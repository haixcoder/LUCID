# cc-viewer 内核包（仅 stdlib）。数据源实测结论（2026-09-03 探针验证）：
#   - <session>/workflows/wf_*.json         仅在【完成时】写入，含完整 workflowProgress（富数据）
#   - <session>/subagents/workflows/wf_*/   运行中即存在：journal.jsonl(started/result 事件,实时)
#                                           + agent-*.jsonl(实时增长) + *.meta.json(agentType)
#   - <session>/workflows/scripts/<name>-wf_*.js  启动即写入，可正则出 meta.name/phases
# 入口 ../server.py 负责参数解析与启停；本包模块：
#   config  路径/端口/PID 与配置读写 | scan 扫描与状态重建 | agent 单 agent 全文
#   notify  webhook 终态通知线程    | web   HTTP handler 与前端页
