# JSONL 读取器契约单测(重构的特征测试):转录/journal 都是"逐行 JSON + 持续增长"的文件,
# 头尾窗口 + 坏行容错是共同策略。现状:同一族语义被四处自造(scan.jlines / sessions._tail /
# _rev_lines / _head / agent.py 内联反向读),本套件钉死其可观察行为,作为集中化到 ccviewer/jsonl.py 的准绳。
# 契约点:① tail 窗口在文件大于窗口时丢"可能被截断的首行"(整文件则不丢);② rev_lines 反向跨块拼行、
# 跳空行,并按文档承诺执行 16MB 上限(CLAUDE.md"反向深扫至 16MB"——旧实现收了参数却没执行,一并钉死);
# ③ 一切读取对缺文件/坏行静默,不抛。
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _util import ck, done

from ccviewer import jsonl

with tempfile.TemporaryDirectory() as td:
    d = Path(td)

    # ── iter_records(原 scan.jlines):容错 + limit 数"行"不数"解析成功数" ──
    fp = d / 'a.jsonl'
    fp.write_text('坏行notjson\n{"i":0}\n{"i":1}\n{"i":2}\n', encoding='utf-8')
    ck('iter/all', [r['i'] for r in jsonl.iter_records(fp)] == [0, 1, 2])
    ck('iter/limit-counts-raw-lines', [r['i'] for r in jsonl.iter_records(fp, 2)] == [0])  # i=0坏,1解析,2即停
    ck('iter/missing-file-silent', list(jsonl.iter_records(d / 'nope.jsonl')) == [])

    # ── tail_text(原 sessions._tail):sz>n 丢首残行;sz==n 完整 ──
    fp = d / 'b.jsonl'
    fp.write_bytes(b'AAAA\nBBBB\nCCCC\n')  # 15 bytes;每行不是合法 JSON,只测文本窗口
    ck('tail/drops-partial-first-line', jsonl.tail_text(fp, 10) == 'CCCC\n', repr(jsonl.tail_text(fp, 10)))
    ck('tail/full-when-fits', jsonl.tail_text(fp, 15) == 'AAAA\nBBBB\nCCCC\n')
    bad = d / 'b.bin'
    bad.write_bytes(b'\xffx\n')
    ck('tail/bad-utf8-replaced', '\ufffd' in jsonl.tail_text(bad, 4096))
    ck('tail/missing-file-empty', jsonl.tail_text(d / 'nope.jsonl') == '')

    # ── tail_records:尾窗直出记录(收编 agent.py 内联"读尾 200KB 反向找") ──
    fp = d / 'c.jsonl'
    fp.write_text('\n'.join('{"i":%d,"pad":"%s"}' % (i, 'x' * 200) for i in range(50)) + '\n', encoding='utf-8')
    recs = list(jsonl.tail_records(fp, 600))
    ck('tail-records/tail-only-ordered', all(r['i'] >= 46 for r in recs) and recs == sorted(recs, key=lambda r: r['i']),
       str([r['i'] for r in recs]))

    # ── rev_lines(原 sessions._rev_lines):跨块拼行/跳空行/上限 ──
    fp = d / 'r.jsonl'
    fp.write_bytes(b'AAAA\nbb\ncc\n')
    ck('rev/chunked-reassembly', [x for x in jsonl.rev_lines(fp, chunk=3)] == [b'cc', b'bb', b'AAAA'])
    ck('rev/maxbytes-enforced', [x for x in jsonl.rev_lines(fp, maxbytes=6, chunk=3)] == [b'cc'])
    fp = d / 'r2.jsonl'
    fp.write_text('{"i":0}\n\n{"i":1}\n', encoding='utf-8')
    ck('rev/skips-blank', [json.loads(x) for x in jsonl.rev_lines(fp)] == [{'i': 1}, {'i': 0}])
    big = '{"i":9,"blob":"' + 'y' * 5000 + '"}\n'
    fp = d / 'r3.jsonl'
    fp.write_bytes(b'{"i":0}\n' + big.encode() + b'{"i":1}\n')
    got = [json.loads(x)['i'] for x in jsonl.rev_lines(fp, chunk=1024)]
    ck('rev/long-line-across-chunks', got == [1, 9, 0], str(got))  # 5KB 行跨 5 块完整重组,首尾块均无损
    ck('rev/missing-file-silent', list(jsonl.rev_lines(d / 'nope.jsonl')) == [])

    # ── head_records(原 sessions._head):头窗 + 尾行截断容错 ──
    fp = d / 'h.jsonl'
    fp.write_text('{"i":0}\n{"i":1,"long":"' + 'z' * 500 + '"}\n', encoding='utf-8')
    ck('head/bounds-truncated-ok', [r['i'] for r in jsonl.head_records(fp, 16)] == [0])
    ck('head/full-small-read', [r['i'] for r in jsonl.head_records(fp, 1 << 20)] == [0, 1])

done()
