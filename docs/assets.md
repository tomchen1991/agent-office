# 素材记录

以下文件从本轮已确认交付中按原字节复制，SHA-256 见 `public/assets/manifest.json`。不包含旧银发占位、未批准镰刀版本或中途废弃的动画帧。

| 文件 | 内容 | 尺寸 | 当前用途 |
| --- | --- | --- | --- |
| `self-agent/standing-v2.png` | 紫发双马尾、洛丽塔、华丽星月镰刀，透明底 | 1263×1246 RGBA | 已确认站姿参考 |
| `self-agent/idle-preview-v2.gif` | 眨眼、轻微呼吸与发梢变化，浅紫背景 | 480×480 | 约 2.93 秒循环预览 |
| `self-agent/idle-frames-v2.png` | 透明待机四帧，2×2 | 1280×1280 | 每格 640×640 的帧图参考 |

## 来源与验收

生成方式为 AI 图片生成与修订，动画由生成帧切分、脚部锚点校准、调色板统一后组装。设计与首个待机样例在 2026-11-03 选择并认可；这不表示所有技术验收均已完成。

已经检查帧图和 GIF 解码帧，未确认最终 Electron 环境中的播放表现。帧间仍有轻微轮廓变化，图像并非严格统一网格、限色的原生像素成品。继续制作生产素材时需处理像素尺度、逐帧一致性、武器稳定性、边缘透明度和尺寸规范。

可用 `npm run verify:assets` 验证仓库内资产与本次收录字节一致。该检查不判断艺术质量或授权范围。

## 四角色动作图集

`public/assets/demo/` 新增 self / deepseek / chatgpt / grok 各两张透明动作 atlas，总计八张、64 个格位。按当前角色设计与用户完整生命周期要求生成，没有复制其他项目角色源码。尺寸、帧序和字节哈希见该目录 manifest；它们不替换上面的原始已确认素材。帧间仍有生成细节差异，属于可运行演示素材而非最终逐像素生产规格。

### Scythe continuity art

`demo/self/pickup.png` is a four-cell 2048×512 registered atlas; `demo/self/scythe-parked.png` is a full 512×512 transparent prop. Both retain self's [300,470] feet anchor. The shaft is at local x211, bottom y470. A fixed base is projected from that exact local point beside the existing personal play route, without moving desks or chairs. Pickup frames 0/1 contain no weapon and display the parked prop; frames 2/3 contain the only weapon and suppress the prop. Putdown reverses these frames. Frame 3 is the original leisure frame 0 copied pixel-for-pixel. Minor generated silhouette drift remains between contact and held poses. Asset hashes and alpha-bound fixtures are checked in.
