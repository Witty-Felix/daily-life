# 01 — 现有后端与数据模型复用边界

Type: research
Status: resolved
Blocked by: None

## Question

当前功过格 HTTP API、账户认证、SQLite 实现和贪吃蛇领域逻辑中，哪些可以直接用于生产云端存储？需要补充哪些数据表、API 或测试，尤其要确保功过格按账户隔离、贪吃蛇只保存个人最高分、课间休息仍为本地功能？

## Answer

现有 Node HTTP 服务、`VirtueApi`/`HttpVirtueApi`、SQLite 功过格适配器和自托管认证可以作为生产主线复用，但需先补齐 schema migration、认证限流/审计、令牌存储策略和 SQLite 并发配置验证。Supabase 当前不宜直接上线：迁移缺少 `virtue_accounts`，且迁移批次提交的原子性未被证明。贪吃蛇当前只有局内分数；若确认新增需求，只实现账户私有个人最高分的原子 max，不做排行榜，也不接入课间数据。

验证：节点完成只读代码审查；现有 Vitest 14 个测试文件、77 个测试通过。未完成真实 Supabase、生产部署和并发压测验证。
