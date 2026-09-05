# 会话层扫描：主 agent（会话本身）与全部非 workflow subagent 的执行状态。
# 数据源（实测）：
#   ~/.claude/sessions/<pid>.json           活进程注册表(pid/sessionId/cwd/startedAt/kind/version…)
#   <proj>/<sess>.jsonl                     主 agent 转录(message.usage/model/stop_reason/工具块/ai-title/permissionMode)
#   <proj>/<sess>/subagents/agent-*.jsonl   Task/teammate 子代理转录 + .meta.json(agentType/name/description/taskKind)
# 状态为尽力而为的推断（无权威 journal），用 tail 窗口解析控制成本。
# 主 agent 状态：running / input_required(等待用户，细分 ask|permission|turn) / waiting / ended，见 main_state()。
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
# 明确"要人来回答/确认"的工具：挂起即等于卡住等用户(与是否需要授权无关)
ASK_TOOLS = ('AskUserQuestion', 'ExitPlanMode')
# 模型主动交回话轮的 stop_reason(其余 tool_use=等工具，None=尾窗没采到)
TURN_END = ('end_turn', 'stop_sequence')


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
    """从转录尾窗提取:模型/usage 合计/pending 工具/最近文本/最近用户输入/权限模式/末条消息角色"""
    usage, seen_mid = {}, {}
    pend = {}
    last_model = last_stop = last_perm = last_kind = None
    last_text = last_prompt = ''
    last_text_mid = ''   # lastText 所在消息 id —— 等待行全文抽屉(data-src=main#<id>)的回取锚点
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
        # 末条"带 message 的记录"是什么角色：判定「模型已交回话轮」还是「用户刚发了/工具刚回来」
        if d.get('type') in ('assistant', 'user'):
            last_kind = d['type']
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
                last_text_mid = m.get('id') or ''
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
    return {'model': last_model, 'stopReason': last_stop, 'permissionMode': last_perm, 'lastKind': last_kind,
            'tokens': tot, 'pendingTools': list(pend.values())[:8], 'toolCalls': tool_calls,
            'lastText': (last_text or '')[:300], 'lastTextMid': last_text_mid, 'lastPrompt': (last_prompt or '')[:300]}


def main_state(info, alive, age):
    """主 agent 状态(3.2)：running / input_required(等待用户) / waiting / ended。
    input_required 按成因细分 waitReason ——
      ask        : 挂起 AskUserQuestion / ExitPlanMode，模型在等用户回答或确认计划;
      permission : 挂起普通工具且转录已静默 >= STALL_SEC，最合理解释是卡在授权确认(无法与"长命令仍在跑"区分,故文档里写"疑似");
      turn       : 无挂起工具、末条为 assistant 且 stop_reason 为交回话轮 —— 模型说完了,等你下一句。
    纯推断(无权威 journal),与既有 running/waiting 同级;误报代价只是一条可关的通知。"""
    if not alive:
        return 'ended', None, None
    pend = info['pendingTools']
    if pend:
        ask = next((t for t in pend if t in ASK_TOOLS), None)
        if ask:
            return 'input_required', 'ask', ask
        if age >= STALL_SEC:
            return 'input_required', 'permission', pend[0]
        return 'running', None, None
    if info.get('lastKind') == 'assistant' and info['stopReason'] in TURN_END:
        return 'input_required', 'turn', None
    return ('running', None, None) if age < STALL_SEC else ('waiting', None, None)


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


SESS_RE = re.compile(r'[0-9a-f][0-9a-f-]{7,}')


def _candidates(now, reg):
    """会话候选 = 转录 <sess>.jsonl ∪ 会话目录 <sess>/(只有子代理等附属文件时才存在)。
    只遍历目录会漏掉"纯交互会话"——没有子代理就没有目录,而它正是「等待用户输入」最该出现的对象。
    活度取两者较新的 mtime;目录可能缺失,故 subagents 一律按可选处理。"""
    for proj in (p for p in PROJ.iterdir() if p.is_dir()):
        try:
            entries = list(proj.iterdir())
        except Exception:
            continue
        dirs, files = {}, {}
        for e in entries:
            if not SESS_RE.fullmatch(e.stem):
                continue
            (dirs if e.is_dir() else files if e.suffix == '.jsonl' else {}).setdefault(e.stem, e)
        for sid in set(dirs) | set(files):
            tp, sd = files.get(sid), dirs.get(sid)
            try:
                mt = max([p.stat().st_mtime for p in (tp, sd) if p])
            except Exception:
                continue
            alive = sid in reg
            if not alive and (now - mt > SESSION_HOURS * 3600 or now - mt > recent_sec()):
                continue
            yield mt, alive, proj, sid, tp, sd


def scan_sessions():
    now = time.time()
    reg = _registry()
    try:
        cands = sorted(_candidates(now, reg), key=lambda x: (-x[1], -x[0]))  # 活跃优先，其后按最近活动
    except OSError:
        return []
    out = []
    for mt, alive, proj, sid, tpath, sdir in cands[:MAX_SESSIONS]:
        tpath = tpath or PROJ / proj.name / (sid + '.jsonl')
        text = _tail(tpath)
        info = _analyze(text)
        try:
            fact = tpath.stat().st_mtime
        except Exception:
            fact = mt
        age = now - fact
        ent = reg.get(sid) or {}
        try:
            submt = max([f.stat().st_mtime for f in (sdir / 'subagents').glob('agent-*.jsonl')], default=0) if sdir else 0
        except Exception:
            submt = 0
        age = min(age, now - submt if submt else age)
        status, why, wtool = main_state(info, alive, age)
        subs = _subagents(sdir, now) if sdir else []
        cwd = ent.get('cwd') or session_cwd(proj.name, sid)
        out.append({'sessionId': sid, 'project': proj.name, 'cwd': cwd,
                    'title': _title(tpath, text), 'status': status, 'alive': alive,
                    'waitReason': why, 'waitTool': wtool,
                    'pid': ent.get('pid'), 'kind': ent.get('kind') or ent.get('entrypoint'),
                    'version': ent.get('version'), 'startedAt': ent.get('startedAt') or int(mt * 1000),
                    'lastActivityAt': int((fact if fact >= submt else submt) * 1000),
                    'ageSec': int(age), 'model': info['model'], 'stopReason': info['stopReason'],
                    'permissionMode': info['permissionMode'], 'tokens': info['tokens'],
                    'pendingTools': info['pendingTools'], 'toolCalls': info['toolCalls'],
                    'lastPrompt': info['lastPrompt'], 'lastText': info['lastText'],
                    'lastTextMid': info['lastTextMid'],
                    'steps': _main_steps(tpath), 'subagents': subs})
    return out


_SESS_CACHE = {'t': 0, 'sessions': []}


def scan_sessions_cached(maxage):
    # 同 scan_cached 的取舍：通知线程 5s 一轮，复用 maxage 秒内的扫描结果省掉重复全盘 I/O
    if time.time() - _SESS_CACHE['t'] > maxage:
        _SESS_CACHE['sessions'] = scan_sessions()
        _SESS_CACHE['t'] = time.time()
    return _SESS_CACHE['sessions']
