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

HOME = Path(tempfile.mkdtemp(prefix='lucid-e2e-'))
import atexit
import shutil
atexit.register(shutil.rmtree, HOME, True)
CLD = HOME / '.claude'
PROJ = CLD / 'projects'
(CLD / 'sessions').mkdir(parents=True, exist_ok=True)
(CLD / 'cc-viewer').mkdir(parents=True, exist_ok=True)

# ── fixture:一个已完成 run + 一个进行中 run + 一个活会话 + 一个窗内历史会话(S3,1.2.38) ──
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
# S2:工具型回合会话(1.2.18「冒号收尾全文」e2e:过渡句以:结尾,内容在 ▸/◂ 里,HTTP 层必须能拿全)
S2 = str(uuid.uuid4())
(proj / (S2 + '.jsonl')).write_text('\n'.join([
    json.dumps({'type': 'user', 'cwd': '/work/fix', 'uuid': str(uuid.uuid4()), 'timestamp': '2026-09-05T04:00:00.000Z',
                'message': {'role': 'user', 'content': '测工具可见'}}),
    json.dumps({'type': 'assistant', 'message': {'id': 'msgT1', 'role': 'assistant', 'stop_reason': 'tool_use',
                                                 'content': [{'type': 'text', 'text': '先跑命令：'},
                                                             {'type': 'tool_use', 'id': 'tu1', 'name': 'Bash',
                                                              'input': {'command': 'echo X'}}]}}),
    json.dumps({'type': 'user', 'message': {'role': 'user', 'content': [
        {'type': 'tool_result', 'tool_use_id': 'tu1', 'content': '回执-8899-OUT'}]}}),
    json.dumps({'type': 'assistant', 'message': {'id': 'msgT2', 'role': 'assistant', 'stop_reason': 'end_turn',
                                                 'content': [{'type': 'text', 'text': '完成'}]}}),
]) + '\n', encoding='utf-8')
# S3:回看窗口内的历史会话(输入 1 天前∈14d 窗,mtime 5h 前>2h 实时口径,不在活注册表)——
# 1.2.38 起必须出现在 /api/sessions(仪表 byCwd 数了它,下方列表就要能看到概览)
S3 = str(uuid.uuid4())
s3 = proj / (S3 + '.jsonl')
s3.write_text('\n'.join([
    json.dumps({'type': 'user', 'cwd': '/work/fix', 'uuid': str(uuid.uuid4()),
                'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - 86400)),
                'message': {'role': 'user', 'content': '昨天跑完的任务'}}),
    json.dumps({'type': 'assistant', 'message': {'id': 'msgH1', 'role': 'assistant', 'stop_reason': 'end_turn',
                                                 'content': [{'type': 'text', 'text': '历史回执'}]}}),
]) + '\n', encoding='utf-8')
mt5h = time.time() - 5 * 3600
os.utime(s3, (mt5h, mt5h))
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
# meta 用真机拼法与真机 workflow 形态(find 实测 118/118 = agentType generic+spawnDepth,无 name)
(lw / 'agent-b1.meta.json').write_text(json.dumps({'agentType': 'workflow-subagent', 'spawnDepth': 1}),
                                       encoding='utf-8')

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
    ck('runs: 顶层键 now/ver/recentDays/runs/projects/tasks', set(d) == {'now', 'ver', 'recentDays', 'runs', 'projects', 'tasks'}, str(sorted(d)))
    # 项目选择列表数据源:窗口内有活动的全部项目(按转录 cwd 解析)——fixture 两会话同项目 → 去重一条
    ck('runs: projects 含回看窗口内活动项目且去重', d.get('projects') == ['/work/fix'], str(d.get('projects')))
    # TASKS 仪表数据源:回看窗口内全部会话的真人输入精确总数+按项目小计(S1/S2/S3 各 1 条输入)
    ck('runs: tasks 覆盖窗口全部会话(含不在视图的已结束会话)',
       (d.get('tasks') or {}).get('total') == 3 and (d.get('tasks') or {}).get('byCwd') == {'/work/fix': 3}, str(d.get('tasks')))
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
    # label:workflow meta 真机无 name(agentType 恒 generic "workflow-subagent",118/118)→ 回落 hex,
    #       不许把同名 agentType 顶进 label(17 个 agent 一模一样的新回归,1.2.40 边界;name 路径钉在 test_subagent_label)
    ck('runs: 实时重建(live/running/agent 状态由 journal+meta 合成)',
       lr.get('live') is True and lr.get('status') == 'running'
       and (lr.get('agents') or [{}])[0].get('state') == 'done'
       and (lr.get('agents') or [{}])[0].get('label') == 'b1'
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
    # turns=主 agent 被调用的任务次数(全转录精确计数,1.2.36;与 prompts 摘要的 30 条上限无关)
    ck('sessions: turns 计数随行回传(全量精确,S1 一条真人输入)', e.get('turns') == 1, repr(e.get('turns')))
    # 1.2.38:回看窗口内的历史会话(mtime 超 2h、非活跃)必须随列表回传——仪表计了它,列表就要能看到概览
    e3 = ss.get(S3) or {}
    ck('sessions: 窗内历史会话入列(与仪表 byCwd 同一判窗口径)',
       e3.get('status') == 'ended' and e3.get('alive') is False and e3.get('turns') == 1, str(e3)[:160])
    ck('sessions: 列表各会话 turns 之和 == 仪表 byCwd(用户拿列表核仪表)',
       sum(x.get('turns') or 0 for x in ss.values()) == (d.get('tasks') or {}).get('byCwd', {}).get('/work/fix'),
       str({k: v.get('turns') for k, v in ss.items()}))

    # ── 全文端点 + 守卫 ──
    a = json.loads(get('/api/agent?proj=-fixproj&sess=%s&run=wf_live1&agent=b1' % S1)[1])
    ck('agent: 转录首条 user=任务,journal result 覆盖转录',
       a.get('prompt') == '任务描述全文' and a.get('result') == 'JOURNAL-FULL-RESULT', str(a))
    sb = json.loads(get('/api/subagent?proj=-fixproj&sess=%s&agent=main&msg=msgW1' % S1)[1])
    ck('subagent: main#msgId 拿回合全文', sb.get('result') == '演示已完成,请查收。' and not sb.get('miss'), str(sb))
    st2 = json.loads(get('/api/subagent?proj=-fixproj&sess=%s&agent=main&msg=msgT1' % S2)[1])
    ck('subagent e2e: 工具型回合全文含 ▸ 命令与 ◂ 回执(冒号后不再空)',
       'echo X' in (st2.get('result') or '') and '回执-8899-OUT' in (st2.get('result') or '')
       and not st2.get('miss'), str(st2)[:200])
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

    # ── 编排器物料(1.2.43):白名单静态件 + 草稿 save/list 全链路 ──
    code, raw, hd = get('/static/xyflow.system.umd.js')
    ck('static: vendored UMD 200 + JS 头 + 首字节非 HTML + no-store',
       code == 200 and hd.get('Content-Type') == 'text/javascript; charset=utf-8'
       and hd.get('Cache-Control') == 'no-store' and raw[:1] != b'<' and len(raw) > 50000,
       str((code, hd.get('Content-Type'), raw[:24])))
    for badp in ['/static/../server.py', '/static/%2e%2e/server.py', '/static/index.html', '/static/config.json', '/static/nope.js']:
        ck('static: 穿越/未列名 → 404 (%s)' % badp, get(badp)[0] == 404, str(get(badp)[0]))
    code, r, _ = post('/api/draft/save', {'name': 'e2e', 'draft': {'v': 1, 'cwd': '/work/fix'}, 'script': 'x'},
                      {'Origin': 'http://evil.example'})
    ck('draft: Origin 守卫同样覆盖新 POST 端点(异源 403)', code == 403 and not isinstance(r, dict), str(code))
    DSCRIPT = 'export const meta = { name: "e2e-flow", description: "", phases: [{ title: "Scope" }] }\nreturn { ok: 1 }\n'
    DDRAFT = {'v': 1, 'name': 'e2e-flow', 'desc': '端到端草稿', 'cwd': '/work/fix',
              'nodes': [{'id': 'n1', 'type': 'start', 'position': {'x': 0, 'y': 0}, 'data': {'note': 'q'}}],
              'edges': [], 'next': 2, 'view': {'x': 0, 'y': 0, 'zoom': 1}}
    code, r, _ = post('/api/draft/save', {'name': 'e2e-flow', 'draft': DDRAFT, 'script': DSCRIPT})
    jsp = Path(r.get('path', ''))
    ck('draft: HTTP 保存 → 200/ok + 落盘在临时 HOME 的 cc-viewer/drafts 内',
       code == 200 and r.get('ok') is True and str(jsp).startswith(str(CLD / 'cc-viewer' / 'drafts')) and jsp.is_file(), str(r)[:200])
    ck('draft: 执行件与草稿成对落盘(内容逐字节 = 请求)',
       jsp.read_text(encoding='utf-8') == DSCRIPT and jsp.with_suffix('.json').read_text(encoding='utf-8')
       == json.dumps(DDRAFT, ensure_ascii=False))
    ck('draft: 绝不含 ~/.claude/projects 写盘(铁律 2)', not list(PROJ.rglob('e2e-flow*')), str(PROJ))
    lcode, lraw, _ = get('/api/drafts?proj=/work/fix')
    code, lst = lcode, json.loads(lraw)
    items = {it['name']: it for it in lst.get('drafts', [])}
    ck('draft: save→list 往返一致(回载再编辑的数据面)',
       code == 200 and 'e2e-flow' in items and (items['e2e-flow'].get('draft') or {}).get('desc') == '端到端草稿'
       and Path(items['e2e-flow']['js']).is_file(), str(lst)[:200])
    ck('draft: 列表口径==磁盘枚举(无第二判定)',
       sorted(items) == sorted(p.stem for p in jsp.parent.glob('*.json')), str((sorted(items), sorted(p.stem for p in jsp.parent.glob('*.json')))))
    # proj 缺省 → 与保存端同一 slug 判定(_draft_dir('')),该目录下确实没有草稿
    ck('draft: proj 缺省时列表为空(判定与保存端同源,不 500)',
       json.loads(get('/api/drafts')[1]).get('drafts') == [], str(get('/api/drafts')[1])[:160])
    ck('draft: 中文/带空格项目路径可存可取(URL 编码往返)',
       post('/api/draft/save', {'name': 'cn', 'draft': dict(DDRAFT, cwd='/work/测 试 目录', name='cn'), 'script': '// cn\n'})[1].get('ok') is True
       and 'cn' in [x['name'] for x in json.loads(get('/api/drafts?proj=' + urllib.parse.quote('/work/测 试 目录'))[1])['drafts']],
       '中文 cwd 往返')
    ck('draft: 恶意 name 经 HTTP 同样被拒',
       post('/api/draft/save', {'name': '../escape', 'draft': DDRAFT, 'script': 'x'})[1].get('ok') is False)
    ck('draft: draft.v!=1 经 HTTP 被拒',
       post('/api/draft/save', {'name': 'vv', 'draft': {'v': 2, 'cwd': '/work/fix'}, 'script': 'x'})[1].get('ok') is False)
finally:
    proc.terminate()
    try:
        proc.wait(5)
    except Exception:
        proc.kill()
    srvlog.close()

done()
