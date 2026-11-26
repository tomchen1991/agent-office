# Presence WebSocket 消费

## 当前源码：浏览器直接订阅采集服务

详见 [浏览器直连与部署前置条件](presence-direct.md)。当前源码默认直连 collector；每个页面独立连接，数据转换和座位分配在浏览器内计算，不运行 Office Node 服务。构建时可指定公开的 WSS 地址，线上观测为 Office 同源地址，见 [部署证据](office-deployment.md#production-evidence-and-source-differences)。不要把 consumer token 放入前端。

## 流协议与生命周期

- raw PresenceList 全量快照，加 `type: 'snapshot'`、`reason: 'initial' | 'change' | 'heartbeat'`、连续 `sequence`。
- 每连接从 initial/1 开始，拒绝重复 initial、跳号、倒序及连接内 processId 变化。重连允许新的 processId。
- 完整替换实例集合；空集清空；complete 仅指授权保留实例，不是全部设备清单或退出证明。
- 验证 15 秒心跳、45 秒失鲜、10 分钟保留等契约；35 秒无合法快照判不可用。
- 断线不更新最后观察的新鲜度，最多 30 秒指数退避。浏览器握手错误不暴露 HTTP 状态码，UI 提示检查采集服务浏览器访问权限或网络；收到 4403 才明确识别授权失败并停重试。
- 隐藏/pagehide 关闭当前连接，恢复/online 重连；旧连接消息与 Strict Mode 清理不影响新连接。
- 单帧最大 1 MiB，最多 128 实例；不发送应用消息或主动 ping，不加 HTTP 轮询兜底。

测试：`tests/presence-stream.test.ts`、`tests/presence-office-mounted.test.ts`、`tests/presence.test.ts`。旧 Node 代理专项测试随其实现移除，直接连接及浏览器计算由新测试覆盖。旧生产架构与历史部署证据保留于 [部署记录](office-deployment.md)，不能当作新直连方案已上线的证据。
