# XRay 插件

<p align="center"><img src="assets/xray-logo.svg" alt="XRay" width="180"></p>

Claude Code 插件:网页版 Workflow 执行进度实时查看器。零依赖(Python3 stdlib),无需构建,服务仅监听 127.0.0.1。

## 插件结构

```
cc-viewer/
├── .claude-plugin/
│   ├── plugin.json        # 插件清单(名称/描述/版本,plugin manager 展示来源)
│   └── marketplace.json   # 市场清单 —— 本目录同时就是 kw-dev-plugins 市场(插件 source 为 "./")
├── frontend/              # 前端源码(TS,仅开发用;运行时零依赖不变)
│   ├── src/*.ts           # 00-types/10-util/20-render/30-app,按名序拼接为全局脚本
│   ├── template.html      # HTML/CSS 壳(手写;含 3 行主题 boot 内联脚本)
│   ├── build.py           # 构建:拼接→tsc --strict→注入产物到 scripts/ccviewer/static/index.html
│   └── dist/              # 中间产物(不进安装副本)
├── commands/
│   └── wf-view.md         # /wf-view 斜杠命令(commands/ 自动发现,无需在清单中声明)
└── scripts/
    ├── server.py          # 入口:参数解析、启动/停止(核心逻辑在 ccviewer/ 包)
    ├── README.md          # webhook 通知钩子详解
    └── ccviewer/          # 内核包(仅 stdlib)
        ├── config.py      # 路径/端口/PID 与配置读写
        ├── scan.py        # 扫描 ~/.claude/projects 与运行状态重建
        ├── agent.py       # 单 agent 完整 prompt/result 全文
        ├── sessions.py    # 主 agent + 非 workflow 子代理状态推断
        ├── notify.py      # webhook 终态通知线程(飞书/通用 JSON)
        ├── web.py         # HTTP handler(页面 + JSON API)
        └── static/index.html  # 前端运行时文件(由 frontend/ 构建产生,勿手改脚本块;插件分发/运行时仍无构建)
```

## 原理

Claude Code 把 workflow 运行状态落盘在 `~/.claude/projects/<项目>/<session>/` 下(实测):

| 文件 | 时机 | 内容 |
|------|------|------|
| `workflows/wf_*.json` | 仅完成时写入 | 完整 `workflowProgress`(agent 状态/tokens/耗时/phase)、logs、result |
| `subagents/workflows/wf_*/journal.jsonl` | 实时追加 | 每个 agent 的 `started`/`result` 事件 |
| `subagents/workflows/wf_*/agent-*.jsonl` | 实时增长 | agent 完整转录(tail 可得最近工具) |
| `<cwd项目>/<session>/workflows/scripts/<name>-wf_*.js` | 启动即写 | meta.name / phases |

服务器合并两个数据源:**已完成的读 run JSON(全量富数据),进行中的由 journal + 转录实时重建**,
前端每 2 秒轮询 `/api/runs` 刷新。

## 安装

```bash
claude plugin marketplace add ~/projectDir/cc-viewer     # 注册本地市场(本目录兼作市场 kw-dev-plugins)
claude plugin install xray@kw-dev-plugins     # 安装插件
```

验证与管理:

```bash
claude plugin list                                    # 应见 xray@kw-dev-plugins ✔ enabled
claude plugin details xray@kw-dev-plugins  # 组件清单(wf-view 命令、token 成本)
claude plugin validate ~/projectDir/cc-viewer         # 改源码后校验两份清单(CI 加 --strict)
claude plugin install xray@kw-dev-plugins  # 改源码后重新安装生效
claude plugin uninstall xray@kw-dev-plugins && claude plugin marketplace remove kw-dev-plugins
```

## 使用

在任意 Claude Code 会话中输入 `/wf-view` —— 自动启动服务(端口 8787)并打开浏览器。

或手动:

```bash
python3 scripts/server.py --port 8787   # 打开 http://127.0.0.1:8787
python3 scripts/server.py --stop        # 按 PID 文件优雅停止(免 lsof|kill)
```

### /wf-view 命令做什么

1. 读 `~/.claude/cc-viewer/config.json` 取端口(网页设置优先于默认 8787);
2. `curl /api/runs` 探测 —— 服务已在运行则直接复用;
3. 未运行则后台(run_in_background)拉起 `server.py`,等 1 秒确认 200;
4. `open http://127.0.0.1:<PORT>` 并汇报进行/完成数量与页面用法。

### server.py 参数

| 参数 | 说明 |
|------|------|
| `--port N` | 默认端口;**config.json 里网页保存过的端口优先于此参数**(改回需清 config 的 port 字段) |
| `--stop` | 读 PID 文件发 SIGTERM 停止 |

端口被占用时服务直接退出并提示改 config 或换 `--port`;网页改端口保存后服务 `execv` 自重启到新端口(PID 不变),页面自动跳转。

## 页面功能

**AGENT 状态区**(会话卡:主 agent 状态/pending 工具/尾窗 tokens/权限模式/最近输入输出 + 子代理表:类型/模型/状态/最近工具/tokens/最后活动)、
运行列表(进行中置顶)、状态徽章(running/completed/failed/killed/stale/aborted)、phase 条、
agent 表格(状态/最近工具/tokens/耗时)、**点击 agent 行全宽展开详情抽屉——自动从 `/api/agent`
拉取完整 prompt/result(transcript+journal 全文,替换截断预览),pane 内下拉滚动且滚动位置跨轮询保持**、
日志尾、按项目筛选、全文搜索(名称/runId/任务/状态)、自动刷新开关、☀日光/☾磷光双主题(localStorage 记忆)。

顶部仪表盘汇总运行/告警计数;右上「⚙ 设置」四块:①通知钩子 ②端口 ③主题 ④自动扫描,底栏统一保存。

## 状态语义

| 状态 | 判定规则 |
|------|----------|
| `running` | 父会话进程存活(`~/.claude/sessions/<pid>.json` 注册表)且 30 分钟内有文件活动 |
| `stale` | 进程存活但 >30 min 无文件活动(疑似挂起) |
| `completed` | run JSON 正常收尾;或父进程已退出且无未完成 agent(孤儿但已齐) |
| `failed` / `killed` | run JSON 记录(agent 失败 / 用户终止) |
| `aborted` | 孤儿运行:父会话进程已死且仍有未完成 agent(相应 agent 标 aborted) |

扫描范围:最近 14 天内有活动的 session 目录;进程内对已完结 run 的元数据永久缓存。

## 数据与配置文件

| 路径 | 内容 |
|------|------|
| `~/.claude/cc-viewer/config.json` | port + webhook 配置(enabled/format/url/insecure) |
| `~/.claude/cc-viewer/sent.json` | 终态通知去重(保留最近 800 条,跨重启不重发;启动首轮静默播种历史运行) |
| `~/.claude/cc-viewer/server.pid` | 服务 PID(`--stop` 依据) |

数据源只读 `~/.claude/projects/`,本服务不写任何项目数据。

## HTTP API

| 端点 | 说明 |
|------|------|
| `GET /api/runs` | 全量运行快照(`{now, runs[]}`;进行中由 journal/转录实时重建) |
| `GET /api/sessions` | 会话状态:主 agent(注册表判活 + 转录尾窗推断 running/waiting/ended、pending 工具、tokens、权限模式)+ 尾窗 30 条执行步骤 steps[](按 message.id 聚合:工具/输出预览/tokens/时间) + 全部非 workflow 子代理(task/teammate,running/done/idle);含活跃会话与最近 2h 会话,上限 40 |
| `GET /api/agent?proj=&sess=&run=&agent=` | 单 agent 完整转录 + journal 事件(详情抽屉数据源) |
| `GET /api/subagent?proj=&sess=&agent=[&msg=]` | 会话层全文抽屉:`agent=main` 返回主会话最近输入/输出全文;加 `msg=<messageId>` 返回该执行步骤全文(工具入参 + 输出);否则返回非 workflow 子代理的任务(首条 user)与结果(末条 assistant) |
| `GET /api/config` | 当前 webhook 配置 + 最近一次推送结果 |
| `POST /api/config/save` | 保存配置(URL 须 http(s)、端口 1-65535 且空闲才写入;改端口触发自重启) |
| `POST /api/config/test` | 发送一条测试通知验证连通 |

## 通知钩子

workflow 进入**终态**时由服务器后台线程(5s 扫描,不要求浏览器开着)推送飞书/通用 JSON,
含任务名+状态、描述摘要、项目与 runId、消费 tokens、用时、agent 完成数、产物概要。
配置入口在页面「⚙ 设置 → 通知钩子」,详见 [scripts/README.md](scripts/README.md)。

## 安全

- 仅绑定 `127.0.0.1`,不对外网开放;
- 所有 POST 带同源 Origin 守卫(防任意网页 DNS rebinding 后改配置 / 重定向 webhook 做外泄通道),无 Origin 的脚本调用放行;
- webhook 的 HTTPS 在公司 TLS 代理下自动导出 macOS 钥匙串根证书(含 MDM 代理根)完成校验,「跳过证书校验」仅作兜底。
