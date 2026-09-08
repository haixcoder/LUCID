// ── 真实输入冒烟(1.2.54 · Phase 5):branch 的 true/false 双出把必须能用**真实鼠标**各连一条边 ──
// 为什么不能只靠无头桩:双把手的错位是 CSS(top:26%/72%)决定的,桩没有布局引擎,量不出"两个圆点分得开";
// 而 vendor 的 handle 命中靠 elementFromPoint 与手写测量的 handleBounds——只有真浏览器能给真实坐标。
// 顺带钉住:从第二个出把(true/false 里的一个)拖连线时,起点 handleId 必须被正确带上。
import { findChrome, makeCk, sleep, startBrowser } from './harness.ts';

const { ck, done } = makeCk();

async function main(): Promise<number> {
  const chromePath = findChrome();
  if (!chromePath) {
    console.log('! 未找到 Chrome:跳过真实输入冒烟(设 CHROME=<可执行文件> 可指定)。');
    return 0;
  }
  let env: Awaited<ReturnType<typeof startBrowser>> | null = null;
  try {
    env = await startBrowser(chromePath);
    const cdp = env.cdp;
    // 固定四节点:start → branch → (true) A / (false) B(两个分支先各自悬空,只验建边)
    await cdp.eval(`(async () => {
      await openFlow('/smoke-proj');
      flowBlank(); FS.name = 'branch-real'; FS.cwd = '/smoke-proj';
      const sm = (type, x, y, data) => { const id = 'n' + (FS.next++); FS.nodes.push({ id, type, position: { x, y }, data }); return id; };
      sm('start', 60, 160, { note: 'q' });
      sm('branch', 300, 160, { label: 'B', cond: 'true' });
      sm('agent', 560, 60, { label: 'A', phase: 'P', prompt: 'a' });
      sm('agent', 560, 260, { label: 'C', phase: 'P', prompt: 'c' });
      flowRender();
      await new Promise((r) => setTimeout(r, 500)); fitFlowView(); await new Promise((r) => setTimeout(r, 500));
      return 1;
    })()`);
    const pos = await cdp.eval(`(() => {
      const q = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
      return { t: q('.wfnode[data-nodeid="n2"] .lucid-flow__handle.h-true'),
               f: q('.wfnode[data-nodeid="n2"] .lucid-flow__handle.h-false'),
               a: q('.wfnode[data-nodeid="n3"] .lucid-flow__handle.target'),
               c: q('.wfnode[data-nodeid="n4"] .lucid-flow__handle.target') };
    })()`);
    ck('两个出把都拿到真实布局且**上下分开**(重叠的话 elementFromPoint 只能命中一个)',
       !!pos.t && !!pos.f && Math.abs(pos.t.y - pos.f.y) > 20, JSON.stringify([pos.t, pos.f]));

    const drag = async (from: any, to: any): Promise<void> => {
      await cdp.mouse('mouseMoved', from.x, from.y, 0);
      await cdp.mouse('mousePressed', from.x, from.y, 1);
      for (const k of [0.3, 0.7, 1]) { await cdp.mouse('mouseMoved', from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, 1); await sleep(30); }
      await cdp.mouse('mouseReleased', to.x, to.y, 0);
      await sleep(250);
    };
    await drag(pos.t, pos.a);
    const e1 = await cdp.eval('JSON.stringify(FS.edges)');
    ck('true 出把真实拖拽建边,sourceHandle 记为 true',
       JSON.parse(e1).length === 1 && JSON.parse(e1)[0].sourceHandle === 'true' && JSON.parse(e1)[0].target === 'n3', e1);
    await drag(pos.f, pos.c);
    const e2 = await cdp.eval('JSON.stringify(FS.edges)');
    ck('false 出把真实拖拽建边,sourceHandle 记为 false(两个把手各连各的,不串)',
       JSON.parse(e2).length === 2 && JSON.parse(e2)[1].sourceHandle === 'false' && JSON.parse(e2)[1].target === 'n4', e2);
    ck('连完之后手势干净结束(不留虚线/不残留起点)',
       await cdp.eval('(!fConnEl().getAttribute("d") && ffrom === null)') === true);
  } catch (e) {
    ck('真实输入冒烟跑通', false, String((e as Error)?.message ?? e));
  } finally {
    env?.close();
  }
  return done();
}

process.exit(await main());
