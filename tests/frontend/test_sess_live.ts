// 会话区标题「活跃 N」的口径(1.2.66 修):它必须与同一行的 vis(过滤后)同口径——
// 用户看不见的会话不该计进标题里的数字。旧实现用未过滤的 sess 求 live,项目过滤/搜索下
// 会出现「列表 1 张卡,标题却写 活跃 3」这类自相矛盾(与 1.2.38 仪表对账事故同一类)。
// 判定单点仍是 sessHit / sessStuck(20-render 侧的显示分级不动),此处只钉计数口径。
import { load, makeCk, SESSION_FIX } from './harness.ts';
const { ck, done } = makeCk();

const mk = (id: string, cwd: string, alive: boolean, title: string) => {
  const s = JSON.parse(JSON.stringify(SESSION_FIX));
  s.sessionId = id; s.cwd = cwd; s.project = cwd.replace(/\W+/g, '-'); s.alive = alive; s.title = title;
  s.status = alive ? 'waiting' : 'ended'; delete s.waitReason; s.subagents = []; s.steps = []; s.prompts = [];
  return s;
};

(async function main() {
  const sessions = [mk('11111111-1111-1111-1111-111111111111', '/work/fix', true, 'alpha run'),
    mk('22222222-2222-2222-2222-222222222222', '/work/nq', true, 'beta run'),
    mk('33333333-3333-3333-3333-333333333333', '/work/fix', false, 'gamma run')];
  const env = load({ fetchFor: (url: string) => url.indexOf('/api/runs') === 0
    ? { now: 1757000300, recentDays: 14, projects: ['/work/fix', '/work/nq'], runs: [] }
    : { now: 1757000300, sessions } });
  await env.flush();
  const tt = env.$('secttl');
  ck('会话卡落 DOM(3 张)', env.$('sess').children.length === 3, String(env.$('sess').children.length));
  ck('无过滤:标题=全部命中数 + 活跃总数', /3/.test(tt.textContent || '') && /活跃 2/.test(tt.textContent || ''), tt.innerHTML);

  // ① 项目过滤:只有卡片可见的那些会话参与计数(旧实现把 /work/nq 的活跃会话也算进来 → RED)
  env.run("fproj = '/work/fix'; renderAnchored()");
  await env.flush(2);
  ck('项目过滤:列表只剩该项目 2 张卡', env.$('sess').children.length === 2, String(env.$('sess').children.length));
  ck('项目过滤:活跃数按可见会话算(1,不是全集 2)',
     /2/.test(tt.textContent || '') && /活跃 1/.test(tt.textContent || '') && !/活跃 2/.test(tt.textContent || ''), tt.innerHTML);

  // ② 再切一档(参数化):另一个项目 → 1 张卡、活跃 1
  env.run("fproj = '/work/nq'; renderAnchored()");
  await env.flush(2);
  ck('切换项目:活跃数随可见集合走(1/1)', env.$('sess').children.length === 1 && /活跃 1/.test(tt.textContent || ''), tt.innerHTML);

  // ③ 搜索无命中:vis=0 → 标题为 0 且**不出现活跃后缀**(0 · 活跃 N 是旧实现的产物)
  env.run("fproj = ''; fstr = 'zzz-绝无匹配'; renderAnchored()");
  await env.flush(2);
  ck('搜索无命中:标题 0 且无活跃后缀(不再 0 · 活跃 2)', !/活跃/.test(tt.innerHTML) && /0\s*$/.test(tt.textContent || ''), tt.innerHTML);

  // ④ 搜索命中一个项目里的一个会话:活跃数=1
  env.run("fstr = 'beta'; renderAnchored()");
  await env.flush(2);
  ck('搜索命中:活跃数只数命中的那个', env.$('sess').children.length === 1 && /活跃 1/.test(tt.textContent || ''), tt.innerHTML);
  ck('全程无渲染异常', env.errs.length === 0, env.errs.join('|'));
  done();
})().catch((e: unknown) => { console.error('HARNESS CRASH:', e); process.exit(2); });
