---
description: 启动 Lucid 网页查看器,实时透视 Workflow / Agent 执行并打开浏览器
allowed-tools: Bash(python3:*), Bash(curl:*), Bash(open:*), Bash(lsof:*), Bash(cat:*)
---

启动 Lucid 网页查看器：

1. 读取端口（网页"⚙ 设置"可改，config 优先于默认 8787）：
   `python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.claude/cc-viewer/config.json'))).get('port') or 8787)" 2>/dev/null || echo 8787`
   记为 PORT。
2. 探测服务是否已在运行：`curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:$PORT/api/runs`
   - 返回 200 → 跳到第 4 步。
3. 未运行则用 Bash（run_in_background: true）启动：
   `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/server.py"`（不传 --port，服务自动按 config 端口监听）
   等 1 秒后重试第 2 步确认 200；若启动即退出，读其 stderr——多为端口被占用，按提示改
   `~/.claude/cc-viewer/config.json` 的 port 或换 `--port` 启动。
4. 打开页面：`open http://127.0.0.1:$PORT`
5. 回复用户：查看器地址、当前进行中/已完成的 workflow 数量（可从 `/api/runs` 响应统计），
   并说明页面每 2 秒自动刷新、可下拉筛选项目、可搜索（名称/runId/任务/状态）；通知钩子与端口
   均在页面"⚙ 设置"里配置（改端口保存后服务自动重启、页面随跳转）；停止服务用
   `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/server.py" --stop`（按 PID 文件优雅停止，免 lsof|kill）。
