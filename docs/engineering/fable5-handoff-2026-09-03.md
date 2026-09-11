# 《我能打职业》暂停状态、后续路线与 FABLE 5 工程提示词

> 历史交接说明：本文件记录 2026-09-03 开始 M6B-1 前的暂停点。M6B-1 现已由后续接管完成；当前状态以 `project-status-matrix.md` 和 `docs/acceptance/m6b-1-acceptance-report.md` 为准，不要再按本文“postseason 模块不存在”的旧描述回退代码。

日期：2026-09-03
项目正式目录：`D:\我能打职业`
当前本地预览：`http://127.0.0.1:4173/`
当前决定：暂停新增实现，只保存已验证基线与后续执行顺序。

---

## 一、当前状态摘要

### 1. 已验证稳定的基线

| 范围 | 状态 | 当前可以确认的结果 |
| --- | --- | --- |
| P1 输入公平性 | DONE | 260ms 单/双击仲裁不再冻结比赛钟或 24 秒；交替点击不能无限延长球权；陈旧输入会失效。 |
| P2 iPhone 横屏原生布局 | DONE（自动化） | 粗指针横屏手机使用 `100dvw/100dvh` 和安全区；iPhone 13、iPhone 15 Pro WebKit 门禁通过；实体 iPhone 尚未验收。 |
| P3 明确传球到达语义 | DONE | 传球释放时固定落点；球员不会被“追踪球”拖动；飞行中持球人不提前切换；到达后只交接一次；比赛钟继续；失效传球会取消。 |
| M0–M4 比赛纵向切片 | DONE（已承诺范围） | 十人移动、真实回合状态机、发球/死球/快攻/篮板/犯规/罚球/违例、玩家与电脑战术、右侧五键均有行为和反馈。 |
| M5 创建/教学/去向 | PARTIAL | 30 模板、循环号码、UMich/UCoon 教学、2026 首轮仪式和 30 队直签可运行；逐步教学、失败恢复、号码冲突仍缺。 |
| M6 常规赛日历 | PARTIAL | 1200 场发布赛程 + 30 场动态杯赛、玩家队 82 场日历、联盟模拟、战绩与首年奖项可运行；季后赛未实现。 |
| M7A 成长经济 | DONE（领域纵向切片） | 38 属性、训练、购买、金币、默契、年龄衰退纯逻辑与 schema v1 根存档已运行。 |
| M7B 正式赛程手打 | DONE | 日历开赛、0:0 第一节、四节比赛、终场原子结算、赛果/统计/金币/默契、刷新幂等闭环已通过。 |
| M8 真人内容 | BLOCKED / SPEC_ONLY | 正式真人名单与每人 38 项能力尚未进入发行数据包；不得把竞品表直接复制进仓库。 |
| M9 发布候选 | PARTIAL | 构建、内容扫描、WebKit 横屏自动测试可用；实体 iPhone、原生壳、活跃比赛恢复、30 分钟性能/耗电尚未完成。 |

### 2. 最近一次正式验收证据

- `npm run test:core`：23 个测试文件，294/294 通过。
- `npm run test:runtime`：86 通过，6 个原生专用用例按桌面配置跳过。
- `npm run test:native`：12/12 通过，覆盖 844×390 与 852×393 两种 iPhone 横屏。
- `npm run build`：通过 TypeScript、Vite 构建、28 个受保护运行时文件校验和内容合规扫描。
- 构建仅有非阻断的大 chunk 警告：主 JS 约 780.44 kB（gzip 约 237.80 kB）。
- 当前 Vite 预览进程仍在 `127.0.0.1:4173` 运行。

这些数字是暂停前最后一次完整正式目录验收，不代表未来修改后自动继续成立。任何后续改动都必须重新运行相应门禁。

### 3. 当前 30 个创建模板

- 控球后卫 PG（7）：亚历山大、东契奇、欧文、莫兰特、哈登、哈里伯顿、库里。
- 得分后卫 SG（6）：马克西、爱德华兹、布克、汤普森、米切尔、科比。
- 小前锋 SF（5）：伦纳德、保罗乔治、塔图姆、詹姆斯、布朗。
- 大前锋 PF（6）：字母哥、锡安、班凯罗、杜兰特、邓肯、唐斯。
- 中锋 C（6）：约基奇、文班亚马、霍姆格伦、恩比德、戈贝尔、奥尼尔。

约束：模板数量不再设上限；当前已接受集合为 30 个；历史球员参照仅科比、邓肯、奥尼尔；模板名称、额外加成、弱点属性和战术定位均已存在；所有永久属性共同封顶 99，不存在模板专属成长上限。

### 4. 当前已冻结的关键产品规则

- 游戏界面继续使用中文。
- 运行时不出现联盟 Logo、球队 Logo、官方球衣图案或禁用联盟字样；球队只使用中文简称和单一代表色。
- 比赛战术板占主要面积；玩家创建球员以细红圈标记；右侧五个按键只操控创建球员，且不可出现无响应按钮。
- 进攻、无球、快攻和防守采用上下文按键；双击传球为空接，双击投篮为扣篮；特殊动作只在玩法说明中说明。
- 比赛使用真实 elapsed 时间；24 秒、进攻篮板 14 秒、后场 8 秒、发球 5 秒、回场、三秒、干扰球、Bonus 与自动罚球已进入规则层。
- 第 5 次连续抢断点击强制犯规；自然犯规维持低频门槛；三分犯规更低频。
- 创建球员常驻场上，不被轮换；当前没有替补轮换引擎。
- 难度与奖励：新秀 120% 属性/30% 奖励；职业 90%/80%；首发 80%/100%；全明星 75%/110%；名人堂 70%/130%。
- 8 分钟完整手打、100% 奖励为 300 金币；30% 为 90 金币。低于 80 的属性每点 90 金币，因此 300 金币可升 3 点并余 30，90 金币可升 1 点。
- 正式生涯比赛总时长为 8/12/24 分钟，对应每节 2/3/6 分钟；加时为 50/75/150 秒。
- 赛季总场次应为 1,230：1200 场发布日程 + 30 场动态杯赛；每队 82 场。
- 首年结束后不再出现选秀、新秀奖或新秀阵容；跨赛季尚未实现，因此这一规则还没有端到端证据。
- 创建球员 20 岁；32 岁赛季起衰退；40 岁强制退役；退役名单应在季后赛结束后通知。
- 架空交易保持为后续数据覆盖：猛龙得到伦纳德；快船得到英格拉姆与迪克。当前真人名单未导入，所以不能声称已经落地。

### 5. FABLE 已完成与不得重复推倒的代码边界

P3 已经从“半完成”恢复为有测试的稳定实现：

- `src/game/types.ts`：`PendingPassState`。
- `src/game/movement.ts`：固定释放时接球点，不追踪移动接球人。
- `src/game/flow.ts`：创建、取消及 `completePassArrival`；引擎仅在物理飞行结束后交接。
- `src/game/controller.ts`：玩家普通传球、突分、无球回传等已迁移。
- `src/game/pass-arrival.test.ts`：覆盖飞行前后持球人、一次到达、时钟、失效取消和真实回场规则。

除非测试揭示回归，不要重写这套语义，不要恢复“释放即换持球人”或逐帧追踪移动接球人的旧模型。

M7B 已完成并且必须保持原子性：

- `src/game/career-game-settlement.ts`：开赛快照与终场结算。
- `src/game/career-calendar-progression.ts`：按日/按周推进。
- `src/game/career-save.ts`：schema v1 根存档及严格校验。
- `src/Prototype.tsx`：日历 → 开赛确认 → 比赛 → 终场 → 结算 → 返回日历。

存储写入失败时必须停在终场弹窗并允许重试；绝不能先返回日历再丢失奖励或赛果。

### 6. 已知缺口与风险

#### 阻断完整生涯闭环

1. 尚无常规赛最终排名冻结快照。
2. 尚无完整同战绩排序。
3. 尚无东西部附加赛状态机。
4. 尚无季后赛七场四胜系列赛、分区冠军和总冠军。
5. 尚未在季后赛结束后接入涨龄、衰退、退役通知和下一赛季。

#### 玩法深度缺口

1. 普通传球仍偏固定目标池；低篮球智商尚未真正更常选择次优队友。
2. 玩家战术分支主要在呼叫时决定；还未完全根据实时防守站位动态改读。
3. 缺急停、抛投、欧洲步、近筐脚步、独立站扣和主动造犯规入口。
4. 缺替补、轮换、六犯离场、完整暂停、挑战、争球和完整罚球违例。

#### 数据与合规缺口

1. 正式真人球员数据包为 0；38 项真人评分、逐字段来源和人工复核尚未完成。
2. 不能把竞品能力表作为可分发数据直接复制；必须使用已获许可数据或独立、可解释的评分模型。
3. 架空交易、真人中文名/称号与号码冲突要在数据包进入后做唯一性验收。

#### 发布缺口

1. Windows 上的 WebKit 自动化不等于实体 iPhone Safari。
2. 尚无 Capacitor 或其他原生安装包。
3. 活跃比赛刷新后不能恢复，只能回到赛前。
4. 尚无 30 分钟真机帧率、内存、发热、耗电和后台恢复报告。
5. 主 bundle 有可优化空间，但当前只是非阻断警告。

#### 文档漂移

`docs/engineering/implementation-plan.md` 的局部旧段落仍出现“24 个模板”“正式存档尚未上线”“尚缺训练结算”等过期描述；真实代码、README、状态矩阵和测试已经是 30 模板、schema v1 根存档、训练/购买与 M7B 结算。后续应先只读核对，再修正文档，不能为了匹配旧文档而回退代码。

---

## 二、接下来的建议路线

### 阶段 A：M6B-1 排名冻结与附加赛（下一项）

目标：把常规赛最终状态转换为不可变的东西部排名快照，并完成每区 7–10 名附加赛；本阶段暂不做七场系列赛。

小任务：

1. M6B-1A：冻结规则、分区与完整同战绩算法。
2. M6B-1B：东西部 1–10 名快照；1–6 直通。
3. M6B-1C：7/8、9/10、最终资格赛的确定性状态机。
4. M6B-1D：存档迁移、损坏档交叉校验与幂等事件。
5. M6B-1E：中文排名/附加赛 UI、桌面与 iPhone 横屏验收。

发布阻断条件：

- 只有 1,230 场常规赛全部为 FINAL 后才能冻结；最后一场延后手打未完成时不得提前冻结。
- 东西部各恰好 15 队；无跨区、重复或遗漏。
- 冻结后拥有稳定 `freezeEventId`、`rankingRulesVersion` 和不可变顺序；刷新或重复推进不能改变。
- 每区 1–6 直通且绝不进入附加赛。
- A：7 主场对 8；胜者锁定第 7，败者保留机会。
- B：9 主场对 10；败者淘汰，胜者进入 C。
- C：A 的败者主场对 B 的胜者；胜者锁定第 8，败者淘汰。
- C 不能在 A、B 均 FINAL 前生成或结算。
- 同一结果重复提交为 no-op；同一事件 ID 的冲突比分必须拒绝。
- 任意阶段刷新后名单、比分、种子、淘汰状态和下一动作完全一致。
- 旧 schema v1 档必须安全迁移或安全采用缺省值；坏档进入 `RECOVERY_REQUIRED`，未来版本只读拒绝且不得覆盖。

### 阶段 B：M6B-2 七场系列赛与冠军闭环

依赖：阶段 A 全绿后才能开始。

小任务：

1. 固定首轮对阵：1–8、2–7、3–6、4–5，不重新排种子。
2. 每轮七场四胜；主场次序 2-2-1-1-1，高种子主场为第 1、2、5、7 场。
3. 分区半决赛、分区决赛、总决赛状态机。
4. 手打玩家球队下一场；其他系列赛逐日模拟。
5. 系列赛比分、赛程、赛果、玩家统计和奖励仍使用稳定事件 ID。
6. 同日多场、抢七、横扫、4-1/4-2/4-3、玩家被淘汰、总冠军唯一性测试。
7. 奖项与退役通知只能在正确节点生成一次。

### 阶段 C：M6B-3 跨赛季年龄、退役和下一年

1. 季后赛完全结束后触发一次赛季结算。
2. 年龄 +1；31→32 首次衰退；39→40 强制退役。
3. 本季特例退役通知写入内容层，不污染通用衰退逻辑。
4. 第 2 年起不再出现选秀、新秀奖、新秀阵容。
5. 生成下一赛季壳、清空当季赛果、保留永久属性/金币/成长账本/设置。
6. 做 20 个赛季的确定性长期模拟，检查赛程、经济、属性上下限和退休幂等。

### 阶段 D：玩法与战术的第二层优化

1. 普通传球使用五人机会评分：空间、传球线路、接球区价值、球员角色、时间、比分、篮球智商、传球和失误风险。
2. 低智商不是简单降低成功率，而是提高选中“次优但合法目标”的概率；仍需保证结果可解释、可复现。
3. 玩家与电脑战术在运行中读取换防、沉退、夹击、协防位置，动态选择顺下、外弹、短顺下、弱侧转移或回退单打。
4. 强化防守转换优先级：护筐、停球、找射手、卡位；避免十人聚团。
5. 每个新动作先写规则/属性映射，再做 UI，最后做概率单调性和浸泡测试。

### 阶段 E：M5/M7 完成度补齐

1. 分步骤中文教学和失败恢复。
2. 评价细目与选秀原因解释。
3. 同队号码冲突处理。
4. 50% 以上默契只改善落位速度、误读风险和换防沟通，不再叠加属性。
5. 成长账本 UI、购买确认与撤销反馈。
6. 活跃比赛中途保存与恢复。

### 阶段 F：M8 数据管线

1. 先冻结名单数据日期、许可范围和字段字典。
2. 每位真人球员的 38 项评分均保留 `source / sourceDate / licenseScope / method / confidence / reviewer`。
3. 没有可许可竞品字段时，用公开比赛统计、高阶指标、近年样本和球探规则独立推演。
4. 实现架空交易覆盖、原队移除、目标队唯一、号码冲突和名单人数检查。
5. 发布包不得包含未经许可的竞品原始表、Logo、官方球衣图案或禁用字样。

### 阶段 G：M9 真机发布候选

1. 实体 iPhone Safari 横屏回归。
2. 决定 PWA 或 Capacitor 包装策略。
3. 活跃比赛恢复、断网、后台、音频解锁、来电/锁屏恢复测试。
4. 30 分钟真机帧率、内存、发热、耗电测试。
5. bundle 拆分、延迟加载和渲染热点分析。
6. 最终安全、隐私、许可证、内容和禁用素材扫描。

---

## 三、FABLE 5 English master prompt

Copy the complete prompt below into FABLE 5 when development is resumed.

```text
You are FABLE 5, continuing an existing Chinese mobile basketball tactics game prototype. Do not restart the project, redesign it from scratch, or replace stable systems. Work from the verified baseline and complete one bounded engineering task at a time.

PROJECT IDENTITY
- Product name: 我能打职业
- Canonical project directory: D:\我能打职业
- Local preview URL: http://127.0.0.1:4173/
- Stack: React 19, TypeScript 7, Vite 8, Vitest, Playwright, WebKit mobile emulation.
- The game UI must remain Chinese. Engineering identifiers and comments may be English.
- There is no reliable Git history in this folder. Preserve all unrelated work. Before each bounded task, record the exact files you intend to modify and establish a recoverable rollback point for those files.

NON-NEGOTIABLE PRODUCT AND RIGHTS CONSTRAINTS
1. Do not display the NBA wordmark, an NBA logo, team logos, official jersey graphics, or other protected visual trade dress in the runtime.
2. Team presentation is limited to approved Chinese short names, a single representative color, generic circular pieces, generic mini jerseys, and visible numbers.
3. Do not copy or ship proprietary NBA 2K rating tables. Licensed data may be used only within its verified scope. Missing attributes must come from an independent, explainable model using permitted statistics and documented scouting rules.
4. Keep the runtime Chinese and concise. Do not expose internal debug terminology to players.
5. Do not modify the 28 hash-locked mobile runtime files. Make application changes only in app-owned source and style files unless the integrity policy is deliberately updated with written approval.
6. Every visible button must either perform a real action, be disabled with a clear reason, or provide immediate explanatory feedback. Silent no-op buttons are release blockers.
7. The tactical board must remain the dominant visual surface. The right-side five-slot control layout must remain stable and usable with one hand.
8. The created player is the only player directly controlled by the right-side controls and is marked by a thin visible red ring, not a rectangular selection frame.

VERIFIED BASELINE — DO NOT CLAIM THESE RESULTS AFTER NEW CHANGES UNTIL YOU RE-RUN THE GATES
- npm run test:core: 294/294 passed across 23 files.
- npm run test:runtime: 86 passed; 6 native-only cases skipped in the desktop configuration.
- npm run test:native: 12/12 passed on WebKit at 844x390 and 852x393.
- npm run build: passed TypeScript, Vite, the 28-file runtime integrity gate, and content compliance scanning.
- Last verified production bundle: approximately 780.44 kB JS minified / 237.80 kB gzip; the >500 kB warning is non-blocking but should be addressed before release.

STABLE SYSTEMS THAT MUST NOT BE REGRESSED
1. P1 input fairness:
   - A single pass/shoot tap is arbitrated against a double tap for 260 ms.
   - The game clock and shot clock continue during that arbitration.
   - Alternating taps cannot stall or extend a possession.
   - Pause, dead ball, possession change, phase change, and decision-epoch changes invalidate stale callbacks.
2. P2 native landscape:
   - Coarse-pointer landscape phones at the supported dimensions use true 100dvw/100dvh rendering and safe-area insets.
   - Desktop QA keeps the device preview frame.
   - Do not reintroduce the hidden #root layout offset or a scaled/rotated fake phone in native mode.
3. P3 explicit pass arrival:
   - PendingPassState is the authoritative in-flight pass record.
   - A receiver does not become the ball handler at release.
   - The ball flies to a catch point fixed at release; it does not home toward a moving receiver.
   - completePassArrival transfers the handler exactly once after physical flight ends.
   - On-ball actions are gated while a live pass is airborne.
   - Possession, phase, or handler changes cancel stale passes.
   - Game and shot clocks continue during flight.
   - Genuine illegal backcourt passes must still trigger the unchanged over-and-back rule.
4. M7B manual career game settlement:
   - Calendar -> confirmation -> 0:0 Q1 game -> final -> atomic settlement -> focused calendar is working.
   - Launch snapshots freeze difficulty, game length, effective ratings, and reward policy.
   - Results, standings, created-player season stats, coins, and chemistry settle atomically from the schedule game ID.
   - Simulated, incomplete, invalid, tied, or already-settled games cannot award coins.
   - A localStorage write failure must keep the final dialog open, preserve the pre-game save, display a retry error, and allow safe settlement retry. Never navigate back to the calendar before the durable write succeeds.

CURRENT CREATION TEMPLATE CONTRACT
- PG 7: 亚历山大, 东契奇, 欧文, 莫兰特, 哈登, 哈里伯顿, 库里.
- SG 6: 马克西, 爱德华兹, 布克, 汤普森, 米切尔, 科比.
- SF 5: 伦纳德, 保罗乔治, 塔图姆, 詹姆斯, 布朗.
- PF 6: 字母哥, 锡安, 班凯罗, 杜兰特, 邓肯, 唐斯.
- C 6: 约基奇, 文班亚马, 霍姆格伦, 恩比德, 戈贝尔, 奥尼尔.
- There is no longer a per-position template-count cap. The accepted current set contains 30 templates.
- Historical references are limited to 科比, 邓肯, and 奥尼尔.
- Each template has a style name, reference label, boosted attributes, explicit weaknesses, and a tactical role.
- Permanent rookie ratings average 69–71, core ratings start at 80/79, weaknesses are generally 55–64, and every rating shares the global cap of 99. There is no template-specific growth cap.
- The tutorial uses a temporary mature preview (94/92 core ratings) and must never write those temporary values into the permanent career profile.

CURRENT CAREER AND RULE CONTRACT
- The regular season is 1,230 total games: 1,200 published games plus 30 dynamically resolved cup games; every team must have 82 games.
- Only the created player's team schedule is shown; all other teams simulate in the background.
- The game supports 8, 12, or 24 total minutes, using 2, 3, or 6 minutes per quarter and 50, 75, or 150 seconds per overtime.
- Difficulty/economy multipliers are:
  ROOKIE 120% effective ratings / 30% rewards;
  PRO 90% / 80%;
  STARTER 80% / 100%;
  ALL_STAR 75% / 110%;
  HALL_OF_FAME 70% / 130%.
- An eight-minute manual game at 100% pays 300 coins. At ratings below 80, one point costs 90, so 300 buys three points with 30 remaining and 90 buys exactly one point.
- The created player starts at age 20, begins annual decline when entering the age-32 season, and must retire at age 40.
- After the first season, the draft, Rookie of the Year, and All-Rookie awards must never appear again. This is not yet end-to-end implemented because multi-season progression is not built.
- The fictional roster override remains a future data requirement: Raptors receive 伦纳德; Clippers receive 英格拉姆 and 迪克. Do not claim it is implemented before the licensed roster pack exists.

CURRENT BOUNDARIES — DO NOT MISREPRESENT THEM
- The postseason module does not exist yet. There is currently no standings freeze, official complete tie-break implementation, play-in state machine, best-of-seven bracket, conference champion, or league champion.
- Active matches are not resumable after refresh.
- There is no bench/rotation engine. The created player remains on court; six fouls are recorded but do not substitute the player.
- There is no physical-iPhone acceptance report and no native iOS package.
- There are zero production real-player 38-rating records in the release data pack.
- Ordinary passing still uses a limited target pool; low basketball IQ does not yet materially choose inferior-but-legal targets often enough.

KNOWN DOCUMENTATION DRIFT
- docs/engineering/implementation-plan.md contains stale local statements such as 24 templates, no formal save, and missing training settlement.
- The verified code, README, project-status-matrix, and tests show 30 templates, a schema-v1 root save, training/purchase logic, and M7B settlement.
- First perform a read-only reconciliation. Correct stale documentation only after verifying source and tests. Never roll working code back to match an outdated document.

EXECUTION POLICY
1. Work on exactly one small task card at a time.
2. Before editing, state:
   - task ID and name;
   - input files and rules;
   - files allowed to change;
   - tests to add;
   - observable acceptance result;
   - rollback point.
3. Prefer pure TypeScript domain logic before React UI wiring.
4. A new rule branch requires at least one success test and one failure/rejection test.
5. A visible UI change requires desktop Playwright plus both native iPhone landscape projects.
6. Do not weaken a correct basketball rule to make a failing fixture pass. Fix the event, movement, or state transition that generated the invalid world state.
7. Keep deterministic stable IDs and seeded outcomes. Repeated button clicks, stale callbacks, refreshes, and retries must be idempotent.
8. Do not edit unrelated user changes. Do not perform destructive resets.
9. Browser plugin availability must be checked. If it is unavailable, record that fact and use the existing Playwright workflow instead.
10. A task is not DONE until its focused tests and all required release gates are green.

NEXT TASK: M6B-1 — FINAL STANDINGS FREEZE AND PLAY-IN
Implement only M6B-1 in the first resumed iteration. Do not begin best-of-seven playoff series in the same change.

PHASE 0 — READ-ONLY AUDIT AND CONTRACT FREEZE
1. Read completely:
   - README.md
   - docs/engineering/project-status-matrix.md
   - docs/engineering/implementation-plan.md
   - docs/engineering/career-progression-m7.md
   - docs/engineering/m6-calendar-draft-rules-plan.md
   - docs/acceptance/acceptance-matrix.md
   - docs/acceptance/m7b-acceptance-report.md
   - src/game/career-season.ts
   - src/game/career-save.ts
   - src/game/career-game-settlement.ts
   - src/game/career-calendar-progression.ts
   - src/game/player-creation.ts
   - src/Prototype.tsx
   - all directly associated tests.
2. Confirm that no postseason or play-in production module currently exists.
3. Write a short rule decision record before code:
   - regular-season completion predicate;
   - division membership;
   - rankingRulesVersion;
   - exact two-team and multi-team tie-break sequence;
   - partial-tie restart behavior;
   - deterministic final fallback;
   - play-in home-court assignment;
   - persistence/migration strategy.
4. Use official primary sources for rules. Start with:
   - https://www.nba.com/news/nba-play-in-tournament
   - https://www.nba.com/standings?hidenav=true
5. Do not copy product wording or proprietary data from a competitor. Only implement generic basketball rules and independently designed UI.

PHASE 1 — PURE POSTSEASON DOMAIN MODEL
Preferred new module: src/game/career-postseason.ts
Preferred test: src/game/career-postseason.test.ts

Define plain JSON-safe types for:
- conference: EAST or WEST;
- stable rules version;
- immutable 15-team conference ranking snapshot;
- per-team regular-season tie-break evidence;
- postseason revision and freezeEventId;
- play-in game slots A, B, and C;
- stable game/event IDs;
- status SCHEDULED or FINAL;
- home/away teams and final score;
- seeds 1–8 after qualification;
- elimination state;
- validation errors or explicit result objects.

Regular-season freeze requirements:
1. Freeze only when all 1,230 regular-season games are FINAL and the dynamic cup schedule is resolved.
2. Recompute standings and tie-break inputs from FINAL game results. Do not trust mutable aggregate standings without reconciliation.
3. Produce exactly 15 Eastern and 15 Western teams with no duplicates, omissions, or cross-conference entries.
4. Include a stable rankingRulesVersion and freezeEventId.
5. Once frozen, the ordered snapshots are immutable. Repeated freeze calls are no-ops and must not reorder from later mutable aggregates.
6. Use deterministic fallback ordering only after all official available criteria are exhausted. Persist enough evidence to reproduce the order.

Tie-break implementation requirements:
- Implement the official two-team and multi-team hierarchy supported by the available schedule data.
- When a multi-team tie is reduced to two teams at a criterion, restart with the two-team procedure if the official rule requires it.
- Determine division winners consistently before using division-winner status as a conference tie-break.
- Compute head-to-head, division record, conference record, record against eligible conference teams, record against eligible opposite-conference teams when applicable, and total point differential from the schedule.
- Add focused tests at the 6/7 and 10/11 boundaries and for a three-team partial tie.
- Never describe a simplified win-percentage/point-differential sort as a complete official implementation.

Conference division map to verify against the canonical team IDs:
- Atlantic: Celtics, Nets, Knicks, 76ers, Raptors.
- Central: Bulls, Cavaliers, Pistons, Pacers, Bucks.
- Southeast: Hawks, Hornets, Heat, Magic, Wizards.
- Northwest: Nuggets, Timberwolves, Thunder, Trail Blazers, Jazz.
- Pacific: Warriors, Clippers, Lakers, Suns, Kings.
- Southwest: Mavericks, Rockets, Grizzlies, Pelicans, Spurs.
Use canonical internal IDs from player-creation.ts, not display-name string matching.

PHASE 2 — PLAY-IN STATE MACHINE
For each conference:
- Seeds 1–6 qualify directly and can never appear in any play-in game.
- Game A: seed 7 hosts seed 8. Winner becomes final seed 7. Loser remains alive.
- Game B: seed 9 hosts seed 10. Loser is eliminated. Winner advances only to Game C.
- Game C: Game A loser hosts Game B winner. Winner becomes final seed 8. Loser is eliminated.
- Game C must not exist or resolve until A and B are both FINAL.
- FINAL games cannot be tied.
- Each conference must end with exactly six direct qualifiers plus two play-in qualifiers.
- Final seeds 7 and 8 must be unique and from the same conference.

Idempotency and concurrency:
- Repeating freeze, advance, or the same result returns the existing state without adding another event or revision.
- Replaying the same game ID with a different score must reject as a conflict; never overwrite history.
- A stale expectedRevision or event token must not advance newer state.
- A rapid browser double click must cause one revision, one persisted result, and one visible result card.
- Refresh at every stage must restore identical teams, scores, seeds, eliminated teams, stable IDs, and next legal action.

Use deterministic test fixtures rather than fragile random simulation:
- EAST: A = original seed 8 beats 7; B = seed 10 beats 9; C = original seed 7 beats original seed 10. Final #7 is original 8 and final #8 is original 7.
- WEST: A = seed 7 beats 8; B = seed 9 beats 10; C = seed 9 beats original seed 8. Final #7 is original 7 and final #8 is original 9.
- Parameterize all 2 x 2 x 2 outcome combinations per conference and assert qualification/elimination invariants.

PHASE 3 — SAVE SCHEMA AND VALIDATION
Preferred direction: introduce an explicit schema-v2 migration because postseason state materially changes the persisted root. If you choose an optional schema-v1 field instead, document why it is safer and prove backward compatibility with tests.

Mandatory behavior:
1. Existing valid v1 careers load without data loss.
2. Corrupt postseason cross-links produce RECOVERY_REQUIRED; do not silently regenerate seeds or overwrite the save.
3. Future versions remain rejected/read-only and must not be overwritten.
4. Validate exactly 30 frozen teams, 15 per conference, correct conference membership, supported rules version, and consistency with the FINAL regular-season schedule.
5. Validate A/B participants against frozen seeds 7–10.
6. Validate C participants as A loser plus B winner.
7. Validate final seed 7 as A winner and seed 8 as C winner.
8. Validate elimination state, unique game IDs, unique event IDs, and no duplicate seeds.
9. Add save round-trip tests at: just frozen; one of A/B final; both A/B final; C final.
10. Add tamper tests for every cross-slice invariant.

PHASE 4 — MINIMAL CHINESE UI
Do not crowd the existing 38-rating sidebar or shrink the tactical board.

Add a compact postseason entry from the calendar only after regular-season completion:
- title: 季后赛
- conference tabs: 东部 / 西部
- compact seeds 1–10 with W-L records;
- clearly mark 1–6 as 直接晋级;
- show A, B, C as three readable play-in cards;
- display home/away, seed, result/status, and the next legal action;
- allow manual play only when the created player's team is in that specific game;
- simulate other games with the existing deterministic calendar approach;
- eliminated player teams receive a clear season-ended state;
- no button may silently do nothing.

Native layout requirements on 844x390 and 852x393:
- no horizontal or vertical document overflow;
- no clipped long Chinese team names;
- primary CTA at least 44x44 CSS pixels;
- no fake phone frame in native mode;
- rankings and play-in cards remain reachable without covering the persistent top bar or safe areas.

PHASE 5 — REQUIRED TESTS
Domain tests:
- cannot freeze with one unfinished game;
- freezes once after all 1,230 games are FINAL;
- exactly two immutable 15-team snapshots;
- complete deterministic tie-break behavior, including 6/7, 10/11, and partial multi-team ties;
- 1–6 never enter play-in;
- correct A/B/C participants, home court, winners, losers, seeds, and eliminations;
- all eight result combinations per conference preserve invariants;
- reject tied finals and out-of-order C resolution;
- repeated operations are no-ops; conflicting replay rejects;
- no duplicate IDs, events, teams, or seeds.

Save tests:
- v1 migration or optional-field compatibility;
- round trip at every play-in stage;
- every malformed cross-reference rejected;
- future schema preserved and not overwritten.

Playwright desktop tests:
- real end-of-season freeze from the career shell;
- East/West switching;
- created player seed 1–6 direct qualification;
- seed 7/8 win and loss paths;
- seed 9/10 elimination and advancement paths;
- final Game C qualification;
- reload at every stage;
- rapid double click creates one settlement only;
- every visible control has a meaningful response.

Native WebKit tests:
- run the same critical flow on iPhone 13 844x390 and iPhone 15 Pro 852x393;
- assert viewport bounds, safe areas, 44px touch targets, no overflow, no preview frame, and persistence after refresh.

FORMAL GATES BEFORE CLAIMING M6B-1 STABLE
Run in D:\我能打职业:
1. npm run test:core
2. npm run test:runtime
3. npm run test:native
4. npm run check:runtime
5. npm run build

All must pass. Report exact current counts from the command outputs; do not repeat old counts as if they were new evidence.

DOCUMENTATION AFTER CODE AND TESTS ARE GREEN
- Update README.md.
- Update docs/engineering/project-status-matrix.md as the single source of truth.
- Update docs/engineering/implementation-plan.md and remove verified stale 24-template/no-save/no-training statements.
- Update docs/acceptance/acceptance-matrix.md.
- Add a focused M6B-1 acceptance report with exact gate evidence, known boundaries, and remaining risks.
- Do not mark M6 overall DONE. Only M6B-1 may become DONE; best-of-seven series and cross-season progression remain pending.

STOP CONDITIONS
- Stop and report instead of guessing if official tie-break rules cannot be represented with the available data.
- Stop if a valid v1 save would be destroyed or silently reset.
- Stop if the change requires modifying a protected runtime file without approval.
- Stop if a P1/P2/P3/M7B invariant regresses.
- Stop if any formal gate is red. Never call a red or partially tested tree stable.

FINAL HANDOFF FORMAT
When M6B-1 is finished, report:
1. Outcome first: DONE, PARTIAL, or BLOCKED.
2. Exact files changed.
3. Rules implemented and explicit non-goals.
4. Bugs discovered and root causes.
5. Focused test evidence.
6. Full gate counts.
7. Save migration behavior.
8. Desktop and two-iPhone UI evidence.
9. Remaining P0/P1 risks.
10. The single next bounded task, which should be M6B-2 best-of-seven series only after M6B-1 is fully green.
```

---

## 四、暂停点

当前暂停点位于“M7B 已全绿，M6B-1 只完成计划与验收设计、尚未写生产代码”。恢复工作时应从上方英文提示词的 Phase 0 开始，不需要再次改写 P3 或 M7B。

除这份交接文档外，本次暂停没有新增或修改游戏代码。
