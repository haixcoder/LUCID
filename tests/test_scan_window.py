# 扫描回看窗口门禁(移植自 /tmp/t3_scan_window.py,1.2.14):
# "近 N 天有活动"的权威信号=转录 <sess>.jsonl mtime(每条消息都落盘);
# 目录 mtime 只在直接子项增删时刷新,journal/run 写入碰不到它——单用会把"老目录里正跑的运行"整段藏掉。
import json
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _util import ck, done

from ccviewer import config, scan

with tempfile.TemporaryDirectory() as td:
    root = Path(td)
    proj = root / '-proj'
    proj.mkdir()
    (root / 'sessions').mkdir()

    # 会话 A:目录龄 40 天,但转录今天一直在写 + 有正在跑的 workflow → 必须被扫到
    sa = proj / 'aaaa1111'
    (sa / 'subagents' / 'workflows' / 'wf_live1').mkdir(parents=True)
    jd = sa / 'subagents' / 'workflows' / 'wf_live1' / 'journal.jsonl'
    jd.write_text('{"type":"started","agentId":"a1"}\n', encoding='utf-8')
    (jd.with_name('agent-a1.jsonl')).write_text('{"type":"assistant"}\n', encoding='utf-8')
    tr_a = proj / 'aaaa1111.jsonl'
    tr_a.write_text('{"type":"assistant"}\n', encoding='utf-8')
    pid = os.getpid()
    (root / 'sessions' / ('%d.json' % pid)).write_text(json.dumps({'pid': pid, 'sessionId': 'aaaa1111'}),
                                                       encoding='utf-8')
    old = time.time() - 40 * 86400
    os.utime(sa, (old, old))  # 目录"看起来"40 天没动(子项写文件不改目录 mtime)

    # 会话 B:负对照——转录与目录都 40 天 → 整段不扫(修复后也不许出现)
    sb = proj / 'bbbb2222'
    (sb / 'workflows').mkdir(parents=True)
    (sb / 'workflows' / 'wf_old.json').write_text(json.dumps(
        {'runId': 'wf_old', 'status': 'completed', 'workflowName': 'old', 'agentCount': 1,
         'workflowProgress': [], 'startTime': int(old * 1000)}), encoding='utf-8')
    tr_b = proj / 'bbbb2222.jsonl'
    tr_b.write_text('{"x":1}\n', encoding='utf-8')
    os.utime(tr_b, (old, old))
    os.utime(sb, (old, old))
    os.utime(sb / 'workflows' / 'wf_old.json', (old, old))

    # 会话 C:正对照——一切新鲜的已完成 run
    sc = proj / 'cccc3333'
    (sc / 'workflows').mkdir(parents=True)
    (sc / 'workflows' / 'wf_new.json').write_text(json.dumps(
        {'runId': 'wf_new', 'status': 'completed', 'workflowName': 'new', 'agentCount': 1,
         'workflowProgress': [], 'startTime': int(time.time() * 1000)}), encoding='utf-8')
    (proj / 'cccc3333.jsonl').write_text('{"x":1}\n', encoding='utf-8')

    # 项目 -noref:回看窗口内有活动但【没有 workflow 运行】的纯交互会话——真实反馈的现场:
    # 回看窗口设 180 天后,项目选择列表仍只列"有运行/活跃"的项目,这类项目永远不出现(总数不对)。
    nq = root / '-noref'
    nq.mkdir()
    (nq / 'dddd4444.jsonl').write_text(json.dumps({'type': 'user', 'cwd': '/work/nq'}) + '\n', encoding='utf-8')
    # 项目 -cold:唯一会话 40 天前活动(超出 14 天窗口)→ 整项目不许出现
    cold = root / '-cold'
    cold.mkdir()
    tr_e = cold / 'eeee5555.jsonl'
    tr_e.write_text('{"x":1}\n', encoding='utf-8')
    os.utime(tr_e, (old, old))

    # 单点重定向:scan/sessions 均以 config.PROJ/config.recent_sec 属性读取(1.2.18 集中化),不再逐模块打补丁
    config.PROJ = root
    config.recent_sec = lambda: 14 * 86400
    runs = scan.scan()
    ids = sorted(r['runId'] for r in runs)
    ck('window/active-transcript-includes-live-run', 'wf_live1' in ids, str(ids))
    if 'wf_live1' in ids:
        r = next(x for x in runs if x['runId'] == 'wf_live1')
        ck('window/live-status', r['live'] and r['status'] == 'running', '%s live=%s' % (r['status'], r['live']))
    ck('window/stale-session-still-excluded', 'wf_old' not in ids, str(ids))
    ck('window/fresh-session-included', 'wf_new' in ids, str(ids))

    # ── 项目选择列表数据源:窗口内有会话活动的【全部】项目(含无 workflow 运行的纯会话项目)──
    pl = scan.projects_in_window()
    ck('pl/pure-session-project-included', '/work/nq' in pl, str(pl))
    ck('pl/workflow-project-included', '-proj' in pl, str(pl))
    ck('pl/out-of-window-project-excluded', all('cold' not in x and 'eeee' not in x for x in pl), str(pl))
    ck('pl/dedup-one-per-project', len(pl) == len(set(pl)), str(pl))
    ck('pl/sorted-stable', pl == sorted(pl), str(pl))

done()
