# Public GitHub仓库保护设置

状态日期：2026-09-11

本项目计划使用Public仓库，但采用“《我能打职业》项目作者”中性署名的玩家娱乐版专有、非开源许可。Public无法阻止查看、Clone或Fork；以下设置保护官方仓库完整性、减少凭据泄漏并明确法律边界，不构成技术性防复制，免责声明也不能替代第三方许可。

## 上传前

1. 确认仓库名为`wo-neng-da-zhi-ye`，不要使用误建的`-`。
2. 不在GitHub网页端生成README、LICENSE或`.gitignore`；本地受控版本已经包含。
3. 运行`npm ci`、`npm audit --audit-level=high`、`npm run check:release`和`npm run check:release:public`。
4. 严格公开门禁未通过时不推送游戏文件；保护文件不能代替第三方公开再分发许可。

## 首次推送后

在`Settings → Rules → Rulesets`创建作用于默认分支`main`的Active branch ruleset：

- Restrict deletions；
- Block force pushes；
- Require a pull request before merging；
- Require status checks to pass；
- Require conversation resolution；
- Require review from Code Owners；
- 有第二名可信审查者后再要求至少1人批准；单人仓库不要设置无法满足的外部批准条件。

首次CI运行后，选择GitHub实际显示的Windows、Ubuntu、Chromium和WebKit检查名作为Required checks。

## 安全设置

在`Settings → Security / Advanced Security`按账户能力启用：

- Dependency graph；
- Dependabot alerts；
- Secret scanning；
- Push protection；
- Code scanning；
- Private vulnerability reporting。

Actions的`GITHUB_TOKEN`保持`contents: read`。除非确有部署需求，不添加Repository Secret，不开启Pages，不安装第三方GitHub App。

## 权限

- 仓库管理员仅保留所有者和实际发布负责人；
- 开发者按需授予Write；
- 普通测试者不需要写入源码时仅使用Read/Triage；
- 不邀请未知账号，不允许自动合并Dependabot PR；
- `.github/CODEOWNERS`只有与Ruleset中的Code Owner review一起启用才具备合并门禁效果。

## 法律与追溯

- 保留`LICENSE`、`COPYRIGHT.md`、`TRADEMARKS.md`、`ASSET_LICENSE.md`和`NOTICE.md`；
- 用受保护标签和GitHub Release固定候选提交SHA；
- 在仓库外保存创作、劳动、委托、转让和第三方许可证据；
- 发现疑似盗用时保留URL、提交SHA、截图、时间与文件哈希，再通过平台投诉或专业法律渠道处理。
