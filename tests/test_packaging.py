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

done()
