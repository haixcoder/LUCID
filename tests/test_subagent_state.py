# 子 agent 状态契约(1.2.23→1.2.24 修「子 agent 左侧不显示运行状态」):
#   现象 —— 主 agent 调起的子 agent,会话卡左侧那一列只有一圈浅灰空心 ◌(idle),看不出成功/运行。
#   根因 —— sessions._subagents 判「完成」只认 stop_reason=='end_turn';但回合可正常收在
#           'stop_sequence'(真机 60 条子代理转录里 7 条 <synthetic> 研究子 agent 全部如此)。
#           收在 stop_sequence 的子 agent 掉进 else → state='idle'。而主 agent 的 main_state
#           早就用共享常量 TURN_END=('end_turn','stop_sequence') 判完成 —— 两处判定不同源即 bug。
#   修复 —— _subagents 复用 TURN_END 单点(与 main_state 同一份),完成态归 done。
# 本测试直接驱动真实 sessions._subagents(),对每种末条形态钉一个可观察行为。
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _util import asst, ck, done, redirect, temp_home, user, write_transcript

HOME = temp_home()
PROJ = redirect(HOME)

from ccviewer import sessions


def sub_agent(sess_dir, aid, stop, blocks, name='research', model='claude-fable-5'):
    """写 <sess>/subagents/agent-<aid>.jsonl + .meta.json,返回文件路径(mtime 由调用方定)。
    _subagents 读 f.with_name(f.name+'.meta.json'),故 meta 文件名带 .jsonl 后缀。
    model 默认取真实模型名;传 '<synthetic>' 模拟 Claude Code 本地合成的错误注入(非模型成功应答)。"""
    sdir = sess_dir / 'subagents'
    sdir.mkdir(parents=True, exist_ok=True)
    recs = [user('分析任务'), asst('m-' + aid, stop, blocks, text_model=model)]
    f = sdir / ('agent-' + aid + '.jsonl')
    f.write_text('\n'.join(__import__('json').dumps(r, ensure_ascii=False) for r in recs) + '\n', encoding='utf-8')
    (sdir / ('agent-' + aid + '.jsonl.meta.json')).write_text(
        __import__('json').dumps({'agentType': name, 'name': aid}), encoding='utf-8')
    return f


def set_age(path, age_sec):
    t = time.time() - age_sec
    os.utime(path, (t, t))


TEXT = [{'type': 'text', 'text': '分析完成,结论如上。'}]
PENDING = [{'type': 'tool_use', 'id': 'tu1', 'name': 'Bash', 'input': {}}]

# 主会话转录(scan_sessions 需要它才把这会话列进候选;子 agent 状态由 _subagents 单独判)
sid = write_transcript(PROJ / 'projsub', [user('派几个子 agent 调研'),
                                          asst('mMain', 'end_turn', TEXT)])
sess_dir = PROJ / 'projsub' / sid

# A/B 都是「跑完并已交回话轮」的老子 agent(mtime 远超 90s)——区别只在收束的 stop_reason。
a = sub_agent(sess_dir, 'doneEturn', 'end_turn', TEXT)         # 传统 end_turn 完成
b = sub_agent(sess_dir, 'doneSeq', 'stop_sequence', TEXT)      # 真机 <synthetic> 的收束方式(bug 触发点)
c = sub_agent(sess_dir, 'working', 'end_turn', TEXT)           # 刚刚还在写(90s 内)= 运行中
d = sub_agent(sess_dir, 'stuckIdle', 'tool_use', PENDING)      # 末条挂起工具且早已静默 = 无权威信号 → idle
# E ★ 真机踩到(用户 1.2.24→1.2.25 报):模型调不到(如"Model not exist"),Claude Code 注入一条
#   本地合成(model='<synthetic>')的末条,stop_reason 恰为 stop_sequence、文本是 API 错误正文。
#   1.2.24 只看 stop_reason∈TURN_END 就判 done → 失败的子 agent 显示成绿色"完成"。应判 error(✕ 红)。
APIERR = [{'type': 'text', 'text': 'API Error: 400 event:error\ndata:{"code":"InvalidParameter","message":"Model not exist."}'}]
e = sub_agent(sess_dir, 'apiError', 'stop_sequence', APIERR, model='<synthetic>')
# F 反例守卫:合成注入若发生在久静默且无 TURN_END(如中断)——仍归 error,不被 idle 吞掉。
f = sub_agent(sess_dir, 'synthIdle', 'tool_use', APIERR, model='<synthetic>')
set_age(a, 3600); set_age(b, 3600); set_age(c, 5); set_age(d, 3600); set_age(e, 3600); set_age(f, 3600)

subs = {x['agentId']: x for x in sessions._subagents(sess_dir, time.time())}
for k in ('doneEturn', 'doneSeq', 'working', 'stuckIdle', 'apiError', 'synthIdle'):
    if k not in subs:
        ck('子 agent %s 出现' % k, False, str(sorted(subs)))

ck('A end_turn 完成的老子 agent → done', subs.get('doneEturn', {}).get('state') == 'done',
   'got ' + repr(subs.get('doneEturn', {}).get('state')))
# ★ RED:stop_sequence 与 end_turn 同为「模型交回话轮」的正常收束,判完成处必须同源(TURN_END)。
#   现状:硬编码 =='end_turn' → 归 idle(◌ 浅灰空心,用户读作"没有运行状态")。修复后应 =done(◆ 绿)。
ck('B stop_sequence 完成的老子 agent → done(与主 agent TURN_END 同源)',
   subs.get('doneSeq', {}).get('state') == 'done',
   'got ' + repr(subs.get('doneSeq', {}).get('state')))
ck('C 90s 内仍在写的子 agent → running', subs.get('working', {}).get('state') == 'running',
   'got ' + repr(subs.get('working', {}).get('state')))
ck('D 挂起工具且久无动静 → idle(不谎报完成,也不谎报失败)', subs.get('stuckIdle', {}).get('state') == 'idle',
   'got ' + repr(subs.get('stuckIdle', {}).get('state')))
# ★ RED(修复前 1.2.24 会判成 done):本地合成的末条 = API 错误注入,不是模型成功应答 → error。
ck('E 末条 <synthetic> 携带 API Error(stop_sequence)→ error(不显示绿色完成)',
   subs.get('apiError', {}).get('state') == 'error',
   'got ' + repr(subs.get('apiError', {}).get('state')))
ck('F 合成注入 + 无 TURN_END(中断)→ 仍 error,不被 idle 吞',
   subs.get('synthIdle', {}).get('state') == 'error',
   'got ' + repr(subs.get('synthIdle', {}).get('state')))
# 错误正文须可见(铁律7:摘要 + 可展开全文)——lastText 即注入的错误串,前端抽屉据此回显。
ck('E 错误正文进 lastText(展开可看全)', 'API Error' in subs.get('apiError', {}).get('lastText', ''),
   repr(subs.get('apiError', {}).get('lastText')))

# 全链路复核:经 scan_sessions() 出口,子 agent 也带着 done 状态出现在会话负载里(不只单测中间层)。
out = {s['sessionId']: s for s in sessions.scan_sessions()}
sub_list = {x['agentId']: x for x in out.get(sid, {}).get('subagents', [])}
ck('scan_sessions 出口:doneSeq 子 agent 以 done 呈现(全链路)',
   sub_list.get('doneSeq', {}).get('state') == 'done',
   'got ' + repr(sub_list.get('doneSeq', {}).get('state')))
ck('scan_sessions 出口:apiError 子 agent 以 error 呈现(全链路)',
   sub_list.get('apiError', {}).get('state') == 'error',
   'got ' + repr(sub_list.get('apiError', {}).get('state')))

done()
