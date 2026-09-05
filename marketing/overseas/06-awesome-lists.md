# GitHub awesome 清单 / 收录站提交

长尾流量最稳的渠道:清单页有 Google 权重,吃常年搜索流量。**提 PR 前先读各仓库 CONTRIBUTING**(格式要求通常很严格,一行 description 超字数都会被拒)。

## 提交目标(逐个核对是否收录 Claude Code 插件类目)

| 目标 | 说明 |
|------|------|
| `helloianneo/awesome-claude-code-plugins` 等 awesome-claude-code(-plugins) 系仓库 | GitHub 搜 "awesome claude code",挑 3~5 个 star 高、近期有维护(最近有 merged PR)的提 PR;别碰僵尸仓库 |
| builtwithclaude.com | Claude 生态收录站,有 submit 入口 |
| awesome-python 的 "Development Tools"?(观望) | 门槛极高且 Lucid  niche,除非零依赖角度写得漂亮,否则性价比低,**不优先** |
| 各 Claude Code 中文社区的 README/资源汇总仓库 | 搜索 "claude code 中文 插件 awesome",顺带收进国内渠道 |

## 条目文案(按清单格式微调)

**EN(一行式,多数 awesome 要求)**:

```
[Lucid](https://github.com/haixcoder/LUCID) - Live web dashboard for Claude Code agent workflows: per-agent tools/tokens/elapsed, full prompt/result drawers, "waiting on you" alerts with webhook push. Zero deps, local-only.
```

**短版(字符数紧的清单)**:

```
[Lucid](https://github.com/haixcoder/LUCID) - Zero-dependency real-time viewer for Claude Code workflows & agents (local-only).
```

**CN(中文清单)**:

```
[Lucid](https://github.com/haixcoder/LUCID) - Claude Code 实时透视面板:网页查看每个 agent 的阶段/工具/token 消耗,全文抽屉 + 「在等你」告警推送。零依赖、纯本机只读。
```

## PR 描述模板

```
Adding Lucid — a Claude Code plugin (live workflow/agent viewer, zero deps,
binds 127.0.0.1 only). Checked against contributing guidelines: single line,
starts with link, dash description, no emoji. Happy to adjust wording.
```

## 注意

- 一次只提一个清单、间隔几天,别同天群发(会被 maintainer 圈互通拉黑);
- PR 被拒别重提同一仓库同一内容,先问 review 意见;
- 清单条目链接统一指 `haixcoder/LUCID`(仓库已改名,旧 XRay 链接/引用在物料里全部更新)。
