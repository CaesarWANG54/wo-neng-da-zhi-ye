# Contributing to 我能打职业

感谢关注项目。当前仓库计划公开可见，但属于项目作者维护的专有、非开源玩家娱乐版预发布项目。公开可见不授予复制、修改、构建、部署、分发或商用权；只有得到仓库所有者授权的协作者才能提交。提交前必须阅读根目录`LICENSE`、`FAN_EDITION_NOTICE.md`、`CONTRIBUTOR_POLICY.md`与`ASSET_LICENSE.md`。

当前不接受未经邀请的外部代码、素材或数据贡献。Issue中的缺陷报告和建议可以进入评估，但外部Pull Request只有在事先邀请、来源可核验且必要的书面权利安排完成后才可能合并。

## 开发环境

- Node.js `24.14.1`；`.node-version`与CI固定使用这一版本。
- 使用仓库锁文件安装：`npm ci`。
- 本地开发：`npm run dev -- --host 127.0.0.1 --port 4173`。
- 浏览器测试需要对应的Playwright浏览器；不要把浏览器缓存或测试报告提交到仓库。

## 改动边界

开始前完整阅读 `AGENTS.md`。应用界面优先修改 `src/Prototype.tsx` 与 `src/prototype.css`。移动设备运行时、受保护资产、Worker和构建脚本受 `mobile-runtime.lock.json` 约束；除非任务明确要求修改运行时并完成复核，否则不得改动或重算锁值。

保持以下产品约束：

- 游戏运行界面使用中文，战术板横屏且右侧五个操作槽位真实可用；
- 不加入联盟或球队Logo、官方球衣图案、竞品专有数据表或未经批准的真人内容；
- 不通过弱化测试、删除断言、改变固定种子或绕开内容扫描来让门禁变绿；
- 不把生成的 `dist/`、测试报告、QA截图、日志、临时导入文件或本地Agent状态提交到仓库。

## 数据、素材与权利

新增名称、赛程、评分、字体、图标、图片或音频前，必须在 `docs/rights/rights-ledger.md` 中记录来源、用途、许可状态和构建门禁。`APPROVED_DEV` 只允许内部原型，不等于可以公开分发；发行内容必须取得适用范围内的 `APPROVED_RELEASE`。

不要复制竞品的逐项评分表。真人评分只能通过经过批准、可追溯的来源和项目原创模型生成。素材应尽量小；任何超过5 MiB的源文件需要在PR中解释，超过10 MiB默认阻止发布审查。

## 提交前检查

至少运行与你的改动相关的测试；准备合并到发布分支时运行完整门禁：

```powershell
node scripts/release-readiness.mjs
npm run check:runtime
npm run test:core
npm run test:runtime
npm run test:native
npm run build
npm run test:sites
```

原生WebKit自动测试不能替代实体iPhone Safari复核。公开发布还必须通过：

```powershell
node scripts/release-readiness.mjs --strict-public
```

严格模式预期会在专有许可结构或内容权利状态未关闭时失败；不得为了通过而删除相关记录或把`APPROVED_DEV`擅自升级。

## Pull Request 要求

PR应保持单一目的，并写明：

- 用户可见结果与不在本次范围内的内容；
- 修改的文件和状态机/存档兼容性影响；
- 执行过的命令、通过数量及任何按设计跳过项；
- UI改动的iPhone与Pixel证据；
- 新增数据或素材的来源、哈希、许可状态；
- 已知风险、回滚办法与后续任务。

安全问题遵循 `SECURITY.md`，不要在公开PR或Issue中披露未修复漏洞。
