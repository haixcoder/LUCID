#!/usr/bin/env node
// npx -y kw-lucid —— 「npm 方式」一行安装 Lucid 插件(也可 npm install -g 后执行 kw-lucid)。
// 原理:npm 包自带 .claude-plugin/marketplace.json(source "./" 相对"被 add 的目录"解析,
// 与仓库目录市场同一语义)。脚本把包内运行时组件同步到 ~/.claude/plugins/marketplaces/
// kw-lucid-npm/(稳定路径,避免 npx 缓存目录失效),再走 claude CLI 的 marketplace add + install。
// 约定:真正的安装/校验逻辑全在 claude CLI,本脚本零第三方依赖(仅 node stdlib)。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PKG_DIR = path.resolve(__dirname, '..'); // bin/ 固定在包根(npm/_npx 缓存布局均成立)
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const STABLE = path.join(CONFIG_DIR, 'plugins', 'marketplaces', 'kw-lucid-npm');
const MKT_NAME = 'kw-dev-plugins';
const PLUGIN_ID = 'lucid@' + MKT_NAME;
const COMPONENTS = ['.claude-plugin', 'commands', 'hooks', 'monitors', 'scripts', 'package.json', 'LICENSE'];

function run(args) {
  const p = spawnSync('claude', args, { encoding: 'utf8' });
  if (p.error) return { code: -1, out: String(p.error.message || p.error) };
  return { code: p.status, out: (p.stdout || '') + (p.stderr || '') };
}

function fail(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

// 1) 前置:claude CLI 必须存在(npm 只是分发渠道,宿主是 Claude Code)
const ver = run(['--version']);
if (ver.code !== 0) {
  fail('未找到可用的 `claude` 命令。请先安装 Claude Code: https://code.claude.com/docs/en/quickstart');
}

// 2) 包完整性自检(tarball 应含市场与插件两份 manifest)
for (const f of [path.join('.claude-plugin', 'marketplace.json'), path.join('.claude-plugin', 'plugin.json')]) {
  if (!fs.existsSync(path.join(PKG_DIR, f))) {
    fail('npm 包缺少 ' + f + '(包体损坏?),请 npm cache clean -f 后重试');
  }
}

// 3) 同步到稳定市场目录(先清后拷;STABLE 路径含固定段名 kw-lucid-npm,rm 安全)
fs.mkdirSync(path.dirname(STABLE), { recursive: true });
fs.rmSync(STABLE, { recursive: true, force: true });
fs.mkdirSync(STABLE, { recursive: true });
for (const c of COMPONENTS) {
  const src = path.join(PKG_DIR, c);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(STABLE, c), { recursive: true });
}

// 4) 注册市场(已存在则沿用其现有渠道——GitHub add 过 kw-dev-plugins 的机器不强行改道)
const add = run(['plugin', 'marketplace', 'add', STABLE]);
if (add.code !== 0) {
  console.log('· 市场 ' + MKT_NAME + ' 已注册(或注册失败),沿用现有渠道: ' +
    add.out.trim().split('\n').pop());
  console.log('  如需改用 npm 包内容:claude plugin marketplace remove ' + MKT_NAME + ' 后重跑本脚本');
} else {
  console.log('✓ 已注册市场 ' + MKT_NAME + ' → ' + STABLE);
}

// 5) 安装或更新(先 update:已装过即升级;失败再 install:首装)
let op = run(['plugin', 'update', PLUGIN_ID]);
if (op.code !== 0) op = run(['plugin', 'install', PLUGIN_ID, '-y']);
if (op.code !== 0) fail('插件安装失败:\n' + op.out);
console.log(op.out.trim());
console.log('\n完成。在任意 Claude Code 会话输入 /lucid 即可启动查看器(默认 http://127.0.0.1:8787)。');
console.log('后续升级:npx -y kw-lucid@latest');
