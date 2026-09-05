# tests 公共件:断言器 + 临时 HOME 重定向。零依赖(仅 stdlib),风格沿用原 /tmp 复现脚本(ck/FAIL/exit code)。
# 背景:历史回归测试(t1..t8/repro_*)每次现写现丢在 /tmp,机器重启即绝迹——本目录是其正式归宿。
import atexit
import json
import os
import shutil
import sys
import tempfile
import time
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'scripts'))

FAILS = []


def ck(name, cond, detail=''):
    """一条断言:✓/✗ 即时打印;✗ 记入 FAILS,由 done() 汇总决定退出码。"""
    print(('✓' if cond else '✗'), name, '' if cond else detail)
    if not cond:
        FAILS.append(name)


def done():
    print()
    print('RESULT:', 'GREEN' if not FAILS else 'RED %d 项: %s' % (len(FAILS), FAILS))
    sys.exit(1 if FAILS else 0)


def temp_home():
    """临时 HOME 根目录(退出自动清理)。数据源 ~/.claude/* 全部落在其下,永不碰真实目录。"""
    td = tempfile.mkdtemp(prefix='lucid-test-')
    atexit.register(shutil.rmtree, td, True)
    home = Path(td)
    (home / '.claude' / 'projects').mkdir(parents=True)
    (home / '.claude' / 'sessions').mkdir(parents=True)
    return home


def redirect(home):
    """把 ccviewer 各模块的数据源钉到临时 HOME。
    现状:模块各自 `from .config import PROJ` 按值导入 → 必须逐模块打别名;
    集中化重构后仅需 config —— hasattr 两种形态通吃,测试不必随重构改写。"""
    from ccviewer import agent, config, notify, scan, sessions
    config.PROJ = home / '.claude' / 'projects'
    config.CONF_DIR = home / '.claude' / 'cc-viewer'
    for m in (scan, sessions, agent, notify):
        if hasattr(m, 'PROJ'):
            m.PROJ = config.PROJ
        if hasattr(m, 'CONF_DIR'):
            m.CONF_DIR = config.CONF_DIR
    return config.PROJ


# ── fixture 构造器(转录/注册表形态,2026-09 实测格式) ──

def asst(mid, stop, blocks, text_model='claude-fable-5', ts=None, usage=None):
    return {'type': 'assistant', 'timestamp': ts or '2026-09-05T04:00:00.000Z',
            'message': {'id': mid, 'model': text_model, 'role': 'assistant', 'content': blocks,
                        'stop_reason': stop,
                        'usage': usage or {'input_tokens': 10, 'output_tokens': 20}}}


def user(text, uuid_=None):
    d = {'type': 'user', 'message': {'role': 'user', 'content': text}}
    if uuid_:
        d['uuid'] = uuid_
    return d


def write_transcript(proj_dir, records, sess=None):
    sess = sess or str(uuid.uuid4())
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / (sess + '.jsonl')).write_text('\n'.join(json.dumps(r, ensure_ascii=False) for r in records),
                                              encoding='utf-8')
    return sess


def registry_add(home_dir, sid, pid, cwd='/fix'):
    """活进程注册表条目:文件名任意(glob *.json),pid 须真实存活(通常传本测试进程 os.getpid())。"""
    reg = home_dir / '.claude' / 'sessions'
    reg.mkdir(parents=True, exist_ok=True)
    (reg / ('%s.json' % sid)).write_text(
        json.dumps({'pid': pid, 'sessionId': sid, 'cwd': cwd,
                    'startedAt': int(time.time() * 1000), 'kind': 'interactive'}), encoding='utf-8')
