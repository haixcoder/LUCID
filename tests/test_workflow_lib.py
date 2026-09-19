# 工作流库层契约(1.2.71):list_workflows / read_workflow / _embed_in / _read_capped 的真实函数测试。
# 全部跑在临时 HOME 下;反向证明"只读枚举"——跑完数据源树一字不变(铁律 2:写域不因本功能扩张)。
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _util import ck, done, redirect, temp_home

from ccviewer import config, web

HOME = temp_home()
redirect(HOME)
CLD = HOME / '.claude'
DRAFTS = CLD / 'cc-viewer' / 'drafts'

# ── fixture:真实目录当"选中项目"(proj 脚本要从真实 FS 枚举)──
P1 = HOME / 'proj1'
(P1 / '.claude' / 'workflows').mkdir(parents=True)
EMBED = '// lucid-graph:1:' + 'eyJ2IjoyfQ=='  # {"v":2} 的 base64——只为标记探测,解码在前端
SCRIPT_EMBED = 'export const meta = {\n  name: "alpha",\n  description: "带内嵌图",\n}\nreturn {}\n' + EMBED + '\n'
(P1 / '.claude' / 'workflows' / 'alpha.js').write_text(SCRIPT_EMBED, encoding='utf-8')
(P1 / '.claude' / 'workflows' / 'beta.js').write_text('export const meta = {\n  name: "beta",\n  description: "无内嵌",\n}\n', encoding='utf-8')
(P1 / '.claude' / 'workflows' / 'notes.txt').write_text('不是脚本,不许进列表', encoding='utf-8')

# 草稿:两个项目 slug + 一个坏件 + 一个非 dict 件
def mk_draft(slug, name, cwd, extra=None):
    d = DRAFTS / slug
    d.mkdir(parents=True, exist_ok=True)
    j = {'v': 2, 'name': name, 'desc': '描述-' + name, 'cwd': cwd, 'nodes': [], 'edges': []}
    j.update(extra or {})
    (d / (name + '.json')).write_text(json.dumps(j, ensure_ascii=False), encoding='utf-8')
    (d / (name + '.js')).write_text('// exec ' + name + '\n', encoding='utf-8')
    return d

mk_draft('proj1-aaaaaa', 'demo', str(P1), {'whenToUse': '需要时'})
mk_draft('proj2-bbbbbb', 'other', '/Users/y/other')
(DRAFTS / 'proj2-bbbbbb' / 'broken.json').write_text('{ 不是 JSON', encoding='utf-8')
(DRAFTS / 'proj2-bbbbbb' / 'notdict.json').write_text('[1,2,3]', encoding='utf-8')

# 个人工作流(与 agentType 枚举同一根)
(CLD / 'workflows').mkdir(parents=True, exist_ok=True)
(CLD / 'workflows' / 'personal.js').write_text('export const meta = {\n  name: "personal",\n  description: "个人流",\n}\n', encoding='utf-8')

# 运行记录:同名两条(保留最近)+ 一条异名 + 对应 scripts 文件
RPROJ = config.PROJ / '-Users-x-proj1'
for sess, rid, at, summary, script in [
    ('sess-1', 'wf_old11111-111', 100, '旧的一次', 'export const meta = { name: "runflow" }\n'),
    ('sess-2', 'wf_new22222-222', 200, '最近一次', 'export const meta = { name: "runflow" }\n' + EMBED + '\n'),
]:
    wd = RPROJ / sess / 'workflows'
    (wd / 'scripts').mkdir(parents=True, exist_ok=True)
    (wd / ('%s.json' % rid)).write_text(json.dumps(
        {'runId': rid, 'workflowName': 'runflow', 'summary': summary, 'startTime': at,
         'status': 'completed', 'script': script}, ensure_ascii=False), encoding='utf-8')
    (wd / 'scripts' / ('runflow-%s.js' % rid)).write_text(script, encoding='utf-8')
wd3 = RPROJ / 'sess-3' / 'workflows'
(wd3 / 'scripts').mkdir(parents=True, exist_ok=True)
(wd3 / 'wf_zzz33333-333.json').write_text(json.dumps(
    {'runId': 'wf_zzz33333-333', 'workflowName': 'solo', 'summary': '另一个', 'startTime': 50,
     'status': 'completed'}), encoding='utf-8')  # 无 script 字段


def tree():
    return {str(p.relative_to(HOME)): p.stat().st_size for p in HOME.rglob('*') if p.is_file()}


before = tree()
res = web.list_workflows(str(P1))
items = res['items']
by = lambda src: [x for x in items if x['src'] == src]

# ── 1) 四类来源齐备,形状完整 ──
ck('list/四类来源都在', {x['src'] for x in items} == {'draft', 'proj', 'home', 'run'},
   str(sorted({x['src'] for x in items})))
ck('list/条目字段完整', all(set(x) >= {'src', 'name', 'desc', 'mtime', 'graph', 'path', 'js'} for x in items),
   str([sorted(x) for x in items][:2]))

# ── 2) draft:跨项目(不受 proj 限制)、cwd/whenToUse 来自 JSON、坏件静默跳过 ──
dn = {x['name'] for x in by('draft')}
ck('draft/跨项目全列出(两个 slug 都进,坏件/非 dict 跳过)', dn == {'demo', 'other'}, str(sorted(dn)))
d1 = next(x for x in by('draft') if x['name'] == 'demo')
ck('draft/cwd 与 whenToUse 来自草稿 JSON(载入切上下文的依据)',
   d1['cwd'] == str(P1) and d1['whenToUse'] == '需要时' and d1['graph'] is True, json.dumps(d1, ensure_ascii=False)[:200])
ck('draft/.json 为读取入口、.js 为执行件', d1['path'].endswith('demo.json') and d1['js'].endswith('demo.js'),
   d1['path'] + ' | ' + d1['js'])

# ── 3) proj:只认绝对 cwd、目录里只看 *.js、graph 徽标 = 内嵌标记 ──
pn = {x['name']: x for x in by('proj')}
ck('proj/只列 .js(notes.txt 不进)', set(pn) == {'alpha', 'beta'}, str(sorted(pn)))
ck('proj/graph 徽标区分内嵌有无', pn['alpha']['graph'] is True and pn['beta']['graph'] is False, str(pn))
ck('proj/头部 meta 的 name/description 供列表展示', pn['alpha']['desc'] == '带内嵌图' and pn['beta']['desc'] == '无内嵌', str(pn))
ck('proj/相对 cwd 不给 proj 源(宁缺毋滥)', [x['name'] for x in web.list_workflows('relative/path')['items'] if x['src'] == 'proj'] == [])
ck('proj/空 cwd 不炸', isinstance(web.list_workflows('')['items'], list))

# ── 4) home:个人工作流目录 ──
ck('home/列出 ~/.claude/workflows/*.js', {x['name'] for x in by('home')} == {'personal'}, str(by('home')))

# ── 5) run:按名去重保留最近一次;scripts 路径按 runId 反查 ──
rn = {x['name']: x for x in by('run')}
ck('run/同名去重(旧的一次被最近一次替换)', set(rn) == {'runflow', 'solo'} and rn['runflow']['desc'] == '最近一次'
   and rn['runflow']['at'] == 200, json.dumps({k: v.get('at') for k, v in rn.items()}))
ck('run/scripts 文件按 <name>-<runid>.js 反查', rn['runflow']['js'].endswith('runflow-wf_new22222-222.js'), rn['runflow']['js'])
ck('run/无 script 字段也能列出(js 为空)', rn['solo']['js'] == '' and rn['solo']['graph'] is False, str(rn['solo']))
ck('run/带内嵌的 graph=True', rn['runflow']['graph'] is True)

# ── 6) 只读枚举:数据源树一字不变(铁律 2 反向证据)──
ck('list/数据源零改动', tree() == before)

# ── 7) 目录上限:超出 LIB_DIR_LIMIT 截断(不给整目录拖垮轮询)──
many = CLD / 'workflows'
for i in range(web.LIB_DIR_LIMIT + 5):
    (many / ('gen%03d.js' % i)).write_text('// x\n', encoding='utf-8')
hn = [x for x in web.list_workflows(str(P1))['items'] if x['src'] == 'home']
ck('list/单目录枚举有上限', len(hn) == web.LIB_DIR_LIMIT, str(len(hn)))
for i in range(web.LIB_DIR_LIMIT + 5):
    (many / ('gen%03d.js' % i)).unlink()

# ── 8) read_workflow:白名单内可读、形状正确 ──
r1 = web.read_workflow(str(DRAFTS / 'proj1-aaaaaa' / 'demo.json'))
ck('read/draft → 图草稿原文', r1 and r1['ok'] and r1['kind'] == 'draft' and r1['graph']['name'] == 'demo', str(r1)[:160])
r2 = web.read_workflow(str(P1 / '.claude' / 'workflows' / 'alpha.js'))
ck('read/proj .js → 脚本全文 + embed 徽标', r2 and r2['kind'] == 'script' and r2['script'] == SCRIPT_EMBED
   and r2['embed'] is True and r2['truncated'] is False, str(r2)[:160])
r3 = web.read_workflow(str(CLD / 'workflows' / 'personal.js'))
ck('read/home .js 同规则可读', r3 and r3['ok'] and r3['kind'] == 'script' and 'personal' in r3['script'])
r4 = web.read_workflow(str(RPROJ / 'sess-2' / 'workflows' / 'wf_new22222-222.json'))
ck('read/run 记录 → script 字段抽出', r4 and r4['ok'] and r4['kind'] == 'run' and 'runflow' in r4['script']
   and r4['embed'] is True, str(r4)[:160])
r5 = web.read_workflow(str(RPROJ / 'sess-2' / 'workflows' / 'scripts' / 'runflow-wf_new22222-222.js'))
ck('read/run 当次脚本 .js 可读', r5 and r5['ok'] and r5['kind'] == 'script', str(r5)[:120])

# ── 9) read_workflow:白名单外一律 None(不泄露、不越权)──
OUTSIDE = HOME / 'outside.js'
OUTSIDE.write_text('// 白名单外的脚本\n', encoding='utf-8')
for path, why in [
    ('/etc/passwd', '系统文件'),
    (str(OUTSIDE), '.js 不在白名单根内'),
    (str(config.PROJ / '-Users-x-proj1' / 'sess-1' / 'transcript.jsonl'), '转录不在白名单'),
    (str(DRAFTS / 'proj1-aaaaaa' / '..' / '..' / 'cc-viewer' / 'config.json'), '穿越回上级'),
    (str(P1), '目录不是文件'),
    (str(P1 / '.claude' / 'workflows' / 'missing.js'), '不存在的文件'),
    ('', '空路径'),
    (str(config.CONF_DIR / 'config.json'), 'CONF_DIR 但不在 drafts 下'),
]:
    ck('read/白名单外拒绝:%s' % why, web.read_workflow(path) is None, str(path))

# ── 10) 截断如实上报(铁律 7:数据源有上限必须能被告知)──
big = DRAFTS / 'proj1-aaaaaa' / 'big.json'
big.write_text('{"v": 2, "pad": "' + 'x' * (web.LIB_READ_CAP + 100) + '"}', encoding='utf-8')
rb = web.read_workflow(str(big))
ck('read/超读取上限 → ok:false 且写明截断(不是静默空白)', rb and rb['ok'] is False and '截断' in rb['msg'], str(rb)[:140])
big.unlink()
jsbig = P1 / '.claude' / 'workflows' / 'big.js'
jsbig.write_text('// ' + 'y' * (web.LIB_READ_CAP + 100), encoding='utf-8')
rj = web.read_workflow(str(jsbig))
ck('read/脚本超上限 → 截断标记随行(界面据此写明"非全文")', rj and rj['ok'] and rj['truncated'] is True, str(rj)[:120])
jsbig.unlink()

# ── 11) 标记判定单点 ──
ck('_embed_in/只看行首整行标记(正文里提到不算)',
   web._embed_in('// lucid-graph:1:AAAA\n') and not web._embed_in('x = "// lucid-graph:1:AAAA"')
   and not web._embed_in('// lucid-graph:1:非法!!') and not web._embed_in(None))

done()
