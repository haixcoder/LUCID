# 会话状态契约(移植自 /tmp/repro_sessions.py,1.2.10):
#   1) 候选 = 转录 <sess>.jsonl ∪ 会话目录 —— 只遍历目录会漏掉"无子代理的纯交互会话"(它恰是等待输入的主体);
#   2) main_state 四态三分:running / input_required{ask|permission|turn} / waiting / ended —— 判定只此一处。
#   3) (1.2.42) 挂起 Workflow 且该会话已有运行目录 subagents/workflows/wf_*/ = 主 agent 已把任务交给
#      工作流后台执行(不是卡在授权) → running/waitReason=workflow,页面显示"等待 workflow 执行";
#      无运行目录的挂起 Workflow(启动授权待批的窗口)仍走 permission 启发式。判定只住 main_state 一处。
import json
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


def _stale(proj_dir, sid):
    """把转录 mtime 拨到 10min 前(模拟主 agent 交接工作流后自身静默,age>=STALL_SEC)。"""
    old = time.time() - 600
    os.utime(proj_dir / (sid + '.jsonl'), (old, old))


def _wf_dir(proj_dir, sid, run='wf_live'):
    """造一个"工作流已启动"的运行目录:subagents/workflows/wf_*/journal.jsonl —— 主转录里
    Workflow tool_use 未回执 + 该目录存在 = 后台执行中,非卡在授权。"""
    d = proj_dir / sid / 'subagents' / 'workflows' / run
    d.mkdir(parents=True, exist_ok=True)
    (d / 'journal.jsonl').write_text(json.dumps({'type': 'started', 'agentId': 'a1'}) + '\n', encoding='utf-8')
    return d


# E: 挂起 Workflow + 已有运行目录 + 转录静默 10min(真机症状:主 agent 已交给工作流执行)
#    → running/waitReason=workflow("等待 workflow 执行"),绝不许误判成 permission(⏸ 告警 + 推"等待授权")
se = write_transcript(PROJ / 'fixE', [user('跑一轮多 agent 审查'),
                                      asst('msgE1', 'tool_use', [{'type': 'tool_use', 'id': 'tu4',
                                                                  'name': 'Workflow', 'input': {}}])])
registry_add(HOME, se, me, '/fixE')
_wf_dir(PROJ / 'fixE', se)
_stale(PROJ / 'fixE', se)
# F: 挂起 Workflow 但无运行目录(启动授权待批的窗口)+ 转录静默 → 仍 permission(保留原启发式,边界最小)
sf = write_transcript(PROJ / 'fixF', [user('再跑一轮'),
                                      asst('msgF1', 'tool_use', [{'type': 'tool_use', 'id': 'tu5',
                                                                  'name': 'Workflow', 'input': {}}])])
registry_add(HOME, sf, me, '/fixF')
_stale(PROJ / 'fixF', sf)

from ccviewer import sessions

out = sessions.scan_sessions()
by = {s['sessionId']: s for s in out}
ck('候选并集:六个活会话全部出现(含无目录的纯交互会话)', len(out) == 6, str([s['project'] for s in out]))
for key, sid, est, ersn in (('A', sa, 'input_required', 'turn'), ('B', sb, 'input_required', 'ask'),
                            ('C', sc, 'input_required', 'permission'), ('D', sd, 'running', None),
                            ('E', se, 'running', 'workflow'), ('F', sf, 'input_required', 'permission')):
    s = by.get(sid)
    if not s:
        ck('会话%s 出现' % key, False)
        continue
    ck('会话%s: %s/%s' % (key, est, ersn),
       s['status'] == est and s.get('waitReason') == ersn,
       'got %s/%s stop=%s pend=%s' % (s['status'], s.get('waitReason'), s.get('stopReason'), s.get('pendingTools')))
# E 专项:交接工作流期间绝不该被算成"卡住等授权"(sessStuck/⏸ 告警/等待推送都依赖此) ——
# waitReason 必须是 workflow、waitTool 指向 Workflow,且仍 running(alive 计入 LIVE,不计入 ⏸)。
se_rec = by.get(se) or {}
ck('会话E:waitTool=Workflow(交出去的就是工作流)', se_rec.get('waitTool') == 'Workflow', str(se_rec.get('waitTool')))
ck('会话E:非 permission(不触发 ⏸ 告警/等待授权推送)', se_rec.get('waitReason') != 'permission',
   'got waitReason=%s' % se_rec.get('waitReason'))
s = by.get(sa) or {}
ck('负载契约字段齐备(title/status/ageSec/tokens/prompts/steps…)',
   all(k in s for k in ('title', 'alive', 'waitTool', 'pid', 'kind', 'startedAt', 'lastActivityAt', 'ageSec',
                        'model', 'stopReason', 'permissionMode', 'tokens', 'pendingTools', 'toolCalls',
                        'lastPrompt', 'lastText', 'lastTextMid', 'prompts', 'steps', 'subagents')), str(sorted(s)))

done()
