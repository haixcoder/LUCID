// 交接工作流的等待显示契约(1.2.42,真实反馈:「提示等待授权,实际上主 agent 已将任务交给工作流在执行」):
//  · status=running + waitReason=workflow → 徽标"等待 workflow 执行",用 running 活动样式(b-running),
//    绝不渲染成 permission(⏸ 告警 b-input_required / 卡面 .wait / 计入 ⏸ 等待数 / 等待推送都依赖 sessStuck)。
//  · 只有"该你动手"的 ask/permission 才进 ⏸ 计数;workflow 交回后台执行不算卡住。
//  · 对照:permission 会话仍照旧显示"等待授权"且计入 ⏸(证明本修复没顺手改坏 permission 启发式)。
// 判定住后端 main_state 单点,前端只做展示与高亮。
import { load, makeCk, payload, SESSION_FIX } from './harness.ts';
const { ck, done } = makeCk();

(async function main() {
  const badgeOf = (card: any) => card.querySelector('.hd .b');

  // ① 交接工作流:running + waitReason=workflow
  const wSid = 'e5f6a7b8-0000-1111-2222-333344445555';
  const w = JSON.parse(JSON.stringify(SESSION_FIX));
  Object.assign(w, { sessionId: wSid, status: 'running', alive: true, waitReason: 'workflow',
                     waitTool: 'Workflow', pendingTools: ['Workflow'], permissionMode: 'default', stopReason: 'tool_use' });
  let env = load({ fetchFor: payload([], [w]) });
  await env.flush();
  ck('boot 无 JS 异常', env.errs.length === 0, env.errs.join(' | '));
  const wCard = env.$('sess').querySelector(`div.card[data-rid="${wSid}"]`)!;
  const wBadge = badgeOf(wCard);
  ck('徽标文案=等待 workflow 执行(不再是"等待授权")', wBadge.textContent === '等待 workflow 执行', wBadge.textContent);
  ck('徽标用 running 活动样式,非 ⏸ 告警的 b-input_required', wBadge.classList.contains('b-running') && !wBadge.classList.contains('b-input_required'), wBadge.getAttribute('class'));
  ck('卡面不带 .wait(未算真卡住,不反白闪烁告警)', !wCard.classList.contains('wait'), wCard.getAttribute('class'));
  ck('不占 ⏸ 等待计数(仪表/区标题都不数它)', !env.$('secttl').textContent.includes('⏸') && env.$('secttl').textContent.includes('活跃'), env.$('secttl').textContent);

  // ② 对照:permission(挂起普通工具 + 静默)仍照旧 —— 边界最小,没顺手改坏
  const pSid = 'c9d8e7f6-0000-1111-2222-333344445555';
  const p = JSON.parse(JSON.stringify(SESSION_FIX));
  Object.assign(p, { sessionId: pSid, status: 'input_required', alive: true, waitReason: 'permission',
                     waitTool: 'Bash', pendingTools: ['Bash'], stopReason: 'tool_use' });
  env = load({ fetchFor: payload([], [p]) });
  await env.flush();
  const pBadge = badgeOf(env.$('sess').querySelector(`div.card[data-rid="${pSid}"]`)!);
  ck('对照:permission 仍显示"等待授权"', pBadge.textContent === '等待授权', pBadge.textContent);
  ck('对照:permission 走 ⏸ 告警样式且计入 ⏸ 数', pBadge.classList.contains('b-input_required') && env.$('secttl').textContent.includes('⏸'), pBadge.getAttribute('class') + ' | ' + env.$('secttl').textContent);

  // ③ 对照:普通 running(无 workflow 交接)徽标仍是 RUNNING,未被牵连改动
  const rSid = 'aa11bb22-0000-1111-2222-333344445555';
  const rn = JSON.parse(JSON.stringify(SESSION_FIX));
  Object.assign(rn, { sessionId: rSid, status: 'running', alive: true, waitReason: null, waitTool: null, pendingTools: ['Read'] });
  env = load({ fetchFor: payload([], [rn]) });
  await env.flush();
  ck('对照:普通 running 徽标仍 RUNNING(不误挂 workflow 文案)',
     badgeOf(env.$('sess').querySelector(`div.card[data-rid="${rSid}"]`)!).textContent === 'RUNNING', badgeOf(env.$('sess').querySelector(`div.card[data-rid="${rSid}"]`)!).textContent);
  ck('全程无渲染异常', env.errs.length === 0, env.errs.join(' | '));
  done();
})().catch((e: unknown) => { console.error('HARNESS CRASH:', e); process.exit(2); });
