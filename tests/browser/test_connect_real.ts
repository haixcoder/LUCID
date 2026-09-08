// ── 真实输入冒烟(1.2.47 入库):用 CDP Input.dispatchMouseEvent 走浏览器**真实事件管线**(与 puppeteer 同路径)──
// 为什么必须存在:页面内 dispatchEvent 的合成事件**绕过浏览器的 pointer→mouse 兼容事件派生**,会给出
// "合成事件全绿、真机全坏"的假绿灯 —— 1.2.47 的「连线不收尾」就是这么漏掉的(我们在 pointerdown 里
// preventDefault,Chrome 便不再派发 mousedown/mousemove/mouseup,而 vendor 的拖拽全靠它们)。
// 断言的是**交互全链路**:拖拽期间虚线已跟手且钉在光标上 → 松手即建边并清线 → 松手后再动鼠标不得复活。
// 需要 Chrome + node ≥22(全局 WebSocket);缺 Chrome 时跳过并警示(与 typecheck 缺 node_modules 同规矩)。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const FAILS: string[] = [];
function ck(name: string, cond: unknown, detail?: unknown): void {
  const ok = !!cond;
  if (!ok) FAILS.push(name);
  console.log((ok ? '✓ ' : '✗ ') + name + (detail === undefined ? '' : '  ← ' + String(detail)));
}

function findChrome(): string {
  const cands = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const c of cands) { if (c && fs.existsSync(c)) return c; }
  return '';
}

async function httpJson(url: string): Promise<any> {
  const r = await fetch(url);
  return await r.json();
}
async function waitHttp(url: string, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return true; } catch { /* 还没起来 */ }
    await sleep(200);
  }
  return false;
}

// 极简 CDP 客户端:Node 22 自带全局 WebSocket,不需要 puppeteer 这类第三方依赖(本仓零依赖)
class Cdp {
  ws: WebSocket; seq = 0; pending = new Map<number, (m: any) => void>();
  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (e: MessageEvent) => {
      const m = JSON.parse(String(e.data));
      const p = this.pending.get(m.id);
      if (p) { this.pending.delete(m.id); p(m); }
    };
  }
  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = ++this.seq;
    return new Promise((res) => { this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expr: string): Promise<any> {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result?.result?.value;
  }
  async mouse(type: string, x: number, y: number, buttons: number): Promise<void> {
    await this.send('Input.dispatchMouseEvent', {
      type, x, y, button: (buttons || type === 'mouseReleased') ? 'left' : 'none', buttons,
      clickCount: (buttons || type === 'mouseReleased') ? 1 : 0,
    });
  }
}

async function main(): Promise<number> {
  const chromePath = findChrome();
  if (!chromePath) {
    console.log('! 未找到 Chrome:跳过真实输入冒烟(设 CHROME=<可执行文件> 可指定)。');
    return 0;
  }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-browser-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-chrome-'));
  let server: any = null, chrome: any = null, cdp: Cdp | null = null;
  const kill = (p: any): void => { try { if (p) p.kill('SIGKILL'); } catch { /* 已退出 */ } };
  try {
    // ① 临时 HOME 起服务(不碰真实 pid/config/草稿)
    const port = 8900 + Math.floor(Math.random() * 400);
    fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
    fs.mkdirSync(path.join(home, '.claude', 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(home, '.claude', 'cc-viewer'), { recursive: true });
    server = spawn('python3', [path.join(REPO, 'scripts', 'server.py'), '--port', String(port)],
      { env: { ...process.env, HOME: home }, stdio: 'ignore' });
    if (!await waitHttp(`http://127.0.0.1:${port}/api/runs`, 15000)) throw new Error('临时服务未起来');

    // ② Chrome(headless + 调试端口;--proxy-server 让外网字体快速失败,页面 load 不被拖住)
    const dbg = 9200 + Math.floor(Math.random() * 500);
    chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--window-size=1600,1000',
      `--user-data-dir=${profile}`, `--remote-debugging-port=${dbg}`, '--proxy-server=http://127.0.0.1:1',
      '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
    if (!await waitHttp(`http://127.0.0.1:${dbg}/json/list`, 20000)) throw new Error('Chrome 调试端口未就绪');
    const page = (await httpJson(`http://127.0.0.1:${dbg}/json/list`)).find((t: any) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    cdp = new Cdp(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    for (let i = 0; i < 50 && !await cdp.eval("typeof openFlow === 'function'"); i++) await sleep(200);

    // ③ 固定四节点链(与 ?flowsmoke 同一张图:横向排开,handle 必在视口内)
    await cdp.eval(`(async () => {
      await openFlow('/smoke-proj');
      flowBlank(); FS.name = 'real-input'; FS.cwd = '/smoke-proj';
      const sm = (type, x, y, data) => { const id = 'n' + (FS.next++); FS.nodes.push({ id, type, position: { x, y }, data }); return id; };
      const s = sm('start', 60, 150, { note: 'q' }), a = sm('agent', 300, 150, { label: 'A', phase: 'P', prompt: 'a' });
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

    // ④ 真实拖拽(n1 的 source → n2 的 target),中途先验"虚线已跟手"
    await cdp.mouse('mouseMoved', pos.s.x, pos.s.y, 0);
    await cdp.mouse('mousePressed', pos.s.x, pos.s.y, 1);
    const mid = { x: (pos.s.x + pos.t.x) / 2, y: (pos.s.y + pos.t.y) / 2 };
    for (const k of [0.3, 0.6, 1]) {
      await cdp.mouse('mouseMoved', pos.s.x + (pos.t.x - pos.s.x) * k, pos.s.y + (pos.t.y - pos.s.y) * k, 1);
      await sleep(30);
    }
    // 拖拽**进行中**:虚线必须已经画出来,且自由端钉在光标上(屏幕坐标)
    const midState = await cdp.eval(`(() => {
      const pr = fPane().getBoundingClientRect(), v = FS.view, d = String(fConnEl().getAttribute('d') || '');
      const n = d.match(/-?\\d+(?:\\.\\d+)?/g) || [];
      return { d, tx: Number(n[n.length - 2]), ty: Number(n[n.length - 1]), v,
               mx: ${pos.s.x + (pos.t.x - pos.s.x)} - pr.left, my: ${pos.s.y + (pos.t.y - pos.s.y)} - pr.top };
    })()`);
    ck('拖拽期间虚线已跟手(合成事件测不到:vendor 靠 document mousemove 驱动)',
       !!midState.d, JSON.stringify(midState.d).slice(0, 60));
    ck('拖拽期间自由端钉在光标上(屏幕坐标,1.2.46 换算口径)',
       Math.abs(midState.v.x + midState.tx * midState.v.zoom - midState.mx) < 2
       && Math.abs(midState.v.y + midState.ty * midState.v.zoom - midState.my) < 2,
       JSON.stringify([midState.v, midState.tx, midState.ty, midState.mx, midState.my]));

    // ⑤ 松手在目标 handle 上:必须建边 + 清线 + 手势结束
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

    // ⑥ 松手后再动鼠标:不许复活任何连线手势(用户症状的最直接判据)
    await cdp.mouse('mouseMoved', pos.t.x + 320, pos.t.y + 240, 0);
    await sleep(150);
    const after2 = await cdp.eval(`({ d: fConnEl().getAttribute('d'), from: ffrom, edges: FS.edges.length })`);
    ck('松手后动鼠标:虚线不得复活(手势真的结束了)', !after2.d && after2.from === null && after2.edges === 1, JSON.stringify(after2));

    ws.close();
  } catch (e) {
    ck('真实输入冒烟跑通', false, String((e as Error)?.message ?? e));
  } finally {
    kill(chrome); kill(server);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 清理失败不影响结论 */ }
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* 同上 */ }
  }
  if (FAILS.length) console.log('RESULT: RED ' + FAILS.length + ' 项: ' + FAILS.join(' | '));
  return FAILS.length ? 1 : 0;
}

process.exit(await main());
