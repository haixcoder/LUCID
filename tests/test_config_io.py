# 配置层契约:load_conf 钳制/回落、save_conf 原子写与往返、INPUT_TIERS 档位 —— 全在临时 CONF_DIR,不碰真实配置。
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _util import ck, done, temp_home

from ccviewer import config

HOME = temp_home()
CD = HOME / '.claude' / 'cc-viewer'
CD.mkdir(parents=True)
config.CONF_DIR = CD
CFG = CD / 'config.json'


def load_raw(d):
    CFG.write_text(json.dumps(d, ensure_ascii=False), encoding='utf-8')
    return config.load_conf()


# 1) 缺文件/坏文件 → 全默认,不抛异常
CD.joinpath('nope.json')
r = config.load_conf()
ck('missing-file-defaults', r == {'enabled': False, 'format': 'feishu', 'url': '', 'insecure': False,
                                  'port': 0, 'recentDays': 14, 'notifyInput': 'blocked'}, repr(r))
CFG.write_text('{ 这是坏 json', encoding='utf-8')
ck('corrupt-file-defaults', config.load_conf()['recentDays'] == 14)

# 2) recentDays 钳制 1..3650 + 脏值回落 14
ck('rdays/clamp-high', load_raw({'recentDays': '99999'})['recentDays'] == 3650)
ck('rdays/clamp-low', load_raw({'recentDays': '0'})['recentDays'] == 1)
ck('rdays/str-num', load_raw({'recentDays': '30'})['recentDays'] == 30)
ck('rdays/junk', load_raw({'recentDays': 'abc'})['recentDays'] == 14)
ck('rdays/null', load_raw({'recentDays': None})['recentDays'] == 14)
ck('rdays/recent_sec', config.recent_sec() == 14 * 86400)

# 3) 档位白名单:未知值回落 blocked(默认只发真卡住)
ck('tier/unknown-fallback', load_raw({'notifyInput': 'yolo'})['notifyInput'] == 'blocked')
ck('tier/all-kept', load_raw({'notifyInput': 'all'})['notifyInput'] == 'all')
ck('tier/const', config.INPUT_TIERS == ('off', 'blocked', 'all'))

# 4) 类型卫生:enabled/insecure 强 bool,url 强 str,port 非数字→0
r = load_raw({'enabled': 1, 'insecure': 0, 'url': 42, 'port': '8888'})
ck('types/coerce', r['enabled'] is True and r['insecure'] is False and r['url'] == '42' and r['port'] == 8888, repr(r))
ck('types/bad-port-zero', load_raw({'port': 'abc'})['port'] == 0)

# 5) save_conf 原子写 + 往返一致(中文不转义)
c = {'enabled': True, 'format': 'feishu', 'url': 'https://open.feishu.cn/hook/飞书群', 'insecure': False,
     'port': 8787, 'recentDays': 21, 'notifyInput': 'off'}
config.save_conf(c)
ck('save/roundtrip', config.load_conf() == c, repr(config.load_conf()))
ck('save/no-tmp-leftover', not (CD / 'config.json.tmp').exists())
ck('save/ensure-ascii-off', '飞书群' in CFG.read_text(encoding='utf-8') and '\\u' not in CFG.read_text(encoding='utf-8'))

done()
