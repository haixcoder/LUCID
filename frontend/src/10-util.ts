// ── 10-util.ts:转义/格式化/迷你 markdown 渲染器(忠实移植自原内联 JS,行为不变) ──
// 长文本 markdown 渲染(895 条真实语料测得语法全集):分段/列表▸/#标题/**粗体/行内码/围栏/|表格|
// 围栏与表格先抽为占位符(SOH=0x01 字符,两侧夹数字索引),避免被逐行分段器打碎;截断致未闭合的围栏整段兜底进代码块
const SOH = String.fromCharCode(1);
const PH_ONLY = new RegExp('^' + SOH + '(\\d+)' + SOH + '$');
const PH_ALL = new RegExp(SOH + '(\\d+)' + SOH, 'g');
const PH = (i: number): string => SOH + i + SOH + '\n';
const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, (c: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]);
const fmtT = (ms?: number | null): string => ms == null ? '—' : ms < 1000 ? ms + 'ms' : ms < 60000 ? (ms / 1000).toFixed(0) + 's' : ms < 3600000 ? (ms / 60000).toFixed(1) + 'm' : (ms / 3600000).toFixed(1) + 'h';
const fmtN = (n?: number | null): string => n == null ? '' : Number(n).toLocaleString('en-US');
const fmtC = (t?: number | null): string => t ? new Date(t).toLocaleTimeString(loc(), { hour12: false }) : '—';
const inlineMd = (s: unknown): string => esc(s).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
// IN 类 prompt 常是一整行无换行长文(mdLite 逐行分段失灵成文字墙):足够长且几乎无换行时按。；断行
const wrapLong = (sv: unknown): string => { const s = String(sv ?? ''); return s.length < 420 || s.split('\n').filter(x => x.trim()).length > 3 ? s : s.replace(/([。；])(?=\S)/g, '$1\n'); };
const esc2 = inlineMd;
// 转录文本常带 HTML 实体转义竖线(数字实体)——不解码则 mdLite 认不出表格、页面上露出转义串
const unent = (sv: unknown): string => {
  let x = String(sv ?? '');
  for (let i = 0; i < 2; i++) {
    const y = x.replace(/&amp;(?=#\d+;)/g, '&').replace(/&#(\d{1,4});/g, (m: string, n: string) => { const c = +n; return c >= 32 && c < 127 ? String.fromCharCode(c) : m; });
    if (y === x) break; x = y;
  }
  return x;
};
const mdTable = (blk: string): string => {
  const rs = blk.split('\n').map(l => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|'));
  const tr = (a: string[], c: string): string => `<tr>${a.map(x => `<${c}>${inlineMd(x.trim())}</${c}>`).join('')}</tr>`;
  let th = '';
  if (rs[1] && rs[1].every(c => /^:?-{2,}:?$/.test(c.trim()))) { th = `<thead>${tr(rs.shift() as string[], 'th')}</thead>`; rs.shift(); }
  return `<table class="mdt">${th}<tbody>${rs.map(r => tr(r, 'td')).join('')}</tbody></table>`;
};
const mdLite = (sv: unknown): string => {
  let s = String(sv ?? ''); const B: string[] = [];
  s = s.replace(/^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm, m => { B.push(`<pre class="code">${esc(m.replace(/^```[^\n]*\n?/, '').replace(/\n?```[ \t]*$/, ''))}</pre>`); return PH(B.length - 1); });
  s = s.replace(/^```[^\n]*(?:\n[\s\S]*)?$/m, m => { B.push(`<pre class="code">${esc(m.replace(/^```[^\n]*\n?/, ''))}</pre>`); return PH(B.length - 1); });  // 截断兜底:未闭合围栏
  s = s.replace(/(?<!\\)\\n/g, '\n').replace(/(?<!\\)\\t/g, '\t');  // 字面换行/制表转义还原(围栏抽取后,代码内字面量不受影响)
  s = s.replace(/(?:^[ \t]*\|[^\n]*\n?)+/gm, m => { B.push(mdTable(m.trimEnd())); return PH(B.length - 1); });
  return s.split(/(?:\n\s*\n|(?=\n[^\s]))/).map(bl => {
    const pl = PH_ONLY.exec(bl.trim()); if (pl) return B[+pl[1]];
    const ls = bl.split('\n').filter(l => l.trim()); if (!ls.length) return '';
    if (/^#{1,4}\s/.test(ls[0])) return `<p class="h3">${esc2(ls[0].replace(/^#{1,4}\s+/, ''))}</p>` + ls.slice(1).map(l => `<p>${esc2(l)}</p>`).join('');
    const li = /^\s*([-•*]|\d+[.)、])/.test(ls[0]);
    return `<p class="${li ? 'li' : ''}">${ls.map(esc2).join('\n')}</p>`;
  }).join('')
    .replace(PH_ALL, (_m: string, i: string) => B[+i]);
};
// 运行产物/结果常是 JSON 串:展开成 k: 多行值(还原字符串里的换行),交给 mdLite 分段
function pretty(sv: unknown): string {
  const s = String(sv ?? '');
  if (!/^\s*[[{]/.test(s)) return s;
  try {
    const out: string[] = [];
    (function w(v: unknown, p: string): void {
      if (v && typeof v === 'object') {
        if (Array.isArray(v)) { v.forEach(x => w(x, p)); }
        else {
          for (const k in v) {
            const x = (v as Record<string, unknown>)[k];
            if (x && typeof x === 'object') { out.push(p + k + ':'); w(x, p + '  '); }
            else out.push(p + k + ': ' + (typeof x === 'string' ? x : JSON.stringify(x)));
          }
        }
      } else out.push(p + (typeof v === 'string' ? v : JSON.stringify(v)));
    })(JSON.parse(s), '');
    return out.join('\n');
  } catch (e) { return s; }
}
const AD = (c: number): string => `animation-delay:${-Number((Date.now() / 1000 % c).toFixed(2))}s`;
const GL: Record<string, string> = { done: '◆', running: '◈', queued: '◇', aborted: '⊘', progress: '◐', error: '✕', failed: '✕', waiting: '◔', idle: '◌', ended: '○' };
const GLY = (s: string): string => GL[s] || '?';
