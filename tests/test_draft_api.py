# 草稿层契约(1.2.43 编排器 §8.1):save_draft / list_drafts / _draft_dir / static_path 四单点的真实函数测试。
# 全部跑在临时 HOME 的 CONF_DIR 下(铁律 2:服务唯一可写目录),并反向证明"CONF_DIR 之外零落盘"。
# Origin 守卫与 HTTP 层往返在 test_web_api.py 增补(真起服务),本套件只管消毒与落盘语义。
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _util import ck, done, redirect, temp_home

from ccviewer import config, web

HOME = temp_home()
redirect(HOME)
DRAFTS = config.CONF_DIR / 'drafts'
CWD_OK = '/Users/x/projectDir/greatWall'
SCRIPT = 'export const meta = { name: "demo-research" }\nreturn { ok: 1 }\n'


def tree():
    """临时 HOME 全树快照(相对路径→size)。"""
    return {str(p.relative_to(HOME)): p.stat().st_size for p in HOME.rglob('*') if p.is_file()}


def outside():
    """CONF_DIR 之外的全部条目——草稿落盘后这些必须一字不变(铁律 2 的反向证据)。"""
    pref = str(config.CONF_DIR.relative_to(HOME)) + '/'
    return {k: v for k, v in tree().items() if not k.startswith(pref)}


def draft(name='demo-research', cwd=CWD_OK, v=1):
    return {'v': v, 'name': name, 'desc': '三角拆解 → 并行检索', 'cwd': cwd,
            'nodes': [{'id': 'n1', 'type': 'start', 'position': {'x': 40, 'y': 170}, 'data': {'note': '调研选题'}}],
            'edges': [], 'next': 2, 'view': {'x': 20, 'y': 10, 'zoom': 1}}


# ── 1) 正常保存:双文件落盘、内容逐字节 == 请求、path 在 drafts/ 前缀内 ──
guard = outside()
r = web.save_draft({'name': 'demo-research', 'draft': draft(), 'script': SCRIPT})
js = Path(r.get('path', ''))
ck('save/ok + 绝对路径在 CONF_DIR/drafts 内',
   r.get('ok') is True and r.get('msg') == '已保存' and js.is_absolute() and str(js).startswith(str(DRAFTS) + '/'), repr(r))
ck('save/.js 逐字节等于请求', js.is_file() and js.read_text(encoding='utf-8') == SCRIPT, str(js))
jf = js.with_suffix('.json')
ck('save/.json 为草稿原文(中文不转义)',
   jf.is_file() and json.loads(jf.read_text(encoding='utf-8')) == draft() and '三角拆解' in jf.read_text(encoding='utf-8'),
   str(jf))
ck('save/CONF_DIR 之外零落盘(铁律 2)', outside() == guard, str(sorted(set(outside()) ^ set(guard)))[:200])

# ── 2) 路径消毒参数化:非法 name 全拒;恶意 cwd 只会产生安全 slug ──
for nm in ['../x', '/abs', 'a/b', '.hidden', '', 'a\\b', '..', 'x' * 90, '中文 名', 'a\nb', 'a\r\nb']:
    res = web.save_draft({'name': nm, 'draft': draft(name=nm), 'script': SCRIPT})
    ck('name 被拒:%r' % nm, res.get('ok') is False and not res.get('path'), repr(res)[:140])
ck('name 合法集(点/横线/下划线/空格,首字符字母数字)',
   web.save_draft({'name': 'ok.name-1_x sp', 'draft': draft(name='ok.name-1_x sp'), 'script': SCRIPT}).get('ok') is True)

nbefore, obefore = tree(), outside()
for i, cwd in enumerate(['', '/../../etc', '/etc/passwd', '/Users/x/项目 目录', 'a' * 300, '~', 'relative/path', '/', None]):
    res = web.save_draft({'name': 'probe%d' % i, 'draft': draft(name='probe%d' % i, cwd=cwd), 'script': SCRIPT})
    p = Path(res.get('path', ''))
    ck('cwd 消毒:%r → 落在 drafts 内' % (cwd,),
       res.get('ok') is True and str(p).startswith(str(DRAFTS) + '/') and p.parent.parent == DRAFTS, repr(res)[:160])
ck('恶意输入只新增 drafts 下文件(CONF_DIR 外仍零变化)',
   outside() == obefore and all(k.startswith('.claude/cc-viewer/drafts/') for k in set(tree()) - set(nbefore)),
   str(sorted(set(tree()) - set(nbefore)))[:260])

# slug 稳定性:同 cwd 两次同目录、不同 cwd 不同目录、空 cwd 不落进程工作目录
d1, d2 = web._draft_dir(CWD_OK), web._draft_dir(CWD_OK + '/')
d3 = web._draft_dir('/Users/y/other')
ck('slug/同 cwd 确定性(尾斜杠不影响)', d1 == d2 and d1.parent == DRAFTS, str(d1))
ck('slug/不同 cwd 不同目录', d1 != d3, str((d1, d3)))
ck('slug/空 cwd 有确定落点且不随进程工作目录漂移(否则保存后回载查不到)',
   web._draft_dir('') == web._draft_dir(None) == web._draft_dir('   ')
   and str(Path.cwd()) not in str(web._draft_dir('')), str(web._draft_dir('')))
ck('slug/目录名只含安全字符', all(c in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-'
                               for c in d1.name), d1.name)

# ── 3) 覆盖保护:同名不同内容并存,同内容重复保存不产新文件 ──
r1 = web.save_draft({'name': 'dup', 'draft': draft(name='dup'), 'script': '// v1\n'})
dup_js = Path(r1['path'])
r2 = web.save_draft({'name': 'dup', 'draft': draft(name='dup'), 'script': '// v2\n'})
alt = Path(r2['path'])
ck('conflict/异内容默认并存 <name>-<sha8>.js(宁并存不覆盖)',
   alt.name == 'dup-%s.js' % r2['sha'] and alt != dup_js and dup_js.read_text(encoding='utf-8') == '// v1\n'
   and alt.read_text(encoding='utf-8') == '// v2\n', repr(r2)[:200])
same_dir = dup_js.parent
ck('conflict/同内容重复保存幂等(不产新文件)',
   web.save_draft({'name': 'dup', 'draft': draft(name='dup'), 'script': '// v1\n', 'overwrite': True})['path'] == str(dup_js)
   and sorted(p.name for p in same_dir.glob('dup*')) == sorted([dup_js.name, dup_js.stem + '.json', alt.name, alt.stem + '.json']),
   str(sorted(p.name for p in same_dir.glob('dup*'))))
ck('conflict/overwrite=true → 覆盖原件且配对 .json 一起更新',
   dup_js.read_text(encoding='utf-8') == '// v1\n' and json.loads((same_dir / 'dup.json').read_text(encoding='utf-8'))['v'] == 1)

# ── 4) 体积与载荷卫生 ──
ck('size/脚本 1MB+1 被拒',
   web.save_draft({'name': 'big', 'draft': draft(name='big'), 'script': 'x' * (1_000_001)}).get('ok') is False)
ck('size/空脚本被拒', web.save_draft({'name': 'empty', 'draft': draft(name='empty'), 'script': ''}).get('ok') is False)
ck('schema/draft.v!=1 被拒', web.save_draft({'name': 'v2', 'draft': draft(v=2), 'script': SCRIPT}).get('ok') is False)
ck('schema/draft 非 dict 被拒',
   web.save_draft({'name': 'x1', 'draft': '[]', 'script': SCRIPT}).get('ok') is False
   and web.save_draft({'name': 'x2', 'draft': None, 'script': SCRIPT}).get('ok') is False)
ck('schema/坏载荷(缺字段/None)不抛错只回 ok:false',
   web.save_draft(None).get('ok') is False and web.save_draft({}).get('ok') is False)
ck('卫生/落盘不留 .tmp', not list(DRAFTS.rglob('*.tmp')))

# ── 5) list_drafts:枚举/坏件跳过/与 save 往返一致 ──
lst = web.list_drafts(CWD_OK)
items = {it['name']: it for it in lst['drafts']}
ck('list/含已存草稿且回带 draft 全文(回载再编辑的数据面)', 'demo-research' in items, str(sorted(items))[:200])
it = items.get('demo-research') or {}
ck('list/条目字段 name/meta/mtime/js/draft',
   it.get('meta') == {'name': 'demo-research', 'desc': '三角拆解 → 并行检索'} and it.get('mtime', 0) > 0
   and Path(it.get('js', '')).is_file() and (it.get('draft') or {}).get('v') == 1, repr(it)[:220])
bad_dir = web._draft_dir(CWD_OK)
(bad_dir / 'broken.json').write_text('{坏 json', encoding='utf-8')
(bad_dir / 'notdraft.txt').write_text('x', encoding='utf-8')
ck('list/坏件静默跳过、非 .json 不入选(列表不许被单个坏件炸掉)',
   'broken' not in [x['name'] for x in web.list_drafts(CWD_OK)['drafts']]
   and 'notdraft' not in [x['name'] for x in web.list_drafts(CWD_OK)['drafts']], str(sorted(items))[:200])
ck('list/无草稿目录 → 空列表且不建目录',
   web.list_drafts('/nonexistent/proj-x') == {'drafts': []} and not any(DRAFTS.glob('proj-x*')), str(DRAFTS))
ck('list/未知项目(空 cwd)与保存端同一 slug 判定',
   'probe0' in [x['name'] for x in web.list_drafts('')['drafts']], str(web.list_drafts(''))[:200])

# ── 6) 静态白名单:只许枚举 vendored 文件,不放开任意路径读取 ──
ck('static/白名单含 xyflow UMD 且为 JS 类型',
   web.STATIC.get('xyflow.system.umd.js') == 'text/javascript; charset=utf-8', repr(web.STATIC))
ck('static/白名单不含其它名字(含 index.html/server.py)',
   'server.py' not in web.STATIC and 'index.html' not in web.STATIC and 'config.json' not in web.STATIC)
ck('static/解析到 static 目录内的真实文件',
   web.static_path('xyflow.system.umd.js') == (web.STATIC_DIR / 'xyflow.system.umd.js')
   and web.static_path('xyflow.system.umd.js').is_file(), str(web.STATIC_DIR))
ck('static/../、绝对路径、未列名一律 None(404)',
   web.static_path('../server.py') is None and web.static_path('/etc/passwd') is None
   and web.static_path('..') is None and web.static_path('') is None and web.static_path('nope.js') is None)
# 软链双保险:白名单命中的名字若真身落在 static 目录外 → 仍拒。
# 做法 = 把模块级 STATIC_DIR 重定向到临时目录(同 config.PROJ 的测试手法),不碰仓库里的 vendor。
import shutil
import tempfile
tmp_root = Path(tempfile.mkdtemp(prefix='lucid-static-'))
orig_static, keep = web.STATIC_DIR, []
try:
    real_dir, outside = tmp_root / 'static', tmp_root / 'outside'
    real_dir.mkdir()
    outside.mkdir()
    (outside / 'victim.js').write_text('SECRET', encoding='utf-8')
    web.STATIC_DIR = real_dir
    (real_dir / 'xyflow.system.umd.js').symlink_to(outside / 'victim.js')
    ck('static/名单内名字+真身在 static 外(软链)→ 拒', web.static_path('xyflow.system.umd.js') is None)
    (real_dir / 'xyflow.system.umd.js').unlink()
    (real_dir / 'xyflow.system.umd.js').write_text('UMD-STUB', encoding='utf-8')
    sp = web.static_path('xyflow.system.umd.js')
    ck('static/名单内名字+真身在内 → 可读(重定向后仍按模块属性取目录)',
       sp is not None and sp.read_text(encoding='utf-8') == 'UMD-STUB', str(sp))
    keep = sorted(p.name for p in outside.iterdir())
finally:
    web.STATIC_DIR = orig_static
    shutil.rmtree(tmp_root, True)
ck('static/测试未在别处留文件', keep == ['victim.js'], str(keep))

done()
