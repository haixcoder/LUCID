# 会话卡列表判窗 = 回看窗口(1.2.38):用户报「选择 claudeConfig 项目后,指示器显示该项目有 10 个任务,
# 但下方列表没有展示这 10 次任务的概览」。根因:1.2.36/37 把项目列表与 TASKS 仪表改成【输入自身时间戳
# 落回看窗口】口径(recentDays=10 天),而会话卡列表的候选门禁 _candidates 仍只放行「活跃 or mtime≤2h」
# ——claudeConfig 实测:窗内 4 个会话(5+3+1+1=10),最后文件写入在 14h 前 ⇒ 仪表 10 / 列表 0。
# 修:_candidates 与 window_activity 共用同一判窗单点(输入时间戳落窗即入选),并抬高 MAX_SESSIONS
# 保证列表不被截断(实测 10d 窗内 64 会话 > 旧上限 40)。
import json
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _util import ck, done

from ccviewer import config, sessions

with tempfile.TemporaryDirectory() as td:
    root = Path(td)
    proj = root / '-w1'
    proj.mkdir()
    (root / 'sessions').mkdir()  # 空注册表:全部非活跃
    now = time.time()
    config.PROJ = root
    config.recent_sec = lambda: 4 * 86400  # 回看窗口 4 天

    def iso(ts):
        return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(ts))

    def urec(uuid, text, ts=None):
        r = {'type': 'user', 'cwd': '/work/w1', 'uuid': uuid,
             'message': {'role': 'user', 'content': text}}
        if ts:
            r['timestamp'] = ts
        return json.dumps(r, ensure_ascii=False, separators=(',', ':'))

    # OLD:窗内 3 次输入(1 天前),文件 mtime 5h 前(>SESSION_HOURS=2h,≤窗口)——
    #      正是用户看到的那类项目:仪表计入、列表曾因「非活跃且超 2h」整个不放
    old_id = 'a1b00000-0000-0000-0000-000000000001'
    old = proj / (old_id + '.jsonl')
    old.write_text('\n'.join([urec('%036d' % i, '窗内任务%d' % i, iso(now - 86400)) for i in (1, 2, 3)]) + '\n',
                   encoding='utf-8')
    mt5h = now - 5 * 3600
    os.utime(old, (mt5h, mt5h))

    # NEW:实时口径回归护栏——mtime 5 分钟前(≤2h)的会话照旧入选(门禁只放宽不收紧)
    new_id = 'a1b00000-0000-0000-0000-000000000002'
    new = proj / (new_id + '.jsonl')
    new.write_text(urec('c' * 36, '刚跑完的任务', iso(now - 60)) + '\n', encoding='utf-8')
    mt5m = now - 5 * 60
    os.utime(new, (mt5m, mt5m))

    # BUMP:mtime 5h 前(窗内粗筛过)但内容最后输入 30 天前——判窗只信时间戳,负控制:不入列不计数
    bump_id = 'a1b00000-0000-0000-0000-000000000003'
    bump = proj / (bump_id + '.jsonl')
    bump.write_text(urec('d' * 36, '三十天前的输入', iso(now - 30 * 86400)) + '\n', encoding='utf-8')
    os.utime(bump, (mt5h, mt5h))

    # COLD:mtime 40 天前且输入也在 40 天前——出窗(粗筛即拒),负对照
    cold_id = 'a1b00000-0000-0000-0000-000000000004'
    cold = proj / (cold_id + '.jsonl')
    cold.write_text(urec('e' * 36, '四十天前的输入', iso(now - 40 * 86400)) + '\n', encoding='utf-8')
    os.utime(cold, (now - 40 * 86400,) * 2)

    wa = sessions.window_activity()
    ck('gauge/fixture-window-byCwd(仪表先给出口径)', wa['tasks']['byCwd'] == {'/work/w1': 4}
       and wa['tasks']['total'] == 4 and wa['projects'] == ['/work/w1'], str(wa))

    listed = {s['sessionId']: s for s in sessions.scan_sessions()}
    # ① 核心 RED:窗内输入但 2h 无文件活动的会话必须出现在列表(真实反馈:仪表 10 / 列表 0)
    ck('gate/in-window-session-listed', old_id in listed, 'listed=%s' % sorted(listed))
    # ② 实时口径不收紧:mtime≤2h 的会话照旧入选
    ck('gate/realtime-session-still-listed', new_id in listed)
    # ③ 负控制×2:mtime 被顶新但输入出窗 / 整体出窗 → 不入选(与仪表/项目列表同一判定)
    ck('gate/mtime-bumped-not-listed', bump_id not in listed)
    ck('gate/out-of-window-not-listed', cold_id not in listed)
    # ④ 对账不变量:列表各会话 turns 之和 == 仪表 byCwd(用户拿列表核仪表的通路)
    ck('consistency/list-turns-sum-equals-gauge',
       sum(s['turns'] for s in listed.values()) == wa['tasks']['byCwd'].get('/work/w1') == 4,
       str({k: v['turns'] for k, v in listed.items()}))
    # ⑤ 入选卡片的呈现语义:非活跃历史会话 = ended 卡(不冒充运行中)
    if old_id in listed:
        s = listed[old_id]
        ck('card/windowed-session-ended-status', s['status'] == 'ended' and s['alive'] is False
           and s['turns'] == 3, '%s/%s/%s' % (s['status'], s['alive'], s['turns']))

done()
