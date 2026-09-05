# 单 agent 全文视图（详情抽屉数据源）：run JSON 里只有 harness 截断的 preview，
# 完整 prompt/result 在 agent 转录与 journal。
import json
import re

from . import config
from .config import DETAIL_CAP
from .jsonl import iter_records, tail_records


def api_agent(proj, sess, run, agent):
    # 全文视图：run JSON 里只有 harness 截断的 preview，完整 prompt/result 在 transcript 与 journal
    if re.search(r'[/\\.]', proj + sess + run):
        return {'prompt': '', 'result': ''}
    d = config.PROJ / proj / sess / 'subagents' / 'workflows' / run
    f = d / ('agent-' + re.sub(r'[^0-9a-f]', '', agent) + '.jsonl')
    out = {'prompt': '', 'result': ''}
    if not f.exists():
        return out
    for rec in iter_records(f, 40):
        if rec.get('type') != 'user':
            continue
        c = (rec.get('message') or {}).get('content')
        if isinstance(c, str) and c.strip():
            out['prompt'] = c
            break
        ts = [x.get('text', '') for x in c or [] if isinstance(x, dict) and x.get('type') == 'text']
        if ts:
            out['prompt'] = '\n'.join(ts)
            break
    for rec in reversed(list(tail_records(f, 200000))):  # 转录尾窗反向找最近一条有正文的 assistant
        msg = rec.get('message') or {}
        if msg.get('role') == 'assistant' and isinstance(msg.get('content'), list):
            ts = [x.get('text', '') for x in msg['content'] if isinstance(x, dict) and x.get('type') == 'text']
            if any(t.strip() for t in ts):
                out['result'] = '\n'.join(ts)
                break
    for x in iter_records(d / 'journal.jsonl'):  # journal 的 result 是权威完整值，覆盖转录兜底
        if x.get('type') == 'result' and x.get('agentId') == agent:
            r = x.get('result')
            out['result'] = r if isinstance(r, str) else json.dumps(r, ensure_ascii=False, indent=1)
            break
    out['prompt'] = out['prompt'][:DETAIL_CAP]
    out['result'] = out['result'][:DETAIL_CAP]
    return out
