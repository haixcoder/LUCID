# 掘金 — 技术长文

**分类/标签**:前端/后端不限,标签打 `Claude Code`、`AI 编程`、`开源`、`开发工具`、`Python`。
**配图**:正文图片位置已留占位(README 首屏截图、全文抽屉、⏸ 等待卡、五主题),发布前替换成打码后的真实截图或 GIF。

## 标题(三选一)

```
Claude Code 的 Workflow 是黑盒?我做了个零依赖的实时透视面板(开源)
```
```
不再盲跑 Agent:给 Claude Code 写了个「谁在等我」实时仪表盘,纯 Python 标准库
```
```
扒完 Claude Code 的落盘文件后,我做了个 2 秒一帧的 Workflow 透视网页(零依赖)
```

## 正文

## 痛点:跑起来就看不见了

用 Claude Code Workflow 并行开过多个子代理的,应该都熟悉这种时刻:

- 终端转着圈,11 个 agent 在跑,**哪一个卡住了?在跑什么工具?烧了多少 token?**不知道;
- 更贵的一种:切出去干了半小时别的活,回来发现其中一个会话**早在等你点授权**,整个链路停了半小时。

根源很朴素:**Claude Code 的 workflow 运行状态,要到正常收尾才会写成一份完整可读的 run JSON**。进行中的真相散落在 journal 事件流和每个 agent 的转录里,没有一个面板替你看。

我做了一个插件来填这个坑:**Lucid**([github.com/haixcoder/LUCID](https://github.com/haixcoder/LUCID))。`/lucid` 一敲,浏览器打开一个本地网页,2 秒一帧,实时透视每一次运行。

![此处:仪表盘全景截图]

## 页面上能看到什么

**运行卡**:每个 workflow 一张卡 —— phase 进度条、agent 表格(状态 / 最近一次工具调用 / tokens / 用时)、运行产物、系统日志尾。进行中的置顶,已完成的随时回看(回看窗口默认近 14 天可调)。

**全文抽屉**:点任意 agent 或步骤行,全宽展开,**完整的 prompt / result** —— 不是截断预览,是对转录做反向深扫拼出来的全文。

**会话监控**:不止 workflow,所有会话(包括没有子代理的纯交互会话)都在这里:主 agent 是 running / waiting / ended 还是 **input_required(在等你)**。等待原因分三档:

- **等待回答**(挂起了 AskUserQuestion / ExitPlanMode)
- **等待授权(疑似)**(某工具挂起且已静默 ≥ 2 分钟)
- **回合已完**(模型正常交回话轮 —— 这不叫卡住,页面用安静的青色徽标,不占用告警)

真卡住的会话**置顶 + 反白 ⏸ 高亮**,仪表盘 ALERT 计数跟着走。不开浏览器也行:后台线程往**飞书或任意通用 JSON webhook** 推两类消息 —— workflow 到终态、会话开始等你。真痛点从来是"它卡住了在等我",不是"它跑完了快来看"。

![此处:⏸ 等待高亮卡截图]

## 原理:只读 Claude Code 自己写的文件

Lucid 不拦截、不注入、不修改任何东西 —— 它只读 Claude Code 本来就落盘的状态文件(`~/.claude/projects/<项目>/<session>/` 下,实测):

| 文件 | 写入时机 | 内容 |
|------|----------|------|
| `workflows/wf_*.json` | **仅完成时** | 完整 workflowProgress(agent/tokens/耗时/phase) |
| `subagents/workflows/wf_*/journal.jsonl` | 实时追加 | 每个 agent 的 started / result 事件 |
| `subagents/workflows/wf_*/agent-*.jsonl` | 实时增长 | agent 完整转录(tail 即最近工具) |
| `workflows/scripts/<name>-wf_*.js` | 启动即写 | 任务名 / phases 定义 |

策略一句话:**已完结的读 run JSON(全量富数据);进行中的由 journal + 转录实时重建**。

存活判定不用猜:以 `~/.claude/sessions/<pid>.json` 注册表 + 进程是否活着为准 —— 父进程已死且仍有未完成 agent,判 `aborted`(孤儿运行)。这个信号把"我 Ctrl-C 了终端"和"任务真挂了"区分开,是我自己用得最多的一条。

![此处:架构示意或代码目录截图]

## 几个有意思的实现细节

**1)「等授权」和「一条长命令还在跑」在转录里同形。** 没有权威 journal 告诉你"现在在等什么",只能启发式:工具挂起 + 静默超 2 分钟 → 标注为"**疑似**卡在授权"。宁可标注不确定性,不假装知道。

**2)成本受控的读取。** 会话转录默认只读尾窗 256KB;步骤全文走按消息锚定的反向深扫(1MB 块,上限 16MB)。深扫也找不到时,前端显式提示「该步已超出转录留存范围」,绝不静默留白。

**3)轮询不能打断阅读。** 已完成的卡数据冻结 → HTML 串稳定 → DOM 永不重建(按卡 diff);只有数据真变的卡局部重建,重建时恢复展开态和滚动位置。另外浏览器会把后台标签页的定时器降到约 1 次/分钟 —— 所以页面恢复可见时立即补扫一轮,不然"终端输完切回页面还是旧状态"。

**4)零依赖是铁律。** 服务端纯 Python3 标准库,没有一行 pip 安装;前端用 TS 写、但产物预编译进单个 index.html,运行时没有构建步骤。只监听 `127.0.0.1`,唯一可写目录是它自己的配置目录;所有 POST 带同源 Origin 守卫(一个本机端口被任意网页 DNS rebinding 打进来改配置,就是外泄通道的雏形)。

**5)自启动,然后消失在日常里。** SessionStart 钩子(任意版本可用)+ 官方后台 monitor 双触发口拉起一个常驻看护循环:TCP 探活,服务没跑就 setsid 分离启动,崩了自动重启 —— 服务和看护进程都独立于你的会话存活。

## 装一下,两行

前提:macOS / Linux,Claude Code 2.0+,Python 3.9+。

```bash
claude plugin marketplace add haixcoder/LUCID
claude plugin install lucid@kw-dev-plugins
```

任意会话里 `/lucid`,浏览器就开了(默认端口 8787)。界面支持中/英/西/法/德五语、五种主题,项目筛选、全文搜索、webhook 都在 ⚙ 设置里。

源码在这里:[github.com/haixcoder/LUCID](https://github.com/haixcoder/LUCID)。回归测试已入库(后端 fixture + 真起服务的 HTTP 全链路,前端无头 DOM 桩 + 黄金快照),欢迎来提 issue —— 特别是"你的状态推断在我这儿不准"这种,真实使用场景永远比我的想象多。

---

**发布提醒**:掘金允许外链但建议正文同时放纯文本仓库地址防吞;摘要栏填"零依赖纯本机,Claude Code 每个 agent 在干嘛、谁在等你,2 秒一帧看得见"。
