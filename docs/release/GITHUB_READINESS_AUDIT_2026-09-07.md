# GitHub Readiness Audit — 2026-09-07

> **历史快照，已被取代。** 本文只保留 2026-09-07 当日审查证据，不是当前状态真相源，也不得用于声明当前门禁已通过。2026-09-09 起请以 [RELEASE_BLOCKERS.md](RELEASE_BLOCKERS.md)、[GITHUB_RELEASE_CHECKLIST.md](GITHUB_RELEASE_CHECKLIST.md)、[PUBLIC_BETA_SCOPE.md](PUBLIC_BETA_SCOPE.md) 和实际命令输出为准；本文中的历史测试/文件数量不随新提交改写。

## 结论先行

截至 2026-09-07，该工程已具备“由所有者上传到私有GitHub仓库并触发首次CI”的仓库结构，但不能标记为已公开、公开发行就绪或移动商店就绪。默认发布审查无失败；严格公开审查按设计被许可证与多项`APPROVED_DEV`权利状态拦截。

本次只修改仓库元数据、GitHub工作流、发布审查脚本、发布文档、README和一项权利台账数量勘误；没有修改`src/`、`tests/`、`package.json`、`package-lock.json`或任何受保护移动运行时文件。

## 审查环境

| 项目 | 结果 |
| --- | --- |
| 主机 | Windows / PowerShell |
| Node.js | `v24.14.1`，已写入`.node-version` |
| 独立Git仓库 | 尚未建立；当前目录处于上级工作区内 |
| 远端与GitHub可见性 | 尚未配置；推荐所有者先建私有仓库 |
| 开源许可证 | 未选择；未新增`LICENSE` |
| 受保护运行时 | `npm run check:runtime`通过，28个文件哈希匹配 |

## 仓库卫生结果

- 高置信度密钥扫描：未发现私钥、GitHub/GitLab/npm/AWS/Google/OpenAI/Slack/Stripe令牌或Discord webhook模式。
- 敏感文件名扫描：未发现`.env`、私钥、签名证书或keystore文件。
- 本地生成物：`debug.log`、`dist/`、`qa-artifacts/`与`test-results/`存在，但均已由`.gitignore`覆盖；没有删除用户材料。
- 球场无损源图现归档为`docs/product/references/paper-court-source.png`（约2.16 MiB），运行时只使用`public/assets/game/paper-court.webp`（约186.3 KiB）；源图和发行文件都由`public/assets/game/game-asset-manifest.json`登记哈希。两张产品参考图分别约2.13 MiB和2.11 MiB。没有文件达到5 MiB警告线或10 MiB项目阻断线，不需要Git LFS。
- 行尾与二进制：`.gitattributes`把常用源码/文档固定为LF，并将图片、字体与音频标为二进制，避免Windows/Ubuntu无意义差异。
- 权利台账勘误：模板风格参照从错误的24套改为当前实际30套；许可状态未被人为升级。

## CI设计

| 作业 | Runner | 内容 | 设计原因 |
| --- | --- | --- | --- |
| `integrity-core-build` | `ubuntu-latest` + `windows-latest` | `npm ci`、仓库卫生、运行时锁、核心测试、生产/Sites构建、Sites Worker测试 | 同时覆盖大小写、路径分隔符和两套主机工具链 |
| `desktop-chromium` | `ubuntu-latest` | 安装锁定Playwright包对应的Chromium系统依赖，运行桌面交互套件 | 浏览器依赖与基础矩阵隔离，失败定位清楚 |
| `native-webkit` | `ubuntu-latest` | 安装WebKit系统依赖，运行双iPhone横屏触摸/几何套件 | 保留原生门禁，避免WebKit安装成本拖慢Windows与核心作业 |

所有作业使用相同分支并发取消、25分钟超时、`contents: read`最小权限、精确Node版本和npm缓存。Checkout关闭凭据持久化；官方Action使用不可变提交SHA固定为[checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1)与[setup-node v7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0)，Dependabot按月提出npm和GitHub Actions更新，不自动合并。

## 实际执行证据

| 命令/检查 | 结果 |
| --- | --- |
| `node --check scripts/release-readiness.mjs` | 通过 |
| `node scripts/release-readiness.mjs` | 通过；仅输出已知本地残留、未初始化仓库、开发期权利与无许可证警告 |
| `node scripts/release-readiness.mjs --strict-public` | 退出码1，符合预期；阻止开发期权利内容和无许可证状态被误称公开候选 |
| `npm run check:runtime` | 通过；28个受保护文件 |
| `.gitignore`命中抽查 | `debug.log`、`dist/client/index.html`、`qa-artifacts/`、`test-results/`均被正确忽略 |
| YAML解析 | 本地主机没有独立YAML解析器；审查脚本已校验必需片段，最终语法/Runner行为仍须由首次GitHub Actions关闭 |
| 游戏全套门禁 | 本支线未并发运行，避免与其他正在集成的游戏代码任务争用；由最终集成负责人统一执行 |

## 仍然阻塞的事项

1. 所有者尚未确认GitHub组织、仓库名称、私有可见性和远端地址。
2. 当前最终集成树尚未形成新的全套绿灯证据，历史2026-09-03结果不能替代。
3. 未选择许可证；公开源码权利不明确。
4. 球队短名/颜色、模板人物参照、选秀/赛程、合成属性、通用球衣、字体、图标和音频在台账中仍为`APPROVED_DEV`，不是`APPROVED_RELEASE`。
5. **当日历史状态已关闭：** 2026-09-07审查时静态Worker尚未显式设置安全响应头；后续已为静态资源、SPA回退和错误响应统一加入CSP、`nosniff`、Referrer/Permissions Policy、同源隔离与防嵌入头，并由Worker契约测试锁定。实际HTTPS域名的最终响应头、缓存和HSTS仍需部署后核验。
6. 实体iPhone Safari、无障碍、活跃比赛恢复、真机30分钟稳定性、性能/耗电和原生安装/签名链尚未关闭。
7. GitHub仓库安全设置和工作流第一次云端运行只能在所有者创建远端后验证。

完整逐项状态及关闭证据要求见[RELEASE_BLOCKERS.md](RELEASE_BLOCKERS.md)，执行顺序见[GITHUB_RELEASE_CHECKLIST.md](GITHUB_RELEASE_CHECKLIST.md)。
