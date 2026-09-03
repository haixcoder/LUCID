# ── Webhook 通知钩子：workflow 进入终态时推送（飞书机器人文本 / 通用 JSON），配置与去重均持久化 ──
import json
import os
import subprocess
import ssl
import sys
import time
import urllib.request
from pathlib import Path

from .config import CONF_DIR, load_conf
from .scan import scan_cached

STATUS_ZH = {'completed': '✓ 执行完成', 'failed': '✗ 失败', 'killed': '⛔ 被终止',
             'aborted': '⊘ 未正常收尾', 'error': '✗ 错误', 'stopped': '⏹ 已停止'}
LAST_HOOK = {'at': 0, 'ok': None, 'status': '', 'reply': ''}


def _dur(ms):
    if ms is None:
        return '—'
    s = ms / 1000
    return f'{s:.0f}s' if s < 60 else (f'{s/60:.1f}m' if s < 3600 else f'{s/3600:.1f}h')


def hook_text(r, tag='⚡ Workflow'):
    st = STATUS_ZH.get(r.get('status'), r.get('status', '?'))
    task = (r.get('task') or r.get('summary') or '').replace('\n', ' ')
    res = str(r.get('result') or '')
    if not res and r.get('status') == 'aborted':
        res = '发起会话已结束，未正常收尾'
    ags = r.get('agents') or []
    done = sum(1 for a in ags if a.get('state') == 'done')
    tok = r.get('tokens')
    lines = [f"{tag} {st}: {r.get('name')}",
             ('任务: ' + task[:80]) if task else '',
             f"项目: {r.get('cwd') or r.get('project')} · {r.get('runId')}",
             f"Tokens: {f'{tok:,}' if isinstance(tok, int) else tok} · 用时: {_dur(r.get('durationMs'))} · agents: {done}/{r.get('agentCount') or len(ags)}",
             ('概要: ' + res.replace('\n', ' ')[:200]) if res else '']
    return '\n'.join(x for x in lines if x)


_CA_CACHE_TS = [0.0]


def macOS_ca_bundle():
    # 公司代理的 MITM 根证书在系统钥匙串里，而 Python 不读钥匙串 -> 导出三库合并成 PEM（每日刷新）
    f = CONF_DIR / 'cas.pem'
    try:
        if f.exists() and time.time() - _CA_CACHE_TS[0] < 86400 and 'BEGIN CERTIFICATE' in f.read_text():
            return str(f)
    except Exception:
        pass
    pem = ''
    for kc in ('/System/Library/Keychains/SystemRootCertificates.keychain',
               '/Library/Keychains/System.keychain',
               os.path.expanduser('~/Library/Keychains/login.keychain-db')):
        try:
            out = subprocess.run(['security', 'find-certificate', '-a', '-p', kc], capture_output=True, timeout=15)
            if out.returncode == 0:
                pem += out.stdout.decode(errors='replace')
        except Exception:
            continue
    if 'BEGIN CERTIFICATE' in pem:
        try:
            CONF_DIR.mkdir(parents=True, exist_ok=True)
            f.write_text(pem)
            _CA_CACHE_TS[0] = time.time()
            return str(f)
        except Exception:
            pass
    return None


def hook_ssl_ctx(conf, url):
    if not url.startswith('https://'):
        return None
    if conf.get('insecure'):
        return ssl._create_unverified_context()
    if sys.platform == 'darwin':
        ca = macOS_ca_bundle()
        if ca:
            return ssl.create_default_context(cafile=ca)
    return None  # 平台默认信任库


def send_hook(r):
    conf = load_conf()
    url = conf.get('url', '')
    if not url.startswith(('http://', 'https://')):
        return False, 'webhook URL 未配置或不合法'
    text = hook_text(r)
    if conf.get('format') == 'json':
        payload = {'text': text, 'workflow': r.get('name'), 'status': r.get('status'),
                   'tokens': r.get('tokens'), 'durationMs': r.get('durationMs'), 'runId': r.get('runId')}
    else:  # feishu / lark 自定义机器人
        payload = {'msg_type': 'text', 'content': {'text': text}}
    try:
        req = urllib.request.Request(url, data=json.dumps(payload, ensure_ascii=False).encode(),
                                     headers={'Content-Type': 'application/json'}, method='POST')
        resp = urllib.request.urlopen(req, timeout=6, context=hook_ssl_ctx(conf, url))
        ok = 200 <= resp.status < 300
        LAST_HOOK.update({'at': time.time(), 'ok': ok, 'status': r.get('runId', 'test'),
                          'reply': resp.read(200).decode('utf-8', 'replace')})
        return ok, f'HTTP {resp.status}'
    except Exception as e:
        err = str(e)[:200]
        if 'CERTIFICATE_VERIFY_FAILED' in err and not conf.get('insecure'):
            err += ' ｜ 公司代理证书链问题：重试一次(自动导出钥匙串根证书)仍失败则勾选"跳过证书校验"'
        LAST_HOOK.update({'at': time.time(), 'ok': False, 'status': r.get('runId', 'test'), 'reply': err})
        return False, err


def notify_loop():
    try:
        sent = set(json.load(open(CONF_DIR / 'sent.json')))
    except Exception:
        sent = set()
    sweep = True  # 启动首轮静默播种存量终态，防历史运行刷屏
    while True:
        try:
            conf = load_conf()
            for r in scan_cached(6):
                if not r['live'] and r['runId'] not in sent:
                    sent.add(r['runId'])
                    if not sweep and conf.get('enabled') and r['status'] in STATUS_ZH:
                        send_hook(r)
            CONF_DIR.mkdir(parents=True, exist_ok=True)
            json.dump(sorted(sent)[-800:], open(CONF_DIR / 'sent.json', 'w'))
        except Exception as e:
            print(f'[notify] {e}', file=sys.stderr)  # 不静默吞错（可观测性原则，同 tick/render 分报教训）
        finally:
            sweep = False
        time.sleep(5)
