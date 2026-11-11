# 纯静态办公室：浏览器直连采集服务

## 状态：代码迁移，尚未部署

链路只有：`浏览器 → 采集服务 WSS`。Office 不再运行 Node 服务，也没有 Office API/Nginx 中转。

**当前线上采集接口还不能供浏览器连接。** 已检查同级 collect-service 仓库的 `src/studio/server.ts`、`docs/37-presence-websocket.md`：现有 `/api/presence/v1/ws` 拒绝 Origin、Cookie 和 subprotocol，只接受 Authorization Bearer。原生浏览器 WebSocket 必然发送 Origin，又不能设置 Authorization 请求头。因此不能把本改动直接上线后声称可用；需要采集服务先支持浏览器只读订阅。这次没有改采集服务或线上配置。

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

默认就是上述采集服务地址。只允许 WSS，开发允许回环 WS；拒绝 URL 账号密码、query 和 fragment。不提供 token 输入框，不把凭据写入 bundle、URL、localStorage 或 WebSocket subprotocol。若浏览器收到 4403，则停止重试；握手 HTTP 401/403 在浏览器仅表现为通用网络错误，不能伪称已识别具体状态码。

如需显式身份，可编辑 `PRESENCE_MAPPING`（合成示例，不是生产映射）：

```ts
export const PRESENCE_MAPPING: PresenceMapping = {
  sourceKinds: { 'example-main': 'self', 'example-review': 'auto-fix' },
  sourceLabels: { 'example-main': '主 Agent' },
};
```

这些字段完全公开，不是权限控制，来源可见范围必须由采集服务决定。

## 采集服务接入前置条件（尚未实现）

由采集服务维护者确定浏览器只读访问策略：公开限定展示范围，或浏览器可用的会话鉴权。需要允许准确的 Office Origin；不能为此暴露机器 consumer token、接受任意 Origin 或复用 producer/admin 权限。若选择会话，还需明确登录入口及 Cookie 跨站约束。这次没有擅自新增其中任何方案。

数据协议仍是现有 raw PresenceList 加 `type/reason/sequence`：首帧 initial，后续 change/heartbeat，每条完整替换；空集清空。保留现有 15 秒心跳、45 秒失鲜、10 分钟保留、最多 128 个实例的契约。

## 部署与回退边界

1. 先完成并测试采集服务浏览器入口，包括 Origin、只读范围及鉴权；不要先停线上旧 Office 服务。
2. 确认公开身份映射，设置采集 WSS 地址，`npm run check`，候选静态页面用真实浏览器验证直连与任务展示。
3. 使用 `deploy/office.falsita.cn.conf` 纯静态模板：仅提供 dist，`/api/` 返回 404；CSP connect-src 只增加准确的采集 WSS Origin，无 proxy_pass。如更换采集域名，必须同步更新 CSP。
4. 经授权切换前端及 Nginx，通过验证后停止/禁用旧 `agent-office.service`。新部署不安装 Node 生产依赖、不安装 systemd Office 服务。
5. 验证直连成功后再按运维流程处理旧机器凭证。不要误删其他消费者配置或修改采集生产状态。
6. 回退需要同时恢复旧静态版本、旧 Nginx 代理配置以及旧服务。旧部署的依赖链接仍可能指向之前 release，不能提前删除。

保留的 `server/collect.ts`、`server/electronBridge.ts` 是可选 Electron main 进程适配库，不是 HTTP 服务，不被网页/Vite 导入。旧 Office presence HTTP/WS 服务、Vite 后端插件和 systemd 模板已移除；ws 直接依赖已移除。
