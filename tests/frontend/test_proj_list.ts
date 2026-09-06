// 项目选择列表(#fproj)契约(1.2.35):
//  · 选项 = 后端 /api/runs 的 projects(回看窗口内有活动的【全部】项目,含无 workflow 运行的纯会话项目)
//    ∪ runs/sessions 数据键(cwd||project)——真实反馈:窗口设 180 天,下拉仍只列"有运行"的项目,总数不对;
//  · 重建判定按【内容】而非数量——数量相同、集合不同(窗口滑动/项目一进一出)必须重建,否则下拉陈旧;
//  · 同串不重建(轮询稳定);已保存 fproj 不在数据源 → 回落全部项目;旧载荷无 projects 字段不破页。
import { load, makeCk } from './harness.ts';
const { ck, done } = makeCk();

(async function main() {
  const RUN_FIX = { runId: 'wf_a', project: '-fixproj', session: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
    cwd: '/work/fix', name: 'n', status: 'completed', live: false, agents: [], phases: [], logs: [] };
  let projs = ['/work/fix', '/work/nq', '/work/pager'];
  const fetchFor = (url: string) => {
    if (url.indexOf('/api/runs') === 0) return { now: 1757000300, recentDays: 180, projects: projs, runs: [RUN_FIX] };
    return { now: 1757000300, sessions: [] };
  };
  const env = load({ fetchFor });
  await env.flush();
  const sel = env.$('fproj');
  const optVals = () => sel.options.map(o => o.value).join(',');
  ck('下拉含纯会话项目(数据源=projects,不再只认有运行的项目)',
     sel.options.length === 4 && optVals().includes('/work/nq') && optVals().includes('/work/pager'),
     sel.options.length + ':' + optVals());
  ck('runs 键与 projects 重合时去重(/work/fix 只出现一次)', optVals().split('/work/fix').length === 2, optVals());
  const node1 = sel.options[1];
  env.run('void tick()');
  await env.flush();
  ck('同载荷轮询不重建下拉(节点身份保持)', sel.options.length === 4 && sel.options[1] === node1);

  // 数量相同、集合不同(pager 出窗、tank 进窗)→ 必须重建(旧"数量差"判定会留下陈旧选项)
  projs = ['/work/fix', '/work/nq', '/work/tank'];
  env.run('void tick()');
  await env.flush();
  const v = optVals();
  ck('数量相同但集合变化 → 重建,陈旧项消失新项出现', sel.options.length === 4 && !v.includes('pager') && v.includes('tank'), v);

  // 已保存筛选不在数据源 → 回落(既有不变量,新数据源下仍成立)
  env.run(`fproj = '/work/gone'; localStorage.setItem('wfo-fproj', '/work/gone'); void tick()`);
  await env.flush();
  ck('fproj 不在列表 → 回落全部项目',
     env.get('fproj') === '' && env.get("localStorage.getItem('wfo-fproj')") === '', String(env.get('fproj')));

  // 老后端载荷无 projects 字段 → 不炸,下拉来自 runs/sessions
  const env2 = load({ fetchFor: (url) => url.indexOf('/api/runs') === 0
    ? { now: 1757000300, recentDays: 180, runs: [RUN_FIX] } : { now: 1757000300, sessions: [] } });
  await env2.flush();
  ck('载荷无 projects(兼容旧响应):不异常,下拉仍含 runs 项目',
     env2.errs.length === 0 && env2.$('fproj').options.length === 2, env2.errs.join('|') + ' n=' + env2.$('fproj').options.length);

  done();
})().catch((e: unknown) => { console.error('HARNESS CRASH:', e); process.exit(2); });
