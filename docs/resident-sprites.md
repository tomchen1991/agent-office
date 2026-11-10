# DevOps 与热点追踪角色素材

两位角色各使用独立的 `locomotion.png`、`seated.png`、`sleep.png`，位于 `public/assets/demo/devops/` 和 `public/assets/demo/hotspot/`。六张批准的源图集按原字节复制，没有重新生成、缩放或覆盖现有角色素材。`manifest.json` 记录尺寸、锚点及 SHA-256，`src/demoAssets.ts` 注册角色及图集。

- 图集为透明 RGBA PNG，2048 × 1024；4 列 × 2 行，每格 512 × 512。
- 行走图集锚点为 (300, 470)，坐姿及睡眠图集锚点为 (250, 355)。
- 从左到右、从上到下编号 0–7。
- locomotion：walk-a、walk-b、walk-c、walk-d、sit-a、sit-b、stand-a、stand-b。
- seated：work-a、work-b、slack-a、slack-b、error-a、error-b、idle-a、idle-b。
- sleep：seated-neutral、drowsy、lean、sleep-a、sleep-b、wake-lean、wake-drowsy、seated-neutral。
- sleep 第 0、7 格的完整 RGBA 像素与各自 seated 第 6 格完全相同。

DevOps 保留灰蓝短发、齿轮发夹及青色耳麦；热点追踪保留橙色短发、贝雷帽及金色雷达帽徽。六张图集均已目视检查。脸部、头发和裙褶仍存在少量生成式逐帧变化，属于接入原型，不是逐像素手修最终版。水平镜像会同时翻转发饰。

`tests/resident-sprite-assets.test.ts` 直接解码六张 PNG，检查透明通道、非空帧、注册信息、哈希及睡眠起止像素。walking/sleep alpha fixtures 从实际 PNG 测量并以哈希绑定，供办公室边界测试使用。素材注册不改变 API 或服务端连接协议。

## 办公室接入

`residentVisuals.ts` 只定义渲染层角色，不扩展 `OfficeAgent.character` 的传输枚举。明确的 `devopsAgentId` / `hotspotAgentId` 或对应席位配置决定专属外观；底层 provider、model、身份与 presence 状态照常保留。未绑定的工位只展示家具，不补造人物。主 Agent 与 Auto-fix 的现有映射保持兼容。

真实办公室、整体动作演示和合成状态示例均接入两位角色。她们复用现有行走/落座/工作/空闲/等待/离席状态机；明确、新鲜且连接正常的夜间 idle 才播放趴桌休息，任务到来先唤醒再恢复工作。暂停、减少动态、未知/过期状态与加载失败沿用现有安全退化行为。夜间休息只是画面表现，不表示真实任务或服务停机。

整个待交付改动只保留素材、动画和前端布局。服务端 API、核心 DTO、bridge、原配置 API、presence WebSocket、部署配置均与 main 一致；大屏是无网络请求的未连接占位，API 与真实数据接入由用户自行处理。
