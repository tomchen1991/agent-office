# collect 状态分页

`server/collect.ts` 是 Node / Electron main 专用消费适配器。仅在可信宿主使用，不得从 renderer 导入。本文描述合成 fixture 验证的本地实现；未连接真实采集部署，未复制上游私有实现。

## 请求和边界

- 每轮从 `/v1/status?limit=32` 开始，按服务返回的 `nextOffset` **顺序**读取后续页。只有当前页读取、校验结束后才发下一页。
- 可显式设置 `sourceId` 筛选，后续请求保留同一筛选。URL 只包含 `limit`、可选 `sourceId`、后续页的 `offset`，每个参数至多一次。
- 首次偏移为 0；后续偏移必须是严格递增的安全整数，范围为 1–1280。最多 41 个请求，单页最多 32 个实例，单页响应最多 1 MiB。异常游标、重复或倒退的偏移、超出页数上限均使整轮失败，不截断后假装成功。
- 使用 consumer Bearer token，**不发送 Origin**，禁止重定向，不缓存。token 只来自 Node/main supplier，不写入 DTO、URL、renderer、日志或错误信息。远端地址必须 HTTPS，回环地址可用 HTTP。
- 一个 `timeoutMs`（默认 10 秒）覆盖 token 获取、全部分页及响应体读取，不会逐页重置。大数据集如确需更长时间，应由可信宿主显式调整，仍保留单轮超时。

## 接受一轮结果的条件

每页验证 version 1、scope `pi-v1`、memory persistence、storageReady 布尔值、processId、startedAt、observedAt、coverage.omitted 布尔值、total、instances 和 nextOffset。实例保留完整的 sourceId / instanceId / collectorEpoch 身份，连接、新鲜度、状态、staleAfterMs 与可空 snapshotReceivedAt 都须有效。服务返回的未知扩展字段不会传入展示 DTO。

- 必须读到 `nextOffset: null`，才发布这一轮唯一一次 connected 快照。不会把中间页逐步发布到 UI。
- 同一轮 processId 或 startedAt 改变，或同一进程 observedAt 倒退时，丢弃整轮。下一次重试从偏移 0 重新开始，绝不混用重启前后的页。
- 不同轮之间允许进程变化。成功的新一轮完全替换旧快照，不把旧 epoch 的状态继承给新实例。
- 使用完整身份三元组去重；后读到的同身份记录覆盖早先记录，保留较晚页提供的观测。同 source / instance 的不同 epoch 仍是两个独立身份。
- total 在分页期间变化会在覆盖说明中明确显示。各页 omitted 取“任一页报告遗漏”，storageReady 取“全部页均就绪”。total 不作为继续分页的依据，只有合法 nextOffset 决定后续请求。

## 非原子覆盖与新鲜度

服务没有分页快照令牌。即使总数一致、所有页都取完，分页期间的插入、移除和排序变化仍可能造成漏项。因此**任何多页结果都保持 `identityCoverage: partial`**，不能据此证明某个身份只有一个 epoch，也不能自动启用 follow-unique 重绑定。

只有单页结束、无遗漏、存储就绪且 total 与去重后实例数相等时，才能标为 complete。覆盖文本包含读取页数、去重后实例数、服务最后报告的总数、非原子分页、遗漏与存储未就绪信息。断连将 identityCoverage 降为 unknown。缺席从不被转译为 offline / 已退出；只有服务明确的 disconnected 记录显示 offline。

connected + fresh 的 idle / active / stopping 分别映射为 idle / working / stopping；其他连接或新鲜度条件不能继续显示当前工作。服务端 freshness 是该页到达时的权威判断；旧 snapshotReceivedAt 只作为观测时间，不参与客户端与服务端的跨时钟相减。

早期页等待后续页的本地耗时使用单调时钟从有效窗口扣除，避免漫长分页把旧页的 fresh 窗口重新延长。剩余窗口向下取整为整数毫秒，耗尽窗口的记录降为 stale / unknown，并保留正值 validForMs 以符合展示 DTO。`now` 仅生成客户端接收时间，`monotonicNow`（默认 Node performance.now）仅计算本地经过时间，不与服务时间比较。

## 失败、取消与重试

- 任意页授权失败（401 / 403）停止自动轮询，直到显式 reconnect。
- 任意页 429 退避，503 或传输、解析、契约错误均重试。退避以默认 5 秒轮询间隔为基数，失败后为 10 / 20 / 40 / 60 秒，并封顶 60 秒；成功后恢复普通间隔。
- 任意页失败都丢弃该轮所有候选页。已有成功快照可作为未知历史保留，全部状态和新鲜度降为 unknown，不会将该轮的部分新数据与历史合并。
- 轮询完成后才安排下一轮，重复 connect 不会启动重叠的活跃轮询。dispose 立即取消定时器、abort token 后的网络/响应体读取，旧代次的晚到结果不能覆盖重连后的新快照，也不能继续取下一页。
- 注入的自定义 fetch 必须遵循 AbortSignal 才能取消底层 I/O；即使它忽略取消，适配器仍按超时结束逻辑轮询并阻止迟到结果发布或继续分页。
- 对外仅有固定本地错误文案，不透传服务正文、token、URL 或异常字符串。

`normalizeStatus` 保留为单页纯归一化入口，非分页网络入口。如果传入的单页还有 nextOffset，输出明确为 partial 并说明有后续分页未读取。

## 本地验证

`node --test tests/collect*.test.ts` 覆盖 41 页、完整身份去重、跨页重启、服务时间倒退、游标与响应边界、每页授权/限流/故障、取消、整轮超时、无 Origin、参数编码、秘密信息隔离、分页新鲜度及 follow-unique 安全限制。测试全部使用合成响应，不要求 token、真实地址或外部服务。
