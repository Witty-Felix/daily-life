# 功过格云端后端运行说明

## 本地启动

要求 Node.js 24+。初始化一个邀请账户并生成一次性恢复码：

```powershell
$env:VIRTUE_DB_PATH = "data/virtue.sqlite"
npm run invite:account -- alice
npm run start:server
```

服务默认监听 `8787`，可通过 `PORT` 修改。Passkey 生产配置还需设置 `VIRTUE_RP_ID`、`VIRTUE_WEB_ORIGIN` 和可选的 `VIRTUE_RP_NAME`。前端云端模式使用：

```powershell
$env:VITE_VIRTUE_API_URL = "http://localhost:8787"
npm run dev
```

生产环境必须通过 HTTPS 反向代理暴露服务；不要把 SQLite 文件放入静态前端目录，不要把恢复码写入日志或提交到仓库。

## 临时 Supabase 阶段

Supabase 只承载 Edge Function/API 边界和认证/数据库服务。浏览器使用 `createSupabaseVirtueApi`，不读取 Supabase 表结构：

```ts
const api = createSupabaseVirtueApi({
  baseUrl: "https://<project>.supabase.co/functions/v1/virtue-api",
  getAccessToken: () => sessionToken,
});
```

Edge Function 必须把请求转发到与 `virtueServer` 相同的 provider-neutral HTTP 契约。高权限 Supabase key 仅放在 Edge Function 的服务端密钥中。

## 迁移验收

迁移窗口内先导出源端 JSON，再执行目标端 preview/commit。必须核对：

- 记录数量
- 善行数量、过失数量、净分
- 日期范围
- 每条修正链长度和内容
- 永久删除清单

目标端导入完成后再次导出并逐项比较；任何一项不一致都不得切换 DNS。保留源端只读副本，直到回滚窗口结束。
