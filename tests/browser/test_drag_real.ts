// ── 真实输入冒烟·拖拽节点(1.2.49 入库)──
// 真实反馈:「在 agent 编排时拖拽节点会漂移」。根因是**派生缓存不新鲜**:applyDrag 原地改 n.position,
// 而 vendor 的 adoptUserNodes 默认 checkEquality=true —— 同一个对象引用被判"没变"而沿用旧 internals,
// 于是下一次拖拽的基线仍是旧坐标,节点在第一次移动时整体跳回上一次的位移量(拖得越远跳得越狠)。
// 这类 bug **合成事件测不出**(它照样走 vendor 的数学,只是基线来自真实的 lookup 缓存),必须真机。
// 断言:① 第一次拖拽跟手;② 松手后 internals.positionAbsolute == 节点真值(直接钉根因);
//       ③ 第二次拖拽不得跳变(用户症状的最直接判据);④ 拖过之后再连线仍能建边。
import { findChrome, makeCk, sleep, startBrowser } from './harness.ts';

const { ck, done } = makeCk();

async function main(): Promise<number> {
  const chromePath = findChrome();
  if (!chromePath) {
    console.log('! 未找到 Chrome:跳过拖拽真实输入冒烟(设 CHROME=<可执行文件> 可指定)。');
    return 0;
  }
  let env: Awaited<ReturnType<typeof startBrowser>> | null = null;
  try {
    env = await startBrowser(chromePath);
    const cdp = env.cdp;

    // 固定两节点图 + 固定视口(非 1 倍缩放 + 平移:漂移只在变换非恒等时按比例放大,便于判定)
    await cdp.eval(`(async () => {
      await openFlow('/smoke-proj');
      flowBlank(); FS.name = 'drag-real'; FS.cwd = '/smoke-proj';
      const sm = (type, x, y, data) => { const id = 'n' + (FS.next++); FS.nodes.push({ id, type, position: { x, y }, data }); return id; };
      sm('start', 60, 150, { note: 'q' }); sm('agent', 300, 150, { label: 'A', phase: 'P', prompt: 'a' });
      sm('agent', 640, 150, { label: 'B', phase: 'P', prompt: 'b' }); sm('return', 900, 150, { ret: '' });
      flowRender();
      await new Promise((r) => setTimeout(r, 500));
      FS.view = { x: -120, y: 45, zoom: 1.5 };
      fVp().style.transform = 'translate(-120px,45px) scale(1.5)';
      fpz?.setViewport(FS.view);
      await new Promise((r) => setTimeout(r, 300));
      return 1;
    })()`);

    const snap = async (): Promise<any> => await cdp.eval(`(() => {
      const el = document.querySelector('.wfnode[data-nodeid="n2"]'), r = el.getBoundingClientRect();
      const n = FS.nodes.find(x => x.id === 'n2'), it = flookup.get('n2');
      return { pos: { ...n.position }, rx: r.left, ry: r.top, w: r.width,
               abs: it && it.internals.positionAbsolute ? { ...it.internals.positionAbsolute } : null };
    })()`);

    // 真实拖拽:20 步 × (3,2) 屏幕像素;每步采样节点屏幕位置
    const runDrag = async (label: string): Promise<{ before: any; after: any; worst: number }> => {
      const before = await snap();
      const gx = before.rx + 40, gy = before.ry + 12;          // 卡片标题区(避开 nodrag 的输入控件与 ✕)
      const steps = 20, dx = 3, dy = 2;
      await cdp.mouse('mouseMoved', gx, gy, 0);
      await cdp.mouse('mousePressed', gx, gy, 1);
      let worst = 0;
      for (let i = 1; i <= steps; i++) {
        await cdp.mouse('mouseMoved', gx + (dx * i), gy + (dy * i), 1);
        await sleep(25);
        const s = await snap();
        // 跟手判据:节点屏幕位置相对拖前的位移,应与鼠标位移一致(阈值基线允许一个步长量级的恒定滞后)
        worst = Math.max(worst, Math.abs((s.rx - before.rx) - dx * i), Math.abs((s.ry - before.ry) - dy * i));
      }
      await cdp.mouse('mouseReleased', gx + dx * steps, gy + dy * steps, 0);
      await sleep(250);
      return { before, after: await snap(), worst };
    };

    const d1 = await runDrag('第一次');
    ck('第一次拖拽跟手(真实输入;屏幕位移与鼠标一致)', d1.worst <= 8, '最大偏差 ' + d1.worst.toFixed(1) + 'px');
    ck('松手后 internals.positionAbsolute 与节点真值一致(根因:派生缓存必须刷新)',
       !!d1.after.abs && Math.abs(d1.after.abs.x - d1.after.pos.x) < 0.01 && Math.abs(d1.after.abs.y - d1.after.pos.y) < 0.01,
       JSON.stringify([d1.after.abs, d1.after.pos]));

    const d2 = await runDrag('第二次');
    ck('第二次拖拽不跳变(用户症状:拖过一次后再拖,节点会跳回上一次的位移量)',
       d2.worst <= 8, '最大偏差 ' + d2.worst.toFixed(1) + 'px');
    ck('第二次拖拽确实移动了(不是"没动所以不跳")',
       Math.abs(d2.after.pos.x - d2.before.pos.x) > 10, JSON.stringify([d2.before.pos, d2.after.pos]));

    // 拖过之后连线仍可用(vendor 的最近 handle 搜索也读 positionAbsolute)
    const pos = await cdp.eval(`(() => {
      const q = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
      return { s: q('.wfnode[data-nodeid="n2"] .lucid-flow__handle.source'), t: q('.wfnode[data-nodeid="n3"] .lucid-flow__handle.target') };
    })()`);
    const e0 = await cdp.eval('FS.edges.length');
    await cdp.mouse('mouseMoved', pos.s.x, pos.s.y, 0);
    await cdp.mouse('mousePressed', pos.s.x, pos.s.y, 1);
    for (const k of [0.4, 0.8, 1]) {
      await cdp.mouse('mouseMoved', pos.s.x + (pos.t.x - pos.s.x) * k, pos.s.y + (pos.t.y - pos.s.y) * k, 1);
      await sleep(30);
    }
    await cdp.mouse('mouseReleased', pos.t.x, pos.t.y, 0);
    await sleep(250);
    ck('拖过的节点仍能正常连线(同一根因的第二症状:吸附读的也是 positionAbsolute)',
       await cdp.eval('FS.edges.length') === e0 + 1, String(await cdp.eval('FS.edges.length')));
  } catch (e) {
    ck('拖拽真实输入冒烟跑通', false, String((e as Error)?.message ?? e));
  } finally {
    env?.close();
  }
  return done();
}

process.exit(await main());
