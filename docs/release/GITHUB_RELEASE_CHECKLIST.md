# GitHub 上传与发布检查清单

最后更新：2026-09-11

## 1. 先确定发布目标

本清单区分三个目标，不能混为“已上线”：

| 目标 | 当前建议 | 说明 |
| --- | --- | --- |
| 本地受控技术预览 | 当前可用 | 代码和自动门禁已形成候选；仍需保证测试者权限最小化 |
| 公开GitHub开发源码 | 按所有者明确指示上传 | 专有许可证已落地；多个实际内容项仍是`APPROVED_DEV`，因此不等于公开发行 |
| 可公开游玩的网页/应用商店版本 | 暂停 | 除公开源码阻塞外，还缺实体iPhone、性能、恢复、签名和商店合规门禁 |

任何对外描述都应使用“公开可见的专有预发布源码候选”或“合成阵容原型”，不得写成开源项目、已公开发行、完整职业篮球规则模拟或正式移动应用。

## 2. 本地仓库卫生

- [ ] 确认工作根目录就是游戏目录，而不是其上级含其他项目的工作区。
- [ ] 确认第3节将运行`npm run check:release`；Public推送前还必须单独运行`npm run check:release:public`，不用手工挑选部分测试替代。
- [ ] 确认根目录`LICENSE`、`COPYRIGHT.md`、`FAN_EDITION_NOTICE.md`、`TRADEMARKS.md`、`ASSET_LICENSE.md`、`NOTICE.md`、`CONTRIBUTOR_POLICY.md`和`.github/CODEOWNERS`均存在且项目作者署名一致。
- [ ] 确认 `git status --short --ignored` 中 `node_modules/`、`dist/`、`qa-artifacts/`、`test-results/`、Playwright报告和日志均为忽略项。
- [ ] 用 `git diff --cached --stat` 检查待提交文件；禁止把许可合同、研究PDF、绝对路径、个人信息、设备日志或密钥带入提交。
- [ ] 检查大文件。当前约2.16 MiB球场无损源图位于`docs/product/references/paper-court-source.png`，运行时使用约186.3 KiB的`public/assets/game/paper-court.webp`；当前不需要Git LFS。新增文件超过5 MiB必须复核，超过10 MiB默认阻止。
- [ ] 确认 `package-lock.json` 存在且依赖安装使用 `npm ci`。
- [ ] 本地Node版本与 `.node-version` 的`24.14.1`一致。
- [ ] 确认 `.gitattributes` 在Windows与Ubuntu之间固定文本换行为LF，并将图片、字体和音频标为二进制。

## 3. 代码与产物门禁

在当前集成树上依次执行并保存命令、日期与实际通过数量。`npm audit`必须显式执行，因为项目`.npmrc`关闭了安装时自动审计；`check:release`内部已经顺序运行发布卫生、第三方 notices、发布脚本回归、运行时锁、核心/桌面/原生测试、构建和Sites Worker测试：

```powershell
npm ci
npm audit --audit-level=high
npm run check:release
```

- [ ] 受保护移动运行时哈希全部匹配。
- [ ] 固定种子核心测试全部通过，无仅为过测而修改的期望值。
- [ ] 桌面Chromium交互测试全部通过；跳过项有明确、仍有效的理由。
- [ ] 双iPhone横屏WebKit门禁全部通过。
- [ ] `dist/client/index.html`、`dist/server/index.js`、`dist/.openai/hosting.json` 与源 `.openai/hosting.json` 存在。
- [ ] `postbuild`内容检查通过，最终包只有清单登记的本地音频。
- [ ] Sites Worker契约测试通过。
- [ ] 对当前发布候选进行一次全新浏览器存档、旧schema迁移和坏存档回退验证。

## 4. 权利与公开发布门禁

- [x] 仓库所有者已选择以“《我能打职业》项目作者”中性署名发布玩家娱乐版专有、非开源、保留全部权利的`LICENSE`；`package.json`保持`private: true`与`license: UNLICENSED`，防止npm误发布。
- [ ] 由适用法域的知识产权专业人士或项目授权负责人复核专有文本、原创权属链和对外署名；玩家娱乐版声明不能替代真实合同、第三方许可与权属证据。
- [ ] 逐项核对 `docs/rights/rights-ledger.md`。进入公开仓库或公开构建的每个内容项必须达到适用范围的`APPROVED_RELEASE`。
- [ ] 球队中文短名、代表色、模板真人风格参照、2026选秀事实、2026-27赛程与音频的许可范围覆盖源码公开、二进制分发、平台、地区和期限。
- [ ] 发布包不含Logo、官方球衣图案、竞品名称/表格、未批准真人名单、昵称或逐项评分。
- [ ] 已生成的`docs/release/THIRD_PARTY_NOTICES.md`与锁定依赖清单一致；Roboto与Phosphor等第三方字体/图标的许可证文本、嵌入/再分发范围仍须由发行负责人最终复核。
- [ ] 运行 `npm run check:release:public`；公开发布候选必须通过。
- [ ] 权利、产品、数据、音频/美术与工程负责人均留下可审计签核；许可合同本身保存在受限系统，不进入客户端或公开仓库。

## 5. 建立GitHub仓库

所有者已选择 Public，并通过受保护分支流程上传开发版源码。远端仓库与上传边界如下：

- [x] 已创建Public空仓库；不要在GitHub页面自动生成README、许可证或`.gitignore`，项目会从本地提交受控版本。
- [x] 仓库名为`wo-neng-da-zhi-ye`，远端URL为`https://github.com/CaesarWANG54/wo-neng-da-zhi-ye.git`。
- [x] 使用独立工作副本，避免把上级工作区或其他项目纳入仓库。
- [ ] 源码PR的 `git add` 后再次执行密钥、大文件和忽略项审查，再提交。
- [ ] 通过`codex/publish-development-source`分支和PR加入`main`，不直接绕过审查流程。
- [ ] 不把个人访问令牌写入远端URL、命令历史、配置文件或Actions变量。

## 6. GitHub仓库设置

- [ ] Actions默认`GITHUB_TOKEN`权限设为只读；工作流本身保持`permissions: contents: read`。
- [ ] 在Rulesets中保护`main`：禁止删除和强推、要求PR、要求对话解决、要求CI；有第二名审查者后再要求至少1人批准。
- [ ] 启用`Require review from Code Owners`，使`.github/CODEOWNERS`产生强制效果。
- [ ] `main`启用分支保护：在GitHub首次成功运行后，从仓库设置中选择当前工作流实际生成的全部必需检查（基础矩阵、桌面Chromium、原生WebKit），禁止强推和删除。检查名以GitHub当次展示为准，本清单不硬编码易漂移的名称。
- [ ] 至少一名代码审查者批准后才能合并；管理员是否允许绕过由所有者明确决定。
- [ ] 启用Dependabot alerts、dependency graph和secret scanning；若计划接受外部报告，启用Private vulnerability reporting。
- [ ] 不配置生产环境Secret，除非后续部署确实需要；新增Secret须记录用途、所有者、轮换和最小权限。
- [ ] Pages、Actions部署和第三方App默认关闭，直到部署目标、域名、数据与权限范围通过审查。
- [ ] 公开网页部署前，为静态响应建立并实测CSP、内容类型嗅探防护、Referrer/Permissions Policy与防嵌入策略；HSTS由最终HTTPS托管层核验。

## 7. GitHub Actions 首次验收

- [ ] Windows与Ubuntu的`npm ci`、运行时锁、核心测试、构建和Sites测试均通过。
- [ ] Ubuntu Chromium桌面交互作业通过。
- [ ] Ubuntu WebKit原生横屏作业通过；此作业独立安装WebKit系统依赖，不拖累其他矩阵作业。
- [ ] 失败日志不包含本地路径、凭据、许可证文档或真实用户数据。
- [ ] Dependabot配置可被GitHub读取，但不自动合并更新。

## 8. 真机与发布候选

- [ ] 至少一台当前支持的实体iPhone Safari完成创建、教学、比赛、暂停/后台、日历、季后赛和下一季回归。
- [ ] 横竖屏切换、安全区、触控双击、音频首次解锁、来电/锁屏恢复和30分钟连续运行有记录。
- [ ] 完成键盘/焦点、动态文字、颜色对比、对话框语义与实体iPhone VoiceOver无障碍验收。
- [ ] 活跃比赛中断/恢复策略明确并测试；不能只恢复赛季外层存档。
- [ ] 记录首屏、内存、CPU、耗电、包体、主JS和最大资产预算。
- [ ] 若制作原生包，另行完成Capacitor/签名、权限、隐私清单、商店素材与审核，不把签名证书放入仓库。
- [ ] 发布候选使用不可变提交SHA和语义化标签；变更日志只陈述实际完成范围。

## 9. 回滚与事故准备

- [ ] 保留最近一个通过全部门禁的提交SHA和构建证据。
- [ ] 部署系统支持回滚到该SHA；回滚不依赖重新生成赛程、随机种子或许可数据。
- [ ] 如果发现密钥泄露，先撤销/轮换再清理历史；如果发现权利问题，立即停止分发并切换合成/原创替代内容。
- [ ] 如果存档迁移异常，停止升级发布，保留原存档副本并使用已验证的上一版本。

发布阻塞项的单一清单见 [RELEASE_BLOCKERS.md](RELEASE_BLOCKERS.md)。
