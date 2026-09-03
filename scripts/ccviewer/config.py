# 共享路径与配置读写：数据源 ~/.claude/projects 永远只读，本服务只写 CONF_DIR
import json
import os
import socket
from pathlib import Path

PROJ = Path.home() / '.claude/projects'
CONF_DIR = Path.home() / '.claude/cc-viewer'
PIDF = CONF_DIR / 'server.pid'
CURRENT_PORT = 8787  # 入口启动时校正；保存端口时据此判断"是否变更"


def port_free(p):
    try:
        s = socket.socket()
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(('127.0.0.1', p))
        s.close()
        return True
    except OSError:
        return False


def load_conf():
    try:
        c = json.load(open(CONF_DIR / 'config.json'))
        return {'enabled': bool(c.get('enabled')), 'format': c.get('format', 'feishu'),
                'url': str(c.get('url', '')), 'insecure': bool(c.get('insecure')),
                'port': int(c.get('port') or 0)}
    except Exception:
        return {'enabled': False, 'format': 'feishu', 'url': '', 'insecure': False, 'port': 0}


def save_conf(c):
    CONF_DIR.mkdir(parents=True, exist_ok=True)
    tmp = CONF_DIR / 'config.json.tmp'
    tmp.write_text(json.dumps(c, ensure_ascii=False, indent=1))
    os.replace(tmp, CONF_DIR / 'config.json')
