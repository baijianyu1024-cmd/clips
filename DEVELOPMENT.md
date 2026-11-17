# 自行二次开发

原仓库由作者维护，不向其他使用者开放直接修改权限。你可以 Fork 到自己的 GitHub 账号，或下载源码，在自己的副本中二次开发、使用和发布。

1. 使用 Node.js 22.13+，执行 `npm ci`。
2. 修改 `extension/` 中的业务逻辑；富文本编辑器源码在 `editor/`，不要只修改生成的压缩文件。
3. 运行 `npm test` 和 `npm run package`。打包会重新生成编辑器及其许可证清单。
4. 在 Chrome 中「加载已解压的扩展程序」，选择 `dist/clips-chrome-extension`，检查受影响的真实交互。
5. 将修改提交到你自己的仓库；发布自己的版本时保留 MIT 许可证和第三方版权声明。

请勿向任何公开仓库提交 `.env`、API Key、会话凭据、真实笔记、资料库备份或包含私人内容的截图。测试使用虚构数据；自动化测试不得调用付费 API。

本地版的默认体验需要独立于任何作者私人账号。新增远端服务时，请说明发送的数据，并要求用户主动配置；不要内置共享 Key。

## 发布

更新 `package.json` 与 `extension/manifest.json` 的版本号，并在 [CHANGELOG.md](CHANGELOG.md) 顶部补充该版本的发布日期、变更和必要的升级事项。README 保留功能与使用说明，历史更新集中维护在 CHANGELOG 中。

运行测试和打包。使用 Gitleaks 检查工作树及提交历史（建议 8.30.1+）：

```sh
gitleaks git --redact
gitleaks dir dist/clips-chrome-extension --redact
```

GitHub Release 的更新说明沿用 CHANGELOG 中对应版本的条目，再附安装包和升级步骤。仅整理文档时无需提高插件版本号或重新发布安装包。

发布 GitHub Release 时上传 `dist/clips-chrome-extension.zip`、`dist/clips-agent.zip` 和 `dist/SHA256SUMS.txt`。源码 ZIP 不是用户安装包。不要将 `dist/`、`node_modules/` 或用户资料库提交进 Git。

## Agent 接口

`agent/` 是 Node MCP / CLI 与本机连接器，`extension/agent-service.js` 将固定工具映射到既有资料库接口。不得扩展成任意 fetch 或脚本执行通道，也不要直接写本地资料库绕过浏览器锁。

```sh
npm --prefix agent ci
npm run test:agent
npm test
```

新增工具需同步 `extension/agent-protocol.js`、验证、测试与 `docs/AGENT.md`。连接器与插件更新时应保持协议兼容，安装说明涵盖 Windows 和 Mac。测试仅使用虚构资料库，不调用付费 API。

删除必须使用 prepare → 用户确认 → delete 两步流程；凭证绑定资料库、目标和 revision。不要自动用新 revision 重试删除。产品删除入口使用二次确认，本地与云端共用记录删除规则。

## 界面与版本对齐

从 0.15.0 起，本地笔记库使用 `ui/app/` 中的共享界面：导航、全部记录/按篇笔记、筛选、标签管理、详情编辑、摘要、图片和字幕阅读。`extension/library-platform.js` 只负责文件夹请求、图片和页面地址适配。对话、AI、字幕和侧栏仍使用相同的功能模块。

修改后运行 `npm run build`、`npm test`、`npm run check:release`、`npm run package`。维护者还可运行 `node scripts/check-parity.mjs --reference <参考源码根目录>`，核对两份源码的共享界面和功能模块；存储连接差异单独记录在 `ui/parity.json`，不能靠忽略整个文件掩盖功能改动。

升级保留原插件目录与资料库，不要卸载。若旧版笔记库有未保存内容，可在「资料库与备份 → 旧版未保存内容」恢复。已保存笔记、图片和字幕仍在原文件夹。
