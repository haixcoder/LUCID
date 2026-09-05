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

    # —— 1.2.18「冒号收尾全文」契约(真实用户症状:抽屉里每段以:结尾,之后没有内容)——
    # 根因:_turn_texts 只累计 text 块,工具调用/回执被丢。OUT 必须按时间序含回合内工具活动。
    ck('out/tools-in-fulltext', 'Bash' in r and 'ls' in r and 'ok' in r, repr(r))
    ck('out/tools-chrono', r.index('T-A1') < r.index('ls') < r.index('ok') < r.index('T-A2') < r.index('T-A3'), repr(r))
    ck('out/no-cross-turn-tools', 'Edit' not in r and 'done' not in r, repr(r))
    ck('out/last-turn-tools', 'Edit' in d3['result'] and 'done' in d3['result']
       and 'ok' not in d3['result'] and 'ls' not in d3['result'], repr(d3['result']))

    # 回合仍在跑(最后一个 ▸ 无回执)→ 显式标注,不许静默消失(铁律7:取不到要说明)
    pend = Path(td) / 'p.jsonl'
    pend.write_text('\n'.join([
        rec('user', '跑C', 'u-c'),
        rec('assistant', [{'type': 'text', 'text': '执行：'},
                          {'type': 'tool_use', 'id': 't9', 'name': 'Bash',
                           'input': {'command': 'sleep 99'}}], 'c1', mid='msg_c1'),
    ]) + '\n', encoding='utf-8')
    dp = sessions._step_detail(pend, 'msg_c1')
    ck('out/pending-marker', 'sleep 99' in dp['result'] and '未回执' in dp['result'], repr(dp['result']))

    # 流式重传同 tool_use 去重;回执逐条限长且超长显式标注「截断」
    big = Path(td) / 'b.jsonl'
    big.write_text('\n'.join([
        rec('user', '跑D', 'u-d'),
        rec('assistant', [{'type': 'text', 'text': 'D开始：'},
                          {'type': 'tool_use', 'id': 't10', 'name': 'Bash',
                           'input': {'command': 'cat big'}}], 'd1', mid='msg_d1'),
        rec('assistant', [{'type': 'tool_use', 'id': 't10', 'name': 'Bash',
                           'input': {'command': 'cat big'}}], 'd1b', mid='msg_d1'),
        rec('user', [{'type': 'tool_result', 'tool_use_id': 't10', 'content': 'Y' * 5000}], 'd2'),
        rec('assistant', [{'type': 'text', 'text': 'D收尾'}], 'd3m', mid='msg_d2'),
    ]) + '\n', encoding='utf-8')
    dl = sessions._step_detail(big, 'msg_d2')
    ck('out/stream-dedup', dl['result'].count('▸') == 1, repr(dl['result'])[:200])
    ck('out/result-cap-mark', '截断' in dl['result'] and dl['result'].count('Y') < 5000, repr(dl['result'])[:120])

    dm = sessions._step_detail(fp, 'msg_zzz')
    ck('turn/miss', dm.get('miss') is True and dm['result'] == '')
    sub = Path(td) / 'sub.jsonl'
    sub.write_text('\n'.join(LINES[6:]) + '\n', encoding='utf-8')
    st = sessions._turn_texts(sub)[0]
    ck('sub/last-turn', 'T-B1' in st and 'T-B2' in st, repr(st))

done()
