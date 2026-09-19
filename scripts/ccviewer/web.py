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
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import config
from .agent import api_agent
from .config import INPUT_TIERS, load_conf, port_free, save_conf
from .notify import LAST_HOOK, send_hook, sess_text
from .scan import scan_cached, session_cwd
from .sessions import agent_detail, scan_sessions_cached, window_activity

INDEX_HTML = (Path(__file__).parent / 'static' / 'index.html').read_text(encoding='utf-8')
_m = re.search(r'<script>\n([\s\S]*)\n</script></body>', INDEX_HTML)  # 主脚本块(boot 片段在 head,非 greedy 会错抓,用尾锚点定位)
VER = hashlib.md5(_m.group(1).encode('utf-8')).hexdigest()[:12] if _m else ''

# ── 编排器物料(1.2.43):vendored 静态件白名单 + 草稿落盘/枚举。判定与消毒只住这一处,handler 只调用 ──
# 铁律 1:vendor 是提交入库的构建产物(同 bin/install.js 先例),不新增运行时依赖;
# 铁律 2(1.2.59 起):服务写域 = CONF_DIR/drafts/ **+ 请求里那个 cwd 下的 .claude/workflows/<name>.js**
#   (用户 2026-09-09 明确要求的"保存即分发");后者由 _project_workflow_path 单点收口——绝对路径、
#   已存在目录、三级软链拒绝、name 白名单,路径成分里绝不出现 cwd 之外的任何东西。
#   草稿目录那边 cwd 只进 slug 的 basename 与哈希——最恶意的 cwd 也只会产出一个 sanitize-hash6 目录名。
STATIC = {'xyflow.system.umd.js': 'text/javascript; charset=utf-8'}
STATIC_DIR = Path(__file__).parent / 'static'
_NAME_RE = re.compile(r'[A-Za-z0-9][A-Za-z0-9._ -]{0,79}\Z')   # 首字符必须字母数字:天然排除 .hidden / ../ / 绝对路径 / 分隔符
_NO_CWD = '__no_cwd__'   # 空 cwd 的确定落点——realpath('') 会回落到进程工作目录,保存与回载就可能不同目录
SCRIPT_CAP = 1_000_000
DRAFT_LIMIT = 200
DRAFT_VERS = (1, 2)      # 1.2.50:v2 = 纯加宽(whenToUse/phases[].detail/argsSpec),v1 原样兼容;未知版本仍拒绝,不猜
AGENT_TYPE_CAP = 200     # agentType 下拉候选上限(枚举只为"给个起点",自由文本永远可用)
# ── 工作流库(1.2.71):把「之前已经构建的工作流」聚进编排器(只读枚举;铁律 2 写域不变)──
# graph 徽标 = 该件能否直接上画布:草稿恒真;脚本看尾部有没有内嵌图注释(// lucid-graph:<v>:<base64>,
# 保存草稿时前端附加)。没有内嵌的旧脚本由前端 flowParse 尝试反解(仅本编辑器生成风格),失败则只读展示。
EMBED_RE = re.compile(r'^// lucid-graph:(\d+):([A-Za-z0-9+/=]+)[ \t]*$', re.M)
LIB_DIR_LIMIT = 100        # 单个脚本目录枚举上限
LIB_RUN_SCAN = 400         # 运行记录扫描上限(按名去重前)
LIB_RUN_BYTES = 8_000_000  # 单份运行记录读取上限(超限跳过:result 字段可能极大)
LIB_LIMIT = 300            # 库总条数上限
LIB_READ_CAP = 1_000_000   # 单件读取上限(.js / 草稿 JSON;截断如实上报,铁律 7)
GZIP_MIN = 1024          # 压缩阈值(字节):小于此值不值得压(头开销+CPU);实测 /api/sessions 249KB→81KB(33%)、页面 313KB→113KB(36%)
SCAN_CACHE_SEC = 2       # HTTP 扫描缓存窗口:与前端 2s 轮询同周期(见 do_GET 里的口径注释)


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


def _project_workflow_path(cwd, name):
    """项目分发落点单点(1.2.59):返回 (target, err)。
    铁律 2 的写域在此**受控扩展**:只写 <cwd>/.claude/workflows/<name>.js,且
    .claude / .claude/workflows / 目标文件**三级软链一律拒绝**(官方"保存为命令"的规则);
    cwd 必须绝对且已存在——不存在就报错,绝不凭空建目录(不猜目标)。"""
    raw = str(cwd or '').strip()
    if not raw:
        return None, '未选中项目(空 cwd),不写项目目录'
    base = Path(raw)
    if not base.is_absolute():
        return None, f'cwd 不是绝对路径:{raw!r}'
    if not base.is_dir():
        return None, f'cwd 不是已存在的目录:{raw}'
    claude, wf = base / '.claude', base / '.claude' / 'workflows'
    if claude.is_symlink() or wf.is_symlink():
        return None, '拒绝写入:项目下 .claude 或 .claude/workflows 是软链'
    target = wf / (name + '.js')
    if target.is_symlink():
        return None, f'拒绝写入:{target.name} 是软链'
    return target, ''


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
    # 项目分发(1.2.59):执行件再写一份到 <cwd>/.claude/workflows/<name>.js,同名**直接覆盖**
    # (项目目录是最终产物;草稿目录那边仍是"宁并存不覆盖")。分发失败不拖垮草稿——草稿是唯一真相。
    wf_path, wf_err = '', ''
    target, err = _project_workflow_path(draft.get('cwd'), name)
    if err:
        wf_err = err
    else:
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_name(target.name + '.tmp')
            tmp.write_text(script, encoding='utf-8')
            os.replace(tmp, target)                      # 原子覆盖
            wf_path = str(target)
        except OSError as e:
            wf_err = '项目 workflow 写入失败:%s' % e
    return {'ok': True, 'msg': '已保存', 'path': str(js), 'sha': sha, 'wfPath': wf_path, 'wfErr': wf_err}


def list_agent_types():
    """GET /api/agents 的实现:只读枚举 agentType 候选——本机 ~/.claude/agents/*.md 的 stem
    + 已安装插件 cache/<market>/<plugin>/<ver>/agents/*.md 的 `<plugin>:<name>`(命名空间前缀与
    Agent 工具注册表一致)。铁律 2:纯读取,不写盘;目录缺失/不可读静默跳过(列表不被单个坏目录炸掉)。"""
    root = config.PROJ.parent                     # ~/.claude(与 projects 同一根,不新增配置项)
    out = []
    try:
        for p in sorted((root / 'agents').glob('*.md')):
            if p.is_file():
                out.append(p.stem)
    except OSError:
        pass
    try:
        cache = root / 'plugins' / 'cache'
        for market in sorted(cache.iterdir()):
            if not market.is_dir():
                continue
            for plugin in sorted(market.iterdir()):
                if not plugin.is_dir():
                    continue
                for ver in sorted(plugin.iterdir()):
                    ad = ver / 'agents'
                    if not ad.is_dir():
                        continue
                    for p in sorted(ad.glob('*.md')):
                        if p.is_file():
                            out.append(f'{plugin.name}:{p.stem}')
    except OSError:
        pass
    seen, uniq = set(), []
    for x in out:
        if x and x not in seen:
            seen.add(x)
            uniq.append(x)
    return {'types': uniq[:AGENT_TYPE_CAP]}


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


# ── 工作流库(1.2.71):四类来源的只读枚举 + 白名单读取 ────────────────────────────
def _embed_in(text):
    """内嵌图标记判定单点:脚本尾部 `// lucid-graph:<v>:<base64>`。列表徽标与读取共用。"""
    return bool(EMBED_RE.search(text)) if isinstance(text, str) else False


def _script_head_meta(text):
    """从生成脚本头部 best-effort 读 meta.name/description(只为库列表展示;解析不出就空,不猜不报错——
    单个怪文件不许拖垮整张列表)。键必须**行首**(生成器固定两空格缩进),免得描述文本里的 "name:" 误命中。"""
    head = str(text or '')[:4000]
    m = re.search(r'meta\s*=\s*\{', head)
    if not m:
        return {}
    blk = head[m.end():]
    out = {}
    for key, dst in (('name', 'name'), ('description', 'desc')):
        mm = re.search(r'\n\s*' + key + r':\s*("(?:[^"\\]|\\.)*")', blk)
        if mm:
            try:
                out[dst] = json.loads(mm.group(1))
            except ValueError:
                pass
    return out


def _read_capped(p, cap=LIB_READ_CAP):
    """读文本件(cap 字节;返回 (text, truncated))。铁律 7:截断必须能被告知,不假装读全。"""
    try:
        with open(p, 'rb') as f:
            raw = f.read(cap + 1)
    except OSError:
        return '', False
    return raw[:cap].decode('utf-8', 'replace'), len(raw) > cap


def _ls_scripts(d, src, limit=LIB_DIR_LIMIT):
    """目录 → 脚本条目(枚举本身即口径:只认 *.js,不可读的跳过)。内嵌图在文件**尾部**,
    故整读(上限 LIB_READ_CAP;超过上限的怪文件 graph 徽标会落空 → 前端还有反解兜底,不假装可用)。"""
    out = []
    try:
        ps = sorted((x for x in d.glob('*.js') if x.is_file()),
                    key=lambda x: x.stat().st_mtime, reverse=True)[:limit]
    except OSError:
        return out
    for p in ps:
        try:
            mt = int(p.stat().st_mtime)
        except OSError:
            continue
        txt, trunc = _read_capped(p)
        meta = _script_head_meta(txt)
        out.append({'src': src, 'name': p.stem, 'desc': str(meta.get('desc') or ''),
                    'mtime': mt, 'graph': _embed_in(txt), 'path': str(p), 'js': str(p), 'trunc': trunc})
    return out


def list_workflows(cwd):
    """GET /api/workflows 的实现:「之前已经构建的工作流」的只读清单。
    四类来源(draft 跨项目;proj 限选中项目;home/run 全局):
      draft = CONF_DIR/drafts/*/*.json —— cwd 就存在草稿 JSON 里(与回载同一字段)
      proj  = <cwd>/.claude/workflows/*.js(保存时分发的那份 + 手放/拷来的)
      home  = ~/.claude/workflows/*.js(个人工作流;与 agentType 枚举同一根)
      run   = PROJ/*/*/workflows/wf_*.json(历史运行;按 workflowName 去重,保留最近一次)
    条目形状:{src,name,desc,mtime,graph,path,js} + draft:{cwd,whenToUse} / run:{project,status,at}。"""
    items = []
    droot = config.CONF_DIR / 'drafts'
    try:
        for slug in sorted(droot.iterdir()):
            if not slug.is_dir():
                continue
            try:
                ps = sorted(slug.glob('*.json'), key=lambda x: x.stat().st_mtime, reverse=True)[:LIB_DIR_LIMIT]
            except OSError:
                continue
            for p in ps:
                try:
                    j = json.loads(p.read_text(encoding='utf-8'))
                    mt = int(p.stat().st_mtime)
                except (OSError, ValueError):
                    continue
                if not isinstance(j, dict):
                    continue
                items.append({'src': 'draft', 'name': p.stem, 'desc': str(j.get('desc') or ''),
                              'whenToUse': str(j.get('whenToUse') or ''), 'cwd': str(j.get('cwd') or ''),
                              'mtime': mt, 'graph': True, 'path': str(p), 'js': str(p.with_suffix('.js'))})
    except OSError:
        pass
    raw = str(cwd or '').strip()
    if raw and Path(raw).is_absolute():
        items += _ls_scripts(Path(raw) / '.claude' / 'workflows', 'proj')
    items += _ls_scripts(config.PROJ.parent / 'workflows', 'home')
    seen = {}
    try:
        files = []
        for p in config.PROJ.glob('*/*/workflows/wf_*.json'):
            try:
                files.append((p.stat().st_mtime, p))
            except OSError:
                continue
        files.sort(key=lambda x: x[0], reverse=True)
        for mt, p in files[:LIB_RUN_SCAN]:
            try:
                if p.stat().st_size > LIB_RUN_BYTES:
                    continue
                j = json.loads(p.read_text(encoding='utf-8', errors='replace'))
            except (OSError, ValueError):
                continue
            if not isinstance(j, dict):
                continue
            nm = str(j.get('workflowName') or 'workflow')
            at = j.get('startTime') or 0
            cur = seen.get(nm)
            if cur is not None and (cur.get('at') or 0) >= at:
                continue
            script = j.get('script') if isinstance(j.get('script'), str) else ''
            proj_dir, sess = p.parents[2].name, p.parents[1].name
            sp = next(iter(p.parent.glob('scripts/*-' + p.stem + '.js')), None)
            seen[nm] = {'src': 'run', 'name': nm, 'desc': str(j.get('summary') or ''),
                        'project': session_cwd(proj_dir, sess) or proj_dir,
                        'status': str(j.get('status') or ''), 'at': at, 'mtime': int(mt),
                        'graph': _embed_in(script), 'path': str(p),
                        'js': str(sp) if sp else ''}
    except OSError:
        pass
    items += sorted(seen.values(), key=lambda x: x.get('at') or 0, reverse=True)
    return {'items': items[:LIB_LIMIT]}


def read_workflow(raw):
    """GET /api/workflow?path= 的实现:白名单根内才读(只读;铁律 2 的写域不含任何新路径)。
    白名单(与 list_workflows 同一批根):
      · CONF_DIR/drafts 下 .json/.js(图草稿与执行件)
      · PROJ 下 .../workflows/wf_*.json(运行记录)与 .../workflows/scripts/*.js(当次脚本)
      · 任意 <dir>/.claude/workflows/<name>.js(项目分发件与个人工作流:校验父目录结构,不要求 cwd 存在)
    返回 {ok,kind,...};不在白名单/读不了 → None(handler 回 404 JSON,不泄露任何内容)。"""
    s = str(raw or '')
    if not s:
        return None
    try:
        pr = Path(s).resolve()
    except (OSError, ValueError):
        return None
    if not pr.is_file():
        return None

    def under(root):
        try:
            return pr.is_relative_to(Path(root).resolve())
        except (OSError, ValueError):
            return False

    suf = pr.suffix.lower()
    if suf == '.json':
        if under(config.CONF_DIR / 'drafts'):
            txt, trunc = _read_capped(pr)
            try:
                j = json.loads(txt)
            except ValueError:
                return {'ok': False, 'kind': 'draft',
                        'msg': '草稿 JSON 无法解析' + ('(超过读取上限,已截断)' if trunc else '')}
            return {'ok': True, 'kind': 'draft', 'graph': j, 'truncated': trunc}
        if under(config.PROJ) and pr.parent.name == 'workflows' and pr.name.startswith('wf_'):
            try:
                j = json.loads(pr.read_text(encoding='utf-8', errors='replace'))
            except (OSError, ValueError):
                return {'ok': False, 'kind': 'run', 'msg': '运行记录无法解析'}
            script = j.get('script') if isinstance(j, dict) and isinstance(j.get('script'), str) else ''
            return {'ok': True, 'kind': 'run', 'script': script, 'truncated': False, 'embed': _embed_in(script)}
        return None
    proj_js = under(config.PROJ) and (pr.parent.name == 'workflows'
                                      or (pr.parent.name == 'scripts' and pr.parent.parent.name == 'workflows'))
    if suf == '.js' and (under(config.CONF_DIR / 'drafts') or proj_js
                         or (pr.parent.name == 'workflows' and pr.parent.parent.name == '.claude')):
        txt, trunc = _read_capped(pr)
        return {'ok': True, 'kind': 'script', 'script': txt, 'truncated': trunc, 'embed': _embed_in(txt)}
    return None


def accepts_gzip(header):
    """Accept-Encoding 判定单点:客户端是否接受 gzip。必须按 RFC 解析 q 值——`'gzip' in header` 的
    子串判断会把明确拒绝的 `gzip;q=0` 当成接受;通配 `*` 只在没有显式 gzip 项时兜底(explicit 优先)。"""
    gz = star = None
    for tok in (header or '').split(','):
        parts = tok.split(';')
        name = parts[0].strip().lower()
        if not name:
            continue
        q = 1.0
        for p in parts[1:]:
            k, _, v = p.partition('=')
            if k.strip().lower() == 'q':
                try:
                    q = float(v.strip())
                except ValueError:
                    q = 0.0
        if name == 'gzip':
            gz = q
        elif name == '*':
            star = q
    q = gz if gz is not None else star
    return q is not None and q > 0


class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'   # keep-alive:前端 2s 轮询复用连接(1.2.65);HTTP/1.0 每请求关连接、且忽略 Accept-Encoding
    timeout = 20                    # 必须与上面**同时**存在:空闲连接超时后 stdlib 置 close_connection,
                                    # 否则线程永久阻塞在 readline 不释放(ThreadingHTTPServer 每连接一线程)
    server_version = 'lucid'  # 本机服务不向任何同源页面外的探测者泄露 Python/http.server 版本
    sys_version = ''

    def log_message(self, *a):
        pass

    def _send(self, body, ctype, code=200):
        """响应出口单点(1.2.65):三处写点(_json/static/index)共用——统一响应头 + gzip(尊重 q=0)
        + 客户端提前断开(刷新/关页/切端口)时不把异常冒到 socketserver.handle_error。
        全裸 wfile.write 时,断连异常会变成 traceback 打满 server.log(现网 517 行里 97% 是它)。"""
        hd = getattr(self, 'headers', None)      # 直调 handler(测试)时可能没有 headers 属性
        try:
            ae = (hd.get('Accept-Encoding') or '') if hd is not None else ''
        except Exception:
            ae = ''
        if accepts_gzip(ae) and len(body) >= GZIP_MIN:
            co = zlib.compressobj(1, zlib.DEFLATED, 31)   # 31=gzip 包装;q1 档=实测体积/CPU 平衡点
            body = co.compress(body) + co.flush()
            gz = True
        else:
            gz = False
        try:
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Vary', 'Accept-Encoding')   # 同 URL 两种编码,缓存键须分开
            if gz:
                self.send_header('Content-Encoding', 'gzip')
            self.send_header('Content-Length', str(len(body)))   # 压缩后长度
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            # 客户端已走:不是缺陷而是客户端行为——收尾(不再写)+ 单行日志,不打印 traceback
            self.close_connection = True
            print('[web] client gone: %s' % self.path, flush=True)

    def _json(self, obj, code=200):
        self._send(json.dumps(obj, ensure_ascii=False).encode(), 'application/json; charset=utf-8', code)

    def do_GET(self):
        u = urlparse(self.path)
        # 扫描缓存口径(1.2.65 B2):maxage = 前端轮询周期(2s)。缓存的是整份扫描对象,**含时间态字段**
        # (ageSec/status/alive/waitReason)——≤2s 陈旧对 2s 轮询的 UI 不可见,且与 notify 线程共用同一份
        # (不再 HTTP/notify 各扫一遍)。不缓存 window_activity(0.003s,可忽略)。
        # TODO(Step2):内容派生字段(名字/阶段/步骤/标题)按签名缓存,时间态每轮现算——F1 铁线见
        #   docs/perf-architecture-research.md(误缓存时间态=等待通知卡死);本步只接线+加锁。
        if u.path == '/api/runs':
            wa = window_activity()  # 项目列表与 TASKS 单一数据源:同一判窗口径,切换窗口两处一起变
            self._json({'now': time.time(), 'ver': VER, 'recentDays': load_conf()['recentDays'],
                        'runs': scan_cached(SCAN_CACHE_SEC),
                        'projects': wa['projects'], 'tasks': wa['tasks']})
        elif u.path == '/api/sessions':
            self._json({'now': time.time(), 'sessions': scan_sessions_cached(SCAN_CACHE_SEC)})
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
        elif u.path == '/api/agents':
            self._json(list_agent_types())
        elif u.path == '/api/workflows':
            q = parse_qs(u.query)
            self._json(list_workflows((q.get('proj') or [''])[0]))
        elif u.path == '/api/workflow':
            q = parse_qs(u.query)
            r = read_workflow((q.get('path') or [''])[0])
            if r is None:
                self._json({'ok': False, 'msg': '路径不在允许范围内'}, 404)
            else:
                self._json(r)
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
            self._send(body, STATIC[name])   # Cache-Control: no-store 与 INDEX_HTML 同口径:升级即生效(vendor 随版本目录整体替换)
        elif u.path in ('/', '/index.html'):
            self._send(INDEX_HTML.encode(), 'text/html; charset=utf-8')
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


class Server(ThreadingHTTPServer):
    """兜底:客户端提前断开在**写响应**时才暴露为 BrokenPipe/ConnectionReset——socketserver 默认把它们
    当"未处理异常"打印整段 traceback 到 stderr(server.log 噪声主源)。这两类不是缺陷而是客户端行为:
    直接 return;其余异常照旧交父类打印(不掩盖真 bug)。send_error 等残余路径也归此处收口。"""

    def handle_error(self, request, client_address):
        if isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


def make_server(port):
    return Server(('127.0.0.1', port), H)
