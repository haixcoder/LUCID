# 等待行「可看全」契约(移植自 /tmp/repro_waitline.py,1.2.12 / 铁律7):
# lastText=300 字摘要必须随行回传 lastTextMid(所在消息 id)——前端等待行 data-src 的全文回取锚点;
# 只给摘要无锚点=违规。无文本会话 mid='' 不造假;按 mid 走 agent_detail 能拿 >300 字全文。
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _util import asst, ck, done, redirect, registry_add, temp_home, user, write_transcript

HOME = temp_home()
PROJ = redirect(HOME)
me = os.getpid()

TAIL_MARK = '⟪尾部标记·超过300字仍在⟫'
LONG_TEXT = '调研结论段。' * 60 + TAIL_MARK + '补充说明。' * 20
assert len(LONG_TEXT) > 300 and LONG_TEXT.find(TAIL_MARK) >= 300, 'fixture 必须复现"尾部在裁切线之后"'

# E: 活会话 end_turn,最后输出 >300 字 —— 截图现场的最小复现
se = write_transcript(PROJ / 'fixE', [user('继续'), asst('msgE1', 'end_turn', [{'type': 'text', 'text': LONG_TEXT}])])
registry_add(HOME, se, me, '/fixE')
# F: 短文本会话 —— mid 一致性
sf = write_transcript(PROJ / 'fixF', [user('在吗'), asst('msgF1', 'end_turn', [{'type': 'text', 'text': '在的。'}])])
registry_add(HOME, sf, me, '/fixF')
# G: 挂起 AskUserQuestion 无文本 —— mid 不造假
sg = write_transcript(PROJ / 'fixG', [user('选方案'),
                                      asst('msgG1', 'tool_use', [{'type': 'tool_use', 'id': 'tu1',
                                                                  'name': 'AskUserQuestion', 'input': {}}])])
registry_add(HOME, sg, me, '/fixG')

from ccviewer import sessions

# 注册表 pid 用本进程(文件名可不同)——registry_add 已保证 pid 字段=传入值
out = sessions.scan_sessions()
by = {s['sessionId']: s for s in out}
ck('三个活会话都在结果中', len(out) == 3, str(len(out)))
e, f, g = by.get(se), by.get(sf), by.get(sg)
ck('E 出现', bool(e))
if e:
    ck('E: lastText 仍为 300 字摘要(负载设计不变)', len(e.get('lastText') or '') == 300, str(len(e.get('lastText') or '')))
    ck("E: lastTextMid='msgE1'", e.get('lastTextMid') == 'msgE1', repr(e.get('lastTextMid')))
    d = sessions.agent_detail('fixE', se, 'main', 'msgE1')
    ck('E: 按 msgId 回全文 >300 字含尾部标记',
       TAIL_MARK in (d.get('result') or '') and len(d.get('result') or '') > 300, str(len(d.get('result') or '')))
ck('F: 短文本也回传 mid', bool(f) and f.get('lastTextMid') == 'msgF1', repr((f or {}).get('lastTextMid')))
ck('G: 无文本会话 mid 空串不造假', bool(g) and not (g.get('lastText') or '') and not (g.get('lastTextMid') or ''))

done()
