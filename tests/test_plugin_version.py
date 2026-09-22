# 插件版本展示(1.2.72)的数据源契约:web.plugin_info 读**本进程正在跑的那份副本**自己的
# .claude-plugin/plugin.json(相对 __file__ 定位,源码仓/安装副本/npm 三处布局同构)。
# 读不到(目录不存在/坏 JSON/字段非字符串)一律归一为空串——上层显式显示「未知」,不报错、不静默留白。
# HTTP 层往返(/api/config.plugin)在 test_web_api.py;前端展示三态在 tests/frontend/test_settings_version.ts。
import atexit
import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _util import REPO, ck, done

from ccviewer import web

plug = json.loads((REPO / '.claude-plugin' / 'plugin.json').read_text(encoding='utf-8'))
ck('repo-copy: 读本仓库自己的清单', web.plugin_info() == {'name': plug['name'], 'version': plug['version']},
   repr(web.plugin_info()))

tmp = Path(tempfile.mkdtemp(prefix='lucid-plug-'))
atexit.register(shutil.rmtree, str(tmp), True)
(tmp / '.claude-plugin').mkdir(parents=True)
(tmp / '.claude-plugin' / 'plugin.json').write_text(json.dumps({'name': 'x', 'version': '9.9.9'}), encoding='utf-8')
ck('tmp-root: 以任意根读取(root 注入)', web.plugin_info(tmp) == {'name': 'x', 'version': '9.9.9'},
   repr(web.plugin_info(tmp)))

ck('missing-manifest: 目录不存在 → 空串(不抛)',
   web.plugin_info(tmp / 'nope') == {'name': '', 'version': ''}, repr(web.plugin_info(tmp / 'nope')))

bad = tmp / 'bad'
(bad / '.claude-plugin').mkdir(parents=True)
(bad / '.claude-plugin' / 'plugin.json').write_text('{ 这不是 json', encoding='utf-8')
ck('corrupt-manifest: 坏 JSON → 空串(不抛)', web.plugin_info(bad) == {'name': '', 'version': ''},
   repr(web.plugin_info(bad)))

(tmp / '.claude-plugin' / 'plugin.json').write_text('{"name": null, "version": 123}', encoding='utf-8')
ck('non-string-fields: 一律 str() 归一,不让 None 泄进 JSON',
   web.plugin_info(tmp) == {'name': '', 'version': '123'}, repr(web.plugin_info(tmp)))

done()
