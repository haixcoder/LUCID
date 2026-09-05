# OUT 面板 =「回合累计」契约(移植自 /tmp/t5_turn_cumulative.py,1.2.15):
# 一次回答常拆多条 assistant 消息(过渡文本+工具+收尾),单步只展示自己那块 = 用户报的"每次只展示最新一条"。
# 回合边界 = 上一条真人输入(_user_prompt 判定);工具回执/isMeta 注入不断回合;IN 仍按步隔离。
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _util import ck, done

from ccviewer import sessions


def rec(t, content, uuid=None, mid=None, **kw):
    d = {'type': t}
    if uuid:
        d['uuid'] = uuid
    msg = {'content': content}
    if mid:
        msg['id'] = mid
    d['message'] = msg
    d.update(kw)
    return json.dumps(d, ensure_ascii=False)


LINES = [
    rec('user', '提示词A:修仪表', 'u-1'),
    rec('assistant', [{'type': 'text', 'text': 'T-A1 开始处理'}], 'a1', mid='msg_m1'),
    rec('assistant', [{'type': 'tool_use', 'id': 't1', 'name': 'Bash', 'input': {'command': 'ls'}}], 'a2', mid='msg_m1'),
    rec('user', [{'type': 'tool_result', 'tool_use_id': 't1', 'content': 'ok'}], 'a3'),
    rec('assistant', [{'type': 'text', 'text': 'T-A2 继续分析'}], 'a4', mid='msg_m2'),
    rec('assistant', [{'type': 'text', 'text': 'T-A3 本回合收尾'}], 'a5', mid='msg_m3'),
    rec('user', '提示词B:再核对', 'u-6'),
    rec('assistant', [{'type': 'text', 'text': 'T-B1 收到'}], 'b1', mid='msg_m4'),
    rec('assistant', [{'type': 'tool_use', 'id': 't2', 'name': 'Edit', 'input': {'path': 'x'}}], 'b2', mid='msg_m4'),
    rec('user', [{'type': 'tool_result', 'tool_use_id': 't2', 'content': 'done'}], 'b3'),
    rec('assistant', [{'type': 'text', 'text': 'T-B2 全部完成'}], 'b4', mid='msg_m5'),
]
BLOB = '\n'.join(LINES) + '\n'

with tempfile.TemporaryDirectory() as td:
    fp = Path(td) / 's.jsonl'
    fp.write_text(BLOB, encoding='utf-8')

    d = sessions._step_detail(fp, 'msg_m2')
    r = d['result']
    ck('turn/accumulate-mid', all(x in r for x in ('T-A1 开始处理', 'T-A2 继续分析', 'T-A3 本回合收尾')), repr(r))
    ck('turn/chronological', r.index('T-A1') < r.index('T-A2') < r.index('T-A3'), repr(r))
    ck('turn/no-cross-boundary', 'T-B1' not in r and '提示词' not in r, repr(r))
    ck('turn/in-pane-per-step', 'Bash' not in d['prompt'], repr(d['prompt']))
    d2 = sessions._step_detail(fp, 'msg_m1')
    ck('turn/first-step-full', 'T-A1' in d2['result'] and 'T-A3' in d2['result'], repr(d2['result']))
    ck('turn/in-stays-per-step', 'Bash' in d2['prompt'] and 'Edit' not in d2['prompt'], repr(d2['prompt']))
    d3 = sessions._step_detail(fp, 'msg_m5')
    ck('turn/last-turn-only', 'T-B1' in d3['result'] and 'T-B2' in d3['result'] and 'T-A' not in d3['result'],
       repr(d3['result']))
    d4 = sessions._step_detail(fp, 'msg_m4')
    ck('turn/in-edit-only', 'Edit' in d4['prompt'] and 'Bash' not in d4['prompt'], repr(d4['prompt']))
    dm = sessions._step_detail(fp, 'msg_zzz')
    ck('turn/miss', dm.get('miss') is True and dm['result'] == '')
    sub = Path(td) / 'sub.jsonl'
    sub.write_text('\n'.join(LINES[6:]) + '\n', encoding='utf-8')
    st = sessions._turn_texts(sub)[0]
    ck('sub/last-turn', 'T-B1' in st and 'T-B2' in st, repr(st))

done()
