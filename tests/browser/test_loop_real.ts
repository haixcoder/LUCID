// ── 真实输入冒烟(1.2.55 · Phase 6):loop 的回边必须能用**真实鼠标**连出来 ──
// 回边 = 把循环体末节点连回 loop 节点(不需要专用 handle,用户直觉如此);它是这套图里唯一合法成环的边,
// 而"能不能拖出一条边"只有真实事件管线说了算(1.2.47 的教训:合成事件给假绿灯)。
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
    await cdp.eval(`(async () => {
      await openFlow('/smoke-proj');
      flowBlank(); FS.name = 'loop-real'; FS.cwd = '/smoke-proj';
      const sm = (type, x, y, data) => { const id = 'n' + (FS.next++); FS.nodes.push({ id, type, position: { x, y }, data }); return id; };
      sm('start', 60, 160, { note: 'q' });
      sm('loop', 300, 160, { label: 'L', cond: 'true', maxRounds: 3, budgetGuard: false });
      sm('agent', 560, 160, { label: 'A', phase: 'P', prompt: 'a' });
      sm('return', 820, 160, { ret: '' });
      // 先建好 start→loop、loop.body→A、loop.out→return,回边留给真实鼠标拖
      FS.edges.push({ id: 'e' + (FS.next++), source: 'n1', sourceHandle: 'out', target: 'n2', targetHandle: 'in' });
      FS.edges.push({ id: 'e' + (FS.next++), source: 'n2', sourceHandle: 'body', target: 'n3', targetHandle: 'in' });
      FS.edges.push({ id: 'e' + (FS.next++), source: 'n2', sourceHandle: 'out', target: 'n4', targetHandle: 'in' });
      flowRender();
      await new Promise((r) => setTimeout(r, 500)); fitFlowView(); await new Promise((r) => setTimeout(r, 500));
      return 1;
    })()`);
    const pos = await cdp.eval(`(() => {
      const q = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
      return { bodyEnd: q('.wfnode[data-nodeid="n3"] .lucid-flow__handle.source'),
               loopIn: q('.wfnode[data-nodeid="n2"] .lucid-flow__handle.target') };
    })()`);
    ck('体末出把与 loop 入把都拿到真实布局', !!pos.bodyEnd && !!pos.loopIn, JSON.stringify(pos));
    const e0 = await cdp.eval('FS.edges.length');
    await cdp.mouse('mouseMoved', pos.bodyEnd.x, pos.bodyEnd.y, 0);
    await cdp.mouse('mousePressed', pos.bodyEnd.x, pos.bodyEnd.y, 1);
    for (const k of [0.3, 0.7, 1]) { await cdp.mouse('mouseMoved', pos.bodyEnd.x + (pos.loopIn.x - pos.bodyEnd.x) * k, pos.bodyEnd.y + (pos.loopIn.y - pos.bodyEnd.y) * k, 1); await sleep(30); }
    await cdp.mouse('mouseReleased', pos.loopIn.x, pos.loopIn.y, 0);
    await sleep(250);
    const st = await cdp.eval('({ edges: FS.edges.length, last: FS.edges[FS.edges.length-1], d: fConnEl().getAttribute("d"), from: ffrom })');
    ck('真实拖拽建出回边(体末 → loop)', st.edges === e0 + 1 && st.last.source === 'n3' && st.last.target === 'n2', JSON.stringify(st.last));
    ck('回边建完后手势干净结束(不留虚线/不残留起点)', !st.d && st.from === null, JSON.stringify(st));
    // 回边是唯一的合法成环边:校验必须放行整张图(而不是报"图中存在环")
    const v = await cdp.eval('JSON.stringify(flowValidate(flowDraft()))');
    ck('整图校验通过(回边被识别为循环而非非法环)', JSON.parse(v).length === 0, v);
  } catch (e) {
    ck('真实输入冒烟跑通', false, String((e as Error)?.message ?? e));
  } finally {
    env?.close();
  }
  return done();
}

process.exit(await main());
