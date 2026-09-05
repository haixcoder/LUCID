'use strict';
// 页面级视口锚定(用户真实反馈:「执行任务中,展开工具调用/agent 详情后上下滚动,内容上下漂移」)。
// 根因假设:render() 的锚点快照在其函数体开头才取,而 tick() 先跑 renderSessions()——执行中会话卡
// 每轮长高(新步骤行)时,快照量到的已是"增长后"位置,补偿恒 0,漂移从未被吸收。
// 桩无布局引擎 → 在 harness 的 El.prototype 上装 _rect 活 getter:高度=f(当前 DOM),docTop=前序兄弟
// 累加,视口坐标再减 scrollY——**outerHTML 重建出的新节点同样自动有正确 rect**(否则重建=丢 rect,
// 补偿逻辑会把「读不到」错当「跳到 0」,测出假象)。
process.env.TZ = 'UTC';
const { load, makeCk, payload, RUN_DONE, RUN_LIVE, SESSION_FIX } = require('./harness');
const { ck, done } = makeCk();

const GAP = 10, SESS_BASE = 200, SESS_PER_DET = 30, RUN_H = 300;
let WIN = null;
function cardH(c) {
  if (!c.dataset || !c.dataset.rid) return 0;
  if (c.parent && c.parent.id === 'sess') return SESS_BASE + SESS_PER_DET * c.querySelectorAll('details').length;
  if (c.parent && c.parent.id === 'list') return RUN_H;
  return 0;
}
function docTopOf(el) {  // 文档流:#sess 区整体在上,#list 在下;区内按前序兄弟累加
  const p = el.parent; if (!p || p.id !== 'list' && p.id !== 'sess') return 0;
  let t = 0;
  if (p.id === 'list') for (const c of env.$('sess').children) { const h = cardH(c); if (h) t += h + GAP; }
  for (const sib of p.children) { if (sib === el) break; const h = cardH(sib); if (h) t += h + GAP; }
  return t;
}
let env = null;
(async function main() {
  const runs = [JSON.parse(JSON.stringify(RUN_DONE)), JSON.parse(JSON.stringify(RUN_LIVE))];
  const sessions = [JSON.parse(JSON.stringify(SESSION_FIX))];
  env = load({ fetchFor: payload(runs, sessions) });
  await env.flush();
  ck('boot 无 JS 异常', env.errs.length === 0, env.errs.join(' | '));
  // 稳定身份:让 'en' 入场类完成合法的一次性摘除(同 test_render_diff 的做法)
  for (let i = 0; i < 2; i++) { env.run('void tick()'); await env.flush(); }
  ck('稳态:会话卡/运行卡身份保持', env.$('sess').children.length === 1 && env.$('list').children.length === 2);

  // 活 rect:直接在 El 原型上装(重建出的新节点是同类实例 → 自动生效)
  const ElProto = Object.getPrototypeOf(env.$('list'));
  delete ElProto.getBoundingClientRect;  // 类方法在原型链上,先摘掉桩的静态版
  ElProto.getBoundingClientRect = function () {
    const h = cardH(this), t = docTopOf(this) - WIN.scrollY;
    return { top: t, bottom: t + h, left: 0, right: 0, height: h };
  };
  WIN = env.win;

  const sessH0 = 200 + 30 * env.$('sess').querySelector('div[data-rid]').querySelectorAll('details').length;
  env.win.scrollY = sessH0 + GAP - 10;  // 首张运行卡视口 top=10(会话卡在上方,已滚过其大半)
  const anc0 = env.$('list').children[0].getBoundingClientRect().top;
  ck('场景就绪:首张运行卡视口 top=10', Math.abs(anc0 - 10) < 0.01, String(anc0));

  // ── 核心场景:执行中的会话新增一个步骤(details+1 → 会话卡 +30px 高),下方全部内容被推下 ──
  sessions[0].steps.push({ msgId: 'msg_g2', turn: '11111111-2222-3333-4444-555555555555', tools: ['Read'],
    text: 'second step of the turn', model: 'claude-fable-5', tokIn: 200, tokOut: 40, ts: '2026-09-05T04:00:02.000Z' });
  env.run('void tick()');
  await env.flush();
  const anc1 = env.$('list').children[0].getBoundingClientRect().top;
  // 原生 scroll-anchoring 语义:锚点卡(视口内首张)视口位置必须保持 → scrollY 应自动补 +30
  ck('会话卡长高不推动视口(锚点卡 top 保持 10)', Math.abs(anc1 - 10) < 0.01,
     `scrollY=${env.win.scrollY} anchorTop=${anc1} 漂移=${(anc1 - 10).toFixed(1)}px`);

  // ── 对照:数据不变的轮询不许画蛇添足动滚动 ──
  const sy = env.win.scrollY;
  env.run('void tick()'); await env.flush();
  ck('无高度变化时不产生补偿(scrollY 原样)', env.win.scrollY === sy, `${sy} → ${env.win.scrollY}`);

  // ── 回归护栏:抽屉内滚动位置跨重建保持(修复锚定时不许碰坏 diffPaint 既有契约) ──
  const sk = SESSION_FIX.sessionId + ':msg_g1';
  const st = env.$('sess').querySelector('details[data-k="' + sk + '"]');
  st.open = true;
  st.querySelector('.rich').scrollTop = 137;
  sessions[0].toolCalls = 8;  // 数据变 → 会话卡重建
  env.run('void tick()'); await env.flush();
  const st2 = env.$('sess').querySelector('details[data-k="' + sk + '"]');
  const rich2 = st2 && st2.querySelector('.rich');
  ck('展开的抽屉跨重建保持,内部滚动位置不丢', !!st2 && st2.open === true && !!rich2 && rich2.scrollTop === 137,
     `open=${st2 && st2.open} rich=${!!rich2} top=${rich2 && rich2.scrollTop}`);

  // ── 回归护栏:运行卡内 agent 抽屉同一契约(运行卡每轮 AD 相位必重建) ──
  const ak = RUN_LIVE.runId + ':' + 'd'.repeat(40);
  const ad = env.$('list').querySelector('details[data-k="' + ak + '"]');
  if (ad) { ad.open = true; const ar = ad.querySelector('.rich'); if (ar) ar.scrollTop = 42; }
  env.run('void tick()'); await env.flush();
  const ad2 = env.$('list').querySelector('details[data-k="' + ak + '"]');
  const ar2 = ad2 && ad2.querySelector('.rich');
  ck('运行卡 agent 抽屉跨重建 open+滚动保持', !!ad2 && ad2.open === true && !!ar2 && ar2.scrollTop === 42,
     `found=${!!ad2} open=${ad2 && ad2.open} top=${ar2 && ar2.scrollTop}`);

  done();
})().catch((e) => { console.error('HARNESS CRASH:', e); process.exit(2); });
