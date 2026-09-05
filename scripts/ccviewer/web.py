# HTTP 层：页面 + JSON API（/api/runs /api/sessions /api/subagent /api/agent /api/config /api/config/save /api/config/test）。
# 前端产物由 frontend/build.py 生成（脚本块 = TS 编译输出）。ver 戳 = 脚本载荷 md5[:12]，
# /api/runs 返回；页面 JS 比对自身 meta[wfo-ver]，不一致即 location.reload()——部署后旧标签页自动换新代码。
import hashlib
import json
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import config
from .agent import api_agent
from .config import INPUT_TIERS, load_conf, port_free, save_conf
from .notify import LAST_HOOK, send_hook, sess_text
from .scan import scan
from .sessions import agent_detail, scan_sessions

INDEX_HTML = (Path(__file__).parent / 'static' / 'index.html').read_text(encoding='utf-8')
_m = re.search(r'<script>\n([\s\S]*)\n</script></body>', INDEX_HTML)  # 主脚本块(boot 片段在 head,非 greedy 会错抓,用尾锚点定位)
VER = hashlib.md5(_m.group(1).encode('utf-8')).hexdigest()[:12] if _m else ''


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == '/api/runs':
            body = json.dumps({'now': time.time(), 'ver': VER, 'recentDays': load_conf()['recentDays'],
                               'runs': scan()}, ensure_ascii=False).encode()
            ct = 'application/json; charset=utf-8'
        elif u.path == '/api/sessions':
            body = json.dumps({'now': time.time(), 'sessions': scan_sessions()}, ensure_ascii=False).encode()
            ct = 'application/json; charset=utf-8'
        elif u.path == '/api/subagent':
            q = parse_qs(u.query)
            g = lambda k: (q.get(k, ['']))[0]
            body = json.dumps(agent_detail(g('proj'), g('sess'), g('agent'), g('msg')), ensure_ascii=False).encode()
            ct = 'application/json; charset=utf-8'
        elif u.path == '/api/agent':
            q = parse_qs(u.query)
            try:
                g = lambda k: (q.get(k, ['']))[0]
                body = json.dumps(api_agent(g('proj'), g('sess'), g('run'), g('agent')), ensure_ascii=False).encode()
            except Exception as e:
                body, ct = json.dumps({'error': str(e)}).encode(), 'application/json'
            else:
                ct = 'application/json; charset=utf-8'
        elif u.path == '/api/config':
            body = json.dumps({'conf': load_conf(), 'last': LAST_HOOK}, ensure_ascii=False).encode()
            ct = 'application/json; charset=utf-8'
        elif u.path in ('/', '/index.html'):
            body, ct = INDEX_HTML.encode(), 'text/html; charset=utf-8'
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', ct)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


    def do_POST(self):
        # Origin 守卫：任意网页可 DNS rebinding 后 POST localhost 改配置/重定向 webhook（外泄通道）。
        # 浏览器同源 fetch 必带本机 Origin；无 Origin 的非浏览器调用（脚本）放行。
        org = self.headers.get('Origin')
        if org and not re.match(r'https?://(localhost|127\.0\.0\.1)(:\d+)?$', org, re.I):
            self.send_error(403); return
        u = urlparse(self.path)
        try:
            data = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0) or 0)) or b'{}')
        except Exception:
            data = {}
        if u.path == '/api/config/save':
            url = str(data.get('url', '')).strip()
            try:
                port = int(data.get('port') or 0)
            except (TypeError, ValueError):
                port = -1
            try:
                rdays = int(data.get('recentDays') or 14)
            except (TypeError, ValueError):
                rdays = -1
            out = None
            if url and not url.startswith(('http://', 'https://')):
                out = {'ok': False, 'msg': 'URL 必须以 http(s):// 开头'}
            elif not 1 <= port <= 65535:
                out = {'ok': False, 'msg': f'端口非法：{data.get("port")}（需 1-65535）'}
            elif port != config.CURRENT_PORT and not port_free(port):
                out = {'ok': False, 'msg': f'端口 {port} 已被占用，请换一个（本次未保存任何改动）'}
            elif not 1 <= rdays <= 3650:
                out = {'ok': False, 'msg': f'回看天数非法：{data.get("recentDays")}（需 1-3650，默认 14）'}
            tier = data.get('notifyInput')
            if tier not in INPUT_TIERS:
                tier = load_conf().get('notifyInput', 'blocked')  # 未携带/非法值 → 保持原档位，绝不清空
            if out is None:
                c = {'enabled': bool(data.get('enabled')), 'format': 'json' if data.get('format') == 'json' else 'feishu',
                     'url': url, 'insecure': bool(data.get('insecure')), 'port': port,
                     'recentDays': rdays, 'notifyInput': tier}
                save_conf(c)
                if port != config.CURRENT_PORT:
                    out = {'ok': True, 'msg': f'已保存，服务 {port} 端口重启中',
                           'reloc': f'http://127.0.0.1:{port}/'}
                    # 响应 flush 后 execv 自我重启：释放旧端口、按新配置监听（PID 不变，nohup/后台归属保持）
                    threading.Timer(0.8, lambda: os.execv(sys.executable, [sys.executable] + sys.argv)).start()
                else:
                    out = {'ok': True, 'msg': '已保存', 'conf': c}
        elif u.path == '/api/config/test':
            if data.get('kind') == 'input_required':  # 分型测试：正文/载荷走真实构造函数
                s = {'sessionId': 'test0000-dead', 'project': 'xray', 'title': '测试消息：等待输入通知连通 ✓',
                     'cwd': '/path/to/project', 'status': 'input_required', 'waitReason': 'permission',
                     'waitTool': 'Bash', 'permissionMode': 'default', 'ageSec': 137,
                     'lastActivityAt': int(time.time() * 1000), 'lastText': '需要你授权(或改问一句)我才能继续。'}
                ok, msg = send_hook(s, sess_text(s), 'input_required')
            else:
                ok, msg = send_hook({'name': 'xray', 'status': 'completed', 'task': '测试消息：通知钩子连通正常 ✓',
                                     'cwd': '—', 'runId': 'test', 'tokens': 12345, 'durationMs': 65000,
                                     'agents': [{'state': 'done'}], 'agentCount': 1, 'result': 'test'})
            out = {'ok': ok, 'msg': msg, 'last': LAST_HOOK}
        else:
            self.send_error(404)
            return
        body = json.dumps(out, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)


def make_server(port):
    return ThreadingHTTPServer(('127.0.0.1', port), H)
