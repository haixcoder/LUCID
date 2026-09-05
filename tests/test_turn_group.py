# 回合分组契约(1.2.20:「展示端以每次 turn 回合作为基本单元,一次任务=一个独立展示单元」):
# _main_steps 每步带 turn = 开启该回合的"真人输入"记录 uuid('' = 输入在尾窗之前)。
# 边界判定复用 _user_prompt 单点(前端不许猜边界,CLAUDE.md 不变量);工具回执/isMeta 不开新回合;
# 同 msgId 流式重传在首次出现时定格 turn(尾窗滑动不漂移)。
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


with tempfile.TemporaryDirectory() as td:
    fp = Path(td) / 'g.jsonl'
    fp.write_text('\n'.join([
        rec('user', '任务甲:修仪表', 'u-A'),
        rec('assistant', [{'type': 'text', 'text': '甲-T1'}], 'a1', mid='msg_a1'),
        rec('user', [{'type': 'tool_result', 'tool_use_id': 't1', 'content': 'ok'}], 'a2'),  # 工具回执:不开回合
        rec('assistant', [{'type': 'tool_use', 'id': 't2', 'name': 'Bash', 'input': {'command': 'ls'}}], 'a3', mid='msg_a2'),
        rec('user', '任务乙:跑测试', 'u-B'),
        rec('assistant', [{'type': 'text', 'text': '乙-T1'}], 'b1', mid='msg_b1'),
        rec('user', '注入噪声', 'u-M', isMeta=True),                                        # isMeta:不开回合
        rec('assistant', [{'type': 'tool_use', 'id': 't3', 'name': 'Read', 'input': {}}], 'b1r', mid='msg_b1'),  # 流式重传
    ]) + '\n', encoding='utf-8')
    st = sessions._main_steps(fp)
    by = {s['msgId']: s for s in st}
    ck('步骤列表完整(按消息 id 聚合,重传不翻倍)', [s['msgId'] for s in st] == ['msg_a1', 'msg_a2', 'msg_b1'], str([s['msgId'] for s in st]))
    ck('turn/首输入开回合', by['msg_a1'].get('turn') == 'u-A', repr(by['msg_a1']))
    ck('turn/工具回执不切回合', by['msg_a2'].get('turn') == 'u-A', repr(by['msg_a2']))
    ck('turn/新输入开新回合', by['msg_b1'].get('turn') == 'u-B', repr(by['msg_b1']))
    ck('turn/isMeta 不切回合+重传不漂移', [s.get('turn') for s in st if s['msgId'] == 'msg_b1'] == ['u-B'], str(st))

    # 尾窗从回合中间开始(首条非输入记录):该批步骤 turn=''(前端须给"输入在尾窗前"的显式分组头)
    fp2 = Path(td) / 'o.jsonl'
    fp2.write_text('\n'.join([
        rec('assistant', [{'type': 'text', 'text': '孤儿步'}], 'o1', mid='msg_o1'),
        rec('user', '后续输入', 'u-N'),
        rec('assistant', [{'type': 'text', 'text': '正常步'}], 'o2', mid='msg_o2'),
    ]) + '\n', encoding='utf-8')
    st2 = sessions._main_steps(fp2)
    ck('turn/尾窗起点前的步骤 turn 空串', [s.get('turn') for s in st2] == ['', 'u-N'], str(st2))

    # ── 尾窗从回合中间开始(真机踩到:单条超长回合把开场输入挤出 256KB 窗)──
    # 孤儿子步骤的归属不许停在 '' :反向找"窗口外最近一条真人输入"回填 turn(可锚定 → 组头仍可展开取全文)。
    pad = [rec('user', [{'type': 'tool_result', 'tool_use_id': 'tp%d' % i, 'content': 'x' * 8000}], 'pad-%d' % i)
           for i in range(40)]  # ~40×8KB=320KB 工具回执:不是回合边界,但把开场输入推出尾窗
    # 布局:[开场输入][320KB 回执垫][窗口内第一步 msg_w1][后续输入][后续步] —— 尾窗(256KB)起点落在垫料中:
    # msg_w1 在窗内但其开场输入在窗外 → turn='';回填须反查窗外最近真人输入。
    fp3 = Path(td) / 'w.jsonl'
    fp3.write_text('\n'.join([
        rec('user', '开场任务:超窗口的长回合', 'u-OPEN'),
        *pad,
        rec('assistant', [{'type': 'text', 'text': '开场后的第一步'}], 'w1', mid='msg_w1'),
        rec('user', '窗口内任务', 'u-IN'),
        rec('assistant', [{'type': 'text', 'text': '窗口内一步'}], 'w2', mid='msg_w2'),
    ]) + '\n', encoding='utf-8')
    st3 = sessions._main_steps(fp3)
    by3 = {s['msgId']: s for s in st3}
    # 前提须独立于修复验证:直接读尾窗,确认 u-OPEN 不在窗内而 msg_w1 在 → 只能由回填解释(非正向赋值)
    from ccviewer.jsonl import tail_records
    win = list(tail_records(fp3))
    win_uuids = {w.get('uuid') for w in win}
    win_mids = {(w.get('message') or {}).get('id') for w in win if w.get('type') == 'assistant'}
    ck('超长回合:开场输入确被挤出尾窗(前提独立成立)',
       'u-OPEN' not in win_uuids and 'msg_w1' in win_mids and 'u-IN' in win_uuids,
       'u-OPEN in window=%s' % ('u-OPEN' in win_uuids))
    ck('孤儿归属回填:反查窗口外最近真人输入', by3.get('msg_w1', {}).get('turn') == 'u-OPEN', str({k: v.get('turn') for k, v in by3.items()}))
    ck('回填只影响孤儿组(窗口内归属不动)', by3.get('msg_w2', {}).get('turn') == 'u-IN', '')

    # 真·无开场输入(会话开头就是 assistant)→ 保持 ''(不造假锚点)
    done()
