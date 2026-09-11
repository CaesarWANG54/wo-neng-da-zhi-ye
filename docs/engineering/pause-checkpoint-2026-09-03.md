# 《我能打职业》暂停检查点与续作计划

日期：2026-09-03
正式项目目录：`D:\我能打职业`
当前结论：M6B-1 已完成并全绿；按用户要求暂停，不启动 M6B-2。

## 1. 当前稳定状态

FABLE 已完成的最终排名/附加赛领域骨架经过接管修复后，现已形成完整可见闭环：

1. 常规赛必须满足杯赛已解析、联盟恰好 1,230 场、30 队各 82 场且全部 FINAL，才能冻结排名。
2. 东西部各保存 15 队最终排名快照；界面展示前十，1–6 直通，7–10 进入附加赛。
3. 两队与多队同战绩使用独立、版本化规则，并包含分区冠军优先、相互战绩、分区/分区内战绩、符合资格对手战绩、净胜分及稳定随机抽签兜底。
4. 每区附加赛按 A（7主8）→ B（9主10）→ C（A负者主B胜者）推进；A/B 未全部结束前不存在 C 场。
5. 日历新增“季后赛中心”：可切换东西部、查看前十和 A/B/C 对阵、模拟下一场，或让创建球员亲自参加本队下一场。
6. 玩家场模拟是产品层有意保留的选择；同一场模拟比分不因先推进东部还是西部而变化。
7. 附加赛手打复用完整比赛引擎，真实主客比分会正确映射回 bracket；当前只记录晋级结果，不重复写常规赛战绩、82场个人统计、金币或默契。
8. 根存档为 schema v2，支持 v1 内存迁移；季后赛切片与最终常规赛及事件重放结果交叉校验。
9. 写盘失败时终场弹窗保持，内存与存档都不提交；恢复后可重试。双击结算只生成一个事件和一次 revision。
10. FABLE 的固定落点传球到达语义也已保留在当前绿色基线：飞行期间不提前换持球人、时钟继续、到达只交接一次、陈旧传球可取消，合法回场规则未被削弱。

## 2. 正式目录最终门禁

以下结果均在 `D:\我能打职业` 顺序执行，不是暂存副本结果：

- `npm run test:core`：24 个测试文件，321/321 通过。
- `npm run test:runtime`：共收集 96 项；89 项桌面测试通过，7 项原生专属测试按桌面配置跳过，退出码 0。
- `npm run test:native`：14/14 通过，覆盖 WebKit iPhone 13（844×390）和 iPhone 15 Pro（852×393）。
- `npm run build`：TypeScript、Vite 生产构建、Sites 产物准备全部通过。
- 移动运行时完整性：28 个受保护文件通过。
- 内容合规：77 个运行时文本、1 个审核游戏资产、2 个审核音频资产通过。
- 生产包主要文件：JS 814.52 kB（gzip 247.01 kB），CSS 62.11 kB（gzip 12.23 kB）；Vite 仅提示后续可做代码拆分，不是构建失败。

详细证据见：

- `docs/acceptance/m6b-1-acceptance-report.md`
- `docs/engineering/project-status-matrix.md`
- `docs/acceptance/acceptance-matrix.md`
- `docs/engineering/m6b-1-rule-decisions.md`

## 3. 本轮关键文件

### 生产代码

- `src/Prototype.tsx`：季后赛运行时状态、加载/自动保存、冻结、模拟、手打、结算、错误恢复和 UI 编排。
- `src/prototype.css`：季后赛中心、附加赛卡片、确认页及 iPhone 44px 触控布局。
- `src/game/career-postseason.ts`：排名证据、完整同战绩排序、冻结和附加赛状态机。
- `src/game/career-save.ts`：schema v2、v1 迁移与季后赛交叉校验。
- `src/game/career-season.ts`：合理区间内的确定性附加赛比分模拟。

### 自动验收

- `src/game/career-postseason.test.ts`
- `src/game/career-save.test.ts`
- `tests/career-postseason.spec.ts`
- `tests/mobile-native.spec.ts`

### 文档

- `README.md`
- `docs/product/GDD-lite.md`
- `docs/data/current-data-inventory.md`
- `docs/engineering/implementation-plan.md`
- `docs/engineering/project-status-matrix.md`
- `docs/acceptance/acceptance-matrix.md`
- `docs/acceptance/m6b-1-acceptance-report.md`

## 4. 已冻结、恢复时不得改写的决定

- 球队仍只显示获准中文简称与纯色；不得加入联盟标志、球队标志或仿制球衣图案。
- 1–6 名绝不进入附加赛；A/B/C 主客与晋级关系不可为简化 UI 改写。
- 东西部可以交错推进，事件 ID 和模拟比分不得依赖交错顺序。
- 排名只冻结一次；刷新不能重抽，同比分重复提交不能增加 revision。
- 玩家可以选择模拟自己的下一场附加赛，也可以手打；两条路径只能结算一次。
- M6B-1 不发季后赛金币、不改默契、不写常规赛统计；相关经济和季后赛数据口径必须在 M6B-2 开始前单独冻结。
- 所有比赛按钮必须有实际状态效果；不可用时禁用或解释，不能保留空壳按钮。
- 当前 pass-arrival、真实 elapsed 时间、24/14/8/5秒、回场、犯规/Bonus、自动罚球、十人移动和创建球员常驻不变量必须全部回归。
- localStorage key 继续使用 `wo-neng-da-zhi-ye:career:v1`；key 是稳定命名空间，不随 schema 数字改名。

## 5. 当前明确未完成

1. 首轮、分区半决赛、分区决赛和总决赛的固定对阵树。
2. 七场四胜系列赛及 2-2-1-1-1 主场顺序。
3. 分区冠军、总冠军、冠军结算与赛季完成事件。
4. 季后赛个人/球队统计、体能消耗和奖励政策。
5. 季后赛结束后的年龄增长、32岁衰退、40岁强退、退役通知和下一赛季。
6. 多标签页 localStorage 的 Web Lock/CAS；当前明确按单标签页使用。
7. 实体 iPhone Safari、30分钟长局、耗电/温度和原生安装包。
8. 真人30队名单和每人38项正式评分；仍受来源、许可与人工复核门禁约束。

## 6. 下一阶段：M6B-2 小任务顺序

恢复时只做七场系列赛与冠军闭环，不同时启动跨赛季。

### M6B-2A — 决策冻结

- 冻结首轮对阵：1v8、4v5、3v6、2v7；后续不重新排种子。
- 冻结 2-2-1-1-1 主场序列和高顺位主场优势。
- 冻结总决赛主场优势的比较口径及完全并列兜底。
- 决定季后赛统计是否独立于常规赛；决定手打/模拟奖励、默契和体能策略。
- 决定 `PostseasonState` 扩展时采用内部 schema v2 还是根存档 schema v3，并先写迁移策略。

验收：新增规则决策文档；所有歧义都有唯一答案，尚未写 UI。

### M6B-2B — 纯领域系列赛模型

- 建立 series、round、game、home/away、winsNeeded、winner、event ledger 和 revision。
- 只能结算“当前下一场”；不得平局、跳场、越轮或覆盖 FINAL。
- 相同结果 NOOP，不同结果 CONFLICT，陈旧 revision STALE。
- 一方达到4胜后立即锁系列赛，且只生成下一轮唯一对阵。
- 东西部冠军全部产生后才生成总决赛；总冠军只能有一个。

验收：固定种子覆盖每轮4-0至4-3、主客序列、东西部交错、重复/冲突/陈旧提交和冠军唯一性。

### M6B-2C — 存档与迁移

- 用严格 validator 检查系列赛参与者、轮次来源、胜场、赛程序列、事件账本和冠军链。
- 从当前 M6B-1 合法存档迁移，不能重抽冻结排名或已完成附加赛。
- 对损坏链路进入 `RECOVERY_REQUIRED`，未来版本拒绝且不覆盖。

验收：round-trip、迁移、篡改、跨赛区交错与失败写盘测试全部通过。

### M6B-2D — 日历/季后赛 UI

- 在现有季后赛中心增加“附加赛 / 首轮 / 分区半决赛 / 分区决赛 / 总决赛”导航。
- 卡片显示系列赛比分、下一场主客、晋级条件和已淘汰状态。
- 只给当前合法场次显示手打/模拟；所有按钮具备实际行为和明确反馈。
- 玩家手打继续复用 `MatchPrototype`，但用新的 series launch 契约结算。

验收：桌面、844×390、852×393 均无溢出，关键触控目标至少44px。

### M6B-2E — 全门禁与报告

- 先跑 focused domain/save，再跑完整 core。
- 跑完整桌面 Playwright、原生 WebKit、生产 build 和内容扫描。
- 保存截图、准确测试数量、包体变化、已知边界和下一任务。
- 只有全部退出码为0时，才把 M6B-2 标记 DONE。

## 7. 恢复时第一组操作

1. 确认没有 Hermes/FABLE 或其他代理仍在写 `D:\我能打职业`。
2. 读取本文件、`project-status-matrix.md`、`m6b-1-rule-decisions.md` 和 `m6b-1-acceptance-report.md`。
3. 顺序运行当前绿色基线：`npm run test:core`、`npm run test:runtime`、`npm run test:native`、`npm run build`。
4. 只创建 M6B-2A 决策文档和测试计划；先审查再实现。
5. 任何现有门禁回归立即停止扩展，先恢复绿色。

## 8. Resume prompt (English)

```text
Continue development of the Chinese-language mobile basketball tactics game “我能打职业” in D:\我能打职业.

Read these files first and treat them as the current source of truth:
- docs/engineering/pause-checkpoint-2026-09-03.md
- docs/engineering/project-status-matrix.md
- docs/engineering/m6b-1-rule-decisions.md
- docs/acceptance/m6b-1-acceptance-report.md

M6B-1 is complete and green. Preserve its frozen standings, official two-team and multi-team tie-break paths, deterministic play-in A/B/C state machine, schema-v2 save migration, atomic persistence, player manual/simulation choice, iPhone layout, and all existing match-engine invariants.

Work only on M6B-2 next: the fixed best-of-seven playoff bracket and championship closure. Do not begin cross-season aging or retirement in the same iteration. First produce the M6B-2A decision record covering 1v8/4v5/3v6/2v7 pairings, no reseeding, 2-2-1-1-1 home sequence, Finals home-court criteria, postseason statistics/reward boundaries, and the save-schema migration strategy. Then implement pure domain tests before React UI.

Run every gate sequentially in the canonical D: project to avoid cache contention. Do not claim stability until core, desktop Playwright, native WebKit, build, protected-runtime integrity, and content compliance all exit zero. Keep the game UI Chinese and do not add league/team logos or prohibited branding.
```

## 9. 暂停动作

- 当前代码、计划、验收矩阵和本检查点均已写入正式项目。
- 本地预览服务在保存完成后停止；恢复工作时重新运行 `npm run dev -- --port 4173 --strictPort`。
- 不再执行 M6B-2 或其他新增修改，等待用户继续指令。
