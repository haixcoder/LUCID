# 会话状态契约(移植自 /tmp/repro_sessions.py,1.2.10):
#   1) 候选 = 转录 <sess>.jsonl ∪ 会话目录 —— 只遍历目录会漏掉"无子代理的纯交互会话"(它恰是等待输入的主体);
#   2) main_state 四态三分:running / input_required{ask|permission|turn} / waiting / ended —— 判定只此一处。
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _util import asst, ck, done, redirect, registry_add, temp_home, user, write_transcript

HOME = temp_home()
PROJ = redirect(HOME)
me = os.getpid()

# A: 活着的纯交互会话(无 subagents 目录),模型回合已结束 → input_required/turn
sa = write_transcript(PROJ / 'fixA', [user('帮我看下这个 bug'),
                                      asst('msgA1', 'end_turn', [{'type': 'text', 'text': '需要你确认方案'}])])
registry_add(HOME, sa, me, '/fixA')
# B: 挂起 AskUserQuestion → input_required/ask
sb = write_transcript(PROJ / 'fixB', [user('选个方案'),
                                      asst('msgB1', 'tool_use', [{'type': 'tool_use', 'id': 'tu1',
                                                                  'name': 'AskUserQuestion', 'input': {}}])])
registry_add(HOME, sb, me, '/fixB')
# C: 挂起普通工具且转录静默 10min → input_required/permission
sc = write_transcript(PROJ / 'fixC', [user('跑一下迁移'),
                                      asst('msgC1', 'tool_use', [{'type': 'tool_use', 'id': 'tu2',
                                                                  'name': 'Bash', 'input': {}}])])
registry_add(HOME, sc, me, '/fixC')
old = time.time() - 600
p = PROJ / 'fixC' / (sc + '.jsonl')
os.utime(p, (old, old))
# D: 挂起普通工具且刚写入 → running(不误报等待)
sd = write_transcript(PROJ / 'fixD', [user('继续'),
                                      asst('msgD1', 'tool_use', [{'type': 'tool_use', 'id': 'tu3',
                                                                  'name': 'Bash', 'input': {}}])])
registry_add(HOME, sd, me, '/fixD')

from ccviewer import sessions

out = sessions.scan_sessions()
by = {s['sessionId']: s for s in out}
ck('候选并集:四个活会话全部出现(含无目录的纯交互会话)', len(out) == 4, str([s['project'] for s in out]))
for key, sid, est, ersn in (('A', sa, 'input_required', 'turn'), ('B', sb, 'input_required', 'ask'),
                            ('C', sc, 'input_required', 'permission'), ('D', sd, 'running', None)):
    s = by.get(sid)
    if not s:
        ck('会话%s 出现' % key, False)
        continue
    ck('会话%s: %s/%s' % (key, est, ersn),
       s['status'] == est and s.get('waitReason') == ersn,
       'got %s/%s stop=%s pend=%s' % (s['status'], s.get('waitReason'), s.get('stopReason'), s.get('pendingTools')))
s = by.get(sa) or {}
ck('负载契约字段齐备(title/status/ageSec/tokens/prompts/steps…)',
   all(k in s for k in ('title', 'alive', 'waitTool', 'pid', 'kind', 'startedAt', 'lastActivityAt', 'ageSec',
                        'model', 'stopReason', 'permissionMode', 'tokens', 'pendingTools', 'toolCalls',
                        'lastPrompt', 'lastText', 'lastTextMid', 'prompts', 'steps', 'subagents')), str(sorted(s)))

done()
