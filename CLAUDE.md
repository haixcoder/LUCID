# CLAUDE.md

本文件指导 Claude Code 在本仓库中的工作。修改本仓库代码前先读完本文件。

## 项目是什么

Claude Code 插件 **xray**：网页版 Workflow 执行进度实时查看器。
零依赖（仅 Python3 stdlib）、无构建步骤、服务只绑定 127.0.0.1。
本目录同时就是本地市场 `kw-dev-plugins`（`.claude-plugin/marketplace.json` 中 source 为 `"./"`）。

- 用户文档：`README.md`（原理、安装、页面功能、API、安全）
- webhook 详解：`scripts/README.md`

## 铁律（违反即 bug）

1. **零依赖**：`scripts/server.py` 与 `scripts/ccviewer/` 包只许 import stdlib。不引第三方包、不加 pip install 步骤。
2. **只读数据源**：扫描 `~/.claude/projects/` 永远只读；服务唯一可写目录是 `~/.claude/cc-viewer/`（config.json / sent.json / server.pid / cas.pem）。
3. **仅本机监听**：bind 地址硬编码 `127.0.0.1`，绝不改成 0.0.0.0；POST 保留 Origin 同源守卫。
4. **命令模板变量必须写花括号形式** `${CLAUDE_PLUGIN_ROOT}`——裸 `$CLAUDE_PLUGIN_ROOT` 不会被 Claude Code 展开，且该变量不存在于 Bash 工具环境（2026-09-04 实际踩坑：导致从项目源码而非已安装插件启动服务）。`commands/wf-view.md` 中已修复，勿回退。
5. **无测试基建**：验证手段 = `curl` 打 API + 浏览器人肉检查。改完必须至少跑通：`/api/runs` 返回 200 且 JSON 结构不变。
6. **前端一律 TypeScript（必须遵守）**：前端唯一合法源码是 `frontend/src/*.ts`（全局脚本模式，按文件名序拼接，不用 import/export）。
   - `scripts/ccviewer/static/index.html` 中主 `<script>` 块是 **build 产物，禁止手改**；改前端 = 改 `frontend/src/` → `python3 frontend/build.py`（tsc --strict 类型检查+编译 → 注入 `frontend/template.html`）。构建失败（任何类型错误）禁止部署。
   - 唯一保留的手写 JS 例外：`template.html` head 里的 3 行夜间主题 boot 片段（须先于 body 存在执行）；HTML/CSS 壳也手改 `template.html`（再 build）。
   - `frontend/dist/` 为中间产物（拼接源+编译 JS），不进安装副本；同步/安装只需 `scripts/`。
   - 后续本仓库所有新增/修改的前端逻辑都必须用 TS 编写；发现 index.html 与 `frontend/src` 不一致时，以 build 重建为准，禁止直接补丁产物。

## 双路径陷阱：源码 ≠ 运行副本

插件已安装后，**运行时加载的是缓存副本**，不是本仓库：

```
源码(本仓库)  ~/projectDir/cc-viewer/
安装副本      ~/.claude/plugins/cache/kw-dev-plugins/xray/<版本>/   ← 命令/服务实际从这里加载
```

- 改完源码必须同步：前端有改动先 `python3 frontend/build.py`（tsc 过编译，产物落 `static/index.html`）；然后 `claude plugin validate .` + `claude plugin install xray@kw-dev-plugins` 重装，或手动覆盖安装副本（版本目录一致时等效，**`scripts/` 含 `ccviewer/` 子包与 `static/`，拷贝要递归 `cp -R`；`frontend/` 是开发源码，不进安装副本**）。
- **正在运行的服务进程是旧代码**——重启才生效：
  `python3 <脚本路径> --stop`（按 PID 文件停），再后台启动**安装副本路径**的脚本。
- 排查"改了没生效"先 `ps -o command -p $(cat ~/.claude/cc-viewer/server.pid)` 看进程从哪份代码启动。

## 架构（多文件模块地图，按模块/函数名定位）

`scripts/server.py` 是薄入口（argparse / 启停 / 线程与端口装配），核心在 `scripts/ccviewer/` 包：

| 模块 | 职责 |
|------|------|
| `config.py` | `PROJ`/`CONF_DIR`/`PIDF` 路径、`CURRENT_PORT`（入口赋值，web 请求期以 `config.CURRENT_PORT` 属性读取）、`load_conf`/`save_conf`/`port_free` |
| `scan.py` | 扫描与状态重建（下表"扫描/存活"两层） |
| `agent.py` | `api_agent()` 单 agent 全文 |
| `sessions.py` | 主 agent 与子代理状态（`scan_sessions()`→`/api/sessions`）：**无权威 journal，尾窗启发式推断**——主:注册表 pid 存活且 120s 内有写入=running，活但更久=waiting，进程亡=ended；子:mtime<90s=running，尾行 `stop_reason==end_turn`=done，否则 idle。只扫"活跃或近 2h"会话，上限 40，转录只读尾 256KB 控制成本；**按步全文 `_step_detail` 例外:1MB 块反向深扫至 16MB**（截图附件是 MB 级 base64,会把旧步骤挤出固定尾窗;找不到返回 `miss:True`,前端必须显式提示而非静默空白） |
| `notify.py` | webhook 通知线程（下表） |
| `web.py` | HTTP handler `class H`、`make_server()`，启动时读入 `static/index.html` |
| `static/index.html` | 前端运行时文件：**HTML/CSS 壳 = `frontend/template.html`，脚本块 = `frontend/src/*.ts` 的 tsc 编译产物**（禁手改，见铁律 6） |
| `frontend/src/*.ts`（仓库根） | 前端 TS 源码：00-types(类型契约/共享状态) 10-util(mdLite 渲染器) 20-render(运行卡/会话卡) 30-app(轮询/diff 装配)；`build.py` 构建，`dist/` 为中间产物 |

分四层的行为要点：

| 层 | 入口 | 要点 |
|----|------|------|
| 扫描/状态重建 | `scan.scan()` → `parse_completed()` / `parse_live()` | run JSON **只在正常收尾时写**；进行中状态由 journal.jsonl + agent-*.jsonl 实时重建 |
| 存活判定 | `scan.live_session_ids()` + `scan.parse_live()` 尾部 | 权威信号 = `~/.claude/sessions/<pid>.json` 注册表且进程存活；父进程已死且有未完成 agent → `aborted`（孤儿），无 pending → `completed`；60s 宽限防竞态；`STALE_SEC=30min` 无活动 → `stale` |
| Webhook 通知 | `notify.notify_loop()` → `send_hook()` | 守护线程 5s 一轮；**启动首轮静默播种**（`sweep`，防历史运行刷屏）；去重靠 sent.json（保留 800 条）；macOS 钥匙串导出 CA 解决公司 TLS 代理（`macOS_ca_bundle()`，每日刷新） |
| HTTP 端点 | `web.class H` | API：`/api/runs` `/api/sessions` `/api/agent` `/api/subagent` `/api/config` `/api/config/save` `/api/config/test` |

端口优先级：**config.json 的 port > `--port` 参数**；网页改端口保存后服务 `os.execv` 自重启到新端口（PID 不变），响应带 `reloc` 字段由页面自动跳转。

缓存三件套（进程内，勿轻易失效）：`_WF_CACHE`（已完结 run 的 name/phases 永不过期）、`scan_cached(6)`（notify 线程复用 6s 内扫描，省一半全盘 I/O）、前端 `CARDS`/`FULL`。

## 前端不变量（改 frontend/src/*.ts 时必读，改完 `python3 frontend/build.py`）

这些是历史 bug 换来的教训，破坏会复发：

- **按卡 diff 渲染**（`render()`）：完成卡数据冻结 → HTML 串不变 → DOM 不重建，滚动/选中不跳。不许改回整体 innerHTML 重绘。
- 会话卡区（`renderSessions`/`SCARDS`，#sess）复刻同一按卡 diff 契约与 ref 同步规则，改一处两处同审；其抽屉 `data-src="S|proj|sess|agent[#msgId]"` 走 `/api/subagent`（toggle 监听器双容器复用 `onToggle`）。
- **卡 HTML 字符串禁止内嵌逐秒变化字段**（曾内嵌 `ageSec"Ns 前"` → 每轮 diff 必失配重建 → 展开的 details"点开即关"）：时间一律 `fmtC(epochMs)`，并保留 renderSessions 的 open/滚动快照恢复；步骤/抽屉的稳定键一律用 `message.id`（尾窗滑动不漂移）。
- **渲染转录/子代理文本必须先过 `unent()`**（实体转义竖线 `&#124;`/`&amp;#124;` 不解码则 mdLite 认不出表格、页面露出转义串），再进 `mdLite(wrapLong/pretty(...))`；行内预览不许再用裸 `inlineMd` 渲染可能含块级 md 的内容。
- **outerHTML 后 `ref` 同步**：替换节点若正被 `ref`（insertBefore 锚点）引用，必须指向新节点，否则抛 NotFoundError 打断整轮渲染（曾伪装成"链路中断"）。
- **tick 的 try/catch 分离**：fetch 失败与 render 失败必须分开报告——JS bug 不许冒充掉线（见 `tick()` 注释）。
- **详情抽屉滚动位置 / details 展开态**跨轮询保持（`sc` 快照 + `open` 集合恢复）；全文靠 `FULL` 缓存 + `/api/agent` 首次展开拉取。
- `mdLite` 用 \u0001 控制字符做占位符抽取围栏/表格，改动分段逻辑注意转义。

## 开发/验证速查

```bash
python3 frontend/build.py                # 前端:TS→tsc --strict→注入产物(首次自动抽 template.html)
python3 scripts/server.py                # 前台启动（默认 8787，config 优先）
python3 scripts/server.py --stop         # 按 PID 优雅停止
curl -s http://127.0.0.1:8787/api/runs | python3 -m json.tool | head   # 快照结构
curl -s http://127.0.0.1:8787/api/config                              # webhook 配置+最近推送
claude plugin validate .                 # 校验两份清单（CI 加 --strict）
```

数据目录探针（判断解析逻辑是否仍适配）：`~/.claude/projects/<proj>/<sess>/workflows/wf_*.json`、
`.../subagents/workflows/wf_*/journal.jsonl`、`.../workflows/scripts/<name>-wf_*.js`。

## 版本管理

本仓库是 git 仓库（2026-09-04 起）。改 `.claude-plugin/plugin.json` 的 `version` 后重装会落到新的 cache 目录，旧版本残留可清理；只改代码不升版本则覆盖同目录（重装前先 `--stop` 旧进程）。
