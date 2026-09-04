# 会话层扫描：主 agent（会话本身）与全部非 workflow subagent 的执行状态。
# 数据源（实测）：
#   ~/.claude/sessions/<pid>.json           活进程注册表(pid/sessionId/cwd/startedAt/kind/version…)
#   <proj>/<sess>.jsonl                     主 agent 转录(message.usage/model/stop_reason/工具块/ai-title/permissionMode)
#   <proj>/<sess>/subagents/agent-*.jsonl   Task/teammate 子代理转录 + .meta.json(agentType/name/description/taskKind)
# 状态为尽力而为的推断（无权威 journal），用 tail 窗口解析控制成本。
import json
import os
import re
import time
from pathlib import Path

from .config import PROJ
from .scan import TOOL_RE, recent_sec, jlines, session_cwd

DETAIL_CAP = 80000  # 全文端点单字段上限（对齐 api_agent）

TAIL_BYTES = 262144      # 转录尾部读取窗口
STALL_SEC = 120          # 主 agent:进程活着且 2min 内有写入 -> running，否则 waiting
SUB_ACTIVE_SEC = 90      # subagent:同上阈值判 running
SESSION_HOURS = 2        # 非活跃会话只保留最近 2h 内的
MAX_SESSIONS = 40


def _tail(path, n=TAIL_BYTES):
    try:
        with open(path, 'rb') as f:
            f.seek(0, 2)
            sz = f.tell()
            f.seek(max(0, sz - n))
            if sz > n:
                f.readline()  # 丢可能被截断的半行
            return f.read().decode('utf-8', 'replace')
    except Exception:
        return ''


def _texts(content):
    if isinstance(content, str):
        return [content] if content.strip() else []
    return [x.get('text', '') for x in content or []
            if isinstance(x, dict) and x.get('type') == 'text' and (x.get('text') or '').strip()]


def _analyze(text):
    """从转录尾窗提取:模型/usage 合计/pending 工具/最近文本/最近用户输入/权限模式"""
    usage, seen_mid = {}, {}
    pend = {}
    last_model = last_stop = last_perm = None
    last_text = last_prompt = ''
    tool_calls = 0
    for ln in text.splitlines():
        try:
            d = json.loads(ln)
        except Exception:
            continue
        if d.get('permissionMode'):
            last_perm = d['permissionMode']
        m = d.get('message')
        if not isinstance(m, dict):
            continue
        content = m.get('content')
        blocks = content if isinstance(content, list) else []
        if isinstance(content, list):
            for b in blocks:
                if not isinstance(b, dict):
                    continue
                if b.get('type') == 'tool_use':
                    pend[b.get('id')] = b.get('name') or '?'
                    tool_calls += 1
                elif b.get('type') == 'tool_result':
                    pend.pop(b.get('tool_use_id'), None)
        elif d.get('type') == 'user' and isinstance(content, str) and content.strip():
            last_prompt = content
        if d.get('type') == 'assistant':
            u = m.get('usage')
            if isinstance(u, dict):
                seen_mid[m.get('id') or ''] = u
            if m.get('model'):
                last_model = m['model']
            last_stop = m.get('stop_reason')
            ts = _texts(content)
            if ts:
                last_text = ts[-1]
        elif d.get('type') == 'user':
            ts = _texts(content)
            if ts:
                last_prompt = ts[-1]
    tot = {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0}
    for u in seen_mid.values():
        tot['input'] += u.get('input_tokens') or 0
        tot['output'] += u.get('output_tokens') or 0
        tot['cacheRead'] += u.get('cache_read_input_tokens') or 0
        tot['cacheWrite'] += u.get('cache_creation_input_tokens') or 0
    return {'model': last_model, 'stopReason': last_stop, 'permissionMode': last_perm,
            'tokens': tot, 'pendingTools': list(pend.values())[:8], 'toolCalls': tool_calls,
            'lastText': (last_text or '')[:300], 'lastPrompt': (last_prompt or '')[:300]}


def _title(path, tail_text):
    for ln in tail_text.splitlines():
        if '"ai-title"' in ln:
            try:
                d = json.loads(ln)
            except Exception:
                continue
            if d.get('aiTitle'):
                return d['aiTitle']
    for d in _head(path):  # 尾窗没有则回头部
        if d.get('type') == 'ai-title' and d.get('aiTitle'):
            return d['aiTitle']
    return ''


def _head(path, n=65536):
    try:
        with open(path, 'rb') as f:
            blob = f.read(n).decode('utf-8', 'replace')
    except Exception:
        return
    for ln in blob.splitlines():
        try:
            yield json.loads(ln)
        except Exception:
            continue


def _registry():
    """sessionId -> {pid, entry(原始 json)}，仅收录进程仍存活的条目"""
    out = {}
    for f in (PROJ.parent / 'sessions').glob('*.json'):
        try:
            d = json.load(open(f))
            os.kill(d['pid'], 0)
            out[d['sessionId']] = d
        except Exception:
            continue
    return out


def _subagents(sess_dir, now):
    lst = []
    for f in sorted((sess_dir / 'subagents').glob('agent-*.jsonl')):
        try:
            st = f.stat()
        except Exception:
            continue
        aid = f.stem[len('agent-'):]
        meta = {}
        try:
            meta = json.load(open(f.with_name(f.name + '.meta.json')))
        except Exception:
            pass
        age = now - st.st_mtime
        info = _analyze(_tail(f, 131072))
        if age < SUB_ACTIVE_SEC:
            state = 'running'
        elif info['stopReason'] == 'end_turn':
            state = 'done'
        else:
            state = 'idle'
        names = TOOL_RE.findall(_tail(f, 16384))
        kind = 'teammate' if meta.get('taskKind') == 'in_process_teammate' else 'task'
        lst.append({'agentId': aid,
                    'label': meta.get('name') or meta.get('agentType') or aid[:12],
                    'agentType': meta.get('agentType'), 'description': str(meta.get('description') or '')[:120],
                    'model': info['model'] or meta.get('model'), 'kind': kind,
                    'teamName': meta.get('teamName'), 'color': meta.get('color'),
                    'state': state, 'lastTool': names[-1] if names else None,
                    'pendingTools': info['pendingTools'], 'toolCalls': info['toolCalls'],
                    'tokens': info['tokens'], 'lastActivityAt': int(st.st_mtime * 1000),
                    'prompt': info['lastPrompt'], 'lastText': info['lastText']})
    return lst


def _rev_texts(path, kind, back=200000):
    """尾窗反向找最近一条 kind(user/assistant) 的文本"""
    for ln in reversed(_tail(path, back).splitlines()):
        try:
            d = json.loads(ln)
        except Exception:
            continue
        if d.get('type') != kind:
            continue
        c = (d.get('message') or {}).get('content')
        if kind == 'user' and isinstance(c, str) and c.strip():
            return c[:DETAIL_CAP]
        ts = _texts(c if isinstance(c, list) else [])
        if ts:
            return '\n'.join(ts)[:DETAIL_CAP]
    return ''


def _first_user_text(path):
    for rec in jlines(path, 40):
        if rec.get('type') != 'user':
            continue
        c = (rec.get('message') or {}).get('content')
        if isinstance(c, str) and c.strip():
            return c[:DETAIL_CAP]
        ts = _texts(c if isinstance(c, list) else [])
        if ts:
            return '\n'.join(ts)[:DETAIL_CAP]
    return ''


def _main_steps(path, limit=30):
    """主 agent 执行步骤：按 message.id 聚合尾窗内的 assistant 消息(流式分块会重复同 id)。
    返回稳定键(msgId)的步骤列表 —— 前端抽屉跨轮询重建靠它保持展开态。"""
    steps, tids = {}, {}
    for ln in _tail(path).splitlines():
        try:
            d = json.loads(ln)
        except Exception:
            continue
        if d.get('type') != 'assistant':
            continue
        m = d.get('message') or {}
        mid = m.get('id')
        if not mid:
            continue
        s = steps.setdefault(mid, {'msgId': mid, 'tools': [], 'text': '', 'model': None,
                                   'tokIn': 0, 'tokOut': 0, 'ts': None})
        tids.setdefault(mid, set())
        if d.get('timestamp'):
            s['ts'] = d['timestamp']
        u = m.get('usage') or {}
        s['tokIn'] = u.get('input_tokens') or s['tokIn']
        s['tokOut'] = u.get('output_tokens') or s['tokOut']
        if m.get('model'):
            s['model'] = m['model']
        for b in m.get('content') or []:
            if not isinstance(b, dict):
                continue
            if b.get('type') == 'tool_use' and b.get('id') not in tids[mid]:
                tids[mid].add(b.get('id'))
                s['tools'].append(b.get('name') or '?')
            elif b.get('type') == 'text' and (b.get('text') or '').strip():
                s['text'] = b['text']
    out = [{'msgId': s['msgId'], 'tools': s['tools'], 'text': s['text'][:300], 'model': s['model'],
            'tokIn': s['tokIn'], 'tokOut': s['tokOut'], 'ts': s['ts']} for s in steps.values()]
    return out[-limit:]


def _rev_lines(path, maxbytes=16 * 1024 * 1024, chunk=1 << 20):
    """自文件尾反向逐行产出(块读,跨界残留处理)，上限 maxbytes——旧步骤可能被 MB 级附件挤出尾窗"""
    try:
        with open(path, 'rb') as f:
            f.seek(0, 2)
            pos, buf = f.tell(), b''
            while pos > 0:
                n = min(chunk, pos)
                pos -= n
                f.seek(pos)
                buf = f.read(n) + buf
                lines = buf.split(b'\n')
                buf = lines[0]
                for ln in reversed(lines[1:]):
                    if ln.strip():
                        yield ln
            if buf.strip():
                yield buf
    except Exception:
        return


def _step_detail(path, msg):
    """单步全文：该 message.id 的全部 tool_use 入参 + 文本输出(流式分块聚合，反向深扫至 16MB)"""
    ins, texts, found, scanned = [], [], False, 0
    for ln in _rev_lines(path):
        scanned += 1
        if scanned > 400000:  # 病态大会话的止损线
            break
        try:
            d = json.loads(ln)
        except Exception:
            continue
        if d.get('type') != 'assistant':
            continue
        m = d.get('message') or {}
        if m.get('id') != msg:
            if found:
                break  # 该消息的分块组已扫完
            continue
        found = True
        for b in m.get('content') or []:
            if not isinstance(b, dict):
                continue
            if b.get('type') == 'tool_use':
                ins.append('● %s: %s' % (b.get('name') or '?',
                                          json.dumps(b.get('input') or {}, ensure_ascii=False)[:1500]))
            elif b.get('type') == 'text' and (b.get('text') or '').strip():
                texts.append(b['text'])
    if not found:
        return {'prompt': '', 'result': '', 'miss': True}
    return {'prompt': '\n'.join(reversed(ins))[:DETAIL_CAP], 'result': (texts[0] if texts else '')[:DETAIL_CAP]}


def agent_detail(proj, sess, agent, msg=''):
    """展开抽屉数据源：main=主会话转录(最近输入/输出全文)；main+msg=该步全文；否则非 workflow 子代理(任务=首条 user,结果=末条 assistant)"""
    if re.search(r'[/\\.]', proj + sess) or not re.fullmatch(r'[0-9a-zA-Z_-]{1,64}', agent or ''):
        return {'prompt': '', 'result': ''}
    p = PROJ / proj / (sess + '.jsonl') if agent == 'main' else PROJ / proj / sess / 'subagents' / ('agent-' + agent + '.jsonl')
    if not p.exists():
        return {'prompt': '', 'result': ''}
    if agent == 'main':
        if msg:
            return _step_detail(p, msg) if re.fullmatch(r'[0-9a-zA-Z_-]{1,64}', msg) else {'prompt': '', 'result': ''}
        return {'prompt': _rev_texts(p, 'user'), 'result': _rev_texts(p, 'assistant')}
    return {'prompt': _first_user_text(p), 'result': _rev_texts(p, 'assistant')}


def scan_sessions():
    now = time.time()
    reg = _registry()
    cands = []
    try:
        projects = [p for p in PROJ.iterdir() if p.is_dir()]
    except Exception:
        return []
    for proj in projects:
        for sess in proj.iterdir():
            if not sess.is_dir() or not re.fullmatch(r'[0-9a-f][0-9a-f-]{7,}', sess.name):
                continue
            try:
                mt = sess.stat().st_mtime
            except Exception:
                continue
            alive = sess.name in reg
            if not alive and (now - mt > SESSION_HOURS * 3600 or now - mt > recent_sec()):
                continue
            cands.append((mt, alive, proj, sess))
    cands.sort(key=lambda x: (-x[1], -x[0]))  # 活跃优先，其后按最近活动
    out = []
    for mt, alive, proj, sess in cands[:MAX_SESSIONS]:
        tpath = PROJ / proj.name / (sess.name + '.jsonl')
        text = _tail(tpath)
        info = _analyze(text)
        try:
            fact = tpath.stat().st_mtime
        except Exception:
            fact = mt
        age = now - fact
        ent = reg.get(sess.name) or {}
        try:
            submt = max([f.stat().st_mtime for f in (sess / 'subagents').glob('agent-*.jsonl')], default=0)
        except Exception:
            submt = 0
        age = min(age, now - submt if submt else age)
        status = ('running' if age < STALL_SEC else 'waiting') if alive else 'ended'
        subs = _subagents(sess, now)
        cwd = ent.get('cwd') or session_cwd(proj.name, sess.name)
        out.append({'sessionId': sess.name, 'project': proj.name, 'cwd': cwd,
                    'title': _title(tpath, text), 'status': status, 'alive': alive,
                    'pid': ent.get('pid'), 'kind': ent.get('kind') or ent.get('entrypoint'),
                    'version': ent.get('version'), 'startedAt': ent.get('startedAt') or int(mt * 1000),
                    'lastActivityAt': int((fact if fact >= submt else submt) * 1000),
                    'ageSec': int(age), 'model': info['model'], 'stopReason': info['stopReason'],
                    'permissionMode': info['permissionMode'], 'tokens': info['tokens'],
                    'pendingTools': info['pendingTools'], 'toolCalls': info['toolCalls'],
                    'lastPrompt': info['lastPrompt'], 'lastText': info['lastText'],
                    'steps': _main_steps(tpath), 'subagents': subs})
    return out
