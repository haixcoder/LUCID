# npm 通道打包契约(1.2.30 起):kw-lucid 包 = 插件 + 自足市场(npm tarball 根目录带
# .claude-plugin/marketplace.json,source "./" 相对"被 add 的目录"解析,与仓库目录市场同一语义)。
# 用户装法:npm install -g kw-lucid && claude plugin marketplace add "$(npm root -g)/kw-lucid"
#           && claude plugin install lucid@kw-dev-plugins ;或一行 npx -y kw-lucid(bin/install.js)。
# 本套件钉死发布物料的完整性——files 漏目录=装出来的插件缺 hook/monitor,只有真装一次才能发现,
# 故用静态契约提前拦:① 两份 manifest 版本同步(铁律"每次更新=版本+1"对 npm 包同样生效);
# ② files 覆盖全部运行时组件目录且无死引用;③ LICENSE 存在且与 package.json 声明一致;
# ④ 包内市场 JSON 有效(插件条目 source "./");⑤ bin 脚本存在、被声明、语法可过。
import json
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _util import REPO, ck, done

pkg = json.loads((REPO / 'package.json').read_text(encoding='utf-8'))
plugin = json.loads((REPO / '.claude-plugin' / 'plugin.json').read_text(encoding='utf-8'))
mkt = json.loads((REPO / '.claude-plugin' / 'marketplace.json').read_text(encoding='utf-8'))

# ── ① 版本同步 ──
ck('ver-sync', pkg.get('version') == plugin.get('version'),
   repr((pkg.get('version'), plugin.get('version'))))

# ── ② files 允许清单:运行时组件一个不能少,且不引用不存在的文件 ──
RUNTIME = {'.claude-plugin/plugin.json', '.claude-plugin/marketplace.json',
           'commands', 'hooks', 'monitors', 'scripts'}
files = set(pkg.get('files') or [])
ck('files-covers-runtime', RUNTIME <= files, repr(sorted(RUNTIME - files)))
dead = [f for f in files if not (REPO / f).exists()]
ck('files-no-dead-ref', not dead, repr(dead))

# ── ③ license:声明了就必须有 LICENSE 文件,且类型一致(npm publish 的合规底线) ──
lic = pkg.get('license') or ''
ck('license-declared', bool(lic), 'package.json 无 license 字段')
if Path(REPO / 'LICENSE').exists():
    head = (REPO / 'LICENSE').read_text(encoding='utf-8')[:600]
    ck('license-file-matches',
       ('Version 2.0' in head) if 'Apache' in lic else True,
       'LICENSE 与 package.json license=%s 不符' % lic)
else:
    ck('license-file-matches', False, 'LICENSE 文件缺失')

# ── ④ 包内市场自足:npm 根目录的 marketplace.json 含 lucid 条目且 source 为 "./" ──
entries = [p for p in mkt.get('plugins', []) if p.get('name') == plugin.get('name')]
ck('market-entry', len(entries) == 1, repr(len(entries)))
if entries:
    ck('market-source-self', entries[0].get('source') == './', repr(entries[0].get('source')))

# ── ⑤ npx 一行装入口:bin 存在、被 package.json 指向、语法通过(有 node 才查语法;CI 无 node 则跳) ──
bin_field = pkg.get('bin')
ck('bin-declared', isinstance(bin_field, str) and bin_field.endswith('install.js'), repr(bin_field))
bs = REPO / (bin_field if isinstance(bin_field, str) else '')
ck('bin-exists', bool(bin_field) and bs.is_file(), str(bs))
node = shutil.which('node')
if bs.is_file() and node:
    p = subprocess.run([node, '--check', str(bs)], capture_output=True, text=True)
    ck('bin-node-syntax', p.returncode == 0, p.stderr[:200])

# ── ⑥ 安装器 TS 化契约(1.2.31 起):源码 tools/install.ts,bin/install.js 为编译产物 ──
#    产物必须带"编译生成勿手改"标;本地装了 devDependencies(tsc)时进一步核对
#    产物==编译输出,拦"改了源码忘了 npm run build 就发布"。
ck('bin-source-exists', (REPO / 'tools' / 'install.ts').is_file(), 'tools/install.ts 缺失')
if bs.is_file():
    ck('bin-artifact-marked', '编译产物' in bs.read_text(encoding='utf-8'),
       'bin/install.js 缺生成标记(疑似手改产物或丢注释)')
tsc = REPO / 'node_modules' / '.bin' / 'tsc'
if tsc.exists() and bs.is_file():
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        p = subprocess.run([str(tsc), '-p', str(REPO / 'tsconfig.install.json'), '--outDir', td],
                           capture_output=True, text=True)
        gen = Path(td) / 'install.js'
        ck('bin-artifact-fresh',
           p.returncode == 0 and gen.is_file() and gen.read_text(encoding='utf-8') == bs.read_text(encoding='utf-8'),
           (p.stderr or p.stdout)[:200] or '产物与 tools/install.ts 编译输出不一致:跑 npm run build')

# ── ⑦ 编排器 vendored UMD(1.2.43):运行时物料必须随包到位 ──────────────────────────
# vendor 是"提交入库的构建产物"(铁律 1 的合规形态,同 bin/install.js):运行时零新增依赖,
# 但页面靠 /static/<白名单> 取它 —— 装出来的副本缺这个文件 = 编辑器打不开(404),只有真装一次才会发现。
VENDOR = 'scripts/ccviewer/static/xyflow.system.umd.js'
ck('flow-vendor-exists', (REPO / VENDOR).is_file(), str(REPO / VENDOR))
ck('flow-vendor-served', 'src="/static/xyflow.system.umd.js"' in (REPO / 'scripts' / 'ccviewer' / 'static' / 'index.html').read_text(encoding='utf-8'),
   '产物未引用 vendor(模板与产物不同步?)')
# 拷贝路径对账:tarball 与安装器都是"递归拷 scripts/",此处断言的是这条覆盖关系不许被改窄
ck('flow-vendor-in-files-glob', 'scripts' in files, repr(sorted(files)))
inst = (REPO / 'tools' / 'install.ts').read_text(encoding='utf-8')
ck('flow-vendor-in-installer', "'scripts'" in inst and 'recursive: true' in inst,
   'install.ts 的 COMPONENTS 或递归拷贝口径变了(vendor 会装不到)')
npm = shutil.which('npm')
if npm:
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        p = subprocess.run([npm, 'pack', '--dry-run', '--json'], cwd=REPO, capture_output=True, text=True, timeout=180)
        listed = VENDOR in (p.stdout or '') or any(VENDOR in str(x.get('path', '')) for x in (json.loads(p.stdout) if p.stdout.strip().startswith('[') else []))
        ck('flow-vendor-in-tarball', p.returncode == 0 and listed, (p.stdout or p.stderr)[-300:])
else:
    print('  ! npm 不在 PATH:跳过 tarball 清单核对(开发机 npm 一次性装好即可)')

done()
