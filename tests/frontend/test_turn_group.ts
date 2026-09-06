// 回合分组展示契约(1.2.20 目标:「一次 turn 回合 = 一个独立展示单元,不再全部放在一起」):
//  · 每个 .tg 组 = 组头(该回合的真人输入行 promptline,抽屉键 <sid>:prompt:<uuid> 不变)+ 其步骤行;
//  · 归属只认后端 step.turn(前端不猜边界);输入超出尾窗的组 → 组头按 uuid 仍可懒拉全文;
//  · turn=''(尾窗起点前的步骤)→ 显式 orphan 头,不冒充有锚点;无步骤的输入也自成组;
//  · 组头展开态跨轮询重建保持(整卡 diff 契约在嵌套结构下不破);运行中 glyph 仍只标全局最后一步。
import { load, makeCk, payload, SESSION_FIX } from './harness.ts';
const { ck, done } = makeCk();

(async function main() {
  const SID = 'f1e2d3c4-0000-1111-2222-333344445555';
  const s0 = JSON.parse(JSON.stringify(SESSION_FIX));
  Object.assign(s0, {
    sessionId: SID, status: 'running', alive: true, waitReason: null, waitTool: null,
    pendingTools: ['Bash'], toolCalls: 4, lastTextMid: 'm3', turns: 4,
    prompts: [{ u: 'uu-1', t: '任务一:修仪表', ts: '2026-09-05T04:00:00.000Z' },
              { u: 'uu-2', t: '任务二:跑测试', ts: '2026-09-05T04:10:00.000Z' },
              { u: 'uu-9', t: '只输入未执行', ts: '2026-09-05T04:30:00.000Z' }],
    steps: [{ msgId: 'm0', turn: '', tools: [], text: '孤儿步', model: 'x', tokIn: 0, tokOut: 0, ts: '2026-09-05T03:50:00.000Z' },
            { msgId: 'm1', turn: 'uu-1', tools: ['Bash'], text: '甲一步', model: 'x', tokIn: 1, tokOut: 2, ts: '2026-09-05T04:00:05.000Z' },
            { msgId: 'm2', turn: 'uu-2', tools: ['Read'], text: '乙一步', model: 'x', tokIn: 1, tokOut: 2, ts: '2026-09-05T04:10:05.000Z' },
            { msgId: 'm3', turn: 'uu-3', tools: ['Bash'], text: '输入超尾窗的步', model: 'x', tokIn: 1, tokOut: 2, ts: '2026-09-05T04:20:00.000Z' }],
  });
  const sessions = [s0];
  const env = load({ fetchFor: payload([], sessions) });
  await env.flush();
  ck('boot 无 JS 异常', env.errs.length === 0, env.errs.join(' | '));
  const sessEl = env.$('sess');

  const tgs = sessEl.querySelectorAll('.tg');
  ck('每组=一个回合:孤儿组+uu-1+uu-2+uu-3+无步骤的uu-9 共 5 组', tgs.length === 5, String(tgs.length));
  const heads = tgs.map(g => g.children.find(c => c.classList.contains('turnhd')));
  ck('组序=时间序(孤儿置顶,尾窗末位)', ['uu-1', 'uu-2', 'uu-3', 'uu-9'].join() ===
     heads.slice(1).map(h => (h!.dataset.k || '').split(':prompt:')[1]).join(), heads.map(h => h!.dataset.k || h!.className).join(' | '));

  const stepOf = (mid: string) => sessEl.querySelector(`details[data-k="${SID}:${mid}"]`)!;
  const headOf = (u: string) => sessEl.querySelector(`details[data-k="${SID}:prompt:${u}"]`)!;
  ck('步骤挂在所属回合组内(父节点即 .tg)', stepOf('m1').parent === tgs[1], stepOf('m1').parent!.className);
  ck('同组两步不串组', stepOf('m2').parent === tgs[2] && tgs[1].querySelectorAll('.tstep').length === 1);
  const o0 = heads[0]!;
  ck("turn='' → 显式 orphan 头(无 data-k/无锚点,不冒充可拉全文)", o0.classList.contains('orphan') && !o0.dataset.k && !o0.dataset.src, o0.className);
  ck('孤儿步在 orphan 组下', stepOf('m0').parent === tgs[0]);
  const h3 = headOf('uu-3');
  ck('输入超尾窗:组头仍按 uuid 出锚点(懒拉可达,铁律7)', h3 && (h3.dataset.src || '').endsWith('#uu-3') && h3.textContent.includes('超出尾窗'), h3 && h3.dataset.src);
  const h9 = headOf('uu-9');
  ck('只输入未执行也自成单元(0 步组头)', h9 && h9.parent!.querySelectorAll('.tstep').length === 0 && h9.textContent.includes('0 步'), h9 && h9.textContent);
  ck('组头带步数徽章', headOf('uu-1').textContent.includes('1 步') && stepOf('m1').textContent !== null);
  const gl = stepOf('m3').querySelector('.glyph')!;
  ck('运行中 glyph 只标全局最后一步(跨组仍单点)', gl.getAttribute('title') !== null && stepOf('m3').querySelector('.glyph')!.textContent === '◈' && stepOf('m1').querySelector('.glyph')!.textContent === '▸');

  // ── 展开态跨重建:打开 uu-1 组头(输入全文抽屉)→ 数据变触发整卡重建 → 保持 open ──
  const pd = headOf('uu-1');
  pd.open = true;
  sessions[0].toolCalls = 5;   // 卡 HTML 变 → outerHTML 重建
  env.run('void tick()');
  await env.flush();
  const pd2 = env.$('sess').querySelector(`details[data-k="${SID}:prompt:uu-1"]`);
  ck('组头抽屉展开态跨重建保持(diff 契约在分组下不破)', pd2 && pd2.open && pd2.classList.contains('noanim'), pd2 && String(pd2.open));
  ck('重建后分组结构依旧 5 组', env.$('sess').querySelectorAll('.tg').length === 5);

  // ── 步骤抽屉键不变(与 1.2.19 以前完全同格式 → FULL 缓存/懒拉跨升级延续)──
  const sd = stepOf('m1');
  ck('步骤 data-src 契约不变', (sd.dataset.src || '') === `S|${s0.project}|${SID}|main#m1`, sd.dataset.src);
  ck('眉标写明尾窗口径(铁律7)', sessEl.textContent.includes('尾窗') && sessEl.textContent.includes('任务(回合)'), '');
  // 主 agent 调用任务次数上卡面(不展开也可见):数据只认后端 turns 字段,前端不再数 prompts(其摘要 30 条封顶会少数)
  ck('卡顶行展示「尾窗任务 N」', sessEl.textContent.includes('尾窗任务 4'), sessEl.textContent.slice(0, 200));
  ck('全程无渲染异常', env.errs.length === 0, env.errs.join(' | '));
  done();
})().catch((e: unknown) => { console.error('HARNESS CRASH:', e); process.exit(2); });
