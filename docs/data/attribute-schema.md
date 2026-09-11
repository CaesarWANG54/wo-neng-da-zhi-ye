# 38 项球员能力数据规范

> 状态：运行时合成数据模型 v1。当前战术板已经以 38 个稳定字段加载并校验 10 名合成球员，38/38 项均进入至少一个现有比赛、裁判、战术或运动公式；`standingDunk` 已参与近筐终结计算，只缺单独的站立扣篮操作入口。八秒推进与前场控制建立后的回场判定也已进入现有规则闭环。它不代表 30 队真人名单或真人数值已经完成；精确清单见 [current-data-inventory.md](current-data-inventory.md)。

## 1. 基本约束

- 每项永久原始能力 `base` 为整数，范围 `25..99`；99 是所有位置共同的硬上限。
- 创建新秀的 38 项简单平均目标为 `69..71`；模板核心 1–2 项可到 `78..80`，明确弱点通常为 `55..64`。
- `overall` 是位置加权派生值，不写入 38 项能力表，也不能直接训练。
- `chemistryBonus` 最多 `+5`；有效能力始终 `clamp(base + chemistryBonus + temporaryModifier, 25, 99)`。
- 难度倍率不改写 `base` 或有效能力显示值，只缩放玩家当前控制的自创球员在投篮、突破/终结、普通传球、突分和罚球公式中的正向能力贡献；电脑与玩家队友不缩放。模拟比赛不执行这些手打动作贡献，也不发动作金币。
- 真人球员的 38 项值必须标明授权来源或独立推演来源、数据日期、置信度和审核状态。竞品只可作定性参照，不得作为逐项数值的复制源。

## 2. 能力清单

### 2.1 终结（6）

| # | 稳定 ID | 中文名 | 主要用途 | 当前原型映射 | 主要训练 |
|---:|---|---|---|---|---|
| 1 | `closeShot` | 近筐投篮 | 非扣篮近框终结、补篮 | 已有 `closeShot` | 对抗上篮、篮下脚步 |
| 2 | `layup` | 上篮 | 突破后的左右手和躲避终结 | 已有 `layup` | 上篮脚步、弱手训练 |
| 3 | `drivingDunk` | 突破扣篮 | 有助跑空间的扣篮成功与动作选择 | 已进入终结公式 | 冲刺扣篮、落地控制 |
| 4 | `standingDunk` | 站立扣篮 | 内线接球后原地强起 | 已进入现有近筐终结公式；只缺单独的站扣操作入口 | 内线强起、二次起跳 |
| 5 | `postFinish` | 背身终结 | 背打脚步、勾手和转身终结的综合执行 | 已进入低位机会/终结公式；独立玩家背身操作待实现 | 低位脚步、对抗终结 |
| 6 | `drawFoul` | 造犯规 | 合理身体接触下获得罚球的能力 | 已进入投篮接触犯规模型；没有独立“造犯规”按键 | 接触终结、节奏变化 |

### 2.2 投篮（6）

| # | 稳定 ID | 中文名 | 主要用途 | 当前原型映射 | 主要训练 |
|---:|---|---|---|---|---|
| 7 | `midRange` | 中距离投篮 | 中投基础命中 | 已有 `midRange` | 定点中投、肘区投篮 |
| 8 | `threePoint` | 三分投篮 | 三分线外基础命中 | 已有 `threePoint` | 定点三分、距离扩展 |
| 9 | `freeThrow` | 罚球 | 罚球线命中 | 已进入自动罚球命中模型，并结合稳定性与体能 | 罚球节奏 |
| 10 | `pullUpShot` | 急停跳投 | 突破中急停中投/三分的移动出手折算 | 挡拆后出手已读取，独立急停动作待实现 | 运球急停、后撤步 |
| 11 | `catchShoot` | 接球投篮 | 接球后短时间内的定点出手 | 非挡拆普通出手已读取 | 接球投篮、脚步准备 |
| 12 | `shotConsistency` | 投篮稳定性 | 连续比赛和受干扰情况下的波动控制 | 已进入投篮公式 | 固定节奏、疲劳投篮 |

### 2.3 组织控球（7）

| # | 稳定 ID | 中文名 | 主要用途 | 当前原型映射 | 主要训练 |
|---:|---|---|---|---|---|
| 13 | `ballHandle` | 控球 | 变向、突破动作和高压下控制 | 已有 `ballHandle` | 变向、压力运球 |
| 14 | `ballSecurity` | 护球 | 被夹击、身体接触和背身保护下防失误 | 已进入传球执行与终结公式 | 护球、弱手运球 |
| 15 | `passAccuracy` | 传球准确 | 传球能否落到目标可接范围 | 已有 `passAccuracy` | 定点与移动传球 |
| 16 | `passVision` | 传球视野 | 发现顺下、弱侧与空位目标 | 已有 `passVision` | 录像阅读、弱侧观察 |
| 17 | `passSpeed` | 传球速度 | 球到达目标前防守轮转的时间 | 已进入传球送达公式 | 快速出球、长传 |
| 18 | `offBallMovement` | 无球跑位 | 空切、外弹、反跑和战术路线时机 | 已进入空切/顺下识别，并决定队友是否向移动路线回传；完整战术机会评分仍待接入 | 战术跑位、反跑 |
| 19 | `decisionSpeed` | 决策速度 | 识别窗口后完成正确动作的时效 | 已进入传球目标识别 | 小场决策、时间限制训练 |

### 2.4 运动（7）

| # | 稳定 ID | 中文名 | 主要用途 | 当前原型映射 | 主要训练 |
|---:|---|---|---|---|---|
| 20 | `speed` | 速度 | 无球冲刺、回防和转换速度 | 已有 `speed`；也进入篮板落点到达时间 | 冲刺跑、回防跑 |
| 21 | `speedWithBall` | 持球速度 | 运球推进和突破持续速度 | 已进入持球移动速度、电脑突破战术与后场出球评分；更细路径时间模型待扩展 | 全场运球冲刺 |
| 22 | `acceleration` | 加速度 | 第一步、变速和短距离回位 | 已进入挡拆分离度、终结与篮板到达时间 | 短冲、反应启动 |
| 23 | `strength` | 力量 | 掩护、对抗终结、卡位和错位攻防 | 已进入篮板卡位候选评分 | 核心、对抗训练 |
| 24 | `vertical` | 弹跳 | 扣篮、盖帽、争抢高点和二次起跳 | 已进入十人篮板候选评分；连续二次起跳动作待实现 | 弹跳、落地训练 |
| 25 | `stamina` | 体能 | 比赛中能力衰减和恢复 | 已有 `stamina` | 间歇跑、恢复跑 |
| 26 | `agility` | 敏捷 | 进攻变向、无球转身与综合移动协调 | 已进入挡拆分离度 | 敏捷梯、变向 |

### 2.5 防守与篮板（10）

| # | 稳定 ID | 中文名 | 主要用途 | 当前原型映射 | 主要训练 |
|---:|---|---|---|---|---|
| 27 | `perimeterDefense` | 外线防守 | 对持球投篮、突破第一步和外线站位的压制 | 已有 `perimeterDefense` | 外线一对一、干扰 |
| 28 | `interiorDefense` | 内线防守 | 篮下站位、对抗和低位防守 | 已有 `interiorDefense` | 护筐站位、低位对抗 |
| 29 | `steal` | 抢断 | 断传球、掏球和预判 | 已有 `steal` | 传球线预判、手部反应 |
| 30 | `block` | 盖帽 | 在实际到位时的封盖能力 | 已有 `block` | 起跳时机、协防封盖 |
| 31 | `lateralQuickness` | 横向移动 | 贴防持球人、换防后的横移 | 已有 `lateralQuickness` | 防守滑步 |
| 32 | `screenNavigation` | 绕掩护 | 挤过、绕过和追防掩护 | 已有 `screenNavigation` | 绕桩追防、掩护阅读 |
| 33 | `helpDefenseIQ` | 协防意识 | 判断何时、从何处协防及轮转 | 已有 `helpDefenseIQ` | 五人轮转、录像复盘 |
| 34 | `defenseConsistency` | 防守稳定性 | 减少漏人、错误协防和连续回合波动 | 已进入投篮干扰与挡拆追防公式 | 连续防守回合、沟通 |
| 35 | `offensiveRebound` | 进攻篮板 | 冲抢前场板、二次进攻位置 | 已进入基于真实落点、到达时间、卡位与个人归属的十人同构候选评分；控制后进入 14 秒二次进攻 | 冲抢、二次起跳 |
| 36 | `defensiveRebound` | 防守篮板 | 卡位后保护篮板和结束回合 | 已进入同一十人候选评分；控制后建立 24 秒新球权并选择自行推进或出球 | 卡位、长篮板判断 |

### 2.6 战术通用（2）

| # | 稳定 ID | 中文名 | 主要用途 | 当前原型映射 | 主要训练 |
|---:|---|---|---|---|---|
| 37 | `basketballIQ` | 篮球智商 | 战术选择、空间判断、挡拆阅读、攻防决策 | 已替代旧 `offenseIQ`，并进入投篮、终结、传球、挡拆、篮板反应与后场出球选择 | 战术课、录像复盘、情境题 |
| 38 | `hands` | 接球 | 高速传球、对抗接球、空接和抢球控制 | 已进入篮板反应/控制与后场接应安全评分 | 接球、反应训练 |

核对：`6 + 6 + 7 + 7 + 10 + 2 = 38`。任何新增概念必须先判断它是动作结果、临时状态还是派生值，不能未经评审扩成第 39 项永久能力。

## 3. 建议 TypeScript 结构

```ts
type Rating = number; // 写入前必须校验为 25..99 的整数

interface PlayerRatings38 {
  closeShot: Rating;
  layup: Rating;
  drivingDunk: Rating;
  standingDunk: Rating;
  postFinish: Rating;
  drawFoul: Rating;
  midRange: Rating;
  threePoint: Rating;
  freeThrow: Rating;
  pullUpShot: Rating;
  catchShoot: Rating;
  shotConsistency: Rating;
  ballHandle: Rating;
  ballSecurity: Rating;
  passAccuracy: Rating;
  passVision: Rating;
  passSpeed: Rating;
  offBallMovement: Rating;
  decisionSpeed: Rating;
  speed: Rating;
  speedWithBall: Rating;
  acceleration: Rating;
  strength: Rating;
  vertical: Rating;
  stamina: Rating;
  agility: Rating;
  perimeterDefense: Rating;
  interiorDefense: Rating;
  steal: Rating;
  block: Rating;
  lateralQuickness: Rating;
  screenNavigation: Rating;
  helpDefenseIQ: Rating;
  defenseConsistency: Rating;
  offensiveRebound: Rating;
  defensiveRebound: Rating;
  basketballIQ: Rating;
  hands: Rating;
}
```

球员记录建议：

```ts
interface PlayerRecord {
  id: string;
  displayName: string;
  generatedEnglishName?: string;
  teamId: string;
  position: "PG" | "SG" | "SF" | "PF" | "C";
  secondaryPosition?: "PG" | "SG" | "SF" | "PF" | "C";
  age: number;
  jerseyNumber: number;
  archetypeId: string;
  ratings: PlayerRatings38;
  growthCaps: Partial<PlayerRatings38>;
  trainingProgress: Partial<Record<keyof PlayerRatings38, number>>;
  lastTrainedWeek: Partial<Record<keyof PlayerRatings38, number>>;
  decayAccumulator: Partial<Record<keyof PlayerRatings38, number>>;
  provenance: RatingProvenance;
}

interface RatingProvenance {
  method: "licensed" | "independent_model" | "generated_prospect";
  sourceVersion: string;
  asOfDate: string;
  confidence: "high" | "medium" | "low";
  rightsStatus: "approved" | "review" | "blocked";
  reviewer?: string;
  notes?: string;
}
```

禁止在发行数据中保留 `competitorValue`、竞品抓取地址或可逆推出其逐项表格的字段。

## 4. 派生值与比赛计算

### 4.1 总评

总评按位置与模板加权，不等于 38 项简单平均。创建球员“平均约 70”使用简单平均做起点检查，界面总评则使用位置权重。

- 控卫重点：控球、传球视野/准确、篮球智商、持球速度、外防和投射。
- 分卫重点：三分、急停、终结、速度、外防。
- 小前锋重点：投射、终结、外防、力量、篮球智商。
- 大前锋重点：终结、内防、篮板、力量、协防，空间型模板提高三分权重。
- 中锋重点：内防、盖帽、篮板、近筐、力量；策应型模板提高传球和智商权重。

总评权重表需要版本化并保证各位置权重之和为 1。不得为了让知名球员接近预期总评而反向篡改单项能力；应先检查模型权重、角色和样本。

### 4.2 难度修正

```text
rawEffective = clamp(base + chemistryBonus + temporaryModifier, 25, 99)
normalizedContribution = normalize(rawEffective) * difficultyPlayerFactor
```

`difficultyPlayerFactor`：新秀 1.20、职业 0.90、首发球员 0.80、全明星 0.75、名人堂 0.70。倍率只作用于玩家正在控制的自创球员在投篮、突破/终结、普通传球、突分和罚球中的正向能力贡献，不直接改变显示能力，也不把 99 写成 119；电脑球员和队友保持未缩放。模拟比赛不进入手打动作结算，动作金币固定为 0。

### 4.3 关键动作读取

- 外线投篮：投篮区能力、急停/接球情境、投篮稳定性，对比**当前实际对位**的外防、横移和到位距离。
- 突破：控球、护球、持球速度、加速度、力量，对比当前防守者外防、横移、力量与绕掩护。
- 篮下终结：相应终结能力、力量、弹跳，对比真正按路径及时到位的内防、盖帽、协防意识；未到位中锋不参与减益。
- 传球：目标选择读取视野、篮球智商和决策速度；执行读取准确、速度、护球、接球者双手和防守抢断。释放瞬间固定接球落点，飞行中不向移动接球人追踪或吸附；到达后才提交唯一接球/失误结果。
- 挡拆：掩护质量读取力量、篮球智商与战术默契；路线选择读取终结、投射、空间和持球人视野；防守覆盖读取绕掩护、横移、内防和协防意识。
- 篮板：先由出手距离、方向与前沿/后沿/侧沿/板筐/空气球生成固定种子落点，再让十名球员用同一公式读取实际距离、到达时间、相应进攻/防守篮板、卡位位置、力量、弹跳、双手、篮球智商、速度与加速度。过晚到达者没有隔空抢板机会，且不存在玩家/电脑或主客队隐藏倍率。
- 后场出球：防守篮板手与本队接应者共同读取控球、篮球智商、护球、双手、持球速度、传球准确/视野、接应距离与防守压力；选择传球时仍保留线路被截断风险，随后由实际持球点受后场 8 秒约束。
- 接触犯规：进攻方的造犯规、力量与护球，对比实际防守人的防守稳定性、横移和协防意识；近筐与激进干扰提高接触概率，但固定夹取且同种子可复现。
- 自动罚球：以 `freeThrow` 为主，结合 `shotConsistency` 与 `stamina`；界面只播放既定结果，不提供单独操作或二次抽签。

## 5. 训练覆盖矩阵

全部 38 项都必须至少有一个明确训练入口：

| 训练组 | 覆盖 ID |
|---|---|
| 终结 | `closeShot`, `layup`, `drivingDunk`, `standingDunk`, `postFinish`, `drawFoul` |
| 投篮 | `midRange`, `threePoint`, `freeThrow`, `pullUpShot`, `catchShoot`, `shotConsistency` |
| 控球 | `ballHandle`, `ballSecurity`, `speedWithBall`, `agility` |
| 组织 | `passAccuracy`, `passVision`, `passSpeed`, `decisionSpeed`, `basketballIQ` |
| 战术 | `offBallMovement`, `basketballIQ`, `hands`, `helpDefenseIQ` |
| 运动 | `speed`, `speedWithBall`, `acceleration`, `strength`, `vertical`, `stamina`, `agility` |
| 防守 | `perimeterDefense`, `interiorDefense`, `steal`, `block`, `lateralQuickness`, `screenNavigation`, `helpDefenseIQ`, `defenseConsistency` |
| 篮板 | `offensiveRebound`, `defensiveRebound`, `strength`, `vertical`, `hands` |

训练结算建议：

1. 每周最多两次。
2. 单次最多一个主属性立即 `+1`；最多两个副属性获得进度，累计到 1 后 `+1`。
3. 任一能力单次最多增加 1，最终不得超过该球员成长上限或全局 99。
4. 连续未训练的衰退使用小数累积，达到 1 才扣点，避免每周跳变。
5. 32 岁后的年龄衰退与训练荒衰退分开记录，赛季结算日志必须能解释每一点变化。

## 6. 位置与模板生成规则

### 6.1 生成顺序

1. 读取位置基础向量。
2. 应用打法模板的优势偏置与弱点偏置。
3. 应用身体规格约束，例如矮小后卫的站扣/盖帽软上限、重型中锋的持球速度成本。
4. 把简单平均校准到 `69..71`。
5. 选择 1–2 项模板核心提高到 `78..80`；若核心已达区间，不再额外抬高。
6. 检查弱点至少有 2 项落在 `55..64`，且不破坏位置基本可玩性。
7. 计算位置总评、跑 10,000 回合固定种子模拟，检查新秀难度可完成基础得分、防守和传球。

### 6.2 可玩性护栏

- 控卫的 `ballHandle`、`passAccuracy` 不得低到无法完成教学普通传球。
- 各投射模板至少有一个常用投篮区达到 74；非投射模板不能因为总评校准而被自动补成全能射手。
- 中锋的 `hands` 与 `closeShot` 必须足以接到基础挡拆传球；纯空间模板也不能失去基本篮板职责。
- 防守模板的进攻弱点应降低创造能力，而不是让所有空位球都必定投失。
- 新秀难度的 1.20 系数是容错，不得用它掩盖基础模板不可玩。

## 7. 真人、生成球员与名单数据

### 7.1 真人球员评分流程

1. 锁定名单版本和数据冻结日。
2. 若有明确授权的 38 项源数据，记录许可和版本；否则进入独立推演。
3. 独立推演至少综合最近三个赛季、当前赛季样本、上场角色、传统数据、高阶数据、伤病/年龄和稳定的大众认知。
4. 小样本或长期缺阵项目降低置信度，不用单场高光直接给 90+。
5. 同位置做分位校准，再由篮球审阅人检查明显违和项。
6. 每次更新保存差异报告；单次无伤病解释的能力变化超过 5 点必须人工复核。

竞品公开画面可帮助发现“方向可能错误”，但不能抄取精确值，也不能以“与竞品相似”作为数据来源说明。当前原型合成值不得直接升级为真人正式值。

### 7.2 生成球员

- 名字以英文显示，使用分离的名/姓词库组合。
- 生成后执行大小写、连字符、空格、重音符号归一化，再与当前真人名单、历史知名球员保护表和本存档已有球员比较。
- 完全相同或过度相似时重新生成；名称检查通过不代表可使用真人肖像或经历。
- 能力通过位置模板和年龄生成，不复制任何真实球员完整 38 项向量。

### 7.3 架空名单覆盖

名单导入完成后应用独立的 transaction override：猛龙加入伦纳德；快船加入英格拉姆与迪克，并从原队移除对应球员。该覆盖属于本游戏世界线，不应被标成现实交易。未确认的选秀权、现金或其他球员字段保持空缺，不能自行推测。

## 8. 数据校验与验收

### 8.1 静态校验

- 正好 38 个稳定 ID，无重复、无缺失。
- 所有值为整数 `25..99`。
- 年龄 `16..40`；创建球员固定 20；40 岁结算进入强制退役队列。
- 球衣号码满足联盟配置并在同队冲突时给出处理结果。
- 每名球员有 `method/sourceVersion/asOfDate/confidence/rightsStatus`。
- `rightsStatus = blocked` 的记录不能进入发行包。

### 8.2 分布校验

- 创建模板简单平均为 `69..71`，永久核心不高于 80。
- 同位置真人分布没有大量挤在 85–99；99 只用于极端且有审阅依据的单项能力。
- 评分与多赛季角色方向一致；缺失数据项目的置信度不能标为 high。
- 年龄衰退后所有值仍在范围内，并能从日志还原训练、年龄、伤病和人工修订来源。

### 8.3 规则校验

- 当前防守者外防提高时，其他条件固定的外线命中率单调不升。
- 只有及时到位的护筐者内防/盖帽提高时，篮下命中率单调不升。
- 传球视野提高主要改善目标选择，传球准确提高主要改善送达，两者不能合并成同一骰子。
- 换防后立即读取新对位；死球/回位后才恢复。
- 全部 38 项在训练覆盖矩阵至少出现一次。
- 默契 10/20/30/40/50% 分别产生 `+1/+2/+3/+4/+5`，有效能力不超过 99。
- 难度只影响玩家当前控制的自创球员在投篮、突破/终结、普通传球、突分和罚球中的正向概率贡献，不污染存档原始值；电脑与队友不缩放，模拟局不发动作金币。

## 9. 迁移记录与后续步骤

2026-09-01 已完成：运行时从旧 22 项迁移到 38 项，`dunk` 已拆为 `drivingDunk`/`standingDunk`，`offenseIQ` 已替换为 `basketballIQ`，并加入 schema 版本、稳定 ID 与范围校验。后续仍需：

1. 正式存档上线前增加显式 `legacyRatings22To38()` 和存档版本迁移测试；目前没有旧玩家存档可迁移。
2. 为站扣、背身与持球速度建立更独立的操作入口；近筐、`standingDunk`、`drawFoul` 与 `freeThrow` 已接入规则公式，但独立站扣、背身和主动造犯规操作仍未提供。
3. 把普通传球从固定接应者扩成五名候选的机会评分；低智商必须真实选择次优目标，而不只改文案。
4. 在现有落点、十人候选、罚球最后一投篮板与个人归属解析器上扩展拍球、连续点抢、自然篮板争抢犯规、完整罚球违例和跳球；当前版本仍直接解析首个最终控制者。
5. 建立 24 个创建模板生成器、位置总评权重和 10,000 回合可玩性模拟。
6. 真人数据只通过带字段级来源链的受审适配器进入，不能覆盖合成数据后冒充已授权评分。

每一步都要保留旧存档迁移函数、固定种子回归用例和版本号；不得仅靠默认值静默补齐后就覆盖原存档。
