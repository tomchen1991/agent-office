# 纯静态办公室：浏览器直连采集服务

## 范围：当前源码的浏览器直连方案

当前源码默认走 `浏览器 → 采集服务 WSS`；仓库模板只提供静态页面，没有 Node 服务或 Nginx 中继。**这不是线上已观测到的同源 WSS 配置。** 线上证据和历史中继部署见 [部署记录](office-deployment.md#production-evidence-and-source-differences)。

采集服务的公开只读 `/api/presence/v1/ws` 不等于允许跨源浏览器访问。2026-11-16 对 collector 发起带 Office Origin 的 Upgrade 返回 HTTP 403；这是当日的跨源检查，不是对线上同源 WSS 路径的检查。不同子域仍是跨源，producer 上报成功也不证明浏览器直连可用。

## 前端负责全部展示计算

- `src/presenceStream.ts`：每个页面独立连接采集服务，校验原始完整快照、连续序号、进程 epoch、消息大小及心跳；不共享连接、不轮询。
- `src/presence.ts`：原先后端的数据转换、供应商外观映射、显式身份映射、协作分组、稳定座位分配均在浏览器完成。
- 座位状态只在当前页面内存保留，断线重连继续使用，刷新重新分配；不同浏览器不共享内存状态。
- `src/presenceConfig.ts`：公开展示映射 `PRESENCE_MAPPING`。不会自动读取旧服务器私有配置。迁移时仅人工确认 sourceKinds/sourceCharacters/instanceCharacters/sourceLabels，绝不复制 token/enabled 等旧配置。
- 断连保留最后观察但不刷新其新鲜度；隐藏页面关闭连接，恢复重连；Strict Mode、旧连接回调隔离及减少动态效果保留。
- 浏览器自动回复传输 ping/pong；Office 不发送应用消息或主动 ping。

## 构建配置

`.env.local` 可设置公开地址：

```dotenv
VITE_PRESENCE_WS_URL=wss://collect.falsita.cn/api/presence/v1/ws
```

默认就是上述采集服务地址。允许 WSS，以及回环地址的 WS；拒绝 URL 账号密码、query 和 fragment。不提供 token 输入框，不把凭据写入 bundle、URL、localStorage 或 WebSocket subprotocol。若浏览器收到 4403，则停止重试；握手 HTTP 401/403 在浏览器仅表现为通用网络错误，不能伪称已识别具体状态码。

如需显式身份，可编辑 `PRESENCE_MAPPING`（合成示例，不是生产映射）：

```ts
export const PRESENCE_MAPPING: PresenceMapping = {
  sourceKinds: { 'example-main': 'self', 'example-review': 'auto-fix' },
  sourceLabels: { 'example-main': '主 Agent' },
};
```

这些字段完全公开，不是权限控制，来源可见范围必须由采集服务决定。

## 跨源直连前置条件

由采集服务维护者确认实际入口策略，并验证准确的 Office Origin、只读范围及鉴权。不要接受任意 Origin、在客户端清除/改写 Origin，或复用 producer/admin 权限。[collect-service PR #16](https://github.com/tomchen1991/collect-service/pull/16) 是曾记录的精确 Origin 许可候选，不是当前生产配置的证明。Nginx 同源中继、旧 Node 后端与浏览器跨源直连是三种不同路径；一种路径的验证不能替代另一种。

数据协议仍是现有 raw PresenceList 加 `type/reason/sequence`：首帧 initial，后续 change/heartbeat，每条完整替换；空集清空。保留现有 15 秒心跳、45 秒失鲜、10 分钟保留、最多 128 个实例的契约。

## 部署与回退边界

1. 经授权评估迁移时，先确认实际基线和 collector 浏览器入口，不要为了验证直连而改变线上中继。
2. 确认公开身份映射，设置采集 WSS 地址，运行 `npm run check`，用真实浏览器验证候选页面的直连与任务展示。
3. `deploy/office.falsita.cn.conf` **仅用于直连方案**：只提供静态文件，`/api/` 返回 404，CSP 允许指定 WSS 地址，无 `proxy_pass`。更换采集域名须同步更新 CSP。直接覆盖同源中继 vhost 会移除其 WSS 路径。
4. 切换及回退由 DevOps 按批准方案执行。回退应恢复切换前已验证的前端与 Nginx 配置；若基线是静态同源中继，就不涉及启动旧 Node 服务。历史 Node 回退仅适用于对应旧 release，见 [部署记录](office-deployment.md)。

保留的 `server/collect.ts`、`server/electronBridge.ts` 是可选 Electron main 进程适配库，不是 HTTP 服务，不被网页/Vite 导入。旧 Office presence HTTP/WS 服务、Vite 后端插件和 systemd 模板已移除；ws 直接依赖已移除。
