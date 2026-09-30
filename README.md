# 谷歌翻译网页插件（Chrome 扩展）

一个 Manifest V3 的 Chrome 扩展，调用谷歌翻译免费接口（`translate_a/single`，无需 API Key）翻译网页内容。

## 目录

| 文件 | 说明 |
| --- | --- |
| `manifest.json` | 扩展清单（MV3），含图标与主机权限 |
| `background.js` | service worker：调用谷歌翻译、结果缓存、右键菜单 |
| `content.js` | 内容脚本：选中文字浮出「翻译」按钮 + 译文气泡 |
| `inject.css` | 浮层与按钮样式 |
| `popup.html` / `popup.js` / `popup.css` | 工具栏弹窗独立翻译器 |
| `viewer.html` / `viewer.js` | 扩展内置 PDF 阅读器，译文白底叠加 |
| `lib/pdf*.js` | 本地 pdf.js（规避扩展 CSP 禁止远程脚本） |
| `make_icon.py` | 纯标准库生成 PNG 图标脚本 |
| `icons/icon{16,48,128}.png` | 扩展图标 |

> 旧版纯网页 PDF 阅读器（`index.html`、`app.js`、`style.css`、`translator.js`）仍保留，可在本地 `http.server` 下单独使用；Chrome 扩展页面因 CSP 限制无法加载 CDN 脚本，故未并入扩展。

## 安装

1. 打开 Chrome，地址栏输入 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择 `d:/Code-programe/pdf_html` 目录
4. 固定扩展图标到工具栏

## 用法

- **选中即译**：在任意网页选中文字，旁边出现「翻译」按钮，点击后译文以气泡内联展示（目标语言取弹窗中设置的默认值）。
- **右键菜单**：右键选中文字 →「用谷歌翻译翻译选中内容」，译文气泡显示在选区附近。
- **弹窗翻译**：点击工具栏图标，输入文本选择目标语言翻译；切换语言会保存为全站默认目标语言。

## PDF 上叠加译文

扩展内置一个 PDF 阅读器 `viewer.html`，可在 PDF 页面上直接叠加显示译文（这正是「在 PDF 上显示翻译文字」的实现）：

- 弹窗中点「打开 PDF 翻译阅读器」，或直接访问扩展页 `chrome-extension://<id>/viewer.html`
- 打开本地 PDF 文件或拖入文件，也可在顶部输入框粘贴 `https://…/xxx.pdf` 直链后回车加载
- **按需虚拟化渲染**：先按真实尺寸排布所有页面占位（滚动条比例正确），仅渲染视口附近 ±2 页，大文档不卡
- 「翻译本页」立即翻译当前页；「自动翻译」开启后**滚动到哪页翻哪页**并预取下一页（不一次性翻译全部，更快更省）
- 「清除译文」一键移除所有译文浮层并可重新翻译
- **缩放**：适应宽度 / ＋ / －（40%–300%），缩放后自动重排版并重渲染视口
- **跳页**：右侧输入页码回车或点「跳转」直接定位
- **键盘导航**：↑/↓ 滚动、PageUp/PageDown/空格 翻页
- 三种显示模式：双语对照 / 仅译文 / 仅原文；译文以白底方块**覆盖原文**，过长时自动缩小字号避免压住相邻块
- 右键任意译文方块可弹出**原文**，点空白处关闭
- 目标语言与弹窗中保存的默认语言自动同步

pdf.js 已下载到 `lib/`（本地化，规避扩展 CSP 对远程脚本的限制）；PDF 字节由扩展页直接 `fetch`（借 `<all_urls>` 主机权限绕过 CORS），译文经后台 service worker 翻译。

## 翻译接口

```
https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=<目标语言>&dt=t&q=<文本>
```

由后台 service worker 发起请求，避免页面端 CORS；两个端点自动回退，结果按 `语言|原文` 缓存。国内网络不通时，修改 `background.js` 中 `ENDPOINTS` 为自建代理即可。
