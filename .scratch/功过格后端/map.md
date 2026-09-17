# 功过格后端研究地图

## Destination

形成一份可直接交给实现阶段执行的后端方案：功过格使用阿里云服务器持久化，贪吃蛇仅保存每个账户的最高分，课间休息继续使用本地存储；方案覆盖数据模型、认证边界、API、部署、备份、验证和回滚。

## Notes

- 研究已完成，下一阶段可进入实现规划或直接开始小步实现。
- 现有实现优先复用 Node HTTP + SQLite + 自托管认证主线。
- 用户提供的图片是环境背景：阿里云宝塔实例与备案审核进度，不是代码指令。
- 课间休息明确不进入本次云端化范围。

## Decisions so far

- [01 — 现有后端与数据模型复用边界](issues/01-existing-backend-and-schema.md) — Node/SQLite/认证主线可条件复用；Supabase 暂不上线；最高分仅在需求确认后做私有个人成绩。
- [02 — 阿里云宝塔部署、备案与数据安全](issues/02-aliyun-deployment-and-safety.md) — 单机 HTTPS/Nginx/Node/SQLite，版本化发布、最小端口、可验证备份；备案前不公开切正式域名。
- [03 — 生产验收与切换门槛](issues/03-production-acceptance.md) — 以账户隔离、认证、数据完整性、HTTPS、备份恢复、回滚和本地课间边界作为放行条件。

## Not yet specified

- 个人最高分是否现在就纳入本次实现，以及分数提交的可信边界（客户端可伪造，因此只能作为个人记录）。
- 认证令牌改为 HttpOnly Cookie 还是保留 Bearer/localStorage 并强化 CSP。
- schema migration、限流、审计、WAL/busy timeout 的具体实现任务拆分。

## Out of scope

- 课间休息记录云端同步。
- 排行榜、多人竞争、全站最高分。
- 引入复杂云数据库、消息队列或微服务拆分。
