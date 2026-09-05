# ── Webhook 通知钩子：两类消息 —— ① workflow 进入终态 ② 会话「等待用户输入」(input_required) ──
# 飞书机器人文本 / 通用 JSON；配置与去重均持久化。kind 字段供通用 JSON 消费方分流。
import json
import os
import subprocess
import ssl
import sys
import time
import urllib.request
from pathlib import Path

from . import config
from .config import load_conf
from .scan import scan_cached
from .sessions import scan_sessions_cached

STATUS_ZH = {'completed': '✓ 执行完成', 'failed': '✗ 失败', 'killed': '⛔ 被终止',
             'aborted': '⊘ 未正常收尾', 'error': '✗ 错误', 'stopped': '⏹ 已停止'}
# 等待成因 → 人话（与 sessions.main_state 的 waitReason 一一对应）
WAIT_ZH = {'ask': '等待回答', 'permission': '等待授权(疑似)', 'turn': '等待输入'}  # ⏸ 由正文首行统一加，避免双图标
LAST_HOOK = {'at': 0, 'ok': None, 'status': '', 'reply': ''}


def _dur(ms):
    if ms is None:
        return '—'
    s = ms / 1000
    return f'{s:.0f}s' if s < 60 else (f'{s/60:.1f}m' if s < 3600 else f'{s/3600:.1f}h')


def sess_text(s):
    """input_required 通知正文：先说"在等什么"，再给定位信息(项目/会话)与上下文(在等的工具、最近输出)。"""
    why = s.get('waitReason') or 'turn'
    tool = s.get('waitTool')
    head = WAIT_ZH.get(why, '等待用户输入')
    title = (s.get('title') or s.get('sessionId', '')[:8]).replace('\n', ' ')
    lines = [f"⏸ 会话 {head}: {title}",
             f"项目: {s.get('cwd') or s.get('project')} · {str(s.get('sessionId') or '')[:8]}",
             (f"在等: {tool}") if tool else '',
             f"已静默: {_dur((s.get('ageSec') or 0) * 1000)} · 权限模式: {s.get('permissionMode') or '—'}",
             ('最后输出: ' + str(s.get('lastText') or '').replace('\n', ' ')[:160]) if s.get('lastText') else '']
    return '\n'.join(x for x in lines if x)


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
    f = config.CONF_DIR / 'cas.pem'
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
            config.CONF_DIR.mkdir(parents=True, exist_ok=True)
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


def send_hook(r, text=None, kind='workflow_status'):
    """r = workflow run 或 session 字典；kind 进 JSON 载荷供消费方分流(feishu 只有文本，靠 tag 区分)。"""
    conf = load_conf()
    url = conf.get('url', '')
    if not url.startswith(('http://', 'https://')):
        return False, 'webhook URL 未配置或不合法'
    rid = r.get('runId') or r.get('sessionId') or 'test'
    text = text or hook_text(r)
    if conf.get('format') == 'json':
        payload = {'text': text, 'kind': kind, 'status': r.get('status'),
                   'sessionId': r.get('sessionId') or r.get('session')}
        if kind == 'input_required':
            payload.update({'waitReason': r.get('waitReason'), 'waitTool': r.get('waitTool'),
                            'project': r.get('project'), 'cwd': r.get('cwd'),
                            'lastActivityAt': r.get('lastActivityAt'), 'ageSec': r.get('ageSec')})
        else:
            payload.update({'workflow': r.get('name'), 'tokens': r.get('tokens'),
                            'durationMs': r.get('durationMs'), 'runId': rid})
    else:  # feishu / lark 自定义机器人
        payload = {'msg_type': 'text', 'content': {'text': text}}
    try:
        req = urllib.request.Request(url, data=json.dumps(payload, ensure_ascii=False).encode(),
                                     headers={'Content-Type': 'application/json'}, method='POST')
        resp = urllib.request.urlopen(req, timeout=6, context=hook_ssl_ctx(conf, url))
        ok = 200 <= resp.status < 300
        # 回执留 2000 字：错误正文(网关 HTML/JSON)要能看全，页面侧不再二次截断
        LAST_HOOK.update({'at': time.time(), 'ok': ok, 'status': rid,
                          'reply': resp.read(2000).decode('utf-8', 'replace')})
        return ok, f'HTTP {resp.status}'
    except Exception as e:
        err = str(e)[:2000]
        if 'CERTIFICATE_VERIFY_FAILED' in err and not conf.get('insecure'):
            err += ' ｜ 公司代理证书链问题：重试一次(自动导出钥匙串根证书)仍失败则勾选"跳过证书校验"'
        LAST_HOOK.update({'at': time.time(), 'ok': False, 'status': rid, 'reply': err})
        return False, err


def _sess_key(s):
    """去重键 = 会话 + 本轮静默起点(lastActivityAt 稳定，直到用户再输入)。
    于是"一次等待 = 一条通知"：用户回了话 → 活动戳前移 → 下一轮等待是新键。"""
    return 'sess|%s|%s' % (s.get('sessionId'), s.get('lastActivityAt'))


def notify_inputs(sent, conf, sessions, sweep=False):
    """input_required 分型通知：档位 blocked=只发等回答/等授权(高信号)，all=含回合结束待输入，off=只播种不发。
    与 run 侧同规则 —— 键一律播种(防"事后开启"补发历史等待)，只把发送门控住。返回实发条数。"""
    tier = conf.get('notifyInput', 'blocked')
    n = 0
    for s in sessions:
        k = _sess_key(s)
        if k in sent:
            continue
        sent.add(k)
        if sweep or not conf.get('enabled') or tier == 'off' or s.get('status') != 'input_required':
            continue
        if tier == 'all' or s.get('waitReason') in ('ask', 'permission'):
            send_hook(s, sess_text(s), 'input_required')
            n += 1
    return n


def notify_loop():
    try:
        with open(config.CONF_DIR / 'sent.json') as f:
            sent = set(json.load(f))
    except Exception:
        sent = set()
    sweep = True  # 启动首轮静默播种存量终态，防历史运行刷屏
    persisted = None  # 上次落盘的序列化串：仅内容变化才写(旧写法每 5s 重写一遍全量键表)
    while True:
        try:
            conf = load_conf()
            on = conf.get('enabled')
            for r in scan_cached(6):
                if not r['live'] and r['runId'] not in sent:
                    sent.add(r['runId'])
                    if not sweep and on and r['status'] in STATUS_ZH:
                        send_hook(r)
            notify_inputs(sent, conf, scan_sessions_cached(6), sweep)
            # 键现在混了两类(wf_* / sess|*)且按字典序截断 —— sess| 排在 wf_ 前会先被丢弃,
            # 抬高上限以免过早遗忘(被遗忘=同一等待可能重发一次,代价远小于漏发)
            blob = json.dumps(sorted(sent)[-2000:])
            if blob != persisted:
                config.CONF_DIR.mkdir(parents=True, exist_ok=True)
                with open(config.CONF_DIR / 'sent.json', 'w') as f:
                    f.write(blob)
                persisted = blob
        except Exception as e:
            print(f'[notify] {e}', file=sys.stderr)  # 不静默吞错（可观测性原则，同 tick/render 分报教训）
        finally:
            sweep = False
        time.sleep(5)
