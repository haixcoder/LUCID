# 任务总次数精确计数(1.2.36):用户报「执行任务的总次数又显示错误」。
# 双根因:① turns 只数 256KB 尾窗——大会话(>900KB 常见)早期输入被挤出窗口,实测 25/37 会话少计、
#   10 会话尾窗归零仍显「尾窗任务 0」;② TASKS 仪表=tsum(视图内会话),而视图只有「活跃+近2h」——
#   回看窗口 180 天真相 151 次,仪表只显 5。修:全量精确计数(整录逐行判 _user_prompt,同 uuid 重传去重,
#   mtime/size 未变走缓存→稳态零重读)+ tasks_summary() 覆盖回看窗口全部会话,仪表切窗口口径。
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
    proj = root / '-tp'
    proj.mkdir()
    (root / 'sessions').mkdir()
    now = time.time()

    def urec(uuid, text, **extra):
        r = {'type': 'user', 'cwd': '/work/tp', 'uuid': uuid,
             'message': {'role': 'user', 'content': text}}
        r.update(extra)
        return json.dumps(r, ensure_ascii=False, separators=(',', ':'))

    # BIG:2 条真人输入(U1 早期→被 300KB 巨块挤出尾窗;U2 在窗内)+ 重传同 uuid 只计一次 + 噪声不计
    pad = json.dumps({'type': 'assistant', 'message': {'id': 'm1', 'role': 'assistant', 'content':
                    [{'type': 'text', 'text': 'x' * 300000}]}}, ensure_ascii=False, separators=(',', ':'))
    big = proj / 'e0b00000-0000-0000-0000-000000000001.jsonl'
    big.write_text('\n'.join([
        urec('u00000000-0000-0000-0000-000000000001', '早期任务'),
        pad,
        urec('u00000000-0000-0000-0000-000000000002', '窗内任务'),
        urec('u00000000-0000-0000-0000-000000000002', '窗内任务'),  # 流式重传:同 uuid 只计一次
        json.dumps({'type': 'user', 'isMeta': True, 'message': {'role': 'user', 'content': 'meta 注入'}}, separators=(',', ':')),
        json.dumps({'type': 'user', 'message': {'role': 'user', 'content':
                    [{'type': 'tool_result', 'tool_use_id': 't1', 'content': '回执'}]}}, separators=(',', ':')),
    ]) + '\n', encoding='utf-8')
    # SML:2 条真人输入(会话 mt 在窗内,但任务甲的时间戳在 14 天窗外 → 仪表只计窗内的任务乙)
    sml_id = 'e5a10000-0000-0000-0000-000000000002'
    sml = proj / (sml_id + '.jsonl')
    sml.write_text('\n'.join([
        urec('a' * 36, '任务甲', timestamp=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now - 30 * 86400))),
        urec('b' * 36, '任务乙', timestamp=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now - 1))),
    ]) + '\n', encoding='utf-8')
    # OLD:窗口外(40 天)会话,含 5 条输入 → tasks_summary 不许计入(负对照)
    old_id = '01d00000-0000-0000-0000-000000000003'
    old = proj / (old_id + '.jsonl')
    old.write_text('\n'.join([json.dumps({'type': 'user', 'uuid': '%08d-0000-0000-0000-000000000000' % i,
                                          'message': {'role': 'user', 'content': 'oldtask%d' % i}}) for i in range(5)])
                   + '\n', encoding='utf-8')
    oldt = now - 40 * 86400
    os.utime(old, (oldt, oldt))

    config.PROJ = root
    config.recent_sec = lambda: 14 * 86400

    # ── 精确计数 vs 尾窗旧口径 ──(U1 在窗外 + U2 重传去重 = 2;尾窗只见重传两条=2 却数错源头)
    n = sessions.count_user_inputs(proj.name, big.stem)
    ck('count/exact-full-transcript', n == 2, str(n))
    ck('count/replay-same-uuid-deduped', n == 2, str(n))  # U2 两条同 uuid 计 1(若各计则=3)
    from ccviewer.jsonl import tail_text
    tail_txt = tail_text(big)
    tail_n = sessions._analyze(tail_txt)['turnsTotal']
    ck('root/tail-window-drops-early-input(U1 在 256KB 窗外)', '早期任务' not in tail_txt, 'tailKB=%d' % (len(tail_txt) // 1024))
    # 旧合式(尾窗数+头扫首条)在本 fixture 上把重传数成两条又补回首条 → 与精确值不一致(误差方向随文件形态变)
    old_heuristic = tail_n + 1  # 头扫首条=U1,不在尾窗 prompts → 补 1
    ck('root/old-heuristic-disagrees-with-exact', old_heuristic != n, 'old=%s exact=%s' % (old_heuristic, n))

    # ── 追加→计数跟进(缓存失效);无变化→缓存命中(值稳定) ──
    with open(big, 'a') as f:
        f.write(urec('d' * 36, '追加任务') + '\n')
    ck('count/append-tracked', sessions.count_user_inputs(proj.name, big.stem) == 3)
    ck('count/stable-across-calls', sessions.count_user_inputs(proj.name, big.stem) == 3)
    # 半行(写入中被采样)不吞不重:补全后计数 +1
    with open(big, 'a') as f:
        f.write('{"type":"user","uuid":"e' + '0' * 34 + '-0000-0000-0000-000000000000","message":{"role":"user","content":"半行任务"}')
    ck('count/partial-line-safe', sessions.count_user_inputs(proj.name, big.stem) == 3)
    with open(big, 'a') as f:
        f.write('}\n')
    ck('count/partial-line-completes', sessions.count_user_inputs(proj.name, big.stem) == 4,
       str(sessions.count_user_inputs(proj.name, big.stem)))
    # 截断(文件变小)→ 全量重算
    big.write_text(urec('a' * 36, '任务甲') + '\n', encoding='utf-8')
    ck('count/shrink-recounts', sessions.count_user_inputs(proj.name, big.stem) == 1)

    # ── 视图内会话 turns = 精确值(卡片「任务 N」数据源) ──
    ent = {s['sessionId']: s for s in sessions.scan_sessions()}.get(sml_id) or {}
    ck('entry/turns-exact', ent.get('turns') == 2, str(ent.get('turns')))

    # ── 项目列表窗口判定=按【转录内容时间戳】,mtime 被外部 touch 变新不算"操作过" ──
    # (真实反馈:4 天窗口列出 6 个项目,但 researchProject 最后一次真人输入在 4.9 天前——
    #  转录 mtime 4.0d 比内容时间戳新,旧 mtime 判窗把它错拉进列表)
    tch = root / '-tch'
    tch.mkdir()
    tch_tr = tch / 'f1e50000-0000-0000-0000-000000000004.jsonl'
    old10 = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now - 10 * 86400))
    tch_tr.write_text('\n'.join([
        urec('f' * 36, '十天前的输入', timestamp=old10, cwd='/work/tch'),
        json.dumps({'type': 'summary', 'summary': '无 timestamp 字段的尾部写入把 mtime 顶新'}, separators=(',', ':')),
    ]) + '\n', encoding='utf-8')  # mtime 保持"刚刚",内容最后输入在 10 天前——mtime 判窗必错的对象

    # ── 多次切换回看窗口:项目列表与任务数必须逐窗口正确(用户验收场景) ──
    config.recent_sec = lambda: 4 * 86400
    w4 = sessions.window_activity()
    ck('window/4d: tch(mtime 新但输入 10d 前)不入列;sml 只计窗内任务乙',
       w4['projects'] == ['/work/tp'] and w4['tasks']['total'] == 2 and w4['tasks']['byCwd'] == {'/work/tp': 2}, str(w4))
    config.recent_sec = lambda: 14 * 86400
    w14 = sessions.window_activity()
    ck('window/14d: tch 入列且贡献 1 个任务', set(w14['projects']) == {'/work/tp', '/work/tch'}
       and w14['tasks']['byCwd'].get('/work/tch') == 1 and w14['tasks']['total'] == 3, str(w14))
    config.recent_sec = lambda: 45 * 86400
    w45 = sessions.window_activity()
    ck('window/45d: old(40d 无 ts,mt 兜底)入列贡献 5;任务甲(30d)也回到窗内', set(w45['projects']) == {'/work/tp', '/work/tch', '-tp'}
       and w45['tasks']['byCwd'].get('-tp') == 5 and w45['tasks']['total'] == 3 + 1 + 5, str(w45))
    config.recent_sec = lambda: 1 * 86400
    w1 = sessions.window_activity()
    ck('window/1d: 任务甲(30d)/tch(10d)/old(40d)全出列,只剩 /work/tp',
       w1['projects'] == ['/work/tp'] and w1['tasks']['total'] == 2, str(w1))
    config.recent_sec = lambda: 14 * 86400  # 还原(后续如有断言依赖)
    ts = sessions.window_activity()['tasks']
    ck('summary/timestamp-window-semantics(14d)', ts['total'] == 3 and ts['byCwd'].get('/work/tp') == 2, str(ts))

done()
