# 当前运行时数据清单

审计日期：2026-09-03
用途：区分“运行时已有数据”“仅有规范”和“受权利门禁阻断的数据”，防止把计划当成产物。

## 1. 当前实际存在

| 数据集 | 数量 | Schema | 来源 | 用途 | 发行状态 |
| --- | ---: | --- | --- | --- | --- |
| 原型场上球员 | 10 人（主客各 5） | `Ratings` v1，38 项 | 项目原创合成值 | 战术板纵向切片、公式和测试 | 仅内部原型 |
| 基础对位 | 5 组 | `Record<homeId, awayId>` | 项目原创 | 阵地对位、换防与死球回位 | 仅内部原型 |
| 比赛初始状态 | 1 组 | `MatchState` | 项目原创 | 第 4 节 3:00、60:60、24 秒 | 仅内部原型 |
| 场上十人技术统计 | 10 条（主客各 5） | `PlayerStatsLedger` | 比赛事件实时生成 | 投篮、三分、罚球、前/后场篮板、助攻、抢断、盖帽、失误、犯规、时间和正负值 | 可执行原型；与合成赛季线尚未逐场互通 |
| 裁判状态 | 1 套 | `OfficialCallState` + `FreeThrowSequenceState` | 官方规则语义的原创状态实现 | 犯规/球队处罚、自动罚球与站位、攻防三秒、干扰球和六犯名单 | 可执行纵向切片；完整规则缺口见M3B说明 |
| 进攻战术纵向切片 | 4 个 | `HORNS/FIVE_OUT/HANDOFF/STAGGER` | 篮球通用概念、原创实现 | 多节点棋子路线、角色落位、防守跟随和事件解释 | 可执行原型；第一/第二机会、破解与失败回落仍不完整 |
| 电脑进攻战术族 | 9 个 | `OpponentPlayId` + 分阶段节点 | 篮球通用概念、原创坐标与规则 | 自动选战术、三种路线变体、投篮/失误概率结算 | 可执行原型 |
| 创建球员模板 | 30 个（PG7/SG6/SF5/PF6/C6） | `CreationTemplate` + `Ratings` v1 | 项目原创合成值；用户指定中文球员风格参照 | 5位置新秀属性、教学临时能力、模板参照标签与`0–99/00`循环号码选择 | 可执行原型；参照名发行前复核 |
| 生涯入口球队身份 | 30 个 | 中文简称、东西部、单一色值 | 用户指定内容；书面范围待发行前核 | 首年直签、选秀签位、日历、后台战绩 | `APPROVED_DEV`，发行待复核 |
| 2026首轮签位与候选人 | 30 条 | `DraftProspect2026` | 2026官方选秀板快照；来源见`2026-draft-source.md` | 逐顺位仪式、自创球员插入与候选人顺延 | 可执行开发数据；发行前复核缓存/再分发范围 |
| 2026-27已确定赛程 | 1200 场 | `ScheduleGameTuple` | 官方按日期PDF，导入时校验SHA-256 | 玩家日历与30队后台模拟 | 可执行开发数据；每队另2场不伪装成固定对阵 |
| 杯赛动态补赛 | 30 场 | `CareerGame` / `DYNAMIC_CUP` | 游戏内战绩与确定性配对 | 补齐每队82场 | 原创模拟结果，不标注为官方对阵 |
| 合成常规赛状态 | 1 套活动赛季/存档内 | `CareerSeasonState` + `scheduleRulesVersion` v1 | 首季为审定2026–27快照；后续为项目确定性生成 | 按日推进、30队战绩、玩家赛季线；首季8项奖，后续6项奖 | schema v4已正式通过；后续季明确标记`PROJECTED`，不作为现实发布赛程 |
| 季后赛状态 | 1 套活动赛季/存档内 | `PostseasonState` v2 + `PlayoffBracketState` v1 | 项目原创确定性规则实现 | 东西部最终排名快照、1–6直通、A/B/C附加赛、固定15个七场系列赛、主客序列、模拟/手打结果、分区冠军与唯一总冠军账本 | M6B-2正式基线；M6B-3继续保持零金币、零默契、零常规赛统计写入 |
| 创建球员季后赛统计 | 每个玩家队FINAL最多1条 | `CareerPostseasonPerformanceState` v1 | 手打十人账本或项目确定性模拟 | `PLAY_IN`/`PLAYOFF`逐场记录及13项重放合计 | M6B-3已通过；新档完整覆盖，旧档缺失行保留`PARTIAL_LEGACY`，不虚构数据 |
| 生涯生命周期与紧凑历史 | 1套活动状态，最多20份摘要 | `CareerLifecycleState` v1 + `CareerSeasonSummary` | 项目原创状态机 | 季末门禁、年龄/衰退、pending通知、下一季或40岁结束、历史只读摘要 | M6B-3已通过；20季SOAK随核心27文件/374项正式通过 |
| 根生涯存档 | 1份/localStorage | `CareerSaveEnvelope` schema v4 | 项目原创 | 球员、去向、赛季、成长、设置、季后赛、个人统计和生命周期原子持久化 | M6B-3已通过；v1/v2/v3内存迁移，未来版本拒绝 |
| 项目生成未来赛程 | 第2–20季每季1200场基础对阵+30场动态杯赛 | `CareerSeasonState` / `PROJECTED` | 项目确定性生成器 | 跨赛季继续原球队、每队82场、跨年ID隔离 | 仅游戏内生成，不声称官方发布或现实同步 |
| 合成退役通知 | 每季确定性2条；创建球员40岁时另1条 | `RetirementNotice` | 项目原创英文姓名组合与规则文本 | 季末通知和40岁生涯结束 | M6B-3已通过；不代表现实退役名单 |
| 已批准真人退役内容 | 0 条 | `ApprovedRetirementContentEvent` | 尚无获准内容包 | 独立剧情钩子 | `BLOCKED`；仅`rightsStatus=APPROVED`且字段合法/ID唯一者可进入 |
| 教学合成姓名 | 10 个 | 内部ID到英文显示名 | 项目原创组合 | UMich/UCoon球员观察信息 | 仅内部原型；发行前做重名筛查 |
| 米制传球模型 | 1 套 | `BallFlightState` | 28.65m×15.24m场地比例与原创玩法校准 | 普通传球、空接、手递手、发球飞行 | 可执行原型 |
| 30 队正式名单 | 0 | 未建立 | — | — | BLOCKED |
| 真人 38 项评分 | 0 | 未建立 | — | — | BLOCKED |
| 大规模正式英文生成名池 | 0 | 未建立 | — | — | SPEC_ONLY |

当前10名场上球员包含内部ID、阵营、号码、位置、坐标、合成能力和原创英文显示名；创建球员另有显示名与20岁起始年龄。场上合成名单不包含完整真人阵容、合同、照片、肖像或外部评分来源。创建页的30个模板标签按用户要求附中文球员风格参照名，这些参照不创建真人球员档案，也不导入其真实属性向量。选秀候选人的英文名属于独立的首轮事实数据，不会被当作38项属性来源。schema v4迁移对旧档无法恢复的季后赛个人行只登记覆盖缺口和追踪起点，不依据球队比分倒推个人数据。

## 2. 38 项接线状态

`src/game/ratings.ts` 定义恰好 38 个稳定 ID；加载数据时会拒绝缺项、额外字段、非整数或 `25..99` 范围外的值。

### 已进入现有比赛、裁判、战术或运动公式（38 项）

- 投篮：`midRange`, `threePoint`, `pullUpShot`, `catchShoot`, `shotConsistency`, `basketballIQ`。
- 裁判与罚球：`drawFoul`, `freeThrow`，并结合 `strength`, `ballSecurity`, `defenseConsistency`, `lateralQuickness`, `helpDefenseIQ`, `shotConsistency`, `stamina`。
- 终结/突破：`closeShot`, `layup`, `drivingDunk`, `standingDunk`, `postFinish`, `ballSecurity`, `acceleration`, `strength`, `vertical`, `basketballIQ`。
- 组织与无球：`ballHandle`, `passAccuracy`, `passVision`, `passSpeed`, `offBallMovement`, `decisionSpeed`, `hands`。
- 挡拆、移动与传球飞行：`speed`, `speedWithBall`, `stamina`, `agility`, `screenNavigation`, `passSpeed`。
- 防守：`perimeterDefense`, `interiorDefense`, `steal`, `block`, `lateralQuickness`, `helpDefenseIQ`, `defenseConsistency`。
- 篮板：`offensiveRebound`, `defensiveRebound`，并结合力量、弹跳和双手。

同一字段可能出现在多个公式中，以上去重后为38项。

### 已进入公式但尚无单独操作入口（1 项）

`standingDunk`。

`standingDunk` 已参与现有近筐终结公式，但仍需要独立近筐静态站扣操作。`drawFoul` 与 `freeThrow` 已由 M3B 接入接触和自动罚球公式，但这不等于已有主动造犯规按键或完整罚球违例系统。

## 3. 当前合成值的质量门

- 每名球员必须恰好有 38 个字段。
- 所有值必须是 `25..99` 的整数。
- 当前比赛样本的简单平均只用于原型平衡检查，不代表创建新秀总评，也不映射任何真人。
- 固定种子测试保证同一输入可复现；属性高低的关键防守减益需要满足单调性。
- 不允许把当前合成值改名后当作真人正式评分。

## 4. 真人数据的进入条件

正式数据包至少包含：

```text
schemaVersion
rosterVersion
ratingsModelVersion
asOfDate
sourceSetVersion
rightsBundleId
transactionOverrideVersion
```

每名真人还必须有字段级 `evidenceRefs`、推演模型版本、人工调整理由、置信度、审核人和权利状态。任何 `REVIEW` 或 `BLOCKED` 内容不得进入发行包。

生产顺序固定为：获准来源 → 独立评分模型 → 同位置分位校准 → 异常值复核 → 名单导入 → 架空交易覆盖 → 名称/号码冲突检查 → 权利和来源门禁。竞品画面只能用于定性核对，未取得逐项数据许可时不得复制其评分表。

## 5. 架空世界线与真实性标注

计划中的“猛龙得到伦纳德；快船得到英格拉姆与迪克”必须实现为单独、版本化的 transaction override，并在数据元信息中标为游戏世界线，而不是现实新闻。导入后必须验证：原队不存在重复记录、目标队只有一份记录、号码冲突有确定处理结果、未确认的选秀权或附加资产保持空缺。
