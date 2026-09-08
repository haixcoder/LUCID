// 生成器 meta 契约(1.2.50 草稿 v2 · Phase 1):whenToUse / phases[].detail 逐字出码、空字段不落码、
// v1 草稿产物**逐字节不变**(纯加宽的唯一硬证据)、桩替身沙箱真跑(meta 纯字面量 + phase() 序列)。
// 沙箱跑器住 harness.runFlowScript 单点(AD-6):Phase 4–8 的 pipeline/loop/retry 断言共用它,禁第二份。
import fs from 'node:fs';
import path from 'node:path';
import { load, makeCk, runFlowScript, HERE } from './harness.ts';
const { ck, done } = makeCk();
const env = load();
await env.flush();

const G = (d: unknown): string => env.get('flowGenerate(' + JSON.stringify(d) + ')') as string;
const V = (d: unknown): string[] => env.get('flowValidate(' + JSON.stringify(d) + ')') as string[];
const metaBlock = (js: string): string => (/export const meta = \{[\s\S]*?\n\}/.exec(js) || [''])[0];
// 7 节点 demo 的 v1 产物黄金(1.2.49 录制,纯加宽的唯一硬证据:字段留空 → 产物逐字节不变)
const GOLD = fs.readFileSync(path.join(HERE, 'golden', 'flowgen_demo.js'), 'utf8');
const demo = (extra: Record<string, unknown> = {}): any =>
  Object.assign(env.get('(function(){flowSeedDemo();return JSON.parse(JSON.stringify(flowDraft()))})()'), extra);

(async () => {
  // ── v1 零 diff:纯加宽不许让既有草稿的产物漂移 ──
  ck('v1/7 节点 demo 产物逐字节不变(空 whenToUse/phases 不落码)', G(demo()) === GOLD,
     JSON.stringify(metaBlock(G(demo()))));

  // ── meta.whenToUse ──
  ck('whenToUse/非空 → meta 里逐字出现',
     metaBlock(G(demo({ whenToUse: '需要并行审计多个路由时' }))).includes('whenToUse: "需要并行审计多个路由时"'),
     metaBlock(G(demo({ whenToUse: 'x' }))));
  ck('whenToUse/空 → meta 不含该键(空字段不落码,否则 v1 产物漂移)', !/whenToUse/.test(G(demo())));

  // ── meta.phases:显式优先,留空沿用推导(单点 flowMetaPhases)──
  const band = [{ title: '扫描', detail: '每文件一个审计代理' }, { title: '汇总' }];
  ck('phases/显式阶段带 → meta.phases 逐字一致(title + detail)',
     metaBlock(G(demo({ phases: band }))).includes('phases: [{ title: "扫描", detail: "每文件一个审计代理" }, { title: "汇总" }]'),
     metaBlock(G(demo({ phases: band }))));
  ck('phases/detail 为空 → 只出 title(不写 detail: "")',
     metaBlock(G(demo({ phases: band }))).includes('{ title: "汇总" }'));
  ck('phases/留空 → 仍按 phase||label 首现去重(既有口径不变)',
     metaBlock(G(demo())).includes('phases: [{ title: "Scope" }, { title: "Search" }, { title: "Verify" }]'),
     metaBlock(G(demo())));
  ck('phases/显式条目全空标题 → 回落推导(编辑到一半不留空表)',
     metaBlock(G(demo({ phases: [{ title: '  ', detail: 'x' }] })))
       .includes('phases: [{ title: "Scope" }, { title: "Search" }, { title: "Verify" }]'));
  ck('phases/单点返回 detail(UI 阶段带与生成器读同一份)',
     JSON.stringify(env.get('flowMetaPhases(' + JSON.stringify(demo({ phases: band })) + ')'))
       === JSON.stringify([{ title: '扫描', detail: '每文件一个审计代理' }, { title: '汇总' }]),
     String(env.get('JSON.stringify(flowMetaPhases(' + JSON.stringify(demo({ phases: band })) + '))')));
  ck('phases/显式阶段带不改变 phase() 调用(它由 agent.phase 驱动,脚本才跑得对)',
     /phase\("Scope"\)/.test(G(demo({ phases: band }))) && !/phase\("扫描"\)/.test(G(demo({ phases: band }))));

  // ── 校验器对 v2 草稿照常放行(v2 不是"非法载荷")──
  ck('validate/v2 草稿(带 whenToUse/phases)零错误', V(demo({ v: 2, whenToUse: 'x', phases: band })).length === 0,
     JSON.stringify(V(demo({ v: 2, whenToUse: 'x', phases: band }))));

  // ── 桩替身沙箱真跑:meta 纯字面量 + phase() 序列 == 阶段带顺序 ──
  const r1 = await runFlowScript(G(demo()), '我的题');
  ck('sandbox/meta 是纯字面量(无模板串/无 await/无箭头/无调用)',
     !/`|\bawait\b|=>|\bMath\b/.test(metaBlock(G(demo()))), metaBlock(G(demo())));
  ck('sandbox/meta 被脚本真实声明出来(不是我们替身伪造的)', !!r1.meta && r1.meta.name === 'demo-research', JSON.stringify(r1.meta));
  ck('sandbox/phase() 序列 == 阶段带顺序(编排时看到的 == 跑起来看到的)',
     r1.phases.join(',') === 'Scope,Search,Verify', JSON.stringify(r1.phases));
  ck('sandbox/meta.phases 与阶段带逐字一致', JSON.stringify(r1.meta.phases) === JSON.stringify([{ title: 'Scope' }, { title: 'Search' }, { title: 'Verify' }]),
     JSON.stringify(r1.meta.phases));

  const r2 = await runFlowScript(G(demo({ v: 2, whenToUse: '需要并行审计多个路由时', phases: band })), '我的题');
  ck('sandbox/whenToUse 落到运行期 meta(不是只出现在文本里)',
     r2.meta.whenToUse === '需要并行审计多个路由时', JSON.stringify(r2.meta));
  ck('sandbox/显式 detail 落到运行期 meta.phases', JSON.stringify(r2.meta.phases) === JSON.stringify([{ title: '扫描', detail: '每文件一个审计代理' }, { title: '汇总' }]),
     JSON.stringify(r2.meta.phases));
  ck('sandbox/args 仍注入 Start 入口(加宽没碰 args 通路)', r2.calls[0].prompt === '把选题 我的题 拆成 3 个互补的调研角度,每角度一行。', r2.calls[0].prompt);
  ck('sandbox/显式阶段带不改变执行(phase() 仍按 agent.phase,代理调用序列不变)',
     r2.phases.join(',') === 'Scope,Search,Verify' && r2.calls.length === 5, JSON.stringify([r2.phases, r2.calls.length]));

  done();
})().catch((e: unknown) => { console.error('HARNESS CRASH:', e); process.exit(2); });
