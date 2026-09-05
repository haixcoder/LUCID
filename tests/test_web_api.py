# HTTP 全链路:真起 server.py 子进程(HOME 钉到临时 fixture),从用户入口(页面/API)打到数据出口。
# 覆盖:GET /api/runs //api/sessions //api/config //api/agent //api/subagent / 页面;POST save/test 校验;
#      Origin 同源守卫;路径穿越守卫;404;"页面 ver==api ver" 部署不变量。
import json
import os
import socket
import tempfile
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _util import REPO, ck, done

HOME = Path(tempfile.mkdtemp(prefix='xray-e2e-'))
import atexit
import shutil
atexit.register(shutil.rmtree, HOME, True)
CLD = HOME / '.claude'
PROJ = CLD / 'projects'
(CLD / 'sessions').mkdir(parents=True, exist_ok=True)
(CLD / 'cc-viewer').mkdir(parents=True, exist_ok=True)

# ── fixture:一个已完成 run + 一个进行中 run + 一个活会话 ─────────────────
proj = PROJ / '-fixproj'
proj.mkdir(parents=True)
S1 = str(uuid.uuid4())
now_ms = int(time.time() * 1000)
UU = str(uuid.uuid4())
(proj / (S1 + '.jsonl')).write_text('\n'.join([
    json.dumps({'type': 'user', 'cwd': '/work/fix', 'uuid': UU, 'timestamp': '2026-09-05T04:00:00.000Z',
                'message': {'role': 'user', 'content': '跑个演示流程'}}),
    json.dumps({'type': 'assistant', 'timestamp': '2026-09-05T04:00:05.000Z',
                'message': {'id': 'msgW1', 'model': 'claude-fable-5', 'role': 'assistant',
                            'stop_reason': 'end_turn', 'usage': {'input_tokens': 7, 'output_tokens': 9},
                            'content': [{'type': 'text', 'text': '演示已完成,请查收。'}]}}),
]) + '\n', encoding='utf-8')
(CLD / 'sessions' / ('%s.json' % S1)).write_text(json.dumps(
    {'pid': os.getpid(), 'sessionId': S1, 'cwd': '/work/fix', 'startedAt': now_ms, 'kind': 'interactive'}),
    encoding='utf-8')
wf = proj / S1 / 'workflows'
wf.mkdir(parents=True)
(wf / 'wf_done.json').write_text(json.dumps({
    'runId': 'wf_done', 'workflowName': 'demo-flow', 'status': 'completed', 'startTime': now_ms - 9000,
    'durationMs': 5000, 'totalTokens': 1000, 'agentCount': 2, 'summary': 's',
    'workflowProgress': [
        {'type': 'workflow_phase', 'index': 1, 'title': 'Phase A'},
        {'type': 'workflow_agent', 'label': 'scout', 'phaseTitle': 'Phase A', 'state': 'done', 'tokens': 500,
         'toolCalls': 3, 'durationMs': 2000, 'lastToolName': 'Bash', 'agentId': 'a' * 40,
         'promptPreview': 'pv', 'resultPreview': 'rv'}],
    'logs': ['L1', 'L2'], 'args': {'task': '做一个演示'}, 'result': {'ok': True}}, ensure_ascii=False),
    encoding='utf-8')
lw = proj / S1 / 'subagents' / 'workflows' / 'wf_live1'
lw.mkdir(parents=True)
(lw / 'journal.jsonl').write_text('\n'.join([
    json.dumps({'type': 'started', 'agentId': 'b1'}),
    json.dumps({'type': 'result', 'agentId': 'b1', 'result': 'JOURNAL-FULL-RESULT'})]), encoding='utf-8')
(lw / 'agent-b1.jsonl').write_text('\n'.join([
    json.dumps({'type': 'user', 'message': {'role': 'user', 'content': '任务描述全文'}}),
    json.dumps({'type': 'assistant', 'message': {'id': 'am1', 'role': 'assistant',
                                                 'content': [{'type': 'text', 'text': '转录尾条'}]}})]),
    encoding='utf-8')
(lw / 'agent-b1.jsonl.meta.json').write_text(json.dumps({'agentType': 'Explore'}), encoding='utf-8')

# ── 起真服务 ────────────────────────────────────────────────────────────
sk = socket.socket()
sk.bind(('127.0.0.1', 0))
PORT = sk.getsockname()[1]
sk.close()
env = dict(os.environ, HOME=str(HOME))
srvlog = open(HOME / 'server.out', 'w')
proc = subprocess.Popen([sys.executable, str(REPO / 'scripts' / 'server.py'), '--port', str(PORT)],
                        env=env, stdout=srvlog, stderr=subprocess.STDOUT)
BASE = 'http://127.0.0.1:%d' % PORT


def get(path, headers=None):
    req = urllib.request.Request(BASE + path, headers=headers or {})
    try:
        r = urllib.request.urlopen(req, timeout=10)
        return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


def post(path, data, headers=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(data, ensure_ascii=False).encode(),
                                 headers=dict({'Content-Type': 'application/json'}, **(headers or {})),
                                 method='POST')
    try:
        r = urllib.request.urlopen(req, timeout=10)
        return r.status, json.loads(r.read()), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


try:
    ok = False
    for _ in range(80):
        try:
            if get('/api/runs')[0] == 200:
                ok = True
                break
        except Exception:
            pass
        time.sleep(0.1)
    ck('服务在临时 HOME 下启动并响应 /api/runs', ok, srvlog and Path(HOME / 'server.out').read_text()[-300:])

    # ── /api/runs 结构与两份运行 ──
    code, raw, hd = get('/api/runs')
    d = json.loads(raw)
    ck('runs: 200 + JSON 头 + no-store', code == 200 and hd.get('Content-Type') == 'application/json; charset=utf-8'
       and hd.get('Cache-Control') == 'no-store', str(hd))
    ck('runs: 顶层键 now/ver/recentDays/runs', set(d) == {'now', 'ver', 'recentDays', 'runs'}, str(sorted(d)))
    runs = {r['runId']: r for r in d['runs']}
    ck('runs: 含 fixture 两个运行', set(runs) == {'wf_done', 'wf_live1'}, str(sorted(runs)))
    rd_ = runs.get('wf_done') or {}
    ck('runs: 完成态富字段(name/phases/agents/logs/task)',
       rd_.get('name') == 'demo-flow' and rd_.get('status') == 'completed' and rd_.get('live') is False
       and rd_.get('phases') == [{'title': 'Phase A'}] and rd_.get('logs') == ['L1', 'L2']
       and rd_.get('task') == '做一个演示' and rd_.get('cwd') == '/work/fix', str(rd_)[:220])
    ag0 = (rd_.get('agents') or [{}])[0]
    ck('runs: agent 行字段(label/phase/state/tokens/lastTool)',
       ag0.get('label') == 'scout' and ag0.get('state') == 'done' and ag0.get('tokens') == 500
       and ag0.get('lastTool') == 'Bash', str(ag0))
    lr = runs.get('wf_live1') or {}
    ck('runs: 实时重建(live/running/agent 状态由 journal+meta 合成)',
       lr.get('live') is True and lr.get('status') == 'running'
       and (lr.get('agents') or [{}])[0].get('state') == 'done'
       and (lr.get('agents') or [{}])[0].get('label') == 'Explore'
       and (lr.get('agents') or [{}])[0].get('result') == 'JOURNAL-FULL-RESULT', str(lr)[:220])

    # ── /api/sessions ──
    s1 = json.loads(get('/api/sessions')[1])
    ss = {x['sessionId']: x for x in s1.get('sessions', [])}
    e = ss.get(S1) or {}
    ck('sessions: 活会话出现且回合已完(input_required/turn)',
       e.get('status') == 'input_required' and e.get('waitReason') == 'turn', str(e.get('status')))
    ck('sessions: lastTextMid/提示词/步骤契约字段随行回传',
       e.get('lastTextMid') == 'msgW1' and [p['u'] for p in e.get('prompts') or []] == [UU]
       and [st['msgId'] for st in e.get('steps') or []] == ['msgW1'], str(e.get('prompts')))

    # ── 全文端点 + 守卫 ──
    a = json.loads(get('/api/agent?proj=-fixproj&sess=%s&run=wf_live1&agent=b1' % S1)[1])
    ck('agent: 转录首条 user=任务,journal result 覆盖转录',
       a.get('prompt') == '任务描述全文' and a.get('result') == 'JOURNAL-FULL-RESULT', str(a))
    sb = json.loads(get('/api/subagent?proj=-fixproj&sess=%s&agent=main&msg=msgW1' % S1)[1])
    ck('subagent: main#msgId 拿回合全文', sb.get('result') == '演示已完成,请查收。' and not sb.get('miss'), str(sb))
    sp = json.loads(get('/api/subagent?proj=-fixproj&sess=%s&agent=main&msg=%s' % (S1, UU))[1])
    ck('subagent: main#uuid 拿整条输入全文', sp.get('prompt') == '跑个演示流程', str(sp))
    g1 = json.loads(get('/api/subagent?proj=../../etc&sess=%s&agent=main' % S1)[1])
    g2 = json.loads(get('/api/agent?proj=-fixproj&sess=%s&run=..%%2F..&agent=b1' % S1)[1])
    ck('守卫: 路径穿越参数一律空回(不抛错不泄文件)',
       g1 == {'prompt': '', 'result': ''} and g2 == {'prompt': '', 'result': ''}, str((g1, g2)))

    # ── 页面与版本不变量 ──
    code, html, _ = get('/')
    html = html.decode('utf-8')
    import re as _re
    mv = _re.search(r'wfo-ver" content="([0-9a-f]{12})"', html)
    ck('页面: 200 且 meta[wfo-ver]==api ver(部署不变量)',
       code == 200 and bool(mv) and mv.group(1) == d.get('ver'), str((code, mv and mv.group(1), d.get('ver'))))
    ck('404: 未知路径', get('/nope')[0] == 404)

    # ── POST 校验/Origin 守卫/保存往返 ──
    code, _, _ = post('/api/config/save', {'port': PORT, 'url': ''}, {'Origin': 'http://evil.example'})
    ck('Origin 守卫: 非同源 POST 一律 403', code == 403, str(code))
    code, r, _ = post('/api/config/save', {'port': 99999, 'url': '', 'recentDays': 14})
    ck('save: 端口非法被拒', r.get('ok') is False and '端口非法' in r.get('msg', ''), str(r))
    code, r, _ = post('/api/config/save', {'port': PORT, 'url': 'ftp://x', 'recentDays': 14})
    ck('save: 非 http(s) URL 被拒', r.get('ok') is False and '必须以 http(s):// 开头' in r.get('msg', ''), str(r))
    code, r, _ = post('/api/config/save', {'port': PORT, 'url': '', 'recentDays': -5})
    ck('save: 回看天数非法被拒', r.get('ok') is False and '回看天数非法' in r.get('msg', ''), str(r))
    code, r, _ = post('/api/config/save', {'port': PORT, 'url': '', 'recentDays': 0})
    ck('save: recentDays=0 按前端 ||14 同口径回落默认(设计行为)',
       r.get('ok') is True and r.get('conf', {}).get('recentDays') == 14, str(r))
    hold = socket.socket()
    hold.bind(('127.0.0.1', 0))
    busy = hold.getsockname()[1]
    hold.listen(1)
    code, r, _ = post('/api/config/save', {'port': busy, 'url': '', 'recentDays': 14})
    ck('save: 端口被占用 → 拒存并解释(且不落盘)',
       r.get('ok') is False and '已被占用' in r.get('msg', ''), str(r))
    conf = json.loads(get('/api/config')[1])['conf']
    ck('save: 被拒的改动确实未写入', conf.get('port') != busy, str(conf))
    hold.close()
    code, r, _ = post('/api/config/save', {'port': PORT, 'url': '', 'enabled': False, 'format': 'feishu',
                                           'insecure': False, 'recentDays': 7, 'notifyInput': 'all'},
                      {'Origin': 'http://localhost:%d' % PORT})
    ck('save: 合法保存 → 已保存 + 无 reloc(端口未变)',
       r.get('ok') is True and r.get('msg') == '已保存' and not r.get('reloc'), str(r))
    conf = json.loads(get('/api/config')[1])['conf']
    ck('save: 往返一致(notifyInput=all, recentDays=7)',
       conf.get('notifyInput') == 'all' and conf.get('recentDays') == 7, str(conf))
    ck('runs: recentDays 即时生效于负载', json.loads(get('/api/runs')[1]).get('recentDays') == 7)
    post('/api/config/save', {'port': PORT, 'url': '', 'recentDays': 7})  # 未携带 notifyInput
    conf = json.loads(get('/api/config')[1])['conf']
    ck('save: 缺省字段不清空档位(1.2.13 契约)', conf.get('notifyInput') == 'all', str(conf))
    code, r, _ = post('/api/config/test', {})
    ck('test: 无 URL 时明确失败原因(不假装送达)', r.get('ok') is False and 'webhook URL' in r.get('msg', ''), str(r))
    code, r, _ = post('/api/config/test', {'kind': 'input_required'})
    ck('test: input_required 分型走同一条通路', r.get('ok') is False and 'webhook URL' in r.get('msg', ''), str(r))
finally:
    proc.terminate()
    try:
        proc.wait(5)
    except Exception:
        proc.kill()
    srvlog.close()

done()
