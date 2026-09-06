// ── lucid 无头 DOM 桩(入库版,TypeScript)────────────────────────────────
// 用 node:vm 加载**真实编译产物**(scripts/ccviewer/static/index.html 的主脚本块),以浏览器语义的
// 最小子集驱动 render/diff/全文抽屉/轮询/语言全链路。历史上每个会话都在 /tmp 现写一份这种桩、
// 重启即丢(t2/t4/t6/t7/t8 皆如此)——本文件是其正式归宿。
// 忠实性铁律:桩按规范实现而非迁就产物。例:getElementById 只匹配 id 属性(meta[name] 不回退,
// 真浏览器亦不回退)。测试因此挂掉时,先怀疑产品代码,再怀疑桩。
// 支持面 = 产物实际用到的 API;未用到的一律不实现。node 仅测试期依赖,运行时仍零依赖(铁律1 不破)。
// 运行方式:node ≥22.18 原生 type-stripping 直接跑 .ts(无编译步骤);类型检查走
//   `node_modules/.bin/tsc -p tsconfig.check.json`(由 run_all 的 typecheck 套件代跑)。
// 产物在 vm 沙箱里是纯 JS,与桩之间的一切值传递天然是 any——边界用 any,桩内部逻辑严格类型。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

process.env.TZ = 'UTC';  // 黄金/时间格式化跨机稳定(原由各测试文件各写一行,ESM import 提升后统一收在此处)

export const HERE = path.dirname(fileURLToPath(import.meta.url)); // tests/frontend
export const REPO = path.resolve(HERE, '..', '..');
export const ARTIFACT = path.join(REPO, 'scripts', 'ccviewer', 'static', 'index.html');

type Handler = (ev: any) => void;
interface Rect { top: number; bottom: number; left: number; right: number; height: number; }

const VOID = new Set(['meta', 'link', 'input', 'br', 'img', 'hr', 'base', 'col', 'embed', 'source', 'track', 'wbr']);
const RAWTEXT = new Set(['style', 'script', 'title', 'textarea']);
const REFLECT = new Set(['open', 'hidden', 'checked']); // 反射到内容属性:[open] 等选择器才认

const ENT_MAP: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEnt(s: unknown): string {
  return String(s).replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z]+));/g, (m, dec, hex, word) => {
    if (dec) return String.fromCharCode(+dec);
    if (hex) return String.fromCharCode(parseInt(hex, 16));
    const k = word.toLowerCase();
    return Object.prototype.hasOwnProperty.call(ENT_MAP, k) ? ENT_MAP[k] : m;
  });
}

class Txt {
  tag = '#text';
  data: string;
  parent: El | null = null;
  constructor(data: string) { this.data = data; }
  get textContent() { return this.data; }
}

export class El {
  tag: string;
  attrs: Record<string, string>;
  kids: ANode[];
  parent: El | null;
  _l: Record<string, Handler[]>;
  style: Record<string, any>;
  scrollTop: number;
  _ownerDoc?: El | null;
  _rect?: Rect;
  content?: El;
  // 反射属性真实现在文件尾(defineProperty 装到 prototype),此处仅声明供类型检查:
  declare open: boolean;
  declare hidden: boolean;
  declare checked: boolean;
  declare placeholder: string;
  // 产物动态挂上的属性(桩不实现语义,仅声明可读写):
  declare className?: string;
  declare onchange?: ((ev: any) => void) | null;
  declare oninput?: ((ev: any) => void) | null;
  constructor(tag: string) {
    this.tag = String(tag).toLowerCase();
    this.attrs = {};
    this.kids = [];
    this.parent = null;
    this._l = {};
    this.style = {};
    this.scrollTop = 0;
    if (this.tag === 'template') this.content = new El('#fragment');
  }
  getAttribute(n: string): string | null { const v = this.attrs[String(n).toLowerCase()]; return v === undefined ? null : v; }
  setAttribute(n: string, v: unknown) {
    n = String(n).toLowerCase();
    this.attrs[n] = v === '' ? '' : String(v); // REFLECT 属性由 prototype 访问器自动同步,见文件尾
  }
  hasAttribute(n: string): boolean { return this.attrs[String(n).toLowerCase()] !== undefined; }
  get id(): string { return this.attrs.id || ''; }
  get dataset(): Record<string, string | undefined> {
    const el = this;
    return new Proxy({} as Record<string, string | undefined>, {
      get(_t, k) {
        if (typeof k !== 'string') return undefined;
        const v = el.attrs['data-' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())];
        return v === undefined ? undefined : v;
      },
      set(_t, k, v) {
        el.attrs['data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())] = String(v);
        return true;
      },
    });
  }
  get classList() {
    const el = this;
    const cur = () => new Set((el.attrs.class || '').split(/\s+/).filter(Boolean));
    const put = (s: Set<string>) => { el.attrs.class = [...s].join(' '); };
    return {
      add: (...cs: string[]) => { const c = cur(); cs.forEach((x) => c.add(x)); put(c); },
      remove: (...cs: string[]) => { const c = cur(); cs.forEach((x) => c.delete(x)); put(c); },
      contains: (x: string) => cur().has(x),
      toggle: (x: string, force?: boolean) => { const c = cur(); const on = force === undefined ? !c.has(x) : !!force; on ? c.add(x) : c.delete(x); put(c); return on; },
    };
  }
  get children(): El[] { return this.kids.filter((n): n is El => n instanceof El); }
  get firstElementChild(): El | null { return this.children[0] || null; }
  get nextElementSibling(): El | null {
    if (!this.parent) return null;
    const sibs = this.parent.children; const i = sibs.indexOf(this);
    return i >= 0 && sibs[i + 1] ? sibs[i + 1] : null;
  }
  get ownerDocument(): El | null { let n: El = this; while (n.parent) n = n.parent; return n._ownerDoc || null; }
  appendChild(n: ANode): ANode { if (n.parent) n.parent._detach(n); n.parent = this; this.kids.push(n); return n; }
  insertBefore(n: ANode, ref?: ANode | null): ANode {
    if (!n) throw new Error('insertBefore(null)');
    if (ref && this.kids.indexOf(ref) < 0) throw new Error("NotFoundError: the reference node is not a child of this node");
    if (n.parent) n.parent._detach(n);
    const i = ref ? this.kids.indexOf(ref) : this.kids.length;
    this.kids.splice(i, 0, n); n.parent = this; return n;
  }
  _detach(n: ANode) { const i = this.kids.indexOf(n); if (i >= 0) this.kids.splice(i, 1); n.parent = null; }
  remove() { if (this.parent) this.parent._detach(this); }
  _replaceWith(nodes: ANode[]) {
    const p = this.parent; if (!p) return;
    const i = p.kids.indexOf(this); this.parent = null;
    p.kids.splice(i, 1, ...nodes); nodes.forEach((n) => (n.parent = p));
  }
  get textContent(): string { return this.kids.map((k) => k.textContent).join(''); }
  set textContent(v: unknown) { this.kids = []; if (v !== '') this.appendChild(new Txt(String(v))); }
  get innerHTML(): string { return this.kids.map(serialize).join(''); }
  set innerHTML(h: string) {
    const target = this.tag === 'template' ? this.content! : this;
    target.kids = [];
    parseNodes(String(h)).forEach((n) => target.appendChild(n));
  }
  get outerHTML(): string { return serialize(this); }
  set outerHTML(h: string) { this._replaceWith(parseNodes(String(h))); }
  get value(): string { return this.attrs.value !== undefined ? this.attrs.value : this.textContent; }
  set value(v: unknown) { this.attrs.value = String(v); }
  get options(): El[] { return this.querySelectorAll('option'); }
  get offsetWidth(): number { return 42; }
  getBoundingClientRect(): Rect { return this._rect || { top: 0, bottom: 0, left: 0, right: 0, height: 0 }; }
  addEventListener(t: string, fn: Handler) { (this._l[t] = this._l[t] || []).push(fn); }
  removeEventListener(t: string, fn: Handler) { this._l[t] = (this._l[t] || []).filter((f) => f !== fn); }
  fire(type: string, extra?: Record<string, unknown>): Record<string, any> {
    const ev = Object.assign({ type, target: this }, extra || {});
    let n: El | null = this;
    while (n) { ((n._l && n._l[type]) || []).slice().forEach((f) => f(ev)); n = n.parent; }
    return ev;
  }
  querySelectorAll(sel: string): El[] { const out: El[] = []; walk(this, (n) => { if (n !== this && matchSel(n, sel, this)) out.push(n); }); return out; }
  querySelector(sel: string): El | null { let hit: El | null = null; walk(this, (n) => { if (!hit && n !== this && matchSel(n, sel, this)) hit = n; }); return hit; }
}
export type ANode = El | Txt;
// 浏览器反射属性:open/hidden/checked 与内容属性双向联动(赋 .open=true 即得上 [open] 选择器命中)
for (const prop of REFLECT) {
  Object.defineProperty(El.prototype, prop, {
    configurable: true,
    get(this: El) { const v = this.attrs[prop]; return v !== undefined && v !== 'false'; },
    set(this: El, val: unknown) { if (!val || val === 'false') delete this.attrs[prop]; else this.attrs[prop] = ''; },
  });
}
// placeholder 同为反射属性(字符串版)
Object.defineProperty(El.prototype, 'placeholder', {
  configurable: true,
  get(this: El) { return this.attrs.placeholder === undefined ? '' : this.attrs.placeholder; },
  set(this: El, v: unknown) { this.attrs.placeholder = String(v); },
});
class HTMLDetailsElementStub {}
Object.defineProperty(HTMLDetailsElementStub, Symbol.hasInstance, { value: (o: unknown) => !!o && (o as El).tag === 'details' });

function walk(root: El, fn: (n: El) => void) {
  for (const k of root.kids || []) if (k instanceof El) { fn(k); walk(k, fn); }
}
function matchSel(el: El, sel: string, scope: El): boolean { return sel.split(',').some((p) => matchChain(el, p.trim(), scope)); }
function matchChain(el: El, chain: string, scope: El): boolean {
  if (chain.startsWith(':scope>')) return el.parent === scope && matchCompound(el, chain.slice(7));
  const parts = chain.split(/\s+/);
  let node: El | null = el;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!(node instanceof El) || !matchCompound(node, parts[i])) return false;
    node = node.parent;
  }
  return true;
}
function matchCompound(el: El, comp: string): boolean {
  const re = /([a-zA-Z][\w-]*|[.#][\w-]+|\[[^\]]+\])/g;
  let m: RegExpExecArray | null, any = false;
  while ((m = re.exec(comp))) {
    const t = m[1];
    if (t[0] === '.') { if (!el.classList.contains(t.slice(1))) return false; }
    else if (t[0] === '#') { if (el.id !== t.slice(1)) return false; }
    else if (t[0] === '[') {
      const a = /^\[([\w-]+)(?:=("?)([^\]"]*)\2)?\]$/.exec(t);
      if (!a) return false;
      const v = el.getAttribute(a[1]);
      if (v === null) return false;
      if (a[2] !== undefined && v !== a[3].replace(/\\(.)/g, '$1')) return false; // 去 CSS.escape 反斜杠;无 =值 时为存在性匹配
    } else if (el.tag !== t.toLowerCase()) return false;
    any = true;
  }
  return any;
}
function escAttr(s: string): string { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function serialize(n: ANode): string {
  if (n instanceof Txt) return n.data;
  if (!(n instanceof El)) return '';
  const at = Object.entries(n.attrs).map(([k, v]) => (v === '' ? ' ' + k : ` ${k}="${escAttr(v)}"`)).join('');
  if (VOID.has(n.tag)) return `<${n.tag}${at}>`;
  return `<${n.tag}${at}>${n.kids.map(serialize).join('')}</${n.tag}>`;
}

const TAG_RE = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w:.-]*)\s*>|<([a-zA-Z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)(\/?)>/gi;
const ATTR_RE = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
function parseAttrs(s: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  ATTR_RE.lastIndex = 0;
  let a: RegExpExecArray | null;
  while ((a = ATTR_RE.exec(s))) {
    if (!a[1] || a[1] === '/') continue;
    const raw = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : '';
    out.push([a[1], decodeEnt(raw)]);
  }
  return out;
}
function parseNodes(src: string): ANode[] {
  const top = new El('#frag');
  const stack: El[] = [top];
  let last = 0, m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(src))) {
    if (m.index > last) pushText(stack, src.slice(last, m.index));
    last = TAG_RE.lastIndex;
    if (m[0].startsWith('<!--') || m[0].toLowerCase().startsWith('<!doctype')) continue;
    if (m[1]) {
      const close = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === close) { stack.length = i; break; }
      }
      continue;
    }
    const el = new El(m[2]);
    parseAttrs(m[3]).forEach(([k, v]) => el.setAttribute(k, v));
    stack[stack.length - 1].appendChild(el);
    if (VOID.has(el.tag) || m[4] === '/') continue;
    if (RAWTEXT.has(el.tag)) {
      const closeRe = new RegExp('</' + el.tag + '\\s*>', 'i');
      const rest = src.slice(last);
      const cm = closeRe.exec(rest);
      const body = cm ? rest.slice(0, cm.index) : rest;
      if (body) el.appendChild(new Txt(body));
      last += cm ? cm.index + cm[0].length : rest.length;
      TAG_RE.lastIndex = last;
      continue;
    }
    stack.push(el);
  }
  if (last < src.length) pushText(stack, src.slice(last));
  return top.kids.slice(); // 必须拷贝:appendChild→_detach 会从同一数组摘除元素,活引用会边迭代边失配
}
function pushText(stack: El[], text: string) { const t = new Txt(decodeEnt(text)); t.parent = stack[stack.length - 1]; stack[stack.length - 1].kids.push(t); }

// ── 环境组装 ───────────────────────────────────────────────────────────────
export interface LoadOpts {
  artifact?: string;
  port?: string;
  language?: string;
  localStorage?: Record<string, string>;
  fetchFor?: (url: string) => any;
}
interface DocLike {
  _topL: Record<string, Handler[]>;
  documentElement: El;
  body: El | undefined;
  hidden: boolean;
  getElementById(id: string): El | null;
  createElement(tag: string): El;
  querySelectorAll(s: string): El[];
  querySelector(s: string): El | null;
  addEventListener(t: string, fn: Handler): void;
  dispatch(t: string, extra?: Record<string, unknown>): Record<string, any>;
}
interface WinLike {
  _topL: Record<string, Handler[]>;
  scrollY: number;
  scrolls: Array<[number, number]>;
  addEventListener(t: string, fn: Handler): void;
  scrollTo(x: number, y: number): void;
  dispatch(t: string): Record<string, any>;
}
interface LocLike { port: string; href: string; reloads: number; reload(): void; assign(u: string): void; }
interface LsLike { getItem(k: string): string | null; setItem(k: string, v: unknown): void; removeItem(k: string): void; _map: Map<string, string>; }
interface Timers { intervals: Handler[]; timeouts: Array<{ fn: Handler; ms: number }>; }

export interface Env {
  fetchFor(url: string): any;
  ctx: Record<string, any>;
  run(code: string): any;
  get(expr: string): any;
  doc: DocLike;
  docRoot: El;
  rootEl: El;
  win: WinLike;
  location: LocLike;
  localStorage: LsLike;
  timers: Timers;
  fetchCalls: string[];
  errs: string[];
  flush(rounds?: number): Promise<void>;
  $(id: string): El;
  $q(s: string): El | null;
  $qa(s: string): El[];
  fireTop(t: string): Record<string, any>;
  fireWin(t: string): Record<string, any>;
}

export function load(opts?: LoadOpts): Env {
  opts = opts || {};
  const html = opts.artifact || fs.readFileSync(ARTIFACT, 'utf8');
  const sm = /<script>\n([\s\S]*)\n<\/script><\/body>/.exec(html);
  if (!sm) throw new Error('产物中未找到主脚本块');
  const bundle = sm[1];

  const docRoot = new El('#document');
  parseNodes(html).forEach((k) => docRoot.appendChild(k));
  const rootEl = docRoot.children.find((k) => k.tag === 'html');
  if (!rootEl) throw new Error('产物缺 <html>');
  docRoot._ownerDoc = null;
  walk(rootEl, (n) => (n._ownerDoc = docRoot));

  const documentProxy: DocLike = {
    _topL: {},
    documentElement: rootEl,
    body: rootEl.children.find((k) => k.tag === 'body'),
    hidden: false,
    getElementById(id) { let hit: El | null = null; walk(rootEl, (n) => { if (!hit && n.id === id) hit = n; }); return hit; },
    createElement(tag) { return new El(tag); },
    querySelectorAll: (s) => rootEl.querySelectorAll(s),
    querySelector: (s) => rootEl.querySelector(s),
    addEventListener(t, fn) { (documentProxy._topL[t] = documentProxy._topL[t] || []).push(fn); },
    dispatch(t, extra) { const ev = Object.assign({ type: t, target: documentProxy }, extra); (documentProxy._topL[t] || []).slice().forEach((f) => f(ev)); return ev; },
  };
  docRoot._l = documentProxy._topL; // 冒泡经过 #document 时触达 document 级监听器

  const win: WinLike = {
    _topL: {}, scrollY: 0, scrolls: [],
    addEventListener(t, fn) { (win._topL[t] = win._topL[t] || []).push(fn); },
    scrollTo(x, y) { win.scrollY = y; win.scrolls.push([x, y]); },
    dispatch(t) { const ev = { type: t, target: win }; (win._topL[t] || []).slice().forEach((f) => f(ev)); return ev; },
  };
  const location: LocLike = {
    port: opts.port || '8787', href: '', reloads: 0,
    reload() { location.reloads++; },
    assign(u) { location.href = u; },
  };
  const ls = new Map(Object.entries(opts.localStorage || {}));
  const localStorageStub: LsLike = {
    getItem: (k) => (ls.has(k) ? ls.get(k)! : null),
    setItem: (k, v) => { ls.set(k, String(v)); },
    removeItem: (k) => { ls.delete(k); },
    _map: ls,
  };
  const timers: Timers = { intervals: [], timeouts: [] };
  const fetchCalls: string[] = [];
  const errs: string[] = [];
  const env = {} as Env;
  env.fetchFor = opts.fetchFor || (() => undefined);
  async function fetchStub(url: string) {
    fetchCalls.push(url);
    const r = env.fetchFor(url);
    if (r === undefined) throw new Error('fetch 无桩数据: ' + url);
    if (r instanceof Error) throw r;
    return { json: async () => JSON.parse(JSON.stringify(r)), text: async () => JSON.stringify(r) };
  }

  const ctx: Record<string, any> = {
    document: documentProxy, window: win, location, navigator: { language: opts.language || 'zh-CN' },
    localStorage: localStorageStub, fetch: fetchStub,
    console: { log: () => {}, warn: () => {}, error: (...a: unknown[]) => { errs.push(a.join(' ')); } },
    setInterval: (fn: Handler) => (timers.intervals.push(fn), timers.intervals.length),
    clearInterval: () => {},
    setTimeout: (fn: Handler, ms: number) => (timers.timeouts.push({ fn, ms }), timers.timeouts.length),
    clearTimeout: () => {},
    CSS: { escape: (s: unknown) => String(s).replace(/[^\w-]/g, (c) => '\\' + c) }, // 本项目 id 全是 [0-9a-f-]/wf_*,不触转义
    HTMLDetailsElement: HTMLDetailsElementStub,
    Intl, Date, Math, JSON, RegExp, String, Number, Boolean, Array, Object, Map, Set, Promise, Error, TypeError,
    encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, isFinite,
  };
  env.ctx = ctx;
  vm.createContext(ctx);
  env.run = (code) => vm.runInContext(code, ctx);
  env.get = (expr) => vm.runInContext('(' + expr + ')', ctx);
  vm.runInContext(bundle, ctx, { filename: 'index.html#main' });

  const flush = async (rounds?: number) => { for (let i = 0; i < (rounds || 15); i++) await new Promise((r) => setImmediate(r)); };
  Object.assign(env, { doc: documentProxy, docRoot, rootEl, win, location, localStorage: localStorageStub, timers, fetchCalls, errs, flush,
    $: (id: string) => documentProxy.getElementById(id)!, $q: (s: string) => rootEl.querySelector(s), $qa: (s: string) => rootEl.querySelectorAll(s),
    fireTop: (t: string) => documentProxy.dispatch(t), fireWin: (t: string) => win.dispatch(t) });
  return env;
}

// 用户可见文本(近似 innerText):跳过 script/style 内容(浏览器 textContent 本就含它们,
// 但"零中文残留"这类断言只应作用于可见文案);langsel 的选项是各语言原生自称,按设计不译,列入白名单。
export function visibleText(el: ANode | null | undefined): string {
  if (el instanceof Txt) return el.data;
  if (!(el instanceof El)) return '';
  if (el.tag === 'script' || el.tag === 'style') return '';
  let s = '';
  if (el.tag === 'input') s += el.placeholder;
  if (el.tag === 'option' && el.parent && el.parent.id === 'langsel') return '';
  for (const k of el.kids) s += visibleText(k);
  return s;
}

// querySelector 的"必然命中"版:取不到即桩/夹具坏了,抛出好定位(测试里裸 .foo 解引用处统一走它)
export function querySelectorEl(root: El, sel: string): El {
  const hit = root.querySelector(sel);
  if (!hit) throw new Error('桩 querySelector 未命中: ' + sel);
  return hit;
}

// ── 断言器(风格对齐 python 套件:✓/✗ + RESULT + 退出码) ───────────────────
export function makeCk(): { ck: (name: string, cond: unknown, detail?: unknown) => void; done: () => never; FAILS: string[] } {
  const FAILS: string[] = [];
  const ck = (name: string, cond: unknown, detail?: unknown) => {
    console.log((cond ? '✓ ' : '✗ ') + name + (cond ? '' : '  ← ' + (detail === undefined ? '' : String(detail).slice(0, 300))));
    if (!cond) FAILS.push(name);
  };
  const done = (): never => {
    console.log('\nRESULT:', FAILS.length ? 'RED ' + FAILS.length + ' 项: ' + FAILS.join(' | ') : 'GREEN');
    process.exit(FAILS.length ? 1 : 0);
  };
  return { ck, done, FAILS };
}

// ── fixture 载荷(与后端 /api/runs //api/sessions 契约对齐;全 ASCII 时间无关字段保证黄金稳定) ──
// 值逐字不许动(黄金快照依赖);any 是诚实标注——它们是"服务端 JSON 契约"的镜像,由后端测试钉结构。
export const RUN_DONE: any = {
  runId: 'wf_alpha1', project: '-fixproj', session: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', cwd: '/work/fix',
  name: 'golden-flow', summary: '', status: 'completed', live: false, startedAt: 1757000000000, durationMs: 65000,
  tokens: 42000, agentCount: 2, phases: [{ title: 'Scan' }, { title: 'Report' }],
  agents: [
    { label: 'scout', phase: 'Scan', state: 'done', tokens: 20000, toolCalls: 5, durationMs: 30000, lastTool: 'Bash', agentId: 'f'.repeat(40), prompt: 'p1&#124;c1 preview', result: 'r1&#124;c2 preview' },
    { label: 'scribe', phase: 'Report', state: 'done', tokens: 22000, toolCalls: 2, durationMs: 35000, lastTool: 'Write', agentId: 'e'.repeat(40), prompt: 'P2 preview', result: 'R2 preview' },
  ],
  logs: ['line one', 'line two'], task: 'golden fixture task', result: '{"ok": true}', orphan: false,
};
export const RUN_LIVE: any = {
  runId: 'wf_live9', project: '-fixproj', session: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', cwd: '/work/fix',
  name: 'live-flow', summary: '', status: 'running', live: true, startedAt: 1757000100000, durationMs: 12000,
  tokens: null, agentCount: 1, phases: [{ title: 'Scan' }],
  agents: [{ label: 'Explore', phase: null, state: 'done', tokens: null, toolCalls: null, durationMs: null, lastTool: null, agentId: 'd'.repeat(40), prompt: 'look', result: 'seen' }],
  logs: [], task: '', result: '', orphan: false, lastActivityAt: 1757000110000,
};
export const SESSION_FIX: any = {
  sessionId: 'b2c3d4e5-f6a7-8901-abcd-ef0123456789', project: '-fixproj', cwd: '/work/fix', title: 'Golden Session',
  status: 'input_required', alive: true, waitReason: 'ask', waitTool: 'AskUserQuestion', pid: 4242, kind: 'interactive',
  version: '2.1.0', startedAt: 1757000000000, lastActivityAt: 1757000200000, ageSec: 77, model: 'claude-fable-5',
  stopReason: 'tool_use', permissionMode: 'default',
  tokens: { input: 100, output: 50, cacheRead: 9000, cacheWrite: 100 }, pendingTools: ['AskUserQuestion'], toolCalls: 6,
  lastPrompt: 'please continue', lastText: 'I need an answer to proceed with the golden fixture.', lastTextMid: 'msg_g1',
  prompts: [{ u: '11111111-2222-3333-4444-555555555555', t: 'golden prompt text', ts: '2026-09-05T04:00:00.000Z' },
            { u: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', t: 'oldest prompt', ts: '2026-09-05T03:00:00.000Z', f: 1 }],
  steps: [{ msgId: 'msg_g1', turn: '11111111-2222-3333-4444-555555555555', tools: ['AskUserQuestion'], text: 'I need an answer', model: 'claude-fable-5', tokIn: 100, tokOut: 50, ts: '2026-09-05T04:00:01.000Z' }],
  subagents: [{ agentId: 'cafe1234', label: 'worker', agentType: 'general-purpose', description: 'do work', model: 'claude-haiku-4-5-20251001', kind: 'task', teamName: null, color: null, state: 'done', lastTool: 'Bash', pendingTools: [], toolCalls: 3, tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, lastActivityAt: 1757000150000, prompt: 'sub task', lastText: 'sub result' }],
};
export function payload(runs: any[], sessions: any[]): (url: string) => any {
  return (url) => {
    if (url.indexOf('/api/runs') === 0) return { now: 1757000300, ver: opts0ver(), recentDays: 14, runs };
    if (url.indexOf('/api/sessions') === 0) return { now: 1757000300, sessions };
    return undefined;
  };
}
export function opts0ver(): string { const m = /wfo-ver" content="([0-9a-f]{12})"/.exec(fs.readFileSync(ARTIFACT, 'utf8')); return m ? m[1] : ''; }
