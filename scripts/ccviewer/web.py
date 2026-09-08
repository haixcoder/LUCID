# HTTP 层：页面 + JSON API（/api/runs /api/sessions /api/subagent /api/agent /api/config /api/config/save /api/config/test
#   + 编排器 /api/drafts /api/draft/save /static/<白名单 vendored 文件>）。
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
from .sessions import agent_detail, scan_sessions, window_activity

INDEX_HTML = (Path(__file__).parent / 'static' / 'index.html').read_text(encoding='utf-8')
_m = re.search(r'<script>\n([\s\S]*)\n</script></body>', INDEX_HTML)  # 主脚本块(boot 片段在 head,非 greedy 会错抓,用尾锚点定位)
VER = hashlib.md5(_m.group(1).encode('utf-8')).hexdigest()[:12] if _m else ''

# ── 编排器物料(1.2.43):vendored 静态件白名单 + 草稿落盘/枚举。判定与消毒只住这一处,handler 只调用 ──
# 铁律 1:vendor 是提交入库的构建产物(同 bin/install.js 先例),不新增运行时依赖;
# 铁律 2:草稿唯一可写点仍是 CONF_DIR(此处为 CONF_DIR/drafts/),cwd 只进 slug 的 basename 与哈希,
#         绝不作为写路径成分——最恶意的 cwd 也只会产出一个 sanitize-hash6 目录名。
STATIC = {'xyflow.system.umd.js': 'text/javascript; charset=utf-8'}
STATIC_DIR = Path(__file__).parent / 'static'
_NAME_RE = re.compile(r'[A-Za-z0-9][A-Za-z0-9._ -]{0,79}\Z')   # 首字符必须字母数字:天然排除 .hidden / ../ / 绝对路径 / 分隔符
_NO_CWD = '__no_cwd__'   # 空 cwd 的确定落点——realpath('') 会回落到进程工作目录,保存与回载就可能不同目录
SCRIPT_CAP = 1_000_000
DRAFT_LIMIT = 200
DRAFT_VERS = (1, 2)      # 1.2.50:v2 = 纯加宽(whenToUse/phases[].detail/argsSpec),v1 原样兼容;未知版本仍拒绝,不猜


def draft_ver_ok(v):
    """draft.v 的判定单点(保存端;前端载入守卫是同一口径的镜像)。只认白名单内的**整数**版本——
    bool 是 int 的子类(True==1),不显式排除就会把 JSON `true` 当成 v1 放行。"""
    return type(v) is int and v in DRAFT_VERS


def static_path(name):
    """白名单静态件的唯一解析点:只取末段 → 查白名单 → 真身必须仍在 STATIC_DIR 内(软链双保险)。"""
    base = str(name or '').replace('\\', '/').rsplit('/', 1)[-1]
    if base not in STATIC:
        return None
    p = STATIC_DIR / base
    try:
        if not p.is_file() or not p.resolve().is_relative_to(STATIC_DIR.resolve()):
            return None
    except OSError:
        return None
    return p


def _draft_dir(cwd):
    """草稿目录单点(保存与回载必须同一判定,否则"存了却看不见")。"""
    raw = str(cwd or '').strip()
    real = os.path.realpath(raw) if raw else _NO_CWD
    slug = re.sub(r'[^A-Za-z0-9._-]+', '-', os.path.basename(real) or 'root')[:40] \
        + '-' + hashlib.md5(real.encode('utf-8')).hexdigest()[:6]
    return config.CONF_DIR / 'drafts' / slug


def save_draft(data):
    """POST /api/draft/save 的实现:执行件 .js(前端生成的原文) + 图草稿 .json 成对原子落盘。
    同名不同内容默认**并存** <name>-<sha8>.*(宁并存不覆盖,用户手滑不丢工作);同内容幂等。"""
    data = data if isinstance(data, dict) else {}
    name = str(data.get('name', '')).strip()
    draft, script = data.get('draft'), data.get('script')
    script = script if isinstance(script, str) else ''
    if not _NAME_RE.match(name):
        return {'ok': False, 'msg': f'名称非法:{name!r}(需 1-80 字符,首字符为字母/数字,可含 . _ - 空格)'}
    if not isinstance(draft, dict) or not draft_ver_ok(draft.get('v')):
        return {'ok': False, 'msg': f'草稿非法:draft 需为对象且 v∈{DRAFT_VERS}(收到 {type(draft).__name__}/{draft.get("v") if isinstance(draft, dict) else "—"})'}
    if not script:
        return {'ok': False, 'msg': '脚本为空(生成失败时不该保存)'}
    if len(script) > SCRIPT_CAP:
        return {'ok': False, 'msg': f'脚本超上限 {SCRIPT_CAP} 字节(收到 {len(script)})'}
    d = _draft_dir(draft.get('cwd'))
    js, jf = d / (name + '.js'), d / (name + '.json')
    sha = hashlib.md5(script.encode('utf-8')).hexdigest()[:8]
    try:
        d.mkdir(parents=True, exist_ok=True)
        old = js.read_text(encoding='utf-8') if js.exists() else None
        if old is not None and old != script and not data.get('overwrite'):
            js, jf = d / (name + '-' + sha + '.js'), d / (name + '-' + sha + '.json')
        for p, txt in ((js, script), (jf, json.dumps(draft, ensure_ascii=False))):
            tmp = p.with_suffix(p.suffix + '.tmp')
            tmp.write_text(txt, encoding='utf-8')
            os.replace(tmp, p)                                   # 原子落盘:读者不会看到半份文件
    except OSError as e:
        return {'ok': False, 'msg': '写入失败:%s' % e}
    return {'ok': True, 'msg': '已保存', 'path': str(js), 'sha': sha}


def list_drafts(cwd):
    """GET /api/drafts 的实现:目录枚举本身即口径(无第二判定);坏件跳过不炸整张列表。"""
    d = _draft_dir(cwd)
    items = []
    if d.is_dir():
        for p in sorted(d.glob('*.json')):
            try:
                j = json.loads(p.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                continue                                          # 单个坏件不许把列表打成 500
            items.append({'name': p.stem, 'meta': {'name': j.get('name'), 'desc': j.get('desc')},
                          'mtime': int(p.stat().st_mtime), 'draft': j, 'js': str(p.with_suffix('.js'))})
    return {'drafts': items[:DRAFT_LIMIT]}


class H(BaseHTTPRequestHandler):
    server_version = 'lucid'  # 本机服务不向任何同源页面外的探测者泄露 Python/http.server 版本
    sys_version = ''

    def log_message(self, *a):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == '/api/runs':
            wa = window_activity()  # 项目列表与 TASKS 单一数据源:同一判窗口径,切换窗口两处一起变
            self._json({'now': time.time(), 'ver': VER, 'recentDays': load_conf()['recentDays'], 'runs': scan(),
                        'projects': wa['projects'], 'tasks': wa['tasks']})
        elif u.path == '/api/sessions':
            self._json({'now': time.time(), 'sessions': scan_sessions()})
        elif u.path == '/api/subagent':
            q = parse_qs(u.query)
            g = lambda k: (q.get(k, ['']))[0]
            self._json(agent_detail(g('proj'), g('sess'), g('agent'), g('msg')))
        elif u.path == '/api/agent':
            q = parse_qs(u.query)
            g = lambda k: (q.get(k, ['']))[0]
            try:
                self._json(api_agent(g('proj'), g('sess'), g('run'), g('agent')))
            except Exception as e:
                self._json({'error': str(e)})  # 单 agent 读取异常按 JSON 报错回,页面侧走 miss 提示
        elif u.path == '/api/config':
            self._json({'conf': load_conf(), 'last': LAST_HOOK})
        elif u.path == '/api/drafts':
            q = parse_qs(u.query)
            self._json(list_drafts((q.get('proj') or [''])[0]))
        elif u.path.startswith('/static/'):
            name = u.path.rsplit('/', 1)[-1]                      # 只取末段:../ 天然失效
            p = static_path(name)
            if not p:
                self.send_error(404)
                return
            try:
                body = p.read_bytes()
            except OSError:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', STATIC[name])
            self.send_header('Cache-Control', 'no-store')         # 与 INDEX_HTML 同口径:升级即生效(vendor 随版本目录整体替换)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif u.path in ('/', '/index.html'):
            body = INDEX_HTML.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_error(404)

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
                s = {'sessionId': 'test0000-dead', 'project': 'lucid', 'title': '测试消息：等待输入通知连通 ✓',
                     'cwd': '/path/to/project', 'status': 'input_required', 'waitReason': 'permission',
                     'waitTool': 'Bash', 'permissionMode': 'default', 'ageSec': 137,
                     'lastActivityAt': int(time.time() * 1000), 'lastText': '需要你授权(或改问一句)我才能继续。'}
                ok, msg = send_hook(s, sess_text(s), 'input_required')
            else:
                ok, msg = send_hook({'name': 'lucid', 'status': 'completed', 'task': '测试消息：通知钩子连通正常 ✓',
                                     'cwd': '—', 'runId': 'test', 'tokens': 12345, 'durationMs': 65000,
                                     'agents': [{'state': 'done'}], 'agentCount': 1, 'result': 'test'})
            out = {'ok': ok, 'msg': msg, 'last': LAST_HOOK}
        elif u.path == '/api/draft/save':
            out = save_draft(data)                                # 消毒与落盘全在 save_draft 单点(handler 不写第二份口径)
        else:
            self.send_error(404)
            return
        self._json(out)


def make_server(port):
    return ThreadingHTTPServer(('127.0.0.1', port), H)
