// Workflow 内嵌卡契约(1.2.41,真实反馈:「在主 agent 调起的 workflow,主 agent 的展示信息和
// workflow 信息块没有在一起,根据时间进行排序」):
//  · 运行卡(完整 workflow 信息块)嵌进发起会话卡的时间线,与回合组同池按时间排序(组头=输入时间,
//    运行卡=startedAt);嵌了即从 #list 摘除(避免重复),发起会话不可见(被滤/不在列表)时保持独立卡;
//  · 仪表 RUNS/LIVE/DONE/ALERT 计入「嵌入+独立」全集(对账不变量:页面有几张运行卡,仪表就数几);
//  · 过滤口径三处共用同一判定点(runHit × sessHit):搜索只命中运行 → 独立卡留在 #list;
//    只命中会话 → 会话在而运行不嵌入(运行本身被滤);
//  · 嵌入后抽屉契约不变:data-k 稳定键的展开态跨轮询重建保持,onToggle 懒拉全文在 #sess 容器同样生效。
import { load, makeCk, payload, opts0ver, RUN_DONE, RUN_LIVE, SESSION_FIX } from './harness.ts';
import type { El } from './harness.ts';
const { ck, done } = makeCk();

const FULL_TEXT = { prompt: 'FULL-IN wf 全文', result: 'FULL-OUT wf 全文' };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const ms = (iso: string): number => Date.parse(iso);

// 会话 s0:sessionId 即两条运行的发起会话;两个回合组 04:00 / 04:30,两条运行 04:05 / 04:20 落中间
function fixture() {
  const s0 = clone(SESSION_FIX);
  Object.assign(s0, {
    sessionId: RUN_DONE.session, status: 'running', alive: true, waitReason: null, waitTool: null,
    pendingTools: ['Workflow'], toolCalls: 9, title: '发起会话特词Q',
    prompts: [{ u: 'uu-a', t: '跑工作流甲', ts: '2026-09-05T04:00:00.000Z' },
              { u: 'uu-b', t: '再查结果乙', ts: '2026-09-05T04:30:00.000Z' }],
    steps: [{ msgId: 'm1', turn: 'uu-a', tools: ['Workflow'], text: '启动工作流甲', model: 'x', tokIn: 1, tokOut: 2, ts: '2026-09-05T04:01:00.000Z' },
            { msgId: 'm2', turn: 'uu-a', tools: ['Bash'], text: '等它跑的时候继续干活', model: 'x', tokIn: 1, tokOut: 2, ts: '2026-09-05T04:03:00.000Z' },
            { msgId: 'm3', turn: 'uu-a', tools: ['Bash'], text: '再收一轮', model: 'x', tokIn: 1, tokOut: 2, ts: '2026-09-05T04:09:00.000Z' },
            { msgId: 'm4', turn: 'uu-b', tools: ['Bash'], text: '继续收尾', model: 'x', tokIn: 1, tokOut: 2, ts: '2026-09-05T04:31:00.000Z' }],
  });
  const wA = clone(RUN_DONE); wA.startedAt = ms('2026-09-05T04:02:00Z');
  const wB = clone(RUN_LIVE); wB.startedAt = ms('2026-09-05T04:20:00Z');
  const wOrph = clone(RUN_DONE); wOrph.runId = 'wf_orph1'; wOrph.session = 'deadbeef-0000-1111-2222-333344445555';
  return { s0, wA, wB, wOrph };
}

// 会话卡内时间线的可见顺序(1.2.45 起细到步骤粒度):回合组(.tg)为容器,其内步骤行(.tstep)与
// 内嵌运行卡(.wfembed > .card[data-rid])同为展示单元——"运行卡落在发起它的那一步之后"由本函数如实读出。
function timeline(cardEl: El): string[] {
  const out: string[] = [];
  const walk = (c: El): void => {
    if (c.classList.contains('tg')) {
      const hd = c.children.find(x => x.classList.contains('turnhd'));
      out.push(hd && hd.dataset.k ? 'grp:' + hd.dataset.k.split(':prompt:')[1] : 'grp:—');
      for (const x of c.children) walk(x);
    } else if (c.classList.contains('wfembed')) {
      const inner = c.querySelector('div.card[data-rid]');
      if (inner) out.push('wf:' + inner.dataset.rid);
    } else if (c.classList.contains('tstep')) {
      out.push('st:' + (c.dataset.k || '').split(':').pop());
    }
  };
  for (const c of cardEl.children) walk(c);
  return out;
}

(async function main() {
  const { s0, wA, wB, wOrph } = fixture();
  const runs = [wA, wB, wOrph], sessions = [s0];
  const env = load({
    fetchFor: (url) => {
      if (url.indexOf('/api/runs') === 0) return { now: 1757000300, ver: opts0ver(), recentDays: 14, runs };
      if (url.indexOf('/api/sessions') === 0) return { now: 1757000300, sessions };
      if (url.indexOf('/api/agent') === 0) return FULL_TEXT;
      return undefined;
    },
  });
  await env.flush();
  ck('boot 无 JS 异常', env.errs.length === 0, env.errs.join(' | '));
  const sessEl = env.$('sess'), listEl = env.$('list');
  const sCard = sessEl.querySelector(`div[data-rid="${s0.sessionId}"]`)!;

  // ── 1) 在一起:发起会话卡内嵌完整运行卡,#list 只留独立卡 ──
  const embA = sCard && sCard.querySelector(`div.card[data-rid="${wA.runId}"]`);
  const embB = sCard && sCard.querySelector(`div.card[data-rid="${wB.runId}"]`);
  ck('主 agent 会话卡内嵌发起的 workflow 运行卡', !!embA && !!embB, embA && embB ? '' : String(!!embA) + '/' + String(!!embB));
  ck('嵌入即摘除:#list 不再有该运行卡', !listEl.querySelector(`div[data-rid="${wA.runId}"]`) && !listEl.querySelector(`div[data-rid="${wB.runId}"]`),
     listEl.innerHTML.slice(0, 120));
  ck('发起会话不在列表的运行保持 #list 独立卡', !!listEl.querySelector(`div[data-rid="${wOrph.runId}"]`) && !sessEl.querySelector(`div[data-rid="${wOrph.runId}"]`));
  // 嵌入的是完整信息块(有 agents 表格行与终态徽章,不只是摘要)
  ck('嵌入块为完整运行信息(状态徽章+agent 行)', !!embA && /b-completed/.test(embA.innerHTML) && !!embA.querySelector(`details[data-k="${wA.runId}:${wA.agents[0].agentId}"]`));

  // ── 2) 时间序(1.2.45 细到步骤粒度):同一回合内运行卡落在发起它的那一步之后,不被推到组尾 ──
  // 夹具:回合 uu-a 三步 m1(04:01,Workflow)/m2(04:03)/m3(04:09);wA 04:02 启动、wB 04:20 启动。
  ck('运行卡按时间插进步骤之间(不再整组之后)',
     timeline(sCard).join(' ') === 'grp:uu-a st:m1 wf:wf_alpha1 st:m2 st:m3 wf:wf_live9 grp:uu-b st:m4',
     sCard && timeline(sCard).join(' '));
  {
    const wrap = sCard.querySelector('.tg .wfembed');
    ck('运行卡是回合组内的一分子(.tg 内,非组后兄弟)', !!wrap && wrap.parent === sCard.children.find(c => c.classList.contains('tg')),
       wrap ? 'wfembed 在 ' + (wrap.parent && wrap.parent.attrs.class) : '未找到 .tg .wfembed');
    ck('紧挨发起它的步骤行(前一个兄弟 = m1 步骤行)',
       !!wrap && !!wrap.previousElementSibling && wrap.previousElementSibling.dataset.k === s0.sessionId + ':m1',
       wrap && wrap.previousElementSibling ? String(wrap.previousElementSibling.dataset.k) : '无前兄弟');
  }

  // ── 3) 仪表对账:RUNS 计「嵌入+独立」全集 ──
  const gs = env.$('gauges').querySelectorAll('.g');
  ck('RUNS 仪表含嵌入卡(3=2 嵌+1 独立)', !!gs[0] && (gs[0].children[0].textContent || '').trim() === '3', gs.map(g => g.textContent).join(' | '));
  ck('LIVE/DONE 同全集(1 running / 2 completed)',
     (gs[2].children[0].textContent || '').trim() === '1' && (gs[3].children[0].textContent || '').trim() === '2', gs.map(g => g.textContent).join(' | '));

  // ── 4) 嵌入卡的抽屉展开态跨轮询重建保持(会话活跃每轮重建,"点开即关"不得复发) ──
  const td = sCard.querySelector(`details[data-k="${wA.runId}:task"]`)!;
  td.open = true;
  sessions[0].toolCalls = 10;   // 会话数据变 → 整卡 outerHTML 重建
  env.run('void tick()');
  await env.flush();
  const td2 = env.$('sess').querySelector(`div[data-rid="${s0.sessionId}"] details[data-k="${wA.runId}:task"]`);
  ck('嵌入运行卡抽屉展开态跨重建保持', !!td2 && td2.open && td2.classList.contains('noanim'), td2 && String(td2.open));

  // ── 5) 嵌入位懒拉全文:onToggle 已挂 #sess 容器,agent 行展开照常拉 /api/agent ──
  const agRow = env.$('sess').querySelector(`div[data-rid="${s0.sessionId}"] details[data-k="${wA.runId}:${wA.agents[0].agentId}"]`)!;
  const calls0 = env.fetchCalls.length;
  agRow.open = true; agRow.fire('toggle');
  await env.flush();
  ck('嵌入 agent 行展开触发 /api/agent 懒拉', env.fetchCalls.slice(calls0).some(u => u.indexOf('/api/agent') === 0 && u.includes('run=' + wA.runId)),
     env.fetchCalls.slice(calls0).join(' | '));
  const inP = agRow.querySelectorAll('.pane').filter(p => (p.dataset.t || '').startsWith('IN'))[0];
  ck('全文回填到嵌入行(标签切「全文」)', !!inP && /全文/.test(inP.dataset.t || '') && inP.textContent.includes('FULL-IN'), inP && inP.textContent.slice(0, 60));

  // ── 6a) 搜索只命中运行名 → 独立卡留 #list(其会话卡被滤,无处嵌入≠消失);未命中运行不显示 ──
  const f6 = fixture();
  const envB = load({ fetchFor: payload([f6.wA, f6.wB, f6.wOrph], [f6.s0]), localStorage: { 'wfo-fstr': 'live-flow' } });
  await envB.flush();
  {
    const listB = envB.$('list'), sessB = envB.$('sess');
    ck('搜索只命中运行:独立卡留 #list(不被吞进不可见会话)',
       !!listB.querySelector(`div[data-rid="${f6.wB.runId}"]`) && !sessB.querySelector(`div[data-rid="${f6.wB.runId}"]`),
       listB.innerHTML.slice(0, 100) + ' ## ' + sessB.innerHTML.slice(0, 60));
    ck('未命中运行(嵌入或独立都不)不显示', !listB.querySelector(`div[data-rid="${f6.wA.runId}"]`) && !sessB.querySelector(`div[data-rid="${f6.wA.runId}"]`));
    const gB = envB.$('gauges').querySelectorAll('.g');
    ck('过滤时 RUNS 显示 命中/总数', (gB[0].children[0].textContent || '').trim() === '1/3', gB.map(g => g.textContent).join(' | '));
  }

  // ── 6b) 搜索只命中会话 → 会话显示、运行被自身过滤(不嵌入),#list 走 NO MATCH 空态 ──
  const f7 = fixture();
  f7.s0.title = '特词Z 会话';
  const envC = load({ fetchFor: payload([f7.wA], [f7.s0]), localStorage: { 'wfo-fstr': '特词Z' } });
  await envC.flush();
  {
    const cCard = envC.$('sess').querySelector(`div[data-rid="${f7.s0.sessionId}"]`);
    ck('命中会话但未命中运行:运行不嵌入(会话卡在,无运行块)',
       !!cCard && !cCard.querySelector(`div.card[data-rid="${f7.wA.runId}"]`) && !envC.$('list').querySelector(`div[data-rid="${f7.wA.runId}"]`),
       cCard ? timeline(cCard).join(' ') : '会话卡缺失');
    ck('运行全被滤:#list 显示 NO MATCH 空态', !!envC.$('list').querySelector('.idle'), envC.$('list').innerHTML.slice(0, 80));
  }

  // ── 7) 回合数据空(步骤/输入全在尾窗外)但有发起运行:时间线仍成立,运行块不丢 ──
  const { s0: s2, wA: w2 } = fixture();
  s2.steps = []; s2.prompts = [];
  const envD = load({ fetchFor: payload([w2], [s2]) });
  await envD.flush();
  const dCard = envD.$('sess').querySelector(`div[data-rid="${s2.sessionId}"]`);
  ck('无步骤无输入的老会话:发起的 workflow 块仍嵌入可见', !!dCard && !!dCard.querySelector(`div.card[data-rid="${w2.runId}"]`),
     dCard ? dCard.children.map(c => c.className).join('|').slice(0, 200) : '会话卡缺失');

  done();
})();
