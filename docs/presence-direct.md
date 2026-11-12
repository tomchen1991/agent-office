# 静态办公室：浏览器计算 + Nginx 同源 WSS

## 链路

`浏览器 → wss://office.falsita.cn/api/presence/v1/ws → Nginx → ws://127.0.0.1:18788/api/presence/v1/ws`

Office 不再运行 Node 服务。Nginx 只转发协议，不转换数据、不共享连接；每个页面独立订阅。`src/presence.ts` 在浏览器完成原始快照转换、角色映射、协作分组及座位分配。页面刷新重新分配，断线重连保留当前页面分配。

## 访问边界（用户授权的 Nginx 方案）

采集服务新版本的 WSS 是匿名公开只读：不需要 consumer Bearer，Cookie 不建立会话，但只允许自身浏览器 Origin，或者无 Origin 的机器客户端。已实测 Office Origin 直连返回 403，Collect Origin 返回 101。

因此不直接跨域连接，不伪造 Collect Origin。Office Nginx **先严格验证** `Origin: https://office.falsita.cn`，再将可信 loopback 跳作为无 Origin 的机器只读订阅：

- 只代理精确 `/api/presence/v1/ws`，仅 GET、WebSocket Upgrade，无查询参数。
- 缺失、null、其他 Origin 一律 403；Origin 检查通过后才移除上游 Origin。
- 清除 Authorization、Cookie 及转发身份头，不读取或注入机器 token。
- 固定上游 loopback、固定 Host；其他 `/api/` 返回 404；不开放管理或上报接口。
- 每 IP 最多 4 条、Office 总计最多 12 条连接；握手每 IP 每秒 1 次、burst 5；超额 429。采集服务本身仍有独立额度，其他消费者可能导致其提前耗尽。
- 禁止缓存/buffering，read timeout 75 秒，CSP connect-src 仅 self。

这是显式的边缘信任边界，不是让采集服务全局接受任意 Origin。Origin 不是用户身份鉴权，非浏览器可以伪造它；本站仍是业主此前要求的公开只读展示，知道地址的人可以读取任务/仓库等公开 presence 数据。若要限制观看者，应额外加真实会话鉴权，不应把 Origin 当密码。

## 前端配置

默认 `VITE_PRESENCE_WS_URL=wss://office.falsita.cn/api/presence/v1/ws`。不得将 token 放进 VITE 环境变量、bundle、URL、storage 或 subprotocol。地址只允许 WSS，开发允许 loopback WS，拒绝凭证/query/fragment。

`src/presenceConfig.ts` 的公开映射只迁移了旧配置中的 sourceCharacters/sourceLabels；未复制 enabled/token。映射不是权限控制。

本地 Vite 无反代，localhost Origin 不在生产 relay 的允许范围。开发使用显式本地测试端点或 `?simulate=1`，不要放宽生产 Origin 检查。

## 生命周期和验证

`src/presenceStream.ts` 校验完整快照、sequence、process epoch、大小及心跳。断连保留最后观察但不刷新新鲜度；隐藏页面关闭连接，恢复重连；旧连接回调隔离。浏览器自动响应协议 ping/pong，不发送应用消息。HTTP 401/403 在浏览器仅表现为通用错误，不伪称已识别状态码。

上线须验证真实 WSS initial/heartbeat、拒绝错误 Origin/缺失 Origin/查询参数、浏览器连接及旧 API 404，再停止旧 agent-office.service。只改 Office vhost，不改采集服务配置或重启采集服务。保留旧 release、vhost、service enabled 状态及私有配置用于回退。

回退：恢复旧 current 符号链接、旧 Office Nginx 配置，nginx -t 后 reload，恢复旧 Office service。不要删除依赖旧 release 的 node_modules 或私有机器凭证。

保留的 `server/collect.ts`、`server/electronBridge.ts` 是可选 Electron main 进程适配库，不是 HTTP 服务，不被网页导入。
