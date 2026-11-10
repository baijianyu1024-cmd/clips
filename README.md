# Clips

在浏览器中边读边记，把摘录、想法、截图和视频引用保存到自己的文件夹。

Clips 是一个 Chrome 扩展，包含侧边栏和本地笔记库。**不需要 ChatGPT 账号、不需要部署服务器。** 普通记录无需 API Key；AI 功能使用你自己配置的 DeepSeek / Supadata 账号。

[下载安装包](https://github.com/baijianyu1024-cmd/clips/releases/latest/download/clips-chrome-extension.zip) · [所有版本](https://github.com/baijianyu1024-cmd/clips/releases) · [隐私说明](PRIVACY.md) · [自行二次开发](DEVELOPMENT.md)

## 功能

- **边读边记**：摘录原文、写想法、粘贴或上传图片；切换网页时保留当前笔记，保存到不匹配的文章前再次确认。
- **笔记库**：全部记录打平浏览，或按篇查看；搜索、标签、待阅读、归档、内容发布时间和后续补充。
- **Markdown**：基本格式、列表、链接、表格、行内代码与代码块，编辑时直接渲染。
- **核心摘要**：结合当前可读取的页面内容、阅读记录和补充信息生成，支持修改及重新生成。
- **理解 / 翻译**：支持引用、图片和多轮追问；可将问答整理成想法，经确认后保存。
- **YouTube 阅读**：获取原生字幕、生成 Overview、双语关键引用、字幕翻译、章节跳转与播放跟随；视频中可快速保存当前上下文的引用。
- **本地资料库**：笔记、图片与字幕直接写入所选文件夹，支持完整备份和 Markdown 导出。

## 安装（Windows / macOS）

1. 使用桌面版 Chrome，下载上方的 `clips-chrome-extension.zip`。请选这个附件，而不是 GitHub 自动生成的 `Source code.zip`。
2. 解压到一个长期保留的文件夹，例如 `Documents/Clips/extension`。不要在 ZIP 压缩包里直接打开。
3. 在 Chrome 地址栏打开 `chrome://extensions`，开启右上角的「开发者模式」。
4. 点击「加载已解压的扩展程序」，选择刚解压的 `clips-chrome-extension` 文件夹；其中应直接包含 `manifest.json`。
5. 安装后打开本地笔记库，选择一个**单独的空文件夹**保存笔记。插件文件夹与笔记文件夹应分开。
6. 将 Clips 固定到工具栏；打开文章或视频，点击 Clips 图标，在侧边栏中手动开始笔记。

建议使用最新版 Chrome；扩展声明的最低版本为 116。当前以桌面 Chrome 为目标，尚未完成 Windows 真机和其他浏览器的兼容性实测。它不是 Chrome Web Store 安装包，首次需要按上述步骤加载，也不会自动更新。

### 更新

先保存草稿并做资料库备份，再下载新版 ZIP，将文件覆盖到**原插件目录**。回到 `chrome://extensions`，点击 Clips 卡片上的「重新加载」，重新打开侧栏；如需 YouTube 页面内入口，请刷新视频页面。不要先卸载插件，以免丢失本机设置与未保存的草稿。

### AI 设置

在侧栏的设置中填写自己的 API Key，配置模型并授予对应服务权限：

| 能力 | 需要的服务 |
| --- | --- |
| 普通笔记、图片、标签、导出 | 无 |
| 核心摘要、理解与翻译 | DeepSeek |
| 获取 YouTube 字幕 | Supadata |
| YouTube Overview、字幕与引用翻译 | Supadata + DeepSeek |

模型名称可在设置中修改；当前默认 `deepseek-flash`。图片理解要求模型支持图像输入，请使用服务商当前支持的模型。模型可用性、配额及 API 费用由各服务商决定。

Key 默认仅保留到浏览器会话结束，勾选「记住到本机」后才保存在插件本机存储中；不会写进笔记文件夹或 Markdown 导出。不提供公共 Key，也不要求把 Key 写入源码、`.env` 或 GitHub。

## 数据与迁移

资料库文件夹结构：

```text
My Clips/
  clips.json          # 笔记、标签和记录
  images/             # 图片
  transcripts/        # 字幕、Overview 和翻译
  backups/            # 上一次修改前的数据
  README.txt
```

换电脑时，先保存所有草稿，使用「资料库与备份 → 完整备份到文件夹」，或关闭编辑后复制整个资料库。在新电脑安装 Clips，再选择复制过去的资料库文件夹。Windows 和 Mac 使用同一种数据格式；API Key 和文件夹权限需要在新电脑重新配置。

笔记的正式数据保存在文件夹中。浏览器仍保存文件夹授权、设置、缓存和未提交的草稿，所以迁移前务必先保存。**此版本没有云同步，不支持多台电脑同时编辑同一个网盘文件夹。** Markdown 导出适合阅读和分享；完整恢复请保留整个原始资料库。

## 边界

- 仅在用户触发时读取已授权页面中的可获取内容；飞书、画板、懒加载页面和受限内容不保证完整提取，无法读取时会提示范围。
- YouTube 字幕依赖 Supadata 的原生字幕接口；没有可用字幕的视频不会自动转录音频。
- 插件设置页、浏览器内置 PDF 阅读器等页面可能不允许注入脚本。
- 本仓库仅包含可独立运行的本地版；不包含作者个人云端站点、托管配置、笔记数据或私人部署历史。

## 自行二次开发

**原仓库由作者维护。** 开源不代表开放原仓库的写入权限。你可以点击 GitHub 上的 **Fork** 将项目复制到自己的账号，再克隆自己的仓库并独立修改、发布；这些改动不会影响原仓库或作者的笔记。也可以直接下载源码进行本地修改。


需要 Node.js 22.13 或更新版本与 npm：

```sh
git clone https://github.com/baijianyu1024-cmd/clips.git
cd clips
npm ci
npm test
npm run package
```

产物在 `dist/clips-chrome-extension/` 与 `dist/clips-chrome-extension.zip`。修改源码后重新打包，在扩展管理页加载或重载该目录即可。打包流程会重新构建富文本编辑器，并生成 `SHA256SUMS.txt`。

| 目录 | 内容 |
| --- | --- |
| `extension/` | Manifest V3 扩展、侧栏、本地笔记库及存储适配器 |
| `editor/` | Tiptap / ProseMirror 编辑器源码 |
| `scripts/` | 编辑器构建、打包与公开内容检查 |
| `tests/extension/` | 自动化测试，使用虚构数据和临时文件夹 |

代码中的 `adapter.cloud` / `CLOUD` 是历史命名的资料库接口；本发行版只路由到本地文件夹，不发送到笔记云服务。

## 许可证与致谢

项目使用 [MIT License](LICENSE)，允许修改、分发和二次开发，请保留许可证与版权声明。

YouTube 阅读功能参考并改编了 [Zara Zhang 的 youtube-digest](https://github.com/zarazhangrui/youtube-digest)。编辑和渲染使用 Tiptap、ProseMirror、Marked 与 markdown-it。完整声明见 [THIRD_PARTY_NOTICES](extension/THIRD_PARTY_NOTICES.txt) 和 `extension/vendor/` 中的许可证；这些声明也包含在安装包内。
