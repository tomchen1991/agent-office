# 接入边界

## 分层

- `src/core.ts`：无 React、无传输依赖的展示 DTO、拓扑和订阅生命周期。
- `src/mock.ts`：可注入时钟、确定性模拟数据。页面默认只连接它。
- `server/collect.ts`：Node/Electron main 侧消费状态接口；**不得由 renderer 引入**。
- `App` / 办公室场景：只读归一化 DTO，人物与团队布局来自显式配置，不由进程 role/host 推断。

`OfficeAdapter.subscribe` 立即发送当前状态，返回独立取消订阅函数；`connect` 幂等，`dispose` 取消工作，之后允许重新连接，兼容 React Strict Mode。宿主应在退出时同时取消订阅和 dispose。渲染层通过固定、窄 IPC 通道接收 `AdapterState`；禁止暴露任意 URL 请求、文件访问、token 或原始采集事件。此仓库**尚未安装 Electron 或实现宿主 IPC**。

## collect-service 消费接口

本阶段只实现 `/v1/status` 状态轮询，不实现事件历史重放。服务使用 consumer-role Bearer token，拒绝带 Origin 的请求，因此不能 renderer fetch；Node/main 持有 token supplier。`.env.example` 仅说明宿主变量，不会自动加载。不得把 token 放进 Vite 环境、URL、页面存储或提交版本控制。

状态接口不提供用户请求摘要、父子关系、办公室拓扑或模型身份。缺失请求统一 `null`；默认未知身份占位。不能将 request.started 的模型调用当作用户请求，不能把生成的回复当作用户摘要。只有后续可靠的用户消息来源才可补充此字段。

实例使用 sourceId / instanceId / collectorEpoch 组合识别；重启实例不复用旧状态。只在 connected + fresh 时把状态视为当前；保留的旧 reportedStatus 不代表正在工作。实例缺席不代表从未出现或已经退出。

当前取第一页（最多 32 条）并标注覆盖范围；分页不是原子快照，未来需要分页时须额外处理去重和时间一致性。断连保留历史有上限，不宣称完整历史。页面新鲜度与传输连接状态分开呈现；断连不能继续将缓存当作实时。

## 宿主后续工作（尚未实现）

1. 在 Node/main 构造 adapter，注入部署地址、token supplier 和显式角色映射。
2. 为配置的逻辑座位建立实例身份映射；不要从第三方模型名字猜测关系。
3. 通过白名单 IPC 传递 DTO，renderer 仅订阅状态，无 Node integration、无凭据。
4. 用真实部署进行经授权的契约联调；本次只有合成 fixture 单元测试，无实际连接。
5. 需要历史时另建事件通道：cursor 是 opaque；409 需要显式重置历史，truncated 代表保留窗口缺失，不是 hasMore。

渲染宿主可使用 `<App adapterFactory={createBridgeAdapter} topology={configuredTopology} modeLabel="本地采集" />`。工厂函数引用应保持稳定（模块级函数或 useCallback），避免每次父组件渲染重连。`createBridgeAdapter` 是未来宿主自行提供的 IPC 客户端，不要把 `createCollectAdapter` 传入 renderer。

### 座位与实例重绑定

`identity()` 仅配置名字与人物外观，不会改变实例 ID。实例键由 `[sourceId, instanceId, collectorEpoch]` 序列化得到；epoch 改变后它是新实例。宿主应把“自研 Agent 主席位”等逻辑座位按明确规则重新绑定到本次快照的实例键，并传入新的 `topology`。不要只改 identity 的名字就以为座位已重绑定，更不能自动沿用旧 epoch 的运行状态。`App` 会校验重复座位与未明确指定的团队负责人；宿主应在配置编辑时先校验并向用户显示可修正错误。

新鲜度使用数据源的 fresh/stale/unknown 判断及有效窗口；renderer 自收到快照起用单调时钟计算经过时间，不以服务端 snapshotReceivedAt 减去客户端时间。snapshotReceivedAt 只作为最近状态观测时间展示，旧快照可能仍因心跳而有效。网络失败或手动断开会将缓存状态降为未知，不继续宣称正在工作。

## 版本化配置与公开核心入口

`src/index.ts` 是 renderer-safe 可复用入口；Node 适配器仍必须单独从 `server/collect.ts` 引入。当前是源码集成入口，不是已发布的 npm 包。

```ts
import { importOfficeConfig, exportOfficeConfig, bindOffice, enrichOfficeSnapshot } from './src/index';

const config = importOfficeConfig(userChosenJson); // 不读取磁盘、不自动保存
const enhanced = enrichOfficeSnapshot(snapshot, { userRequests: hostSuppliedRequests });
const bound = bindOffice(config, enhanced.snapshot);
// 将 bound.snapshot 提供给宿主 bridge adapter；将 bound.topology 传给 App。
// 必须把 bound.warnings 呈现给用户，不能把歧义空位当作实例离线。
const jsonForUserExport = exportOfficeConfig(config);
```

`examples/office-config.json` 全为合成示例。配置严格限定版本和字段，不能混入 token、部署 URL、任意请求参数。它只描述逻辑席位、显式角色外观和身份选择器；没有本地自动保存、网络调用或浏览器存储副作用。导入/导出函数返回数据/字符串；文件选择和保存界面由实际宿主提供。

每个选择器必须指定 **sourceId + instanceId**，不能从模型、host、role 或显示名字猜身份：

- `epoch.policy: exact`：只匹配指定 `value`。重启后保持未绑定，需要用户明确修改配置。
- `epoch.policy: follow-unique`：宿主明确允许同 source + instance 的新 epoch 接替，但只有一个候选且 `snapshot.identityCoverage === "complete"` 才绑定。采集适配器仅在第一页覆盖全部实例、无遗漏且存储就绪时标记 complete；分页 / 遗漏 / 未声明完整性均禁止自动跟随，断线也撤销完整性。服务同时保留旧离线实例和新实例时仍是歧义，不自动挑“最新”或“在线”者。用户可选择 exact 解除歧义。
- 零候选 / 多候选均保留空位并返回警告；配置冲突和重复实例 ID 拒绝处理。未配置实例不自动进入办公室。绑定结果若过滤了任意实例，会降级身份覆盖为 partial，不能再用该子集证明全局唯一性；重绑定应使用原始完整快照。
- `bindOffice` 无历史缓存；每次从本次快照重新绑定。它不会把旧 epoch 的状态、请求或角色自动复制到新实例。

实例 DTO 的 `identity` 是适配器提供的结构化来源身份；缺失时不解析 id 字符串或猜测。collect 适配器现在显式提供此字段。绑定只覆盖当前匹配实例的名字和角色外观，不更改原始输入。

### 用户请求增强

`OfficeEnrichment.userRequests` 是未来可信宿主主动提供的、按**完整当前实例 ID**索引的用户请求摘要与来源。此接口不意味着 collect 状态协议支持摘要。未知或旧 epoch 的增强记录不会应用，而是返回 `unmatchedAgentIds`。同一实例更早 receivedAt 的增强不会覆盖已有最新摘要，而是返回 `ignoredOlderAgentIds`；相同时间允许可信宿主修正文案。输入还必须区分用户请求与模型生成内容；本模块不能替宿主判断语义或权限。没有增强时保持原有 `null`，绝不生成替代摘要。

拓扑增强通过显式配置构建新的 `bound.topology`，与请求增强独立；两者不要求修改上游服务。
