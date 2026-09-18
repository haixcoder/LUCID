# 扫描 ~/.claude/projects：合并两数据源 —— 已完成读 run JSON(全量富数据)，
# 进行中的由 journal.jsonl + agent 转录实时重建。状态语义见 README.md「状态语义」。
# JSONL 窗口读取一律走 ccviewer.jsonl；路径/配置一律 config 模块属性(单点可重定向,测试即此入口)。
import json
import os
import re
import threading
import time
from pathlib import Path

from . import config
from .jsonl import iter_records, tail_text

STALE_SEC = 30 * 60          # 运行中但超过 30min 无文件活动 -> 判定 stale
TAIL = 16384
TOOL_RE = re.compile(r'"name":"((?:mcp__)?[A-Za-z0-9_]{2,60})"')

_WF_CACHE = {}  # ponytail: session jsonl 推导的 name/phases/task 对已死 run 是稳定的，进程内永久缓存


def session_wf_meta(proj, sess, run_id):
    key = (proj, sess, run_id)
    if key in _WF_CACHE:
        return _WF_CACHE[key]
    out = (None, [], '')
    uses = {}
    for d in iter_records(config.PROJ / proj / (sess + '.jsonl')):
        content = (d.get('message') or {}).get('content')
        if not isinstance(content, list):
            continue
        for c in content:
            if not isinstance(c, dict):
                continue
            if c.get('type') == 'tool_use' and c.get('name') == 'Workflow':
                uses[c.get('id')] = c.get('input') or {}
            elif c.get('type') == 'tool_result' and run_id in str(c.get('content')):
                inp = uses.get(c.get('tool_use_id'))
                if inp:
                    script = inp.get('script') or ''
                    m = re.search(r"name:\s*['\"]([^'\"]+)['\"]", script[:6000])
                    name = m.group(1) if m else (Path(inp['scriptPath']).stem if inp.get('scriptPath') else None)
                    titles = []
                    pm = re.search(r'phases:\s*\[(.*?)\]', script[:6000], re.S)
                    if pm:
                        titles = re.findall(r"title:\s*['\"]([^'\"]+)['\"]", pm.group(1))
                    args = inp.get('args')
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except Exception:
                            pass
                    task = (args.get('task') if isinstance(args, dict)
                            else (args if isinstance(args, str)
                                  else (json.dumps(args, ensure_ascii=False) if args is not None else ''))) or ''
                    out = (name, titles, str(task)[:1500])
                    break
        if out[0]:
            break
    _WF_CACHE[key] = out
    return out


_CLAUDE_JSON = {'key': None, 'paths': ()}   # ~/.claude.json 真实路径白名单的进程内缓存


def known_project_paths():
    """~/.claude.json 的 projects 键集合(官方逐项目聚合的真实路径 = 白名单),按文件
    (路径, mtime_ns, size) 缓存,变了才重读;文件缺失/坏 JSON 一律空——调用方据此回退 '',绝不猜。"""
    p = config.PROJ.parent.parent / '.claude.json'   # config.PROJ=~/.claude/projects ⇒ 此处=~/.claude.json
    try:
        st = p.stat()
        key = (str(p), st.st_mtime_ns, st.st_size)
    except OSError:
        return ()
    if _CLAUDE_JSON['key'] != key:
        try:
            pr = json.loads(p.read_text(encoding='utf-8')).get('projects')
            paths = tuple(pr) if isinstance(pr, dict) else ()
        except Exception:
            paths = ()
        _CLAUDE_JSON['key'], _CLAUDE_JSON['paths'] = key, paths
    return _CLAUDE_JSON['paths']


def session_cwd(proj_dir, sess_id):
    """会话的真实 cwd = 转录里首个带 cwd 的记录(cwd 只出现在文件开头几行,真机 113/113 在前 5 行内,
    但 38 份恰好压在第 5 行——预算留到 40,命中即 return,成本可忽略)。
    兜底解码:proj_dir 是 cwd 的编码形式('/'→'-'),拿 ~/.claude.json 的真实路径键做**白名单正向比对**,
    精确命中才还真实路径;**都不行返回 ''**(1.2.65 前回退编码名:它会经 cwd||project 渗进项目下拉/
    过滤键/草稿 slug/项目分发,而 _project_workflow_path 拿到非绝对路径只会报错——宁缺毋滥)。"""
    for d in iter_records((config.PROJ / proj_dir / (sess_id + '.jsonl')), 40):
        if d.get('cwd'):
            return d['cwd']
    for real in known_project_paths():
        if real.replace('/', '-') == proj_dir:
            return real
    return ''


def script_meta(sess_id, run_id):
    # 脚本落在发起时 cwd 对应的项目目录下，可能与 transcript 所在项目不同 -> 跨项目按 session id 搜
    for p in config.PROJ.glob(f'*/{sess_id}/workflows/scripts/*-{run_id}.js'):
        try:
            head = p.read_text(errors='replace')[:8000]
        except Exception:
            return None, []
        name = re.search(r"name:\s*['\"]([^'\"]+)['\"]", head)
        titles = []
        m = re.search(r'phases:\s*\[(.*?)\]', head, re.S)
        if m:
            titles = re.findall(r"title:\s*['\"]([^'\"]+)['\"]", m.group(1))
        return (name.group(1) if name else p.stem.replace('-' + run_id, '')), titles
    return None, []


def first_prompt(agent_jsonl):
    for d in iter_records(agent_jsonl, 4):
        if d.get('type') != 'user':
            continue
        c = (d.get('message') or {}).get('content')
        if isinstance(c, str):
            return c[:500]
        for x in c or []:
            if isinstance(x, dict) and x.get('type') == 'text':
                return (x.get('text') or '')[:500]
    return ''


def last_tool(agent_jsonl):
    names = TOOL_RE.findall(tail_text(agent_jsonl, TAIL))
    return names[-1] if names else None


def parse_completed(p, proj, sess, cwd):
    try:
        with open(p, errors='replace') as f:
            d = json.load(f)
    except Exception:
        return None
    agents, phases = [], []
    for e in d.get('workflowProgress') or []:
        if e.get('type') == 'workflow_phase':
            phases.append({'index': e.get('index'), 'title': e.get('title')})
        elif e.get('type') == 'workflow_agent':
            agents.append({
                'label': e.get('label') or e.get('agentId', '')[:8],
                'phase': e.get('phaseTitle'), 'state': e.get('state'),
                'tokens': e.get('tokens'), 'toolCalls': e.get('toolCalls'),
                'durationMs': e.get('durationMs'), 'lastTool': e.get('lastToolName'), 'agentId': e.get('agentId'),
                'prompt': (e.get('promptPreview') or '')[:1600],
                'result': (e.get('resultPreview') or '')[:1000],
            })
    args = d.get('args')
    task = (args.get('task') if isinstance(args, dict)
            else (json.dumps(args, ensure_ascii=False) if args is not None else '')) or ''
    return {
        'runId': d.get('runId') or p.stem, 'project': proj, 'session': sess, 'cwd': cwd,
        'name': d.get('workflowName') or 'workflow', 'summary': d.get('summary') or '',
        'status': d.get('status') or 'completed', 'live': False,
        'startedAt': d.get('startTime'), 'durationMs': d.get('durationMs'),
        'tokens': d.get('totalTokens'), 'agentCount': d.get('agentCount') or len(agents),
        'phases': [{'title': t} for t in script_titles_or(d, phases)],
        'agents': agents, 'logs': [str(x)[:500] for x in (d.get('logs') or [])[-30:]],
        'task': str(task)[:2000], 'result': _res_cap(d.get('result')),
    }


def _res_cap(v):
    if not v:
        return ''
    t = json.dumps(v, ensure_ascii=False, indent=1)
    return t if len(t) <= 4000 else t[:4000] + '…(截断，展开 agent 行可见全文)'


def script_titles_or(d, phases):
    if phases:
        return [p['title'] for p in phases]
    m = re.search(r'phases:\s*\[(.*?)\]', (d.get('script') or '')[:8000], re.S)
    return re.findall(r"title:\s*['\"]([^'\"]+)['\"]", m.group(1)) if m else []


def live_session_ids():
    # ~/.claude/sessions/<pid>.json 是活进程注册表；pid 需仍存活（SIGKILL 可能留下死条目）
    ids = set()
    for f in (config.PROJ.parent / 'sessions').glob('*.json'):
        try:
            with open(f) as fh:
                d = json.load(fh)
            os.kill(d['pid'], 0)
            ids.add(d.get('sessionId'))
        except Exception:
            continue
    return ids


def read_agent_meta(f):
    """子代理 meta 读取单点(sessions._subagents 与 scan.parse_live 共用)。
    真机拼法(Claude Code 实写)= agent-x.meta.json —— find 实测 182 份全为此形,"agent-x.jsonl.meta.json"
    0 份。旧代码按后者拼(f.name+'.meta.json'),open 恒抛被 try 吞 → meta 恒空,网页子代理名恒为
    截断 agentId、与终端后台面板显示的名字不一致(1.2.40 修)。真机形优先;旧形作兜底(第三方宿主
    格式不可控,读取零成本),两形都无则返回 {}。"""
    for cand in (f.with_name(f.name[:-len('.jsonl')] + '.meta.json'), f.with_name(f.name + '.meta.json')):
        try:
            with open(cand) as fh:
                d = json.load(fh)
            return d if isinstance(d, dict) else {}
        except Exception:
            continue
    return {}


def parse_live(d, proj, sess, cwd, now, parent_alive):
    run_id = d.name
    files = [f for f in d.iterdir() if f.is_file()]
    if not files:
        return None
    mt = [f.stat().st_mtime for f in files]
    started, lastact = min(mt), max(mt)
    ev = {}
    for x in iter_records(d / 'journal.jsonl'):
        a = x.get('agentId')
        if not a:
            continue
        if x.get('type') == 'started':
            ev.setdefault(a, {})['started'] = True
        elif x.get('type') == 'result':
            e = ev.setdefault(a, {})
            e['done'] = True
            e['result'] = str(x.get('result'))[:800]
    name, titles = script_meta(sess, run_id)
    task = ''
    if not name:
        name, jt, task = session_wf_meta(proj, sess, run_id)
        titles = titles or jt
    agents = []
    for f in sorted(d.glob('agent-*.jsonl'), key=lambda f: f.stat().st_mtime):
        a = f.stem[len('agent-'):]
        e = ev.get(a, {})
        # label 只认 name,不用 agentType —— workflow run 目录的 meta 真机恒为
        # agentType="workflow-subagent"(find 实测 118/118,无 name),对同 run 全部 agent 同名无区分度,
        # 用它会把可辨识的 hex 换成一模一样的 N 行(修名字反造新回归)。
        label = read_agent_meta(f).get('name') or a[:8]
        agents.append({
            'label': label, 'phase': None, 'agentId': a,
            'state': 'done' if e.get('done') else 'running',
            'tokens': None, 'toolCalls': None, 'durationMs': None,
            'lastTool': None if e.get('done') else last_tool(f),
            'prompt': first_prompt(f), 'result': e.get('result') or '',
        })
    total = len(agents)
    pending = {a for a in ev if not ev[a].get('done')}
    # 权威判活：run JSON 只在父进程正常收尾时写；父会话进程已死 => 孤儿运行，绝不可能还在跑
    if parent_alive or (now - lastact) < 60:  # 60s 宽限防注册表竞态误判
        status = 'running' if (now - lastact) < STALE_SEC else 'stale'
        orphan = False
    else:
        status = 'completed' if not pending else 'aborted'
        orphan = True
    if orphan:
        for a in agents:
            if a['state'] == 'running':
                a['state'] = 'aborted'
    live = status in ('running', 'stale')
    return {
        'runId': run_id, 'project': proj, 'session': sess, 'cwd': cwd,
        'name': name or run_id, 'summary': '', 'status': status,
        'live': live, 'startedAt': int(started * 1000),
        'durationMs': int(((now if live else lastact) - started) * 1000),
        'lastActivityAt': int(lastact * 1000), 'tokens': None, 'agentCount': total,
        'phases': [{'title': t} for t in titles], 'agents': agents, 'logs': [],
        'task': task, 'result': '', 'orphan': orphan,
    }


def scan():
    now = time.time()
    recent = config.recent_sec()   # 一轮扫描读一次配置(窗口在单次快照内一致;旧写法每个会话读盘一次)
    alive = live_session_ids()
    runs, seen = [], set()
    try:
        projects = [p for p in config.PROJ.iterdir() if p.is_dir()]
    except Exception:
        return []
    for proj in projects:
        for sess in proj.iterdir():
            if not sess.is_dir() or not re.fullmatch(r'[0-9a-f][0-9a-f-]{7,}', sess.name):
                continue
            try:
                # "近 N 天有活动"的权威信号=转录文件 mtime(每条消息都追加写);
                # 会话目录 mtime 只在直接子项增删时刷新——journal/run JSON 的写入碰不到它，
                # 单用它会把"老目录里正在跑的 workflow"整段藏掉(仪表 RUNS/LIVE 与实际不符的真实根因)。
                mt = sess.stat().st_mtime
                try:
                    mt = max(mt, (proj / (sess.name + '.jsonl')).stat().st_mtime)
                except OSError:
                    pass
                if now - mt > recent:
                    continue
            except Exception:
                continue
            cwd = None
            wd = sess / 'workflows'
            for p in sorted(wd.glob('wf_*.json')):
                cwd = cwd or session_cwd(proj.name, sess.name)
                r = parse_completed(p, proj.name, sess.name, cwd)
                if r:
                    seen.add(r['runId'])
                    runs.append(r)
            for d in (sess / 'subagents' / 'workflows').glob('wf_*'):
                if d.name in seen or not d.is_dir():
                    continue
                cwd = cwd or session_cwd(proj.name, sess.name)
                r = parse_live(d, proj.name, sess.name, cwd, now, sess.name in alive)
                if r:
                    runs.append(r)
    runs.sort(key=lambda r: (not r['live'], -(r.get('startedAt') or 0)))
    return runs[:200]


_scan_cache = {'t': 0.0, 'runs': []}
# 锁住"检查-过期-重扫-写入"**整段**(1.2.65):HTTP 线程(2s 轮询)与 notify 线程(5s 一轮)现在共用
# 这一份缓存,无锁时两线程会同时判定过期→各扫一遍全盘(旧注释的"竞态最坏=多扫一遍,无害"已不成立)。
# scan()/scan_sessions() 内部都不回调 cached 函数,无重入/死锁风险。
_scan_lock = threading.Lock()


def scan_cached(maxage):
    # HTTP 与 notify 共用一份近期扫描,省掉重复全盘 I/O;整对象缓存含时间态字段,
    # maxage=2s 对 2s 轮询的 UI 不可见(口径与 Step2 TODO 见 web.do_GET)
    with _scan_lock:
        if time.time() - _scan_cache['t'] > maxage:
            _scan_cache['runs'] = scan()
            _scan_cache['t'] = time.time()
        return _scan_cache['runs']
