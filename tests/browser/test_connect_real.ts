// ── 真实输入冒烟(1.2.47 入库):用 CDP Input.dispatchMouseEvent 走浏览器**真实事件管线**(与 puppeteer 同路径)──
// 为什么必须存在:页面内 dispatchEvent 的合成事件**绕过浏览器的 pointer→mouse 兼容事件派生**,会给出
// "合成事件全绿、真机全坏"的假绿灯 —— 1.2.47 的「连线不收尾」就是这么漏掉的(我们在 pointerdown 里
// preventDefault,Chrome 便不再派发 mousedown/mousemove/mouseup,而 vendor 的拖拽全靠它们)。
// 断言的是**连线全链路**:拖拽期间虚线已跟手且钉在光标上 → 松手即建边并清线 → 松手后再动鼠标不得复活。
// 脚手架(CDP/临时服务/断言)在 ./harness.ts,与 test_drag_real.ts 共用。
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

    // 固定四节点链(与 ?flowsmoke 同一张图:横向排开,handle 必在视口内)
    await cdp.eval(`(async () => {
      await openFlow('/smoke-proj');
      flowBlank(); FS.name = 'real-input'; FS.cwd = '/smoke-proj';
      const sm = (type, x, y, data) => { const id = 'n' + (FS.next++); FS.nodes.push({ id, type, position: { x, y }, data }); return id; };
      sm('start', 60, 150, { note: 'q' }); sm('agent', 300, 150, { label: 'A', phase: 'P', prompt: 'a' });
      sm('agent', 540, 150, { label: 'B', phase: 'P', prompt: 'b' }); sm('return', 780, 150, { ret: '' });
      flowRender();
      await new Promise((r) => setTimeout(r, 500)); fitFlowView(); await new Promise((r) => setTimeout(r, 500));
      return 1;
    })()`);
    const pos = await cdp.eval(`(() => {
      const q = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
      return { s: q('.wfnode[data-nodeid="n1"] .lucid-flow__handle.source'), t: q('.wfnode[data-nodeid="n2"] .lucid-flow__handle.target') };
    })()`);
    const e0 = await cdp.eval('FS.edges.length');
    const p0 = await cdp.eval('JSON.stringify(FS.nodes.find(n => n.id === "n1").position)');
    ck('真实输入:起点/终点 handle 都拿到真实布局', !!pos.s && !!pos.t && e0 === 0, JSON.stringify([pos, e0]));

    // 真实拖拽(n1 的 source → n2 的 target),中途先验"虚线已跟手"
    await cdp.mouse('mouseMoved', pos.s.x, pos.s.y, 0);
    await cdp.mouse('mousePressed', pos.s.x, pos.s.y, 1);
    for (const k of [0.3, 0.6, 1]) {
      await cdp.mouse('mouseMoved', pos.s.x + (pos.t.x - pos.s.x) * k, pos.s.y + (pos.t.y - pos.s.y) * k, 1);
      await sleep(30);
    }
    // 拖拽**进行中**:虚线必须已经画出来,且自由端钉在光标上(屏幕坐标)
    const midState = await cdp.eval(`(() => {
      const pr = fPane().getBoundingClientRect(), v = FS.view, d = String(fConnEl().getAttribute('d') || '');
      const n = d.match(/-?\\d+(?:\\.\\d+)?/g) || [];
      return { d, tx: Number(n[n.length - 2]), ty: Number(n[n.length - 1]), v,
               mx: ${pos.t.x} - pr.left, my: ${pos.t.y} - pr.top };
    })()`);
    ck('拖拽期间虚线已跟手(合成事件测不到:vendor 靠 document mousemove 驱动)',
       !!midState.d, JSON.stringify(midState.d).slice(0, 60));
    ck('拖拽期间自由端钉在光标上(屏幕坐标,1.2.46 换算口径)',
       Math.abs(midState.v.x + midState.tx * midState.v.zoom - midState.mx) < 2
       && Math.abs(midState.v.y + midState.ty * midState.v.zoom - midState.my) < 2,
       JSON.stringify([midState.v, midState.tx, midState.ty, midState.mx, midState.my]));

    // 松手在目标 handle 上:必须建边 + 清线 + 手势结束
    await cdp.mouse('mouseReleased', pos.t.x, pos.t.y, 0);
    await sleep(250);
    const after = await cdp.eval(`({ edges: FS.edges.length, d: fConnEl().getAttribute('d'), from: ffrom,
      paths: document.querySelectorAll('#fEdges path.e').length })`);
    ck('松手即建边(真实 mouseup 驱动 onConnect)', after.edges === 1, JSON.stringify(after));
    ck('松手即清线且手势结束(这正是「连线没有结束」的反例)', !after.d && after.from === null, JSON.stringify(after));
    ck('新边已渲染进 #fEdges', after.paths === 1, String(after.paths));
    // 去掉 pointerdown 的 preventDefault 后 mousedown 会重新派发:必须确认 d3-drag 的 nodrag 过滤真的拦住了
    // "从 handle 按下"这件事(否则拖连线会把节点一起拖走)
    const p1 = await cdp.eval('JSON.stringify(FS.nodes.find(n => n.id === "n1").position)');
    ck('从 handle 拖连线不会把节点拖走(nodrag 过滤在真实 mousedown 下生效)', p0 === p1, p0 + ' → ' + p1);

    // 松手后再动鼠标:不许复活任何连线手势(用户症状的最直接判据)
    await cdp.mouse('mouseMoved', pos.t.x + 320, pos.t.y + 240, 0);
    await sleep(150);
    const after2 = await cdp.eval(`({ d: fConnEl().getAttribute('d'), from: ffrom, edges: FS.edges.length })`);
    ck('松手后动鼠标:虚线不得复活(手势真的结束了)', !after2.d && after2.from === null && after2.edges === 1, JSON.stringify(after2));
  } catch (e) {
    ck('真实输入冒烟跑通', false, String((e as Error)?.message ?? e));
  } finally {
    env?.close();
  }
  return done();
}

process.exit(await main());
