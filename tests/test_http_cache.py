# B2(1.2.65):HTTP 路径接入扫描缓存 + 缓存加锁。
# 实测:web.py 直调 scan_sessions() 中位 0.249s(~85% 是 _main_steps/_analyze/_title 的内容派生解析),
# 前端每 2s 轮询 = 每 2s 全盘重解析一遍;而 HTTP 与 notify 双线程还会**并发重扫**(两缓存是无锁全局单槽)。
# 契约:web 只走 scan_cached/scan_sessions_cached 单点(2s 窗口),两缓存各锁住"检查-过期-重扫-写入"整段。
# 进程内直调 handler(假 wfile,不经 socket),计数桩替身;不做时序依赖(并发用例除外)。
import io
import json
import sys
import threading
import time
from email.message import Message
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _util import ck, done, redirect, temp_home  # noqa: E402

HOME = temp_home()
redirect(HOME)                                   # 数据源钉到空 fixture:不与真实 ~/.claude 交互
from ccviewer import scan, sessions, web  # noqa: E402


class _WFile:
    def __init__(self):
        self.buf = io.BytesIO()

    def write(self, b):
        self.buf.write(b)
        return len(b)

    def flush(self):
        pass


def get(path):
    """进程内直调 do_GET(不经 socket):返回 (状态码, JSON 载荷)。"""
    h = web.H.__new__(web.H)
    h.wfile = _WFile()
    h.path, h.command, h.request_version = path, 'GET', 'HTTP/1.1'
    h.requestline = 'GET %s HTTP/1.1' % path
    h.close_connection = False
    h._headers_buffer = []
    h.headers = Message()
    h.do_GET()
    raw = h.wfile.buf.getvalue()
    return int(raw.split(b' ', 2)[1]), json.loads(raw.partition(b'\r\n\r\n')[2])


PATCHED = []


def install(fake_scan, fake_sess):
    """把两处扫描函数换成计数桩。今天 web 直接 import 了 scan/scan_sessions(值拷贝一份引用),
    只补 scan/sessions 模块里的不够——web 名下那份必须一并换掉(今天正是 RED 的原因:
    两次请求各扫一遍);修复后 web 走 cached 单点(内部按模块全局解析),hasattr(web,'scan') 为 False,
    这两条补丁自然失效,计数只落在唯一入口上。"""
    for mod, name, fn in ((scan, 'scan', fake_scan), (sessions, 'scan_sessions', fake_sess),
                          (web, 'scan', fake_scan), (web, 'scan_sessions', fake_sess)):
        if hasattr(mod, name):
            PATCHED.append((mod, name, getattr(mod, name)))
            setattr(mod, name, fn)


def restore():
    while PATCHED:
        mod, name, fn = PATCHED.pop()
        setattr(mod, name, fn)


calls = {'runs': 0, 'sess': 0}


def fake_scan():
    calls['runs'] += 1
    return []


def fake_sess():
    calls['sess'] += 1
    return []


def reinstall(fake_s, fake_z):
    restore()
    install(fake_s, fake_z)


install(fake_scan, fake_sess)
try:
    # ① HTTP 出口必须复用缓存:窗口内两次请求 = 一次真实扫描(今天 2 次 = RED)
    scan._scan_cache['t'] = 0
    c1, d1 = get('/api/runs')
    c2, d2 = get('/api/runs')
    ck('cache/http-runs 两次请求只扫一次(2s 窗口内)', c1 == 200 and c2 == 200 and calls['runs'] == 1,
       'codes=%s/%s calls=%d' % (c1, c2, calls['runs']))
    ck('cache/http-runs 响应形状不变(runs/projects/tasks)', d1.get('runs') == [] and isinstance(d1.get('tasks'), dict)
       and 'projects' in d1, str(d1)[:140])
    sessions._SESS_CACHE['t'] = 0
    c3, d3 = get('/api/sessions')
    c4, d4 = get('/api/sessions')
    ck('cache/http-sessions 两次请求只扫一次(前端 2s 轮询的主开销)', c3 == 200 and c4 == 200 and calls['sess'] == 1,
       'codes=%s/%s calls=%d' % (c3, c4, calls['sess']))
    ck('cache/http-sessions 响应形状不变(sessions 键)', d3.get('sessions') == [] and d3.get('now'), str(d3)[:140])

    # ② 缓存语义:窗口内同一对象、过期后重扫(两缓存同一契约)
    sessions._SESS_CACHE['t'] = 0
    n0 = calls['sess']
    a = sessions.scan_sessions_cached(60)
    b = sessions.scan_sessions_cached(60)
    ck('cache/sessions-窗口内返回同一对象(不重扫)', a is b and calls['sess'] == n0 + 1,
       'calls=%d→%d' % (n0, calls['sess']))
    sessions._SESS_CACHE['t'] = 0
    c = sessions.scan_sessions_cached(60)
    ck('cache/sessions-过期后重扫(新对象)', c is not b and calls['sess'] == n0 + 2, 'calls=%d' % calls['sess'])
    scan._scan_cache['t'] = 0
    m0 = calls['runs']
    x = scan.scan_cached(60)
    y = scan.scan_cached(60)
    ck('cache/scan-窗口内返回同一对象(不重扫)', x is y and calls['runs'] == m0 + 1, 'calls=%d' % calls['runs'])
    scan._scan_cache['t'] = 0
    z = scan.scan_cached(60)
    ck('cache/scan-过期后重扫(新对象)', z is not y and calls['runs'] == m0 + 2, 'calls=%d' % calls['runs'])
finally:
    restore()


def overlap_probe(cached_fn, reset):
    """两线程同刻(barrier)各调 cached 函数 3 次,替身每次 sleep 50ms:
    返回 (同时进入扫描的最大并发数, 异常列表)。无锁时两线程会同时进 scan(今日 RED);加锁后恒为 1。"""
    bar = threading.Barrier(2)
    active = {'cur': 0, 'max': 0}
    errs = []

    def slow():
        active['cur'] += 1
        active['max'] = max(active['max'], active['cur'])
        time.sleep(0.05)
        active['cur'] -= 1
        return []

    if cached_fn is sessions.scan_sessions_cached:
        reinstall(fake_scan, slow)
    else:
        reinstall(slow, fake_sess)
    reset()

    def work():
        try:
            bar.wait(10)
            for _ in range(3):
                cached_fn(0.001)
        except Exception as e:
            errs.append(repr(e))

    ts = [threading.Thread(target=work) for _ in range(2)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(20)
    return active['max'], errs


try:
    s0, r0 = calls['sess'], calls['runs']
    mx, errs = overlap_probe(sessions.scan_sessions_cached, lambda: sessions._SESS_CACHE.update(t=0))
    ck('cache/sessions-并发调用不异常', not errs, str(errs))
    ck('cache/sessions-锁:同刻只有一个扫描在跑', mx == 1, 'max=%d' % mx)
    mx2, errs2 = overlap_probe(scan.scan_cached, lambda: scan._scan_cache.update(t=0))
    ck('cache/scan-并发调用不异常', not errs2, str(errs2))
    ck('cache/scan-锁:同刻只有一个扫描在跑', mx2 == 1, 'max=%d' % mx2)
    ck('cache/并发扫描计数不超过调用次数(宽松:2 线程×3 次)', calls['sess'] - s0 <= 6 and calls['runs'] - r0 <= 6,
       'sess=%d runs=%d' % (calls['sess'] - s0, calls['runs'] - r0))
finally:
    restore()

done()
