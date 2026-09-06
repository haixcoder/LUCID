# 子 agent 名字显示契约(1.2.39→1.2.40 修「终端里主 agent 调起的子 agent 名字与网页显示的不一致」):
#   现象 —— 终端后台面板显示 docs-factcheck / new-features,网页会话卡子代理列显示 adocs-factch / anew-feature,
#           且类型列恒为 agent(从不 T·teammate)、悬停描述恒空(真机截图逐字比对一致)。
#   根因 —— sessions._subagents 与 scan.parse_live 读 meta 用 f.with_name(f.name+'.meta.json'),
#           即 "agent-x.jsonl.meta.json";真机(Claude Code 实写)一律是 "agent-x.meta.json"
#           (find 实测:该拼法 0 份,正确拼法 projects 64 份 + workflows 118 份全中)。open 恒抛 →
#           meta 恒 {} → label 回落 aid[:12] 截断 id,name/agentType/taskKind/teamName/description 全丢。
#           同根因还潜伏 1.2.24 的测试固件——它按代码的错误拼法写文件(注释断言"meta 文件名带 .jsonl
#           后缀"),固件钉了臆造而非真机,故测试全绿而真机全坏(lessons-learned 类 6:fixture 钉泛化、真机钉适配)。
#   修复 —— 单点 read_agent_meta():真机拼法优先,旧臆造拼法作防御兜底;两处消费点同一入口。
#   边界 —— workflow run 目录的 agent meta 真机恒为 agentType="workflow-subagent"+spawnDepth(118/118,无 name),
#           对同 run 全部 agent 同名无区分度,故 scan 侧 label 保持 name→hex(a[:8]) 不引入 agentType
#           (否则"修名字"反把可辨识 id 换成 17 个一模一样的 workflow-subagent = 新回归)。
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _util import asst, ck, done, redirect, temp_home, user, write_transcript

HOME = temp_home()
PROJ = redirect(HOME)

from ccviewer import scan, sessions

TEXT = [{'type': 'text', 'text': '任务完成。'}]


def agent_file(sdir, aid, meta=None, legacy=False):
    """按真机形态写 <sdir>/agent-<aid>.jsonl;meta 给定且 legacy=False 时写 agent-<aid>.meta.json
    (真机 find 实测唯一存在的拼法);legacy=True 写旧臆造拼法 agent-<aid>.jsonl.meta.json(兜底分支用)。"""
    sdir.mkdir(parents=True, exist_ok=True)
    (sdir / ('agent-' + aid + '.jsonl')).write_text(
        '\n'.join(json.dumps(r, ensure_ascii=False) for r in [user('干活'), asst('m-' + aid, 'end_turn', TEXT)]) + '\n',
        encoding='utf-8')
    if meta is not None:
        suf = '.jsonl.meta.json' if legacy else '.meta.json'
        (sdir / ('agent-' + aid + suf)).write_text(json.dumps(meta, ensure_ascii=False), encoding='utf-8')


# 会话目录四类子 agent(字段值取自真机 d77d32ae…/subagents 实测样本)
sid = write_transcript(PROJ / '-plabel', [user('派几个子 agent'), asst('mMain', 'end_turn', TEXT)])
sess_dir = PROJ / '-plabel' / sid
sdir = sess_dir / 'subagents'
# ① teammate(真机拼法,name 与终端面板同名)→ label 必须 = name,teammate 分型/团队/描述齐活
agent_file(sdir, 'adocs-factcheck-3d458b4ea1015786', {
    'agentType': 'docs-factcheck', 'name': 'docs-factcheck',
    'description': 'Official docs fact-check (hooks/statusline/OTel)', 'spawnDepth': 0,
    'model': 'haiku', 'taskKind': 'in_process_teammate', 'teamName': 'session-87b1f128',
    'color': 'blue', 'planModeRequired': False, 'permissionMode': 'auto'})
# ② 普通 Task 子代理(真机 44/64 份无 name)→ label 回落 agentType
agent_file(sdir, 'a03a43f3c03a5317f', {
    'agentType': 'Explore', 'description': '扫代码库', 'spawnDepth': 0, 'toolUseId': 'toolu_x'})
# ③ 无 meta(老转录)→ 负对照:保持 aid[:12] 截断兜底,不造假名字
agent_file(sdir, 'a1b2c3d4e5f6a7b8c9d0')
# ④ 兜底分支:仅旧臆造拼法存在时也要读到(第三方主机格式不可控,防御)
agent_file(sdir, 'alegacy-00000000000001', {'agentType': 'legacy-one', 'name': 'legacy-one'}, legacy=True)

subs = {x['agentId']: x for x in sessions._subagents(sess_dir, time.time())}
s1 = subs.get('adocs-factcheck-3d458b4ea1015786', {})
ck('① 真机拼法 meta:label = name(与终端同名,不再是 aid[:12] 截断)',
   s1.get('label') == 'docs-factcheck', 'got ' + repr(s1.get('label')))
ck('① taskKind=in_process_teammate → kind=teammate(前端 T· 前缀)', s1.get('kind') == 'teammate',
   'got ' + repr(s1.get('kind')))
ck('① agentType/teamName/description 均入载荷(悬停与类型列数据源)',
   s1.get('agentType') == 'docs-factcheck' and s1.get('teamName') == 'session-87b1f128'
   and s1.get('description').startswith('Official docs'),
   repr({k: s1.get(k) for k in ('agentType', 'teamName', 'description')}))
s2 = subs.get('a03a43f3c03a5317f', {})
ck('② 无 name 有 agentType → label = agentType', s2.get('label') == 'Explore', 'got ' + repr(s2.get('label')))
s3 = subs.get('a1b2c3d4e5f6a7b8c9d0', {})
ck('③ 无 meta → 仍回落 aid[:12](负对照,不许造假名)', s3.get('label') == 'a1b2c3d4e5f6',
   'got ' + repr(s3.get('label')))
s4 = subs.get('alegacy-00000000000001', {})
ck('④ 旧臆造拼法兜底仍可读(防御分支)', s4.get('label') == 'legacy-one', 'got ' + repr(s4.get('label')))

# 全链路:/api/sessions 出口(经 scan_sessions)同样带真名
out = {s['sessionId']: s for s in sessions.scan_sessions()}
sub_out = {x['agentId']: x for x in out.get(sid, {}).get('subagents', [])}
ck('scan_sessions 出口:teammate 以真名呈现(全链路)',
   sub_out.get('adocs-factcheck-3d458b4ea1015786', {}).get('label') == 'docs-factcheck',
   'got ' + repr(sub_out.get('adocs-factcheck-3d458b4ea1015786', {}).get('label')))

# 工作流运行卡(同根因第二消费点 scan.parse_live):meta 恒只有 generic agentType →
# label 保持 hex 区分度;若真机日后给 name 才用它。
rd = PROJ / '-plabel' / 'sesswf' / 'subagents' / 'workflows' / 'wf_run1'
agent_file(rd, 'a0431072109daf6ea', {'agentType': 'workflow-subagent', 'spawnDepth': 1})
agent_file(rd, 'anamed-wf-agent-00001', {'agentType': 'workflow-subagent', 'name': 'grounding-doc'})
(rd / 'journal.jsonl').write_text(
    '\n'.join(json.dumps({'type': 'started', 'agentId': a}) for a in
              ('a0431072109daf6ea', 'anamed-wf-agent-00001')) + '\n', encoding='utf-8')
r = scan.parse_live(rd, '-plabel', 'sesswf', '/fix', time.time(), True) or {}
ags = {a['agentId']: a for a in r.get('agents', [])}
ck('wf 无 name(meta 恒 generic)→ label 保持 hex a[:8],不被同名 workflow-subagent 糊掉',
   ags.get('a0431072109daf6ea', {}).get('label') == 'a0431072', 'got ' + repr(ags.get('a0431072109daf6ea', {}).get('label')))
ck('wf 有 name(真机暂未见,防御)→ label 用 name',
   ags.get('anamed-wf-agent-00001', {}).get('label') == 'grounding-doc',
   'got ' + repr(ags.get('anamed-wf-agent-00001', {}).get('label')))

done()
