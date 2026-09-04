#!/usr/bin/env python3
# xray 服务看护/自启动：由插件 harness 的两个触发口之一在会话开始时调用本脚本 --detach：
#   · monitors/monitors.json —— 官方后台 monitor（交互式会话自动化；部分宿主不可用）
#   · hooks/hooks.json 的 SessionStart —— 钩子兜底（每次会话开始）
# --detach 语义：确保一个常驻「看护循环」（guard.py 自身，写 guard.pid 跨会话去重）在跑；
# 循环探测 127.0.0.1:<port> 未监听 → setsid 分离启动 server.py（服务进程独立于本会话存活），
# 周期复查实现崩溃自动重启 —— 即「自启动 + 看护」。server/循环退出均不影响服务。
# 静默策略：常稳态零输出；仅「启动成功 / 启动失败」状态变化时输出一行（monitors 模式进会话
# 通知；detach 模式循环的 stdout 落 server.log）。
import argparse
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

from ccviewer import config

DEFAULT_PORT = 8787
DEFAULT_INTERVAL = 30  # 秒；每轮仅一次 TCP 探测，开销可忽略


def probe(port, timeout=0.5):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout):
            return True
    except OSError:
        return False


def spawn_server():
    """setsid 分离启动 server.py（无 nohup/setsid 外部命令，纯 stdlib，等效）。"""
    config.CONF_DIR.mkdir(parents=True, exist_ok=True)
    log = config.CONF_DIR / 'server.log'
    return subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve().parent / 'server.py')],
        start_new_session=True,
        stdin=subprocess.DEVNULL,
        stdout=open(log, 'a', buffering=1),
        stderr=subprocess.STDOUT,
    )


def ensure_once():
    """确保服务在运行。返回 None（已运行）或一行状态文案；调用方决定何时打印。"""
    port = config.load_conf().get('port') or DEFAULT_PORT
    if probe(port):
        return None
    p = spawn_server()
    deadline = time.time() + 6.0
    while time.time() < deadline:
        if probe(port):
            return f'xray 服务已自动启动: http://127.0.0.1:{port} (pid {p.pid})'
        if p.poll() is not None:  # server.py 启动即退出（多为端口被外部进程占用，详见其 stderr）
            break
        time.sleep(0.2)
    return f'xray 服务自动启动失败: 端口 {port} 未在监听, server.py 已退出(详见 {config.CONF_DIR}/server.log)'


def watcher_alive():
    try:
        pid = int(config.GUARDPID.read_text())
        os.kill(pid, 0)
        return True
    except Exception:
        return False


def spawn_watcher():
    """以独立会话拉起新一轮看护循环（常驻、跨会话存活），幂等靠 guard.pid。"""
    config.CONF_DIR.mkdir(parents=True, exist_ok=True)
    log = config.CONF_DIR / 'server.log'
    return subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve()), '--interval', str(DEFAULT_INTERVAL)],
        start_new_session=True,
        stdin=subprocess.DEVNULL,
        stdout=open(log, 'a', buffering=1),
        stderr=subprocess.STDOUT,
    )


def main():
    ap = argparse.ArgumentParser(description='xray 服务看护: 确保 server.py 运行, 崩溃自动重启; 仅状态变化时输出一行')
    ap.add_argument('--once', action='store_true', help='只保证一次并退出(调试/测试)')
    ap.add_argument('--detach', action='store_true', help='确保常驻看护循环在跑(无则 setsid 拉起), 立即退出(会话开始入口)')
    ap.add_argument('--interval', type=int, default=DEFAULT_INTERVAL, help=f'复查间隔秒(默认 {DEFAULT_INTERVAL})')
    args = ap.parse_args()

    if args.detach:
        if not watcher_alive():
            spawn_watcher()
        return 0

    if args.once:  # 一次性检查, 不写 guard.pid(不代表常驻循环存在)
        msg = ensure_once()
        if msg:
            print(msg, flush=True)
        return 0

    config.CONF_DIR.mkdir(parents=True, exist_ok=True)
    config.GUARDPID.write_text(str(os.getpid()))
    last = ''  # 状态变化才输出；连续失败只报告一次，恢复后再失败会重新报告
    while True:
        msg = ensure_once()
        if msg != last:
            if msg:
                print(msg, flush=True)
            last = msg
        time.sleep(max(3, args.interval))


if __name__ == '__main__':
    sys.exit(main())
