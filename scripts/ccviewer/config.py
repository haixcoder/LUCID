# 共享路径与配置读写：数据源 ~/.claude/projects 永远只读，本服务只写 CONF_DIR
import json
import os
import socket
from pathlib import Path

PROJ = Path.home() / '.claude/projects'
CONF_DIR = Path.home() / '.claude/cc-viewer'
PIDF = CONF_DIR / 'server.pid'
GUARDPID = CONF_DIR / 'guard.pid'  # 常驻看护循环 pid(guard.py),跨会话去重用
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


INPUT_TIERS = ('off', 'blocked', 'all')  # 等待输入通知档位：关闭 / 仅等回答·等授权 / 含回合结束待输入
DETAIL_CAP = 80000  # 全文端点(/api/agent /api/subagent)单字段上限——多消费方共用同一契约值


def load_conf():
    try:
        with open(CONF_DIR / 'config.json') as f:
            c = json.load(f)
        try:
            rdays = max(1, min(3650, int(c.get('recentDays') or 14)))
        except (TypeError, ValueError):
            rdays = 14
        tier = c.get('notifyInput') if c.get('notifyInput') in INPUT_TIERS else 'blocked'
        return {'enabled': bool(c.get('enabled')), 'format': c.get('format', 'feishu'),
                'url': str(c.get('url', '')), 'insecure': bool(c.get('insecure')),
                'port': int(c.get('port') or 0), 'recentDays': rdays, 'notifyInput': tier}
    except Exception:
        return {'enabled': False, 'format': 'feishu', 'url': '', 'insecure': False,
                'port': 0, 'recentDays': 14, 'notifyInput': 'blocked'}


def recent_sec():
    # 回看窗口秒数:配置里 recentDays 天(默认 14);按次读文件,改设置下一轮扫描即生效
    return load_conf()['recentDays'] * 86400


def save_conf(c):
    CONF_DIR.mkdir(parents=True, exist_ok=True)
    tmp = CONF_DIR / 'config.json.tmp'
    tmp.write_text(json.dumps(c, ensure_ascii=False, indent=1))
    os.replace(tmp, CONF_DIR / 'config.json')
