// TASKS 仪表窗口口径(1.2.36):用户报「执行任务的总次数又显示错误」——
// 旧仪表=视图内会话 turns 之和,而视图只含「活跃+近 2h」(实测窗口真相 151 只显 5);
// 新口径:总数=tasks.total(回看窗口全部会话精确计数),仅项目过滤=byCwd 命中/总,含搜索=视图命中/窗口总。
// 无 tasks 字段的旧载荷 → 回落视图和(兼容,不冒充窗口口径)。
import { load, makeCk, RUN_DONE, RUN_LIVE, SESSION_FIX } from './harness.ts';
const { ck, done } = makeCk();

(async function main() {
  const runs = [JSON.parse(JSON.stringify(RUN_DONE)), JSON.parse(JSON.stringify(RUN_LIVE))];
  const sessions = [JSON.parse(JSON.stringify(SESSION_FIX))];  // turns=2
  let tasks: any = { total: 151, byCwd: { '/work/fix': 9, '/work/nq': 142 } };
  const fetchFor = (url: string) => {
    if (url.indexOf('/api/runs') === 0) return { now: 1757000300, recentDays: 180, projects: [], tasks, runs };
    return { now: 1757000300, sessions };
  };
  const env = load({ fetchFor });
  await env.flush();
  for (let i = 0; i < 2; i++) { env.run('void tick()'); await env.flush(); }
  let g = env.$('gauges').innerHTML;
  ck('无过滤:TASKS=回看窗口总数(非视图和 2)', /<b>151<\/b><span>TASKS/.test(g), g.slice(0, 260));

  // 仅项目过滤 → byCwd 命中/窗口总数(命中精确到全部会话,不只视图)
  env.run(`fproj = '/work/nq'; localStorage.setItem('wfo-fproj', '/work/nq'); renderAnchored()`);
  await env.flush(2);
  g = env.$('gauges').innerHTML;
  ck('项目过滤:TASKS=byCwd 命中/窗口总数', /<b>142\/151<\/b><span>TASKS/.test(g), g.slice(0, 280));

  // 搜索过滤(命中只能来自视图会话)→ 视图命中/窗口总数
  env.run(`fproj = ''; localStorage.setItem('wfo-fproj', ''); fstr = 'golden'; renderAnchored()`);
  await env.flush(2);
  g = env.$('gauges').innerHTML;
  ck('搜索过滤:TASKS=视图命中/窗口总数', /<b>2\/151<\/b><span>TASKS/.test(g), g.slice(0, 280));

  // 过滤键在 byCwd 里没有 → 0/total(不许回落成纯视图数)
  env.run(`fstr = ''; localStorage.setItem('wfo-fstr', ''); fproj = '/work/none'; renderAnchored()`);
  await env.flush(2);
  g = env.$('gauges').innerHTML;
  ck('项目无任务记录:0/总数', /<b>0\/151<\/b><span>TASKS/.test(g), g.slice(0, 280));

  // 会话卡顶行文案:「任务 N」(全量精确,不再是尾窗口径)——先清过滤,卡回到视图
  env.run(`fproj = ''; localStorage.setItem('wfo-fproj', ''); renderAnchored()`);
  await env.flush(2);
  const card = env.$('sess').children[0];
  ck('卡顶行展示「任务 N」且不再写「尾窗任务」',
     card && (card.textContent || '').includes('任务 2') && !(card.textContent || '').includes('尾窗任务'),
     card ? (card.textContent || '').slice(0, 160) : 'no card');

  // 旧载荷无 tasks 字段 → 回落视图和,不崩
  const env2 = load({ fetchFor: (url) => url.indexOf('/api/runs') === 0
    ? { now: 1757000300, recentDays: 180, runs } : { now: 1757000300, sessions } });
  await env2.flush();
  for (let i = 0; i < 2; i++) { env2.run('void tick()'); await env2.flush(); }
  ck('无 tasks 字段(旧后端兼容):回落视图和 2', /<b>2<\/b><span>TASKS/.test(env2.$('gauges').innerHTML),
     env2.errs.join('|') + ' ' + env2.$('gauges').innerHTML.slice(0, 160));

  done();
})().catch((e: unknown) => { console.error('HARNESS CRASH:', e); process.exit(2); });
