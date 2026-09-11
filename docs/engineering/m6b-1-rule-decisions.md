# M6B-1 规则决策记录（冻结前）

日期：2026-09-03 · 模块：`src/game/career-postseason.ts`
依据：官方公开附加赛与排名通则（nba.com play-in / standings tie-break 说明的通用规则表述），
不复制任何竞品数据或文案；所有口径在本文件中冻结。

## 1. 常规赛完成谓词
- `season.cupResolved === true`
- `season.games.length === 1230`（1200 场发布 + 30 场动态杯赛）
- `season.games.every(g => g.status === "FINAL")`
- 三者全真才允许冻结；最后一场未 FINAL 时冻结调用返回 `NOT_READY`，绝不部分冻结。

## 2. 分区归属（用 player-creation.ts 规范队 ID，不用显示名）
- 大西洋 Atlantic：CELTICS, NETS, KNICKS, SIXERS, RAPTORS
- 中部 Central：BULLS, CAVALIERS, PISTONS, PACERS, BUCKS
- 东南 Southeast：HAWKS, HORNETS, HEAT, MAGIC, WIZARDS
- 西北 Northwest：NUGGETS, TIMBERWOLVES, THUNDER, TRAIL_BLAZERS, JAZZ
- 太平洋 Pacific：WARRIORS, CLIPPERS, LAKERS, SUNS, KINGS
- 西南 Southwest：MAVERICKS, ROCKETS, GRIZZLIES, PELICANS, SPURS

## 3. 排名规则版本
- `RANKING_RULES_VERSION = "m6b1-tiebreak-v1"`，随快照持久化。
- 先按官方分区平局程序确定 6 个分区冠军；“分区冠军”只作为同战绩判据，不自动占据前四名。
- 每队每季 82 场（80 发布 + 2 杯赛），因此胜场排序等价于胜率排序；统一按胜率。

## 4. 两队平局序列（同区球队，决定先后）
1. 相互交手胜率（只统计实际已赛；0 场则该判据相等）
2. 分区冠军优先（无论两队是否同分区）
3. 同分区时：分区内胜率
4. 同区（联盟内）胜率
5. 对同区季后赛资格球队的胜率（按本区前十战绩门槛，包含并列第十）
6. 对异区季后赛资格球队的胜率（按异区前十战绩门槛，包含并列第十）
7. 全部比赛净胜分（pointsFor − pointsAgainst），高者在前
8. 官方口径用尽后的随机抽签；游戏使用赛季种子与平局球队集合做确定性抽签，保证刷新可复现

## 5. 多队平局序列（3 队及以上）
1. 分区冠军优先（无论是否同分区）
2. 平局团队之间的相互交手胜率
3. 若全部同分区：分区内胜率
4. 同区胜率
5. 对同区季后赛资格球队胜率（本区前十战绩门槛，包含并列第十）
6. 全部比赛净胜分
7. 仍无法拆分时进行由赛季种子驱动的确定性随机抽签
- 在任一判据把平局缩小到 2 队时，**重新从两队序列开始**。
- 每次分离出“严格最优”的队后，剩余平局团队从头重启判据。
- 平局组只含胜率完全相同的连续球队；排序在组内进行，绝不跨组比较。

## 6. 冻结快照
- 一次冻结生成 EAST / WEST 各 15 队的不可变排名快照（含胜负、分区、分区冠军、排名与种子）；完整判据从已冻结赛果重算并由根存档严格交叉校验，不重复持久化可推导明细。
- 冻结只从 FINAL 比赛重算；不信任可变 standings 聚合。
- `freezeEventId` 确定性生成；重复冻结是 no-op，不重排。
- 第 1–10 名 = 种子 1–10（第 11–15 名直接无缘附加赛）。

## 7. 附加赛主场分配（每区独立）
- A 场：种子 7 主场 vs 种子 8；胜者锁定最终第 7，败者保留机会
- B 场：种子 9 主场 vs 种子 10；败者淘汰，胜者只进 C 场
- C 场：A 场败者主场 vs B 场胜者；胜者锁定最终第 8，败者淘汰
- C 场在 A、B 均 FINAL 前不可生成/结算；FINAL 比赛不可平局。
- 1–6 名直接晋级，绝不进入任何附加赛场次。

## 8. 持久化/迁移策略
- 根存档升 schema v2：`data.postseason?: PostseasonState`（可选字段）。
- v1 存档照常加载并在内存中迁移为 v2（无数据丢失）；写入恒为 v2。
- 损坏的附加赛交叉引用 → `RECOVERY_REQUIRED`，不静默重抽种子或覆盖存档。
- v3+ 一律拒绝/只读，禁止覆写。

## 9. 结算边界（M6B-1）
- 附加赛手打场次只结算附加赛结果（比分/胜负 + 稳定事件 ID）；
- 不发放金币、不改默契、不改常规赛 PlayerSeasonLine 与 standings；
- 该边界写入 M6B-1 验收报告；季后赛统计与奖励留给 M6B-2 统一决策。
