# Presence stopping 离场

办公室 presence 接入层将采集服务的 `stopping` 映射为 `offline`，不修改采集服务契约，也不修改其他 adapter 的 stopping 语义。

- 已就座角色复用现有离场流程：起身约 2 秒，行走约 4 秒，然后移除。
- 首次观察即为 stopping 的实例不入场；入场/坐下中收到 stopping 会取消入场。减少动态效果模式直接移除。
- 公共实例的 offline 记录即使变 stale 仍保留拓扑和原工位，避免心跳过期提前截断离场。工位绑定随上游记录删除而释放；不会在动画结束时立即重用。
- 专属角色优先绑定仍在线的 fresh 实例，旧 offline 记录不阻止新实例接管。
- 持续 stopping 不重复离场；同一实例恢复 idle/working 等在线状态可以重新出现。尚在离场时恢复会取消路线并直接就座。
- 断连仍显示未知，不推断退出；没有发送 stopping 的退出仍依赖上游超时处理。上游提前删除记录或拓扑被替换仍可能截断动画。

验证：`node --test tests/presence-proxy.test.ts tests/live-office-motion.test.ts`。
