# A7(1.2.65):session_cwd 的"解析不到就吐编码目录名"兜底必须拆掉。
# 现状:只扫转录前 5 条(按消耗行数计)找 cwd,未命中就 `return proj_dir`(如 -Users-x-y 编码名),
# 实测 113 份转录里 38 份的首条 cwd 恰好压在第 5 行——一旦回退,编码名会经 cwd||project 渗进
# 项目下拉/过滤/草稿 slug/项目分发(_project_workflow_path 拿到非绝对路径直接报错)。
# 修复:预算 5→40;仍未命中则拿 ~/.claude.json 的 projects 键(真实路径白名单)做正向编码比对,
# 精确命中才还真实路径;都不行 **返回 ''**(宁缺毋滥,不再吐编码名)。
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _util import ck, done, redirect, temp_home  # noqa: E402

HOME = temp_home()
PROJ = redirect(HOME)                            # config.PROJ = <HOME>/.claude/projects
CLAUDE_JSON = HOME / '.claude.json'              # 官方逐项目聚合:projects[真实路径] = …

from ccviewer import scan  # noqa: E402


def lines(*recs):
    return '\n'.join(json.dumps(r, ensure_ascii=False) for r in recs) + '\n'


# ① 首条 cwd 压在第 7 行(第 6 行才是第一条 user):预算 5 时扫不到 → 今日返回编码名
d1 = PROJ / '-work-line7'
d1.mkdir(parents=True)
(d1 / 'aaaa0001.jsonl').write_text(lines(
    {'type': 'mode', 'mode': 'normal'},
    {'type': 'permission-mode', 'permissionMode': 'default'},
    {'type': 'atis-latch', 'latched': True},
    {'type': 'file-history-snapshot', 'messageId': 'm0', 'snapshot': {}},
    {'type': 'last-prompt', 'lastPrompt': '继续'},
    {'type': 'user', 'message': {'role': 'user', 'content': '跑一下'}},
    {'type': 'user', 'cwd': '/work/line7', 'message': {'role': 'user', 'content': 'go'}},
), encoding='utf-8')
ck('cwd/预算 40:第 7 行的 cwd 也要扫到(预算 5 时返回编码名)',
   scan.session_cwd('-work-line7', 'aaaa0001') == '/work/line7',
   scan.session_cwd('-work-line7', 'aaaa0001'))

# ② 40 行内无 cwd → 用 ~/.claude.json 的真实路径键做白名单解码(编码 = 真实路径的 '/' 换成 '-')
d2 = PROJ / '-work-decode'
d2.mkdir(parents=True)
(d2 / 'bbbb0002.jsonl').write_text(lines(*[{'type': 'user', 'message': {'role': 'user', 'content': 'n%d' % i}}
                                            for i in range(45)]), encoding='utf-8')
CLAUDE_JSON.write_text(json.dumps({'projects': {'/work/decode': {'last': 1}, '/work/other': {}}}), encoding='utf-8')
ck('cwd/白名单解码:无 cwd 时按 ~/.claude.json 键还原真实路径',
   scan.session_cwd('-work-decode', 'bbbb0002') == '/work/decode',
   scan.session_cwd('-work-decode', 'bbbb0002'))

# ③ 键不存在(项目已从 .claude.json 消失)→ 空串,绝不再吐编码名
CLAUDE_JSON.write_text(json.dumps({'projects': {'/work/other': {}}}), encoding='utf-8')
ck('cwd/白名单未命中 → 空串(不吐编码目录名)',
   scan.session_cwd('-work-decode', 'bbbb0002') == '', repr(scan.session_cwd('-work-decode', 'bbbb0002')))
missing = scan.session_cwd('-no-such-proj', 'cccc0003')
ck('cwd/转录不存在且未命中白名单 → 空串', missing == '', repr(missing))

# ④ 近似键不许误命中(白名单只做精确正向比对)
CLAUDE_JSON.write_text(json.dumps({'projects': {'/work/decode/deeper': {}, '/work-x': {}}}), encoding='utf-8')
ck('cwd/近似编码名不许误命中(精确比对)', scan.session_cwd('-work-decode', 'bbbb0002') == '',
   repr(scan.session_cwd('-work-decode', 'bbbb0002')))

# ⑤ 消费者级:runs[].cwd 拿到的就该是真实路径(项目下拉/过滤键 cwd||project 的数据面)
CLAUDE_JSON.write_text(json.dumps({'projects': {'/work/decode': {}}}), encoding='utf-8')
wd = d2 / 'bbbb0002' / 'workflows'
wd.mkdir(parents=True)
(wd / 'wf_demo.json').write_text(json.dumps(
    {'runId': 'wf_demo', 'workflowName': 'demo', 'status': 'completed', 'startTime': int(time.time() * 1000),
     'agentCount': 0, 'workflowProgress': []}), encoding='utf-8')
runs = {r['runId']: r for r in scan.scan()}
ck('cwd/消费者(runs[].cwd)拿到真实路径而非编码名',
   (runs.get('wf_demo') or {}).get('cwd') == '/work/decode', str((runs.get('wf_demo') or {}).get('cwd')))

done()
