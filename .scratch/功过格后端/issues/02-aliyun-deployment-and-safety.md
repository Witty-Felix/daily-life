# 02 — 阿里云宝塔部署、备案与数据安全

Type: research
Status: resolved
Blocked by: None

## Question

在用户的阿里云服务器、宝塔面板和即将完成备案的域名上，如何以最小可靠方案部署现有 Node API + SQLite + 前端？需要怎样安排备案前测试、DNS、HTTPS、反向代理、进程托管、SQLite 备份、恢复和回滚？哪些内容必须在实施前用阿里云/宝塔官方文档复核？

## Answer

推荐单机部署：浏览器 → HTTPS/Nginx → `127.0.0.1:8787` Node API → `/var/lib/virtue/virtue.sqlite`。使用版本化 release + `current` 符号链接，systemd 托管 Node，数据库和备份置于 Web 根目录之外；公网只开放 80/443，8787、SSH 和宝塔面板按最小权限限制。备案完成前仅做本机、SSH 隧道或受控网络验收，不把未备案正式域名公开解析到中国大陆服务器。正式上线前锁定规范域名并使 `VIRTUE_RP_ID`、`VIRTUE_WEB_ORIGIN`、`VITE_VIRTUE_API_URL` 完全一致；备份使用 SQLite backup + `PRAGMA integrity_check`，必须进行恢复演练。

验证：部署节点完成仓库和部署模板审查；未连接服务器、未修改配置、未处理凭据。阿里云备案和证书规则需上线时按官方控制台/文档复核。
