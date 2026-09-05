# ── JSONL 读取族(scan/sessions/agent 共用):转录/journal 都是"逐行 JSON、持续增长、随时可能被截读"的文件,
# 标准策略=只读头/尾窗口 + 坏行静默跳过。此处集中收编原四处自造实现:
#   scan.jlines→iter_records | sessions._tail→tail_text | sessions._head→head_records |
#   sessions._rev_lines→rev_lines | agent.py 内联尾读→tail_records
# 契约单测见 tests/test_jsonl_unit.py(行为改动必须先过它)。缺文件/坏行一律静默是刻意取舍:
# 数据源由外部 harness 随时写入,读取器不许把竞态放大成 500。
import json


def iter_records(path, limit=None):
    """从头逐行解析;limit 按"消耗的行数"计(含坏行),沿袭原 scan.jlines 语义。"""
    try:
        with open(path, errors='replace') as f:
            for i, line in enumerate(f):
                if limit and i >= limit:
                    return
                try:
                    yield json.loads(line)
                except Exception:
                    continue
    except Exception:
        return


def tail_text(path, nbytes=262144):
    """尾窗口文本:文件大于窗口时丢弃可能被截断的首行。"""
    try:
        with open(path, 'rb') as f:
            f.seek(0, 2)
            sz = f.tell()
            f.seek(max(0, sz - nbytes))
            if sz > nbytes:
                f.readline()
            return f.read().decode('utf-8', 'replace')
    except Exception:
        return ''


def tail_records(path, nbytes=262144):
    """尾窗口内的记录,时间序(原 agent.py 反向找"最近一条"的公用底座)。"""
    for ln in tail_text(path, nbytes).splitlines():
        try:
            yield json.loads(ln)
        except Exception:
            continue


def head_records(path, nbytes=65536):
    """头窗口记录(首条用户输入/ai-title 常落在头部)。"""
    try:
        with open(path, 'rb') as f:
            blob = f.read(nbytes).decode('utf-8', 'replace')
    except Exception:
        return
    for ln in blob.splitlines():
        try:
            yield json.loads(ln)
        except Exception:
            continue


def rev_lines(path, maxbytes=16 * 1024 * 1024, chunk=1 << 20):
    """自文件尾反向逐行产出原始 bytes(1MB 块读,跨界残留重组,跳空行)。
    上限 maxbytes=16MB:MB 级截图附件会把旧步骤挤出固定尾窗,深扫须有止损线
    (CLAUDE.md「反向深扫至 16MB」的承诺;旧实现收了参数但未执行,1.2.18 补正——
    超界的更老步骤按 miss 显式提示,不再无上限扫盘)。"""
    try:
        with open(path, 'rb') as f:
            f.seek(0, 2)
            size = pos = f.tell()
            buf = b''
            while pos > 0:
                n = min(chunk, pos)
                pos -= n
                f.seek(pos)
                buf = f.read(n) + buf
                lines = buf.split(b'\n')
                buf = lines[0]
                for ln in reversed(lines[1:]):
                    if ln.strip():
                        yield ln
                if size - pos >= maxbytes:
                    return
            if buf.strip():
                yield buf
    except Exception:
        return
