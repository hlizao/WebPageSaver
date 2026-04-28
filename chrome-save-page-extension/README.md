# 网页保存助手（Chrome Extension）

一个基于 Manifest V3 的 Google Chrome 浏览器插件，能够将用户当前浏览的网页保存为完整的本地 HTML 文件，并自动下载页面中的所有图片、视频等媒体资源到本地 `media` 文件夹，确保离线后也能完整查看页面内容。

## 功能特性

- **完整保存网页**：将当前页面的 DOM 结构、样式、内联脚本等保存为单个 `.html` 文件，尽量保持页面原貌。
- **自动下载媒体资源**：提取并下载页面中的所有图片（`img`）、视频（`video`）、音频（`audio`）、CSS 背景图等资源。
- **相对路径重写**：保存的 HTML 文件中，所有媒体资源的引用路径被自动替换为 `./media/xxx.jpg` 等相对路径，离线打开即可正常显示。
- **跨域资源下载**：通过 `fetch + blob` 方式尝试下载跨域资源，并替换为本地引用。
- **重名自动处理**：媒体资源按原文件名保存，若出现重名则自动添加序号（如 `image_1.jpg`）。
- **进度实时提示**：保存过程中展示资源下载进度条和状态信息。
- **中文界面**：插件弹窗和代码注释均为中文，易于理解和使用。

## 项目结构

```
chrome-save-page-extension/
├── manifest.json          # 插件清单文件（Manifest V3）
├── background.js          # Service Worker 后台脚本，负责资源下载和文件保存
├── content.js             # 内容脚本，注入网页中负责提取 HTML 和媒体资源 URL
├── popup.html             # 插件弹窗页面（用户交互界面）
├── popup.js               # 弹窗页面的交互逻辑
├── icons/                 # 插件图标（建议尺寸：16x16、48x48、128x128）
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md              # 项目说明文档（本文件）
```

### 各文件职责说明

| 文件 | 说明 |
|------|------|
| `manifest.json` | 声明插件名称、版本、权限、入口文件等，采用 Manifest V3 格式。 |
| `background.js` | Service Worker，接收 popup 的保存指令，使用 `fetch` 下载媒体资源，并通过 Chrome `downloads` API 将 HTML 和资源保存到本地。 |
| `content.js` | 内容脚本，在网页上下文中运行。负责克隆整个页面 DOM、提取所有媒体资源的绝对 URL、并将 HTML 中的资源引用替换为相对路径。 |
| `popup.html` / `popup.js` | 点击工具栏图标时弹出的交互界面，展示保存按钮和下载进度。 |
| `icons/` | 插件图标，用于工具栏、扩展管理页面等位置。 |

## 权限声明

插件在 `manifest.json` 中申请了以下权限：

- `activeTab`：读取当前活动标签页的信息，向其中注入内容脚本。
- `downloads`：使用 Chrome 下载 API 将文件保存到用户本地。
- `scripting`：向当前页面执行脚本（用于与 content script 通信）。
- `storage`：预留的本地存储权限（当前版本暂未使用，便于后续扩展）。
- `host_permissions: <all_urls>`：允许插件访问所有网站，以便跨域下载媒体资源。

## 本地安装步骤

### 1. 克隆项目到本地

```bash
# 使用 git 克隆本项目
git clone <your-repo-url> chrome-save-page-extension

# 进入项目目录
cd chrome-save-page-extension
```

### 2. 加载已解压的扩展程序

1. 打开 Google Chrome 浏览器，在地址栏输入 `chrome://extensions/` 并回车，进入扩展程序管理页面。
2. 在页面右上角，打开「开发者模式」开关（Developer mode）。
3. 点击左上角出现的「加载已解压的扩展程序」（Load unpacked）按钮。
4. 在弹出的文件选择器中，选择本项目所在的文件夹 `chrome-save-page-extension`。
5. 加载成功后，你会在扩展列表中看到「网页保存助手」，工具栏上也会出现插件图标。

### 3. 使用插件

1. 打开任意你想要保存的网页。
2. 点击 Chrome 工具栏上的「网页保存助手」图标。
3. 在弹出的窗口中点击「保存当前网页」按钮。
4. 插件会自动提取页面内容和媒体资源，并显示下载进度。
5. 保存完成后，你可以在 Chrome 的默认下载目录中找到保存的文件：
   - `网页标题_时间戳.html`：完整的网页文件。
   - `网页标题_时间戳/media/`：该页面使用的所有媒体资源（图片、视频等）。
6. 双击打开 `.html` 文件，即可在离线状态下完整查看保存的网页。

## 注意事项

- **下载目录**：文件默认保存到 Chrome 浏览器的默认下载目录中，可在 Chrome 设置中修改。
- **跨域资源**：虽然插件尝试通过 `fetch` 下载跨域资源，但某些网站可能设置了严格的 CORS 策略或防盗链机制，导致部分资源无法下载。此时 HTML 文件中对应的资源链接可能失效，但页面整体结构仍然完整。
- **动态内容**：插件保存的是当前时刻的页面快照。如果页面内容是通过 JavaScript 动态加载的（如懒加载图片、无限滚动），建议在页面完全加载后再执行保存操作。
- **大文件视频**：对于体积较大的视频文件，下载可能需要较长时间，请耐心等待进度完成。
- **图标文件**：项目中 `icons/` 目录下的 `icon16.png`、`icon48.png`、`icon128.png` 为占位文件，建议替换为你自己设计的图标，以获得更好的视觉效果。

## 技术细节

### 资源提取逻辑（content.js）

内容脚本会遍历当前页面的所有元素，提取以下类型的媒体资源：

- `img` 标签的 `src` 和 `srcset`
- `video` 标签的 `src` 和 `poster`
- `audio` 标签的 `src`
- `source` 标签的 `src` 和 `srcset`
- 内联 `style` 和 `style` 标签中的 `background-image`
- 外部 CSS 样式表中的 `url(...)` 引用（在允许访问的情况下）

提取完成后，脚本会克隆整个 `document.documentElement`，将所有媒体资源的绝对 URL 替换为 `./media/文件名` 的相对路径，确保离线可用。

### 资源下载逻辑（background.js）

Service Worker 接收到保存指令后：

1. 遍历所有媒体资源 URL，使用 `fetch(url)` 获取资源的 `Blob` 数据。
2. 由于插件申请了 `host_permissions: <all_urls>`，可以跨域请求资源。
3. 下载完成后，通过 `chrome.downloads.download()` API 将文件保存到本地。
4. 文件名中包含斜杠（如 `标题_时间戳/media/image.jpg`），Chrome 会自动创建对应的目录结构。

### 进度通信

- `popup.js` 向 `content.js` 发送 `extractPage` 消息，获取页面内容。
- `popup.js` 向 `background.js` 发送 `savePage` 消息，触发下载和保存。
- `background.js` 通过 `chrome.runtime.sendMessage` 向 `popup.js` 发送 `downloadProgress` 消息，实时更新进度条。

## 开源协议

本项目采用 MIT 协议开源，欢迎自由使用、修改和分发。

## 贡献与反馈

如果你在使用过程中遇到问题，或有新的功能建议，欢迎通过 GitHub Issues 提交反馈。
