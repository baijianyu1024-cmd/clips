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

更新 `package.json` 与 `extension/manifest.json` 的版本号，运行测试和打包。使用 Gitleaks 检查工作树及提交历史（建议 8.30.1+）：

```sh
gitleaks git --redact
gitleaks dir dist/clips-chrome-extension --redact
```

发布 GitHub Release 时上传 `dist/clips-chrome-extension.zip` 和 `dist/SHA256SUMS.txt`。源码 ZIP 不是用户安装包。不要将 `dist/`、`node_modules/` 或用户资料库提交进 Git。
