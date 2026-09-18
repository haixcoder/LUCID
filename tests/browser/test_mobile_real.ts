// ── A8 移动端横向溢出(1.2.66 入库):390px 视口下 documentElement.scrollWidth 必须 ≤ clientWidth ──
// 为什么进浏览器套件:溢出是**布局引擎**产物(固定宽 666px 的 .tools 不换行、#fq 158px 写死、
// 会话卡 7 列网格),无头桩没有布局引擎,给不出 getBoundingClientRect/scrollWidth —— 只有真 Chrome 能证伪。
// 实测根因排序(逐层隐藏法,VB 取证):.tools(不换行) > #fq 固定宽 + #fproj max-width > 会话卡 .thead/.arow 网格。
// 夹具说明:临时 HOME 是空数据源(无会话),故会话卡由**真实渲染函数**用 /api/sessions 契约形状的对象驱动
// (renderAnchored() 走生产代码路径,不手写 HTML),并关掉 auto 防下一轮轮询把它冲掉。
import { findChrome, makeCk, sleep, startBrowser } from './harness.ts';

const { ck, done } = makeCk();

// 与 tests/frontend/harness.ts 的 SESSION_FIX 同形(/api/sessions 契约)。
const SESS = {
  sessionId: 'b2c3d4e5-f6a7-8901-abcd-ef0123456789', project: '-fixproj', cwd: '/work/fix', title: 'Golden Session With A Long Title',
  status: 'waiting', alive: true, pid: 4242, kind: 'interactive', version: '2.1.0', startedAt: 1757000000000,
  lastActivityAt: 1757000200000, ageSec: 77, model: 'claude-fable-5', stopReason: 'tool_use', permissionMode: 'default',
  tokens: { input: 100, output: 50, cacheRead: 9000, cacheWrite: 100 }, pendingTools: [], toolCalls: 6,
  lastPrompt: 'please continue', lastText: 'I need an answer to proceed with the golden fixture.', lastTextMid: 'msg_g1',
  prompts: [{ u: '11111111-2222-3333-4444-555555555555', t: 'golden prompt text', ts: '2026-09-05T04:00:00.000Z' }],
  turns: 2,
  steps: [{ msgId: 'msg_g1', turn: '11111111-2222-3333-4444-555555555555', tools: ['AskUserQuestion'], text: 'I need an answer', model: 'claude-fable-5', tokIn: 100, tokOut: 50, ts: '2026-09-05T04:00:01.000Z' }],
  subagents: [{ agentId: 'cafe1234', label: 'worker', agentType: 'general-purpose', description: 'do work', model: 'claude-haiku-4-5-20251001', kind: 'task', teamName: null, color: null, state: 'done', lastTool: 'Bash', pendingTools: [], toolCalls: 3, tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, lastActivityAt: 1757000150000, prompt: 'sub task', lastText: 'sub result' }],
};

async function main(): Promise<number> {
  const chromePath = findChrome();
  if (!chromePath) {
    console.log('! 未找到 Chrome:跳过移动端布局冒烟(设 CHROME=<可执行文件> 可指定)。');
    return 0;
  }
  let env: Awaited<ReturnType<typeof startBrowser>> | null = null;
  try {
    env = await startBrowser(chromePath);
    const cdp = env.cdp;
    const seeded = await cdp.eval(`(() => {
      auto = false; localStorage.setItem('wfo-auto', '0');      // 关轮询:夹具不被下一轮空载荷冲掉
      fproj = '/work/fix';                                      // 选中项目:入口按钮可见(顶栏最宽的一种排布)
      sess = [${JSON.stringify(SESS)}]; runs = []; renderAnchored();
      return { cards: document.querySelectorAll('#sess > div').length, header: !!document.querySelector('.thead'),
               btn: document.getElementById('btnFlow').hidden === false };
    })()`);
    ck('会话卡真实渲染(含 7 列表头 .thead → 移动端溢出的主嫌疑块在场)',
       seeded.cards === 1 && seeded.header === true && seeded.btn === true, JSON.stringify(seeded));

    const measure = async (w: number, h: number): Promise<any> => {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
      await sleep(350);
      return await cdp.eval(`(() => {
        const de = document.documentElement, cw = de.clientWidth;
        const over = [...document.querySelectorAll('body *')]
          .filter(e => e.getBoundingClientRect().right > cw + 1)
          .map(e => e.tagName + '.' + String(e.className || '').split(' ').slice(0, 2).join('.') + '@' + Math.round(e.getBoundingClientRect().right));
        return { sw: de.scrollWidth, cw, n: over.length, over: [...new Set(over)].slice(0, 6) };
      })()`);
    };

    const m390 = await measure(390, 844);
    ck('390px:无横向溢出(scrollWidth ≤ clientWidth)', m390.sw <= m390.cw, JSON.stringify(m390));
    // 顶栏的另一种态:B1 提示行可见(未选项目)—— 它是 .tools 里最长的一段文案,同样不许溢出
    const hintState = await cdp.eval(`(() => {
      fproj = ''; renderAnchored();
      const de = document.documentElement, h = document.getElementById('flowHint');
      const r = { sw: de.scrollWidth, cw: de.clientWidth, hintVisible: !!h && h.hidden === false };
      fproj = '/work/fix'; renderAnchored();          // 复原:后面几档接着量
      return r;
    })()`);
    ck('390px:提示行可见的顶栏态也不溢出', hintState.sw <= hintState.cw && hintState.hintVisible, JSON.stringify(hintState));
    const m360 = await measure(360, 844);
    ck('360px:无横向溢出(窄于 iPhone 12 一档的余量)', m360.sw <= m360.cw, JSON.stringify(m360));
    const m1280 = await measure(1280, 900);
    ck('1280px:无回归(桌面档不溢出)', m1280.sw <= m1280.cw, JSON.stringify(m1280));
    // 桌面档必须仍是**原 7 列网格**(移动端规则不得泄漏到大屏)
    const cols = await cdp.eval(`getComputedStyle(document.querySelector('.thead')).gridTemplateColumns.split(' ').length`);
    ck('1280px:会话表头仍是 7 列(移动端规则未泄漏到桌面)', cols === 7, String(cols));

    // 390px 下顶栏控件仍在视口内且可点(.tools 换行后不应把控件推出屏幕)
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(300);
    const tools = await cdp.eval(`(() => {
      const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right) }; };
      return { proj: r('#fproj'), fq: r('#fq'), btn: r('#btnFlow'), hook: r('#hookbtn'), cw: document.documentElement.clientWidth };
    })()`);
    ck('390px:顶栏筛选/搜索/按钮都在视口内(换行而非被推出去)',
       !!tools.proj && !!tools.fq && !!tools.hook
       && [tools.proj, tools.fq, tools.hook].every((x: any) => x.l >= 0 && x.r <= tools.cw + 1), JSON.stringify(tools));
    await cdp.send('Emulation.clearDeviceMetricsOverride');
  } catch (e) {
    ck('移动端布局冒烟跑通', false, String((e as Error)?.message ?? e));
  } finally {
    env?.close();
  }
  return done();
}

process.exit(await main());
