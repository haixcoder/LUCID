# B3+C1(1.2.65):HTTP 响应出口单点 _send 的契约——统一响应头 + gzip(尊重 Accept-Encoding 的 q=0)
# + 客户端提前断开(刷新/关页/切端口)时不把 BrokenPipeError 冒到 socketserver.handle_error。
# 进程内直调 handler 方法(不经 socket),假 wfile 负责制造断连与收集字节;不做时序依赖。
# 背景:web.py 三个写点(_json/static/index)全裸写 wfile,断连异常一路冒到 handle_error →
# 现网 server.log 517 行里 97% 是这段 traceback(验证 agent 确定性复现 6/6)。
import contextlib
import gzip
import io
import json
import sys
from email.message import Message
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _util import ck, done  # noqa: E402  (_util 把 scripts/ 插进 sys.path)

from ccviewer import web  # noqa: E402


class _WFile:
    """假 wfile:boom 非空时每次 write 抛该异常(模拟客户端已断开)。"""

    def __init__(self, boom=None):
        self.buf = io.BytesIO()
        self.boom = boom

    def write(self, b):
        if self.boom:
            raise self.boom
        self.buf.write(b)
        return len(b)

    def flush(self):
        pass


def mk(boom=None, ae=None, path='/api/x', headers=True):
    h = web.H.__new__(web.H)              # 不经 socket 装配:只造 handler 方法需要的属性
    h.wfile = _WFile(boom)
    h.path, h.command, h.request_version = path, 'GET', 'HTTP/1.1'
    h.requestline = 'GET %s HTTP/1.1' % path     # log_request 要用(真机由 parse_request 填)
    h.close_connection = False
    h._headers_buffer = []
    if headers:
        h.headers = Message()
        if ae is not None:
            h.headers['Accept-Encoding'] = ae
    return h


def split(h):
    """假 wfile 里的字节 → (响应头 dict, body)。"""
    raw = h.wfile.buf.getvalue()
    head, _, body = raw.partition(b'\r\n\r\n')
    hd = {}
    for ln in head.split(b'\r\n')[1:]:
        k, _, v = ln.partition(b':')
        hd[k.decode()] = v.strip().decode()
    return hd, body


# ① 统一头:Content-Type/Cache-Control/Vary/Content-Length=实际写出长度
h = mk()
h._json({'a': 1})
hd, body = split(h)
ck('send/json-统一头(ctype/no-store/Vary/长度=实际字节)',
   hd.get('Content-Type') == 'application/json; charset=utf-8' and hd.get('Cache-Control') == 'no-store'
   and 'Accept-Encoding' in hd.get('Vary', '') and int(hd.get('Content-Length', -1)) == len(body), str(hd))
ck('send/json-语义不变', json.loads(body) == {'a': 1}, body[:80])
ck('send/json-小体(<1024B)不压缩', 'Content-Encoding' not in hd, str(hd))

# ② 大体积 + 接受 gzip → 压缩,且 Content-Length 是压缩后长度、解压逐字节等于原文
big = {'pad': 'x' * 4000}
h = mk(ae='gzip')
h._json(big)
hd, body = split(h)
ck('send/gzip-大体积压缩且长度=压缩后', hd.get('Content-Encoding') == 'gzip'
   and int(hd.get('Content-Length', -1)) == len(body) and len(body) < len(big['pad']), str(hd))
try:
    unzipped = gzip.decompress(body)
except Exception:                          # 未压缩(或不是 gzip 流)——断言按"不相等"记账,不炸掉后续用例
    unzipped = None
ck('send/gzip-解压后逐字节等于未压缩原文',
   unzipped == json.dumps(big, ensure_ascii=False).encode(), body[:40])

# ③ Accept-Encoding 判定:必须解析 q 值——'gzip' in header 的子串判断会把 gzip;q=0 当成接受
cases = [('gzip', True), ('gzip;q=0', False), ('gzip; q=0.0', False), ('gzip;q=0.5', True),
         ('GZIP', True), ('deflate', False), ('deflate, gzip', True), ('*', True), ('*;q=0', False),
         ('gzip;q=0, *', False), ('br;q=1, gzip;q=0, *;q=0.5', False), ('identity', False),
         ('', False), (None, False)]
_ag = getattr(web, 'accepts_gzip', None)   # 未实现时也得给出 ✗(而不是 AttributeError 打断整个文件)
bad = [(c, want) for c, want in cases if (_ag is None or _ag(c) is not want)]
ck('send/accepts-gzip-解析 q 值与通配优先级(gzip 显式项优先于 *)', not bad, str(bad))
h = mk(ae='gzip;q=0')
h._json(big)
hd, _ = split(h)
ck('send/q=0 端到端不压', 'Content-Encoding' not in hd, str(hd))
h = mk(ae='gzip')
h._json({'a': 1})
hd, _ = split(h)
ck('send/小体积即使接受 gzip 也不压(阈值 1024B)', 'Content-Encoding' not in hd, str(hd))

# ④ 客户端断开:不抛异常 + close_connection=True + 单行日志(不静默吞错、不打印 traceback)
for boom in (BrokenPipeError('gone'), ConnectionResetError('rst')):
    h = mk(boom=boom, path='/api/x')
    out = io.StringIO()
    raised = None
    try:
        with contextlib.redirect_stdout(out):
            h._json({'a': 1})
    except Exception as e:
        raised = e
    ck('send/断连不抛(%s)' % type(boom).__name__, raised is None, repr(raised))
    ck('send/断连置 close_connection(%s)' % type(boom).__name__, h.close_connection is True)
    ck('send/断连有单行日志含路径(%s)' % type(boom).__name__,
       'client gone' in out.getvalue() and '/api/x' in out.getvalue() and 'Traceback' not in out.getvalue(),
       out.getvalue()[:120])

# ⑤ index 分支(第三个写点)走同一出口:断连同样静默
h = mk(boom=ConnectionResetError('rst'), path='/')
raised = None
try:
    h.do_GET()
except Exception as e:
    raised = e
ck('send/index-分支断连静默', raised is None and h.close_connection is True, repr(raised))

# ⑥ 直调(无 headers 属性)不许炸:Accept-Encoding 判定要 getattr 防护
h = mk(headers=False)
raised = None
try:
    h._json({'a': 1})
except Exception as e:
    raised = e
ck('send/无 headers 属性(直调)不炸', raised is None, repr(raised))

# ⑦ keep-alive 前提:两个类属性必须同时存在(只改 protocol_version 会让空闲连接线程永久阻塞在 readline)
ck('send/protocol_version=HTTP/1.1 且 timeout 同设',
   web.H.protocol_version == 'HTTP/1.1' and web.H.timeout == 20,
   '%s/%s' % (web.H.protocol_version, getattr(web.H, 'timeout', None)))

# ⑧ server 层兜底:断连类异常不打印 traceback,其他异常照旧交给父类(不掩盖真 bug)
srv = web.make_server(0)
try:
    for exc, want_tb in ((BrokenPipeError('x'), False), (ConnectionResetError('x'), False), (ValueError('boom'), True)):
        out = io.StringIO()
        try:
            raise exc
        except type(exc):
            with contextlib.redirect_stderr(out):
                srv.handle_error(None, ('127.0.0.1', 1))
        ck('send/server-handle_error-%s %s traceback' % (type(exc).__name__, '照旧打印' if want_tb else '不打印'),
           ('Traceback' in out.getvalue()) is want_tb, out.getvalue()[:120])
finally:
    srv.server_close()

done()
