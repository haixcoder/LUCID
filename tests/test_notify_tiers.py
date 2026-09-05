# input_required 通知分型全链路(移植自 /tmp/repro_notify.py,1.2.10):
# A 段:档位(off/blocked/all)× 去重(会话+静默起点)× sweep 播种 × 总开关 —— monkeypatch 决策面;
# B 段:本机 HTTP 收件箱 + 真 send_hook,断言 feishu 文本/通用 JSON kind 分流/终态载荷字段不破。
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _util import ck, done, temp_home

from ccviewer import config, notify

HOME = temp_home()
CONF = (HOME / '.claude' / 'cc-viewer')
CONF.mkdir(parents=True)


def sess(sid, status, why=None, tool=None, act=1000):
    return {'sessionId': sid, 'project': 'fix', 'cwd': '/tmp/fix', 'title': '标题' + sid[:2], 'status': status,
            'waitReason': why, 'waitTool': tool, 'ageSec': 137, 'permissionMode': 'default',
            'lastActivityAt': act, 'lastText': '需要你选一个方案再继续。'}


# ── A 段:档位 / 去重 / 播种 ─────────────────────────────────────────────
sent_log = []
REAL_SEND = notify.send_hook
notify.send_hook = lambda r, text=None, kind='workflow_status': (
    sent_log.append((kind, r.get('sessionId'))), (True, 'HTTP 200'))[1]
S = [sess('aaa11111', 'input_required', 'ask', 'AskUserQuestion'),
     sess('bbb22222', 'input_required', 'permission', 'Bash'),
     sess('ccc333', 'input_required', 'turn'),
     sess('ddd444', 'running'),
     sess('eee555', 'ended')]
C_BLOCKED = {'enabled': True, 'notifyInput': 'blocked', 'format': 'feishu', 'url': 'http://127.0.0.1:9/'}

d = set()
notify.notify_inputs(d, C_BLOCKED, S)
ck('blocked 档:只发 等回答/等授权,不发 回合待输入与 running/ended',
   sorted(k[1] for k in sent_log) == ['aaa11111', 'bbb22222'], str(sent_log))
sent_log.clear()
notify.notify_inputs(d, C_BLOCKED, S)
ck('同一等待事件(活动戳未变)不重复推送', not sent_log, str(sent_log))
sent_log.clear()
S[2]['lastActivityAt'] = 2000  # 用户回话后又卡住 = 新等待轮
notify.notify_inputs(d, {'enabled': True, 'notifyInput': 'all', 'format': 'feishu'}, S)
ck('all 档:回合结束待输入也推(且只对"新等待轮")', [k[1] for k in sent_log] == ['ccc333'], str(sent_log))
sent_log.clear()
notify.notify_inputs(set(), {'enabled': True, 'notifyInput': 'off', 'format': 'feishu'}, S)
ck('off 档:一律不推', not sent_log)
sent_log.clear()
d2 = set()
notify.notify_inputs(d2, C_BLOCKED, S, sweep=True)
ck('首轮 sweep:静默播种全部键(含非等待态),不发消息', not sent_log and len(d2) == 5, str(d2))
sent_log.clear()
notify.notify_inputs(set(), {'enabled': False, 'notifyInput': 'all', 'format': 'feishu'}, S)
ck('总开关关闭:不推', not sent_log)

# ── B 段:真实投递 ───────────────────────────────────────────────────────
notify.send_hook = REAL_SEND
INBOX = []


class Rcv(BaseHTTPRequestHandler):
    def do_POST(self):
        INBOX.append((self.headers.get('Content-Type'),
                      json.loads(self.rfile.read(int(self.headers['Content-Length'])))))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"code":0}')

    def log_message(self, *a):
        pass


srv = HTTPServer(('127.0.0.1', 0), Rcv)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
config.CONF_DIR = CONF
notify.CONF_DIR = CONF


def post(fmt):
    url = 'http://127.0.0.1:%d/hook' % port
    (CONF / 'config.json').write_text(json.dumps({'enabled': True, 'format': fmt, 'url': url,
                                                  'insecure': False, 'port': 8787, 'recentDays': 14,
                                                  'notifyInput': 'blocked'}))
    INBOX.clear()
    return notify.notify_inputs(set(), json.loads((CONF / 'config.json').read_text()),
                                [sess('fff99999', 'input_required', 'permission', 'Bash')])


for fmt, _key in (('feishu', 'content'), ('json', 'kind')):
    n = post(fmt)
    ck('%s: 收件箱实收 1 条' % fmt, n == 1 and len(INBOX) == 1, 'n=%s inbox=%s' % (n, len(INBOX)))
    if INBOX:
        body = INBOX[0][1]
        if fmt == 'feishu':
            txt = body['content']['text']
            ck('feishu: 正文首行标明等待类型', txt.startswith('⏸ 会话 等待授权(疑似)'), txt.splitlines()[0])
            ck('feishu: 含 在等工具/项目/最后输出', 'Bash' in txt and '/tmp/fix' in txt and '需要你选一个方案' in txt)
        else:
            ck('json: kind=input_required + 会话字段齐备',
               body.get('kind') == 'input_required' and body.get('waitTool') == 'Bash'
               and body.get('sessionId') == 'fff99999' and 'text' in body,
               json.dumps(body, ensure_ascii=False)[:200])

INBOX.clear()
notify.send_hook({'name': 'wf', 'status': 'completed', 'task': 't', 'cwd': 'c', 'runId': 'wf_1',
                  'tokens': 1, 'durationMs': 2, 'agents': [], 'agentCount': 1, 'result': ''})
b = INBOX[0][1]
ck('workflow 终态载荷字段不变(新增 kind 为增量)',
   b.get('kind') == 'workflow_status' and b.get('workflow') == 'wf' and b.get('runId') == 'wf_1',
   json.dumps(b, ensure_ascii=False)[:160])
srv.shutdown()

done()
