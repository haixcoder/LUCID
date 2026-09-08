// 全文抽屉契约(复刻历史 t8 并入库):展开 details → data-src 懒拉全文 → IN/OUT pane 三态。
//  · 首次展开:pane 先挂 .q 扫描光加载态;到达后换内容 pane 摘 .q→重挂 .xfp 扫光 + .rich 挂 .xf 淡入,
//    标签切「全文」;二次展开(FULL 命中)不再发请求(反断言:缓存跨轮询重建存活);
//  · miss:显式「⚠ 超出留存」提示而非静默空白(铁律7);note 错误路径同摘 .q。
import { load, payload, makeCk, opts0ver, RUN_DONE, SESSION_FIX } from './harness.ts';
const { ck, done } = makeCk();

const FULL_TEXT = { prompt: 'FULL-IN 全文注入段落', result: 'FULL-OUT 回合累计全文' };

(async function main() {
  const runs = [JSON.parse(JSON.stringify(RUN_DONE))];
  const sessions = [JSON.parse(JSON.stringify(SESSION_FIX))];
  const env = load({
    fetchFor: (url) => {
      // ver 必须等于页面构建戳,否则 tick 走"旧标签页自刷新"分支提前返回(该分支由 test_render_diff 专门覆盖)
      if (url.indexOf('/api/runs') === 0) return { now: 1757000300, ver: opts0ver(), recentDays: 14, runs };
      if (url.indexOf('/api/sessions') === 0) return { now: 1757000300, sessions };
      if (url.indexOf('/api/agent') === 0) return FULL_TEXT;
      if (url.indexOf('/api/subagent') === 0) {
        if (url.indexOf('msg=uu-miss') >= 0) return { prompt: '', result: '', miss: true };
        if (url.indexOf('msg=msg-miss-step') >= 0) return { prompt: '', result: '', miss: true };   // 步骤行 miss(1.2.61)
        return FULL_TEXT;
      }
      return undefined;
    },
  });
  await env.flush();
  for (let i = 0; i < 2; i++) { env.run('void tick()'); await env.flush(); }
  ck('boot 无 JS 异常', env.errs.length === 0, env.errs.join('|'));

  // ── workflow agent 行:proj|sess|run|agent 形态 ──
  const k1 = RUN_DONE.runId + ':' + RUN_DONE.agents[0].agentId;
  const d1 = env.$('list').querySelector(`details[data-k="${k1}"]`)!;
  ck('agent 行带 data-src 懒拉锚点', !!d1 && /^-fixproj\|/.test(d1.dataset.src || ''), d1 && d1.dataset.src);
  const calls0 = env.fetchCalls.length;
  d1.open = true;
  d1.fire('toggle');
  const qPanes = () => [...d1.querySelectorAll('.pane')];
  ck('展开即进入 .q 加载态(扫描光预告)', qPanes().length > 0 && qPanes().every((p) => p.classList.contains('q')));
  await env.flush();
  ck('请求打到 /api/agent(参数完整)', env.fetchCalls.slice(calls0).some((u) => u.includes('/api/agent') && u.includes('agent=')),
     env.fetchCalls.slice(calls0).join(' '));
  const inP = d1.querySelectorAll('.pane').filter((p) => (p.dataset.t || '').startsWith('IN'))[0];
  const outP = d1.querySelectorAll('.pane').filter((p) => (p.dataset.t || '').startsWith('OUT'))[0];
  ck('IN pane 回填全文 + 标签切「全文」', inP && inP.textContent.includes('FULL-IN') && /全文/.test(inP.dataset.t || ''), inP && inP.dataset.t);
  ck('OUT pane 同', outP && outP.textContent.includes('FULL-OUT') && /全文/.test(outP.dataset.t || ''), outP && outP.dataset.t);
  ck('加载态摘除 + 一次性扫光 .xfp + 内容淡入 .xf', [inP, outP].every((p) => p && !p.classList.contains('q') && p.classList.contains('xfp'))
     && inP.querySelector('.rich')!.classList.contains('xf'));

  // ── FULL 缓存:轮询重建后仍显示全文且不再请求 ──
  runs[0].agents[0].lastTool = 'Grep';   // 数据变 → 卡重建
  env.run('void tick()');
  await env.flush();
  const d1b = env.$('list').querySelector(`details[data-k="${k1}"]`);
  ck('重建后渲染即感知 FULL(标签直接「全文」)', d1b && /全文/.test((d1b.querySelectorAll('.pane')[0] || { dataset: {} as Record<string, string | undefined> }).dataset.t || ''),
     d1b && d1b.innerHTML.slice(0, 200));
  const calls1 = env.fetchCalls.length;
  d1b!.open = true;
  d1b!.fire('toggle');
  await env.flush();
  ck('FULL 命中:二次展开零请求(反断言)', env.fetchCalls.length === calls1);

  // ── 会话侧:S|…|main#msgId 与 main#uuid 两种锚点 ──
  const wk = SESSION_FIX.sessionId + ':wait';
  const wd = env.$('sess').querySelector(`details[data-k="${wk}"]`)!;
  ck('等待行 data-src 带 msg 锚点', wd && /main#msg_g1$/.test(wd.dataset.src || ''), wd && wd.dataset.src);
  const c2 = env.fetchCalls.length;
  wd.open = true;
  wd.fire('toggle');
  await env.flush();
  ck('等待行展开 → /api/subagent?…&msg=msg_g1', env.fetchCalls.slice(c2).some((u) => u.includes('/api/subagent') && u.includes('msg=msg_g1')),
     env.fetchCalls.slice(c2).join(' '));
  ck('等待行 OUT 全文回填', wd.textContent.includes('FULL-OUT'), wd.textContent.slice(0, 160));
  const pk = SESSION_FIX.sessionId + ':prompt:' + SESSION_FIX.prompts[0].u;
  const pd = env.$('sess').querySelector(`details[data-k="${pk}"]`)!;
  ck('提示词行 data-src 用记录 uuid 锚点', pd && (pd.dataset.src || '').endsWith('#' + SESSION_FIX.prompts[0].u), pd && pd.dataset.src);
  const c3 = env.fetchCalls.length;
  pd.open = true;
  pd.fire('toggle');
  await env.flush();
  ck('提示词展开 → uuid 锚点回全文(IN pane)', env.fetchCalls[c3].includes('msg=' + SESSION_FIX.prompts[0].u)
     && pd.textContent.includes('FULL-IN'), pd.textContent.slice(0, 160));

  // ── miss 显式提示(用尚未进 FULL 缓存的提示词行做锚) ──
  sessions[0].prompts[1].u = 'uu-miss';
  env.run('void tick()');
  await env.flush();
  const pk2 = SESSION_FIX.sessionId + ':prompt:uu-miss';
  const pd2 = env.$('sess').querySelector(`details[data-k="${pk2}"]`)!;
  const c4 = env.fetchCalls.length;
  pd2.open = true;
  pd2.fire('toggle');
  await env.flush();
  ck('请求确实发出', env.fetchCalls.length > c4 && env.fetchCalls[env.fetchCalls.length - 1].includes('msg=uu-miss'));
  ck('miss:pane 显式「超出转录留存范围」不留白', pd2.textContent.includes('超出转录留存范围'), pd2.textContent.slice(0, 200));
  ck('miss:加载态已摘(不留 .q 永挂)', pd2.querySelectorAll('.pane').every((p) => !p.classList.contains('q')));

  // ── 步骤行的 miss(1.2.61 修;真实反馈「点击展开详情后，不显示内容」)──
  // stepRow 是唯一**不读**缓存 miss 标志的行:miss 时 FULL[k].r='' → R 恒空 → OUT 面板整块消失,
  // onToggle 写进 pane 的 ⚠ 又在下一轮轮询重建时被冲掉。展开后既无全文也无提示 = 静默空白。
  sessions[0].steps[0].msgId = 'msg-miss-step';
  sessions[0].steps[0].text = 'STEP-PREVIEW 截断预览';
  env.run('void tick()');
  await env.flush();
  const sk = SESSION_FIX.sessionId + ':msg-miss-step';
  const sd = env.$('sess').querySelector(`details[data-k="${sk}"]`)!;
  ck('步骤行 miss 前提:展开前有 OUT 截断预览', !!sd && sd.textContent.includes('STEP-PREVIEW'), sd && sd.textContent.slice(0, 160));
  sd.open = true;
  sd.fire('toggle');
  await env.flush();
  ck('步骤行 miss:pane 显式「超出转录留存范围」,OUT 面板不消失',
     /超出转录留存范围/.test(sd.textContent) && [...sd.querySelectorAll('.pane')].some((p) => (p.dataset.t || '').startsWith('OUT')),
     sd.textContent.slice(0, 240));
  env.run('void tick()');                       // 轮询重建(实况页面每 2s 一次)
  await env.flush();
  const sd2 = env.$('sess').querySelector(`details[data-k="${sk}"]`)!;
  ck('步骤行 miss:轮询重建后 ⚠ 与 OUT 面板都还在(不被截断预览顶掉)',
     !!sd2 && /超出转录留存范围/.test(sd2.textContent) && [...sd2.querySelectorAll('.pane')].some((p) => (p.dataset.t || '').startsWith('OUT')),
     sd2 && sd2.textContent.slice(0, 240));

  ck('全程无渲染异常', env.errs.length === 0, env.errs.join('|'));
  done();
})().catch((e: unknown) => { console.error('HARNESS CRASH:', e); process.exit(2); });
