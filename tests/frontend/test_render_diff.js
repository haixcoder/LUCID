'use strict';
// 前端装配层不变量(复刻历史 t2/t4/t6/t7 的语义并入库):
//  · 首轮 tick 完成 → 运行卡/会话卡落 DOM,仪表串自证口径(无过滤=纯数,有过滤=命中/总数+title);
//  · 按卡 diff:同载荷重渲染 → 完成卡节点身份保持(不许整体重绘),数据变的卡才重建;
//  · details 展开态/滚动位置跨重建恢复;会话卡区同契约;
//  · 后台节流补偿 catchUp:visibilitychange/pageshow/focus 立即补扫,1s 冷却去重,auto=off 不越权;
//  · 两条真实缺陷的 RED 复现:① 搜索空态→恢复后 .idle「NO MATCH」永久残留(render() 漏摘);
//    ② meta[wfo-ver] 无 id → VER 恒空 → 部署后旧标签页永不自动刷新(桩按规范只认 id,还原真机行为)。
process.env.TZ = 'UTC';  // 黄金/时间格式化跨机稳定
const { load, makeCk, payload, RUN_DONE, RUN_LIVE, SESSION_FIX, ARTIFACT } = require('./harness');
const { ck, done } = makeCk();

(async function main() {
  const runs = [JSON.parse(JSON.stringify(RUN_DONE)), JSON.parse(JSON.stringify(RUN_LIVE))];
  const sessions = [JSON.parse(JSON.stringify(SESSION_FIX))];
  const env = load({ fetchFor: payload(runs, sessions) });
  await env.flush();

  ck('boot 无 JS 异常(渲染错误会伪装掉线,必须为零)', env.errs.length === 0, env.errs.join(' | '));
  const list = env.$('list'), sessEl = env.$('sess');
  ck('运行卡落 DOM(2 张,按载荷序)', list.children.length === 2 && list.children[0].dataset.rid === 'wf_alpha1'
     && list.children[1].dataset.rid === 'wf_live9', list.children.map(c => c.dataset.rid).join(','));
  ck('会话卡落 DOM + 区标题可见', sessEl.children.length === 1 && env.$('secttl').hidden === false);
  const g0 = env.$('gauges').innerHTML;
  ck('仪表无过滤态:RUNS 纯计数(无命中/总数,无 title 说明)', /<b>2<\/b><span>RUNS/.test(g0) && g0.indexOf('title=') < 0, g0.slice(0, 160));
  ck('会话区标题含 ⏸ 计数(ask=真卡住)', /⏸/.test(env.$('secttl').innerHTML), env.$('secttl').innerHTML);

  // ── 按卡 diff:完成卡身份保持;会话卡数据稳定同样不重建 ──
  // (首轮后 painted=true 会摘 'en' 入场类 → 合法的一次性重建;让出后再断言稳态身份)
  for (let i = 0; i < 2; i++) { env.run('void tick()'); await env.flush(); }
  const done0 = list.children[0], live0 = list.children[1], sess0 = sessEl.children[0];
  env.run('void tick()');
  await env.flush();
  ck('同载荷重渲染:完成卡节点身份保持(diff 不破)', list.children[0] === done0);
  ck('同载荷重渲染:会话卡节点身份保持', env.$('sess').children[0] === sess0);
  ck('运行中卡每轮重建(含 AD 相位,设计如此)且保持活体', !!list.children[1] && list.children[1].dataset.rid === 'wf_live9');

  // ── 展开态 + 滚动位置跨重建恢复(强制会话卡数据变化 → 重建) ──
  const waitK = SESSION_FIX.sessionId + ':wait';
  const stepK = SESSION_FIX.sessionId + ':msg_g1';
  const w = sessEl.querySelector(`details[data-k="${waitK}"]`);
  const st = sessEl.querySelector(`details[data-k="${stepK}"]`);
  ck('等待行/步骤行按 data-k 定位', !!w && !!st, `wait=${!!w} step=${!!st}`);
  w.open = true;
  st.open = true;  // 折叠的 details 浏览器本就不滚动,快照契约只管展开态
  const rich = st.querySelector('.rich');
  rich.scrollTop = 137;
  sessions[0].toolCalls = 7;   // 数据变 → 卡 HTML 变 → outerHTML 重建
  env.run('void tick()');
  await env.flush();
  const w2 = env.$('sess').querySelector(`details[data-k="${waitK}"]`);
  const st2 = env.$('sess').querySelector(`details[data-k="${stepK}"]`);
  ck('重建后展开态恢复(点开即关不复發)', w2 && w2.open && w2.classList.contains('noanim'), w2 && String(w2.open));
  const rich2 = st2 && st2.querySelector('.rich');
  ck('重建后 pane 滚动位置恢复', rich2 && rich2.scrollTop === 137, rich2 && String(rich2.scrollTop));

  // ── catchUp:后台节流补偿(1.2.16) ──
  const before = env.fetchCalls.length;
  env.doc.hidden = false;
  env.fireTop('visibilitychange');
  await env.flush(4);
  ck('恢复可见立即补扫一轮(+2 请求)', env.fetchCalls.length === before + 2, String(env.fetchCalls.length - before));
  env.fireWin('focus');  // 同瞬再触发
  await env.flush(4);
  ck('三事件同瞬触发被 1s 冷却去重', env.fetchCalls.length === before + 2, String(env.fetchCalls.length - before));
  env.$('auto').checked = false;
  env.$('auto').onchange({ target: { checked: false } });
  const b2 = env.fetchCalls.length;
  env.fireTop('visibilitychange');
  await env.flush(4);
  ck('auto=off:补扫不越权刷新', env.fetchCalls.length === b2);
  env.$('auto').checked = true;
  env.$('auto').onchange({ target: { checked: true } });

  // ── 仪表过滤口径(1.2.14) ──
  env.$('fq').oninput({ target: { value: 'alpha' } });
  await env.flush(2);
  const g1 = env.$('gauges').innerHTML;
  ck('有过滤:RUNS 显示 命中/总数', /<b>1\/2<\/b><span>RUNS/.test(g1), g1.slice(0, 200));
  ck('有过滤:title 交代原因', /已按项目\/搜索过滤|filtered/i.test(g1), g1.slice(0, 240));

  // ── RED①:空态→恢复,.idle 残留(render() 从未摘掉) ──
  env.$('fq').oninput({ target: { value: 'zzz-绝无匹配' } });
  await env.flush(2);
  ck('空态:运行区只剩 NO MATCH 段', list.children.length === 1 && list.children[0].classList.contains('idle'),
     list.children.map(c => c.className || c.tag).join(','));
  ck('空态:会话区同为 NO MATCH', sessEl.children.length === 1 && sessEl.children[0].classList.contains('idle'));
  env.$('fq').oninput({ target: { value: '' } });
  await env.flush(2);
  ck('恢复:运行卡全部回来', list.children.filter(c => c.dataset.rid).length === 2,
     list.children.map(c => c.dataset.rid || c.className).join(','));
  ck('恢复:NO MATCH 残留被摘(render() 空态↔非空态对称清理)', !list.querySelector('.idle'),
     list.innerHTML.slice(0, 120) + '…');
  ck('恢复:会话区无残留', !sessEl.querySelector('.idle'));

  // ── RED②:meta[wfo-ver] 取不到 → 部署自刷新失效(桩按规范只认 id) ──
  ck('VER 常量非空(页面从 meta 自取构建戳;当前 meta 无 id → 真浏览器同为 null)',
     env.get('VER') !== '', JSON.stringify(env.get('VER')));
  const mismatch = load({
    fetchFor: (url) => {
      if (url.indexOf('/api/runs') === 0) return { now: 1757000300, ver: 'ffffffffffff', recentDays: 14, runs: [] };
      return { now: 1757000300, sessions: [] };
    },
  });
  await mismatch.flush();
  ck('api ver ≠ 页面构建戳 → location.reload()(旧标签页自动换新代码)', mismatch.location.reloads >= 1,
     'reloads=' + mismatch.location.reloads + ' VER=' + JSON.stringify(mismatch.get('VER')));

  done();
})().catch((e) => { console.error('HARNESS CRASH:', e); process.exit(2); });
