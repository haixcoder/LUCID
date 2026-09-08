// ── 真实输入测试的共用脚手架(CDP + 临时服务 + 断言)──
// 为什么值得单独一层:交互类 bug 只有**浏览器真实事件管线**能证伪(合成事件绕开 pointer→mouse 派生,
// 1.2.47 的「连线不收尾」就是这么漏掉的);现在有两个套件要用同一套启动/驱动逻辑,复制第二份就是铁律 8 违规。
// 依赖:node ≥22(全局 WebSocket)+ 本机 Chrome;缺 Chrome 时调用方跳过并警示。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface Ck { ck: (name: string, cond: unknown, detail?: unknown) => void; fails: string[]; done: () => number }
export function makeCk(): Ck {
  const fails: string[] = [];
  return {
    fails,
    ck: (name, cond, detail) => {
      const ok = !!cond;
      if (!ok) fails.push(name);
      console.log((ok ? '✓ ' : '✗ ') + name + (detail === undefined ? '' : '  ← ' + String(detail)));
    },
    done: () => (fails.length ? (console.log('RESULT: RED ' + fails.length + ' 项: ' + fails.join(' | ')), 1) : 0),
  };
}

export function findChrome(): string {
  const cands = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const c of cands) { if (c && fs.existsSync(c)) return c; }
  return '';
}

async function httpJson(url: string): Promise<any> { return await (await fetch(url)).json(); }
async function waitHttp(url: string, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return true; } catch { /* 还没起来 */ }
    await sleep(200);
  }
  return false;
}

// 极简 CDP 客户端:Node 22 自带全局 WebSocket,不需要 puppeteer 这类第三方依赖(本仓零依赖)
export class Cdp {
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
  // 真实拖拽:n 步小位移(默认 3px/步)—— 大跳跃会放大 vendor 的阈值基线效应,测不出真实手感
  async drag(x0: number, y0: number, dx: number, dy: number, steps = 10): Promise<void> {
    await this.mouse('mouseMoved', x0, y0, 0);
    await this.mouse('mousePressed', x0, y0, 1);
    for (let i = 1; i <= steps; i++) {
      await this.mouse('mouseMoved', x0 + (dx * i) / steps, y0 + (dy * i) / steps, 1);
      await sleep(20);
    }
    await this.mouse('mouseReleased', x0 + dx, y0 + dy, 0);
  }
}

export interface BrowserEnv { cdp: Cdp; port: number; close: () => void }

// 起一套「临时 HOME 服务 + headless Chrome + CDP」;调用方在 finally 里 close()
export async function startBrowser(chromePath: string): Promise<BrowserEnv> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-browser-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-chrome-'));
  let server: any = null, chrome: any = null;
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
    const cdp = new Cdp(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    for (let i = 0; i < 50 && !await cdp.eval("typeof openFlow === 'function'"); i++) await sleep(200);
    const close = (): void => {
      try { ws.close(); } catch { /* 已关闭 */ }
      kill(chrome); kill(server);
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 清理失败不影响结论 */ }
      try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* 同上 */ }
    };
    return { cdp, port, close };
  } catch (e) {
    kill(chrome); kill(server);
    throw e;
  }
}
