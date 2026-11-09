# Presence WebSocket 消费

已于2026-11-09在完成上游及候选浏览器联调后部署。版本、验证与回退见 [office-deployment.md](office-deployment.md)。

## 链路

浏览器不再每5秒请求HTTP，改连同源 `/api/office/presence/ws`。Node代理持有私有consumer token，并连接固定 `wss://collect.falsita.cn/api/presence/v1/ws`；同机 `OFFICE_PRESENCE_LOOPBACK=1` 改用固定 `ws://127.0.0.1:18788` 并保留collector Host。不透传浏览器Origin/Cookie，不使用URL token，不接受远端重定向。

**多个浏览器共用一条上游连接**，最多32个浏览器；最后一个离开关闭上游。每次新建上游重读私有配置。上游初始快照到达前不会发布连接成功；后来加入者接收缓存全量，但用单调时间扣减剩余有效期，不因加入而刷新旧观察的新鲜度。

HTTP只读接口保留兼容，页面不降级轮询。旧Node/Electron `/v1/status` adapter不在此次presence链路中，未改动。

## 最终上游协议

已核对采集服务 `docs/37-presence-websocket.md` 和 `src/presence/ws-contracts.ts`。仅独立consumer Bearer、有agent_presence kind权限并裁剪source scopes；不能使用producer或管理员凭证。

每条UTF-8 JSON为现有完整PresenceList顶层字段，另加：

```ts
{ type: 'snapshot', reason: 'initial' | 'change' | 'heartbeat', sequence: number }
```

- initial立即同步；状态、元数据、失鲜或过期移除时推change完整集合；每15秒heartbeat完整集合。
- 每连接sequence从1严格连续递增，第一条必须initial；拒绝重复initial、跳号/倒序及连接内processId变化。
- 每条均完整替换，不是delta：缺席实例移除，空数组清空。complete只指内存中全部授权保留实例，不是所有应上报设备或退出证明。
- 代理只转发白名单DTO，不暴露token和其他原始字段。下游同样使用snapshot/reason/sequence，但sequence是该浏览器连接内从1递增的编号，不是上游游标。
- ws标准库自动回复服务端ping；不发送应用消息或主动ping。传输ping不延长应用观察的新鲜度。

## 故障和边界

- 上下游35秒未收到合法业务快照则判不可用。断线保留旧详情但不刷新快照时间、不继续显示在线工作动作。
- 浏览器1秒起指数退避，最多30秒；429映射下游1013且至少5秒退避；401/403或配置禁用映射4403，停止自动重试，修复服务端配置后刷新页面。
- 隐藏/pagehide关闭连接，恢复/online立即重连；仅当前连接可发布，Strict Mode和旧连接迟到消息无效。
- 后端限制1 MiB上游帧/下游编码/发送缓冲，单次发送1秒deadline、至多一条在途发送，慢浏览器单独断开。无待发队列。
- 浏览器端校验Host、Origin、精确路径；拒绝query token/subprotocol，禁止客户端应用写入。沿用现有只读展示范围和Nginx访问策略，不增加任何写入或远程控制。
- 机器凭证和外观配置修改在下次上游重连时生效；需要立即生效时重启办公室后端。机器token撤销/冷轮换按采集服务运维约定执行。

## 发布边界与验证

在用户明确授权后，已部署WS Upgrade及75秒read timeout配置，并完成公网collector WSS、候选代理/Chrome及生产办公室Chrome只读验证。仅重启agent-office；不修改采集服务、真实凭证或来源开关。生产Chrome验证无旧HTTP轮询、收到初始/变化/保活、无应用异常；Cloudflare额外注入的统计脚本被既有CSP拦截，单独记录、不放宽策略。详细证据与限制见部署记录。

- `npm run typecheck`、`npm run build`：通过。
- `node --test tests/presence-stream-server.test.ts tests/presence-office-mounted.test.ts tests/presence-proxy.test.ts`：22项通过，使用合成token和临时loopback；覆盖共享上游、缓存年龄、空集替换、序列校验、授权失败、浏览器恢复和旧消息隔离。
- 最终协议对齐前运行的 `npm test`：218通过、7失败，位于 `copy-declutter.test.ts` 和 `live-office-mounted.test.ts`；本次未修复这些展示断言，未声称全量回归通过。
