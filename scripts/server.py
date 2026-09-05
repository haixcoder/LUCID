#!/usr/bin/env python3
# cc-viewer 入口：参数解析、启动/停止。核心逻辑在 ccviewer/ 包（仅 stdlib）：
#   config 路径与配置 | scan 扫描与状态重建 | agent 全文 | notify webhook 通知 | web HTTP+前端
# 原 982 行单文件版备份结构说明见 README.md「原理」。
import argparse
import os
import signal
import sys
import threading

from ccviewer import config, notify, web

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8787, help='默认端口；网页"⚙ 设置"保存过的端口优先于此参数')
    ap.add_argument('--stop', action='store_true', help='停止运行中的 viewer（按 PID 文件，免 lsof|kill）')
    args = ap.parse_args()
    if args.stop:
        try:
            pid = int(config.PIDF.read_text()); os.kill(pid, signal.SIGTERM); print(f'已停止 lucid (pid {pid})')
        except Exception as e:
            sys.exit(f'停止失败（可能未在运行）：{e}')
        sys.exit(0)
    config.CURRENT_PORT = config.load_conf().get('port') or args.port  # 属性赋值；web.py 请求期读 config.CURRENT_PORT
    threading.Thread(target=notify.notify_loop, daemon=True).start()
    try:
        srv = web.make_server(config.CURRENT_PORT)
    except OSError as e:
        sys.exit(f'端口 {config.CURRENT_PORT} 无法监听：{e}\n'
                 f'恢复：编辑或删除 {config.CONF_DIR / "config.json"} 中的 port 字段，或用 --port 指定')
    config.CONF_DIR.mkdir(parents=True, exist_ok=True)
    config.PIDF.write_text(str(os.getpid()))
    print(f'lucid → http://127.0.0.1:{config.CURRENT_PORT} (webhook 通知线程已启动, pid {os.getpid()})')
    srv.serve_forever()
