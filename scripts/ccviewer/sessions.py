# 会话层扫描：主 agent（会话本身）与全部非 workflow subagent 的执行状态。
# 数据源（实测）：
#   ~/.claude/sessions/<pid>.json           活进程注册表(pid/sessionId/cwd/startedAt/kind/version…)
#   <proj>/<sess>.jsonl                     主 agent 转录(message.usage/model/stop_reason/工具块/ai-title/permissionMode)
#   <proj>/<sess>/subagents/agent-*.jsonl   Task/teammate 子代理转录 + .meta.json(agentType/name/description/taskKind)
# 状态为尽力而为的推断（无权威 journal），用 tail 窗口解析控制成本。
# 主 agent 状态：running / input_required(等待用户，细分 ask|permission|turn) / waiting / ended，见 main_state()。
import bisect
import json
import os
import re
import threading
import time

from . import config
from .config import DETAIL_CAP, TURN_RESULT_CAP  # 全文契约常量(与 api_agent 同值同契约,住 config 单点)
from .jsonl import head_records, iter_records, rev_lines, tail_records, tail_text
from .scan import TOOL_RE, read_agent_meta, session_cwd

STALL_SEC = 120          # 主 agent:进程活着且 2min 内有写入 -> running，否则 waiting
SUB_ACTIVE_SEC = 90      # subagent:同上阈值判 running
SESSION_HOURS = 2        # 非活跃会话的实时口径保底(回看窗口之外的近期活动仍入列,见 _candidates)
# 旧值 40:1.2.38 会话列表改窗口口径后必截断(实测 10d 窗内 64 会话,被截者仪表计了、列表看不到,
# 症状与所修 bug 同类)。上限是失控库的保险丝:成本 ~3ms/会话,180d 全量 131 会话冷扫实测 0.4s
MAX_SESSIONS = 200
# 明确"要人来回答/确认"的工具：挂起即等于卡住等用户(与是否需要授权无关)
ASK_TOOLS = ('AskUserQuestion', 'ExitPlanMode')
# 模型主动交回话轮的 stop_reason(其余 tool_use=等工具，None=尾窗没采到)
TURN_END = ('end_turn', 'stop_sequence')
# Claude Code 本地合成的末条标记(model 值):API 调用失败/中断时注入,非模型真实应答 → 判失败用(见 _subagents)。
SYNTHETIC_MODEL = '<synthetic>'


def _texts(content):
    if isinstance(content, str):
        return [content] if content.strip() else []
    return [x.get('text', '') for x in content or []
            if isinstance(x, dict) and x.get('type') == 'text' and (x.get('text') or '').strip()]


# ── 用户输入提示词提取 ──
# 转录里 type=user 的不全是"人打的字":工具回执、meta 注入、本地命令包装都混在其中。
# 斜杠命令的真实输入在 <command-args>(如 /goal 的参数);无参命令(/clear)不是提示词。
UUID_RE = re.compile(r'[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}')
_NOISE_PREFIX = ('<local-command-caveat>', '<local-command-stdout>', '<local-command-message>',
                 '<teammate-message', '<task-notification', '<system-reminder', '<command-message>')
PROMPT_MAX = 30  # 尾窗最多回传条数(窗口本身即留存上限,界面以"尾窗"字样摊明)


def _user_prompt(d):
    """该记录是否"用户真的输入了字":是→返回文本;否(tool_result 回执/isMeta 注入/无参命令/噪声包装)→''"""
    if not isinstance(d, dict) or d.get('type') != 'user' or d.get('isMeta'):
        return ''
    c = (d.get('message') or {}).get('content')
    if isinstance(c, str):
        t = c.strip()
    else:
        ts = _texts(c)
        if not ts:
            return ''
        t = '\n'.join(ts).strip()
    if not t or t.startswith(_NOISE_PREFIX):
        return ''
    if t.startswith('<command-name>'):
        nm = re.search(r'<command-name>\s*(\S.*?)\s*</command-name>', t, re.S)
        ar = re.search(r'<command-args>(.*?)</command-args>', t, re.S)
        name = nm.group(1) if nm else ''
        args = ar.group(1).strip() if ar else ''
        return (name + ' ' + args).strip() if (name and args) else ''
    return t


def _merge_prompts(tail, first):
    """尾窗条目(时间序)+ 头扫首条:首条已含于尾窗则不补,否则挂 f:1 置顶 —— 摘要与全文同一提取器,保证一致"""
    fu, ft, fts = first or ('', '', '')
    if not fu or not ft:
        return tail
    if any(p['u'] == fu for p in tail):
        return tail
    return [{'u': fu, 't': ft[:300], 'ts': fts, 'f': 1}] + tail


def _analyze(text):
    """从转录尾窗提取:模型/usage 合计/pending 工具/最近文本/最近用户输入/权限模式/末条消息角色/用户输入提示词列表"""
    usage, seen_mid = {}, {}
    pend = {}
    last_model = last_stop = last_perm = last_kind = None
    last_text = last_prompt = ''
    last_text_mid = ''   # lastText 所在消息 id —— 等待行全文抽屉(data-src=main#<id>)的回取锚点
    tool_calls = 0
    prompts = []         # 尾窗内"用户真的输入"的提示词 [{u,t,ts}](uuid 锚点供前端懒拉全文;无 uuid 不回收,锚不住即不可达)
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
            pu = d.get('uuid') or ''
            pt = _user_prompt(d)
            if pu and pt:
                prompts.append({'u': pu, 't': pt[:300], 'ts': d.get('timestamp') or ''})
    tot = {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0}
    for u in seen_mid.values():
        tot['input'] += u.get('input_tokens') or 0
        tot['output'] += u.get('output_tokens') or 0
        tot['cacheRead'] += u.get('cache_read_input_tokens') or 0
        tot['cacheWrite'] += u.get('cache_creation_input_tokens') or 0
    return {'model': last_model, 'stopReason': last_stop, 'permissionMode': last_perm, 'lastKind': last_kind,
            'tokens': tot, 'pendingTools': list(pend.values())[:8], 'toolCalls': tool_calls,
            # 尾窗内真人输入全量数(prompts 摘要展示会裁到 30 条,计数不许跟着被裁——"调用任务次数"的数据源)
            'turnsTotal': len(prompts),
            'lastText': (last_text or '')[:300], 'lastTextMid': last_text_mid, 'lastPrompt': (last_prompt or '')[:300],
            'prompts': prompts[-PROMPT_MAX:]}


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


def _title(path, tail):
    for ln in tail.splitlines():
        if '"ai-title"' in ln:
            try:
                d = json.loads(ln)
            except Exception:
                continue
            if d.get('aiTitle'):
                return d['aiTitle']
    for d in head_records(path):  # 尾窗没有则回头部
        if d.get('type') == 'ai-title' and d.get('aiTitle'):
            return d['aiTitle']
    return ''


def _registry():
    """sessionId -> {pid, entry(原始 json)}，仅收录进程仍存活的条目"""
    out = {}
    for f in (config.PROJ.parent / 'sessions').glob('*.json'):
        try:
            with open(f) as fh:
                d = json.load(fh)
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
        meta = read_agent_meta(f)  # 单点读取;真机拼法 agent-x.meta.json(1.2.40:旧拼法恒读不到 → 名字恒截断 id)
        age = now - st.st_mtime
        info = _analyze(tail_text(f, 131072))
        if info['model'] == SYNTHETIC_MODEL:
            # 末条是 Claude Code 本地合成的注入(model='<synthetic>')= API 调用失败/中断,不是模型成功应答。
            # 真机踩坑(1.2.24→1.2.25):模型调不到(如"Model not exist")时,失败的子 agent 末条
            # stop_reason 恰为 stop_sequence、文本是"API Error:..."正文,只看 stop_reason∈TURN_END 会把
            # 失败误判成 done(绿"完成")。合成标记才是权威失败信号(真机 60 条:real-model 全是 end_turn,
            # stop_sequence 全是 <synthetic> 错误,零反例)→ 归 error(✕ 红),错误正文留在 lastText 可展开。
            state = 'error'
        elif age < SUB_ACTIVE_SEC:
            state = 'running'
        elif info['stopReason'] in TURN_END:
            # 完成判定与主 agent main_state 同源(TURN_END):真人模型回合可正常收在 end_turn / stop_sequence。
            state = 'done'
        else:
            state = 'idle'
        names = TOOL_RE.findall(tail_text(f, 16384))
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
    for d in reversed(list(tail_records(path, back))):
        if d.get('type') != kind:
            continue
        c = (d.get('message') or {}).get('content')
        if kind == 'user' and isinstance(c, str) and c.strip():
            return c[:DETAIL_CAP]
        ts = _texts(c if isinstance(c, list) else [])
        if ts:
            return '\n'.join(ts)[:DETAIL_CAP]
    return ''


def _first_prompt(path, head=120):
    """会话首条"人打的字"(头扫):长会话首条会掉出读取尾窗,这里兜住它 —— 返回 (uuid, 全文, ts)"""
    for rec in iter_records(path, head):
        t = _user_prompt(rec)
        if t and rec.get('uuid'):
            return rec['uuid'], t, rec.get('timestamp') or ''
    return '', '', ''


def _prompt_detail(path, uu):
    """单条用户输入全文(按记录 uuid 回取):头扫优先(首条常在头部),再反向深扫(尾窗条目靠尾,快速命中)"""
    for rec in iter_records(path, 120):
        if rec.get('type') == 'user' and rec.get('uuid') == uu:
            t = _user_prompt(rec)
            return {'prompt': t[:DETAIL_CAP], 'result': ''} if t else {'prompt': '', 'result': '', 'miss': True}
    scanned = 0
    for ln in rev_lines(path):
        scanned += 1
        if scanned > 400000:  # 病态大会话的止损线(同 _step_detail)
            break
        try:
            d = json.loads(ln)
        except Exception:
            continue
        if d.get('type') == 'user' and d.get('uuid') == uu:
            t = _user_prompt(d)
            return {'prompt': t[:DETAIL_CAP], 'result': ''} if t else {'prompt': '', 'result': '', 'miss': True}
    return {'prompt': '', 'result': '', 'miss': True}


def _first_user_text(path):
    for rec in iter_records(path, 40):
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
    返回稳定键(msgId)的步骤列表 —— 前端抽屉跨轮询重建靠它保持展开态。
    turn 键(1.2.20「一次任务=一个独立展示单元」)= 开启该步所在回合的"真人输入"记录 uuid;
    边界判定复用 _user_prompt 单点(前端不猜),工具回执/isMeta 不开新回合,
    同 id 重传在首次出现定格 turn(尾窗滑动不漂移)。"""
    steps, tids, cur, pseen = {}, {}, '', set()
    for d in tail_records(path):
        if d.get('type') == 'user':
            pu = d.get('uuid') or ''
            if pu and _user_prompt(d):
                cur = pu
                pseen.add(pu)
            continue
        if d.get('type') != 'assistant':
            continue
        m = d.get('message') or {}
        mid = m.get('id')
        if not mid:
            continue
        s = steps.setdefault(mid, {'msgId': mid, 'turn': cur, 'tools': [], 'text': '', 'model': None,
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
    # 孤儿归属回填(真机踩到:单条超长回合把开场输入挤出 256KB 尾窗 → 一批步骤 turn='')。
    # 反向扫"窗外最近一条真人输入"(rev_lines 自尾,首个不在 pseen 的真实输入=该回合开启者)回填,
    # 使组头仍可按该 uuid 懒拉全文(锚点在,只是摘要不在窗内)。找不到(会话开头即 assistant)则保持
    # ''——不造假锚点,前端显式标为无锚孤児组。
    if any(not s['turn'] for s in steps.values()):
        opener = ''
        scanned = 0
        for ln in rev_lines(path):
            scanned += 1
            if scanned > 400000:  # 病态大会话止损线(同 _step_detail/_turn_texts)
                break
            try:
                w = json.loads(ln)
            except Exception:
                continue
            pu = w.get('uuid') or ''
            if pu and pu not in pseen and _user_prompt(w):
                opener = pu
                break
        if opener:
            for s in steps.values():
                if not s['turn']:
                    s['turn'] = opener
    out = [{'msgId': s['msgId'], 'turn': s['turn'], 'tools': s['tools'], 'text': s['text'][:300], 'model': s['model'],
            'tokIn': s['tokIn'], 'tokOut': s['tokOut'], 'ts': s['ts']} for s in steps.values()]
    return out[-limit:]


def _is_turn_boundary(d):
    """反向扫描的回合边界=一条"真人输入"记录(工具回执/注入噪声不算)——一个回合的回答常拆成
    多条消息(过渡文本+工具+收尾文本),逐条展示即用户报的"每次只展示最新一条"。"""
    return d.get('type') == 'user' and bool(_user_prompt(d))


def _result_text(b):
    """tool_result 块 → 可展示文本:文本块拼接/图片占位;is_error 标 ✕;逐条限长且超长显式标注(铁律7)。"""
    c = b.get('content')
    if isinstance(c, list):
        parts = []
        for x in c:
            if not isinstance(x, dict):
                continue
            if x.get('type') == 'text':
                parts.append(x.get('text') or '')
            elif x.get('type') == 'image':
                parts.append('[图片]')
        c = '\n'.join(p for p in parts if p)
    c = str(c or '').strip() or '(无文本回执)'
    if b.get('is_error'):
        c = '✕ ' + c
    if len(c) > TURN_RESULT_CAP:
        c = c[:TURN_RESULT_CAP] + '…(回执超 %d 字截断)' % TURN_RESULT_CAP
    return c


def _turn_texts(path, stop_mid=None):
    """所在回合累计全文:自尾反向收集 assistant text 块 **与工具活动(▸ 调用入参/◂ 回执)** 直到上一条
    真人输入;stop_mid 给出时须先扫到该 message.id(其更新回合的内容在边界处丢弃)。返回 (时间序全文, 是否命中 stop_mid)。
    工具内容不许丢(1.2.18):模型习惯"过渡句:→ 调工具",只收 text 块会让工具型回合的全文变成一串以冒号
    收尾的 empty 句、冒号后永远没内容(真实用户报告;转录里命令与回执俱在,显示层砍的=铁律7 违规)。
    流式重传按 tool_use id 去重(同 _main_steps);最后一个无回执的 ▸ 标「未回执」——回合进行中时
    让页面上看得到"正在跑什么"。"""
    items, found, scanned = [], stop_mid is None, 0
    names, seen_u, done_r = {}, set(), set()

    def reset():
        items.clear()
        names.clear()
        seen_u.clear()
        done_r.clear()

    for ln in rev_lines(path):
        scanned += 1
        if scanned > 400000:  # 病态大会话的止损线(同 _step_detail)
            break
        try:
            d = json.loads(ln)
        except Exception:
            continue
        if _is_turn_boundary(d):
            if found:
                break
            reset()  # 边界之前(时间更靠后)的内容属于更新的回合,与目标消息无关
            continue
        m = d.get('message') or {}
        c = m.get('content')
        if not isinstance(c, list):
            continue
        t = d.get('type')
        if t == 'assistant':
            if m.get('id') == stop_mid:
                found = True
            for b in c:
                if not isinstance(b, dict):
                    continue
                if b.get('type') == 'text' and (b.get('text') or '').strip():
                    items.append(['x', None, b['text']])
                elif b.get('type') == 'tool_use':
                    bid = b.get('id') or ''
                    if bid in seen_u:  # 流式重传(同 id 多条记录)去重
                        continue
                    seen_u.add(bid)
                    nm = b.get('name') or '?'
                    names[bid] = nm  # 供 ◂ 回执反查工具名(反向扫描时回执先于调用被扫到,故渲染留到最后)
                    items.append(['u', bid, json.dumps(b.get('input') or {}, ensure_ascii=False)[:1500]])
        elif t == 'user':
            for b in c:
                if isinstance(b, dict) and b.get('type') == 'tool_result':
                    bid = b.get('tool_use_id')
                    if bid in done_r:
                        continue
                    done_r.add(bid)
                    items.append(['r', bid, _result_text(b)])
    out = []
    for kind, bid, payload in reversed(items):  # 统一在扫描结束后渲染:此时 names 完整,◂ 也能拿到真实工具名
        if kind == 'x':
            out.append(payload)
        elif kind == 'u':
            out.append('▸ %s: %s%s' % (names.get(bid) or '?', payload, '' if bid in done_r else '(未回执)'))
        else:
            out.append('◂ %s: %s' % (names.get(bid) or '?', payload))
    full = '\n\n'.join(out)
    if len(full) > DETAIL_CAP:  # 全局上限必须写明,不许让用户误以为看的就是全部(铁律7)
        full = full[:DETAIL_CAP] + '\n…(回合全文超 %d 字,后续省略)' % DETAIL_CAP
    return full, found


def _step_detail(path, msg):
    """单步全文：IN=该 message.id 的全部 tool_use 入参(按步隔离)；OUT=所在回合的累计文本(时间序,
    反向深扫至 16MB)。回合语义见 _turn_texts。"""
    ins, found, scanned = [], False, 0
    for ln in rev_lines(path):
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
        if m.get('id') == msg:
            found = True
            for b in m.get('content') or []:
                if isinstance(b, dict) and b.get('type') == 'tool_use':
                    ins.append('● %s: %s' % (b.get('name') or '?',
                                              json.dumps(b.get('input') or {}, ensure_ascii=False)[:1500]))
    if not found:
        return {'prompt': '', 'result': '', 'miss': True}
    result, _ = _turn_texts(path, msg)
    return {'prompt': '\n'.join(reversed(ins))[:DETAIL_CAP], 'result': result}


def agent_detail(proj, sess, agent, msg=''):
    """展开抽屉数据源：main=主会话转录(最近输入/输出全文)；main+msg=该步全文；否则非 workflow 子代理(任务=首条 user,结果=末条 assistant)"""
    if re.search(r'[/\\.]', proj + sess) or not re.fullmatch(r'[0-9a-zA-Z_-]{1,64}', agent or ''):
        return {'prompt': '', 'result': ''}
    p = (config.PROJ / proj / (sess + '.jsonl') if agent == 'main'
         else config.PROJ / proj / sess / 'subagents' / ('agent-' + agent + '.jsonl'))
    if not p.exists():
        return {'prompt': '', 'result': ''}
    if agent == 'main':
        if msg:
            # uuid 形态 = 用户输入提示词的回取锚点(用户记录没有 message.id,靠记录 uuid 定位);msg_* = assistant 步骤全文
            if UUID_RE.fullmatch(msg):
                return _prompt_detail(p, msg)
            return _step_detail(p, msg) if re.fullmatch(r'[0-9a-zA-Z_-]{1,64}', msg) else {'prompt': '', 'result': ''}
        return {'prompt': _rev_texts(p, 'user'), 'result': _turn_texts(p)[0]}
    return {'prompt': _first_user_text(p), 'result': _turn_texts(p)[0]}  # 子代理结果=末回合累计,同 _step_detail 根因


SESS_RE = re.compile(r'[0-9a-f][0-9a-f-]{7,}')


def _candidates(now, reg):
    """会话候选 = 转录 <sess>.jsonl ∪ 会话目录 <sess>/(只有子代理等附属文件时才存在)。
    只遍历目录会漏掉"纯交互会话"——没有子代理就没有目录,而它正是「等待用户输入」最该出现的对象。
    活度取两者较新的 mtime;目录可能缺失,故 subagents 一律按可选处理。
    门禁(1.2.38):活跃 ∪ 近 2h 实时口径 ∪ 【回看窗口口径】——窗内有真人输入的会话必须入选,
    否则仪表 TASKS 与下方会话卡对不上账(真实反馈:选 claudeConfig 后指示器 10、列表一张卡没有——
    列表曾只认「活跃 or mtime≤2h」,而仪表 1.2.36/37 已改为按输入时间戳落窗)。判窗走 _window_hit
    单点,与 projects[]/byCwd 同一口径,切换窗口时列表/计数/项目小计一并跟着变。"""
    recent = config.recent_sec()  # 一轮扫描读一次配置(旧写法每个候选都读盘)
    cutoff = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now - recent))
    for proj in (p for p in config.PROJ.iterdir() if p.is_dir()):
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
            if not alive and now - mt > recent:
                continue  # 粗筛(负控制 sound):mtime 出窗 ⇒ 内容必无窗内输入
            if not alive and now - mt > SESSION_HOURS * 3600 and not _window_hit(proj.name, sid, cutoff)[1]:
                continue  # 超 2h 且窗内无真人输入(或被非输入写入顶新、输入其实在窗外)
            yield mt, alive, proj, sid, tp, sd


_INP_LOCK = threading.Lock()
# (proj, sid) -> (mtime_ns, size, (全量计数, 时间戳升序列表, 无时间戳条数))。转录只追加,size/mtime 未变→缓存复用
_INP_CACHE = {}


def _count_file(path):
    """全转录真人输入精确计数:逐行,子串预筛 '"type":"user"' 后才 json.loads → _user_prompt 单点判定
    (与提示词回显同一口径,不另写一份"什么算用户输入")。同 uuid 重传只计一次;无 uuid 逐条计。
    半行(正在写入)解析失败丢弃,下轮 size/mtime 变化自然补上。实测全库 111MB 仅 0.2s——
    尾窗 256KB 启发式会整段漏掉早期输入(1.2.36 修,用户报「执行任务总次数显示错误」)。
    同时收集各条 ISO 时间戳(升序列表):仪表窗口口径按【输入自身时间】落窗,长会话跨窗口边界时
    窗口外部分不许计入(会话 mtime 判窗会把 30 天前的输入记进"近 4 天"总数——实测 151 vs 127)。"""
    seen, cnt, tss, nots = set(), 0, [], 0
    try:
        with open(path, 'r', errors='replace') as f:
            for ln in f:
                if '"type":"user"' not in ln and '"type": "user"' not in ln:  # 真转录为紧凑序列化;容错带空格的写入方
                    continue
                try:
                    d = json.loads(ln)
                except Exception:
                    continue
                if not _user_prompt(d):
                    continue
                u = d.get('uuid') or ''
                if u:
                    if u in seen:
                        continue
                    seen.add(u)
                cnt += 1
                ts = d.get('timestamp') or ''
                if ts:
                    tss.append(ts)
                else:
                    nots += 1
    except OSError:
        return 0, [], 0
    tss.sort()  # ISO8601Z 串可按字典序比较/二分
    return cnt, tss, nots


def _inputs_entry(proj, sid):
    """缓存读取/重算入口:返回 (全量计数, 时间戳升序列表, 无时间戳条数)。"""
    path = config.PROJ / proj / (sid + '.jsonl')
    key = (proj, sid)
    with _INP_LOCK:
        try:
            st = path.stat()
            sig = (st.st_mtime_ns, st.st_size)
        except OSError:
            _INP_CACHE.pop(key, None)
            return 0, [], 0
        ent = _INP_CACHE.get(key)
        if ent and ent[:2] == sig:
            return ent[2]
        val = _count_file(path)
        _INP_CACHE[key] = (sig[0], sig[1], val)
        return val


def count_user_inputs(proj, sid):
    """会话的真人输入总数(全量精确,带缓存)——卡顶「任务 N」数据源。缓存键含 size+mtime_ns:
    截断/改写(变小)→ 全量重算。"""
    return _inputs_entry(proj, sid)[0]


def _window_hit(proj, sid, cutoff):
    """回看窗口判定【唯一实现】(1.2.38):项目列表 / TASKS 仪表 byCwd / 会话卡列表三处共用同一口径,
    不许再写第二份。只信转录内真人输入的自身时间戳(fs mtime 归调用方做「内容不可能比它新」的粗筛);
    返回 (最后一条输入是否落窗内, 窗内输入条数)——无时间戳的旧数据回落 mtime 口径,条数计 nots。"""
    _, tss, nots = _inputs_entry(proj, sid)
    if tss and tss[-1] < cutoff:
        return False, 0
    return True, len(tss) - bisect.bisect_left(tss, cutoff) + nots


def window_activity():
    """项目选择列表 + TASKS 仪表的【单一数据源】(1.2.36)——两处必须同一判窗口径,切换窗口时一起正确;
    会话卡列表(_candidates)自 1.2.38 起也走 _window_hit 同口径——仪表数了什么,下方就能看到什么。
    返回 {'projects': [展示名 sorted], 'tasks': {'total': N, 'byCwd': {展示名: n}}}。
    判窗看转录内容里每条真人输入的【自身时间戳】:fs mtime 只做「内容不可能比它新」的粗筛(负控制 sound),
    不作入选依据——真实反馈:4 天窗口列出没操作过的项目(researchProject mtime 被非输入写入顶到 4.0d,
    最后一次输入其实在 4.9 天前)。无时间戳输入的会话(旧数据/只有 journal 无转录的目录)回落 mtime 判窗;
    跨窗长会话只计窗内输入(全量计会多算:实测 4 天窗口 151 vs 127)。
    展示名=session_cwd(与前端过滤键 cwd||project 同源可去重);写入不晚于 mtime ⇒ mt 出窗者必无窗内输入,跳过不读盘。"""
    now = time.time()
    recent = config.recent_sec()
    cutoff = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now - recent))
    total, by_cwd, labels = 0, {}, set()
    try:
        projects = [p for p in config.PROJ.iterdir() if p.is_dir()]
    except OSError:
        return {'projects': [], 'tasks': {'total': 0, 'byCwd': {}}}
    for proj in projects:
        try:
            entries = list(proj.iterdir())
        except OSError:
            continue
        cands = {}
        for e in entries:
            sid = e.name if e.is_dir() else (e.stem if e.suffix == '.jsonl' else None)
            if not sid or not SESS_RE.fullmatch(sid):
                continue
            try:
                mt = e.stat().st_mtime
                try:
                    mt = max(mt, (proj / (sid + '.jsonl')).stat().st_mtime)
                except OSError:
                    pass
                if mt > cands.get(sid, 0):
                    cands[sid] = mt
            except OSError:
                continue
        for sid, mt in cands.items():
            if now - mt > recent:
                continue
            ok, n = _window_hit(proj.name, sid, cutoff)  # 判窗单点(与会话卡列表同一口径,ISO8601Z 串字典序=时间序)
            if not ok:
                continue  # 最后一次输入已在窗外(mtime 被非输入写入顶新)——不算操作过,不入列
            lbl = session_cwd(proj.name, sid)
            labels.add(lbl)
            if n:
                total += n
                by_cwd[lbl] = by_cwd.get(lbl, 0) + n
    return {'projects': sorted(labels), 'tasks': {'total': total, 'byCwd': by_cwd}}


def scan_sessions():
    now = time.time()
    reg = _registry()
    try:
        cands = sorted(_candidates(now, reg), key=lambda x: (-x[1], -x[0]))  # 活跃优先，其后按最近活动
    except OSError:
        return []
    out = []
    for mt, alive, proj, sid, tpath, sdir in cands[:MAX_SESSIONS]:
        tpath = tpath or config.PROJ / proj.name / (sid + '.jsonl')
        text = tail_text(tpath)
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
        fp = _first_prompt(tpath)  # 头扫首条:prompts 摘要合并用(f:1 判据同 _merge_prompts)
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
                    # turns = 主 agent 被调用的任务次数:全转录精确计数(count_user_inputs,带缓存)。
                    # 旧口径"尾窗全量+头扫首条"对大会话系统性少计(>256KB 的早期输入看不见),1.2.36 修。
                    'turns': count_user_inputs(proj.name, sid),
                    'prompts': _merge_prompts(info['prompts'], fp),
                    'steps': _main_steps(tpath), 'subagents': subs})
    return out


_SESS_CACHE = {'t': 0, 'sessions': []}


def scan_sessions_cached(maxage):
    # 同 scan_cached 的取舍：通知线程 5s 一轮，复用 maxage 秒内的扫描结果省掉重复全盘 I/O
    if time.time() - _SESS_CACHE['t'] > maxage:
        _SESS_CACHE['sessions'] = scan_sessions()
        _SESS_CACHE['t'] = time.time()
    return _SESS_CACHE['sessions']
