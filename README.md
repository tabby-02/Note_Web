# 个人学习笔记网站

基于 Astro 和 Starlight 的静态笔记站。笔记按 `notes/taxonomy.yml` 中的知识主题组织；每个叶子条目通过 `note.yml` 标记类型，支持 Markdown、DOCX 和图片集。

## 技术架构与服务

阅读网站使用 Astro 静态生成，Starlight 提供文档站框架，自定义 Astro 组件实现知识目录、章节目录、阅读器、搜索和附件弹窗。交互使用 TypeScript / JavaScript、Web Components 和浏览器原生 API；样式使用 CSS，构建由 Astro 内置的 Vite 完成。

| 服务 / 平台 | 启动方式 / 地址 | 用途与部署范围 |
| --- | --- | --- |
| 本地阅读开发服务 | `npm run dev`，默认 `http://localhost:4321/` | 查看笔记和开发界面，支持页面更新；端口占用时以终端地址为准 |
| 本地笔记管理服务 | `npm run manage`，默认 `http://127.0.0.1:4322/` | Node.js 原生 HTTP 服务，导入、移动、删除、恢复本地笔记；单独运行，仅监听本机 |
| 本地产物预览服务 | `npm run preview`，默认 `http://localhost:4321/` | 检查 `dist/` 中已构建的网站；先停止占用相同端口的开发服务 |
| GitHub Actions | `.github/workflows/deploy.yml` | 在仓库默认分支上安装依赖、构建、校验并上传静态产物 |
| GitHub Pages | 当前配置：`https://tabby-02.github.io/Note_Web/` | 托管 `dist/` 静态文件，供公开阅读 |

公开网站不需要常驻 Node.js 后端、数据库、账号系统或外部内容管理平台。管理页面有本机接口，但它们不属于公开阅读网站，也不会部署到 Pages。管理操作直接修改项目内的 `notes/` 和分类配置；浏览器中的主题、目录宽度等偏好保存在 `localStorage`，搜索历史和知识目录滚动位置保存在 `sessionStorage`。

## 主要依赖与用途

以下版本来自当前 `package-lock.json`。`package.json` 声明允许的版本范围，`npm ci` 按锁文件安装确切版本；升级后以这两个文件为准。

| 组件 / 依赖 | 当前锁定版本 | 用途 |
| --- | --- | --- |
| `astro` | 7.4.5 | 静态页面生成、资源打包、开发和预览服务 |
| `@astrojs/starlight` | 0.42.8 | 文档站布局、全站导航、主题和文档基础能力 |
| `@astrojs/mdx` | 8.1.2 | 生成的 MDX 页面中引入 Markdown、Word、图库等阅读组件 |
| `@lucide/astro` | 1.67.0 | 搜索、目录、附件等界面图标 |
| `markdown-it` | 15.0.3 | 主笔记 Markdown 解析，支持 HTML 标签和普通换行 |
| `markdown-it-anchor` | 10.0.0 | 标题锚点，供文内链接、章节导航和搜索跳转共用 |
| `markdown-it-emoji` | 3.1.0 | 将 `:yum:` 等表情短码转换为 Unicode 表情 |
| `markdown-it-texmath` | 1.0.0 | 识别 `$…$`、`$$…$$` 等公式并交给 KaTeX 渲染 |
| `katex` | 0.19.1 | 数学公式排版及配套字体、样式 |
| `highlight.js` | 11.12.0 | 按代码块语言进行语法高亮 |
| `pagefind` | 1.6.0 | 构建静态搜索索引，支持范围筛选、摘要高亮和段落结果 |
| `docx-preview` | 0.4.1 | 浏览器内预览 Word 主文档及 DOCX 附件 |
| `pdfjs-dist` | 6.5.438 | 本页弹窗预览 PDF；worker、字符映射、字体和 WASM 资源随站点发布 |
| `jszip` | 3.10.2 | 读取 DOCX 压缩包中的 XML，提取可搜索段落并校验文档 |
| `cheerio` | 1.2.0 | 构建时处理 HTML / XML、重写资源引用、生成搜索锚点和校验链接 |
| `image-size` | 2.0.4 | 读取图片尺寸、检查图库图片，为阅读页预留图片空间 |
| `yaml` | 2.9.1 | 读写分类树、笔记清单和页面元数据 |
| `@astrojs/check`（开发依赖） | 0.9.12 | Astro 文件诊断与类型检查 |
| `typescript`（开发依赖） | 6.0.3 | TypeScript 类型检查与编辑器支持 |

管理服务使用 Node.js 内置的 `http`、`fs`、`path`、`crypto`、`child_process` 等模块，无需额外安装 Web 服务框架。测试使用 Node.js 内置的 `node:test`。Windows 的“选择文件夹”功能通过系统 PowerShell 和 Windows Forms 打开原生窗口；其他系统使用管理页面中的绝对路径输入。

## 项目目录与配置

```text
Note_Web/
├─ notes/                       笔记维护来源：主题树、主文件、图片和辅助资料
│  ├─ taxonomy.yml               知识分类、标题、路由、类型及旧地址映射
│  ├─ migration-report.md        初次迁移报告
│  └─ source-index.md            原始笔记来源清单
├─ src/
│  ├─ components/               阅读器、目录、搜索、主题及附件预览组件
│  ├─ lib/                      Markdown、搜索段落、图库和 PDF 处理逻辑
│  ├─ styles/global.css         全站样式
│  └─ content/docs/             自动生成的首页和笔记 MDX 页面
├─ scripts/
│  ├─ prepare-notes.mjs         生成页面、复制资源、调用搜索索引构建
│  ├─ search-index.mjs          按目录、章节和主文档段落生成 Pagefind 索引
│  ├─ validate-notes.mjs        校验笔记来源、格式、公式、图片和引用
│  ├─ validate-site.mjs         校验构建页面、静态资源、导航及搜索跳转目标
│  ├─ taxonomy.mjs              解析分类并生成导航及重定向
│  ├─ import-notes.mjs          初次资料迁移脚本
│  └─ note-manager/             本机管理服务、页面、导入整理逻辑及测试
├─ public/
│  ├─ library/                  自动复制的主文件、图片及辅助资料
│  ├─ pdfjs/                    自动复制的 PDF 运行资源
│  └─ scoped-search/            自动生成的分范围搜索索引
├─ .notes-manager/trash/        本机回收站，不提交到 Git
├─ .astro/                     Astro 缓存和搜索目标校验清单
├─ dist/                       正式构建产物，部署时发布此目录
├─ .github/workflows/deploy.yml GitHub Pages 构建发布流程
├─ astro.config.mjs            站点地址、基础路径、Starlight 和 Vite 配置
├─ package.json                依赖范围及 npm 命令
└─ package-lock.json           确切依赖版本
```

日常笔记维护以 `notes/` 为准；自动生成的页面、`public/library/`、`public/pdfjs/` 和搜索索引会被重新生成，不应作为笔记编辑来源。`node_modules/`、`dist/`、`.astro/`、生成的笔记页面、搜索索引和本机回收站等由 `.gitignore` 排除。

## 本地运行

建议安装 **Node.js 24**（与 GitHub Actions 一致）和 npm。当前 Astro 声明 Node.js 至少 `22.23.4`、npm 至少 `9.6.5`。克隆项目后，在根目录执行：

```powershell
cd H:\github\Note_Web
npm ci
npm run dev
```

`npm ci` 适合按现有锁文件复现环境；需要主动新增或调整依赖时使用 `npm install`，同时保留锁文件变更。启动命令会持续运行，按 `Ctrl+C` 关闭。

需要维护笔记时，另开一个终端启动管理服务，阅读页和管理页即可同时使用：

```powershell
cd H:\github\Note_Web
npm run manage
```

管理端口可在启动前通过环境变量修改：

```powershell
$env:NOTES_MANAGER_PORT = '4323'
npm run manage
```

选择文件夹时，原生窗口使用置前显示，并提供“选择笔记文件夹”的任务栏入口。管理页等待区有“取消选择”按钮，窗口未出现或无响应时可取消后重试，也可直接粘贴完整路径。刷新、离开或关闭管理页会取消该页面的选择请求；新的选择会替换遗留请求，等待超过三分钟也会自动取消并释放状态。

## 构建、校验与预览

| 命令 | 执行内容 |
| --- | --- |
| `npm run dev` | 自动先执行 `predev` 生成页面、资源和搜索索引，再启动 Astro 开发服务 |
| `npm run manage` | 启动本机管理服务；保存笔记后重新生成页面和索引，并通知开发服务更新 |
| `npm run check` | 自动先执行 `precheck` 准备笔记，再运行 `astro check` |
| `npm run test:manager` | 验证导入、引用重写、分类移动、回收站、失败回滚及本机接口 |
| `npm run test:search` | 验证搜索索引与正文锚点一致、嵌套内容去重、Word 文本提取 |
| `npm run build` | 依次运行 `prebuild`、Astro 静态构建、`postbuild`，产出并校验 `dist/` |
| `npm run preview` | 启动构建产物预览，不重新生成笔记或重新构建 |

正式构建与发布前，按顺序执行：

```powershell
npm run check
npm run test:manager
npm run test:search
npm run build
npm run preview
```

Windows 上建议先停止开发服务，并等待管理操作完成，再依次运行检查和构建；这些进程会写入相同的生成目录与 Astro 缓存，同时运行可能出现 `EPERM` 文件锁冲突。

`npm run build` 的完整流程：

1. **准备内容**：`scripts/prepare-notes.mjs` 读取 `notes/taxonomy.yml` 和各叶子的 `note.yml`，生成 MDX 页面、复制资料与 PDF 资源，并通过 `scripts/search-index.mjs` 建立分范围 Pagefind 索引。
2. **校验笔记**：`scripts/validate-notes.mjs` 检查分类配置、主文件、来源记录、Markdown 公式与本地引用、DOCX 和图片集。
3. **生成站点**：Astro / Starlight 渲染页面、处理资源，生成静态 HTML、JavaScript、CSS、站点地图及 Starlight 的默认 Pagefind 索引。自定义搜索界面使用 `scoped-search/` 中的分范围索引。
4. **校验产物**：`scripts/validate-site.mjs` 检查页面、目录、资源和附件链接、预览运行资源及全部搜索目标。Word 的搜索目标先依据随页面生成的段落清单校验，浏览器渲染 DOCX 后再绑定到对应段落。
5. **产出**：`dist/` 可直接交给静态托管服务；它包含公开阅读所需资源，不包含本机管理服务和回收站。

## GitHub Pages 部署

1. 将项目提交到 GitHub 仓库，在仓库 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。
2. 核对 `astro.config.mjs` 的 `site`。当前站点域名为 `https://tabby-02.github.io`，Pages 基础路径为 `/Note_Web`。如果修改仓库名、使用用户主页仓库或绑定自定义域名，应同步调整 `astro.config.mjs`、`scripts/search-index.mjs` 与 `scripts/validate-site.mjs` 中的基础路径配置。
3. 推送到仓库默认分支，或在 Actions 中手动触发 **Deploy study notes**。工作流仅在默认分支执行发布任务。
4. 构建任务使用 Ubuntu 和 Node.js 24，安装锁定依赖、配置 Pages、执行类型检查及 Markdown / 搜索 / 管理工具测试，再设置 `GITHUB_PAGES=true` 执行 `npm run build`，通过 `actions/upload-pages-artifact` 上传 `dist/`。
5. 部署任务使用 `actions/deploy-pages` 发布产物。当前工作流已声明 `contents: read`、`pages: write`、`id-token: write` 权限，无需额外配置部署令牌。

Actions 同时执行类型检查、三套回归测试、笔记校验和产物校验；全部通过后才发布。

本地复现 Pages 路径下的构建与预览（PowerShell）：

```powershell
$env:GITHUB_PAGES = 'true'
npm run build
npm run preview
```

打开终端地址下的 `/Note_Web/`。完成后关闭预览，恢复本地根路径配置，再启动开发服务：

```powershell
Remove-Item Env:GITHUB_PAGES
npm run dev
```

部署后更新笔记仍使用本机管理服务，保存后提交并推送 `notes/`，触发静态站点重新发布。具体操作见下节。

## 维护笔记

推荐使用本地管理工具，无需手工修改 YAML：

```powershell
npm run manage
```

打开终端中显示的 `http://127.0.0.1:4322/`：

1. **导入笔记**：点击“选择文件夹”（Windows 原生选择窗口），或粘贴文件夹完整路径；工具识别 Markdown、Word 或图片集。有多个主文件时，在“主文件”中选择要展示的一份。
2. 填写名称、选择知识分类，再点击“导入到知识库”。工具复制资料、重写 Markdown 本地资源引用、生成 `note.yml` 并更新知识目录；原文件保持不变，其他笔记和辅助文件保留为附件。
3. **整理目录**：在知识库点击条目右侧“整理”，可以重命名、移动笔记或整个分类。移动后旧页面地址会自动跳转到新位置；“新建分类”支持创建顶层及子分类。
4. **删减与恢复**：点击“移入回收站”，笔记及其文件会一起移出网站。回收站可恢复到原位置；如果原分类也被删除，应先恢复原分类。
5. **检查笔记**：检查图片引用、文内跳转、公式、DOCX 与图片集。图片集支持任意数量和多层目录的章节，检查空章节及损坏图片，不再固定为十章。

管理工具只监听本机，不会部署到 GitHub Pages。回收站位于 `.notes-manager/trash/`，已从 Git 排除；它只保存在当前电脑。管理工具与 `npm run dev` 可分别运行，保存后自动生成页面并更新开发网站；发布仍需将笔记库更改提交、推送到 GitHub。

### 网站部署后更新笔记

部署的网站是静态只读页面，不能从网页端直接改写仓库文件。更新时在有项目仓库的电脑上拉取最新版本，运行 `npm run manage`，通过本机管理页面导入、移动或删减笔记；保存操作会修改项目内的 `notes/` 和 `notes/taxonomy.yml`，原始来源目录不会被改动。完成后运行 `npm run build` 做完整校验，再提交并推送：

```powershell
git add notes/
git commit -m "Update learning notes"
git push
```

推送到仓库默认分支后，GitHub Actions 会自动重新构建并发布 Pages。换电脑维护时，先克隆仓库或拉取最新改动；管理工具本身无需部署，也不会出现在公开网站中。

自动化验证管理工具：`npm run test:manager`。以下为手工维护时的目录约定：

- Markdown：编辑对应主题目录中的 `note.md`。正文引用的图片放在 `media/`，未引用的补充资料放在 `attachments/`。
- 公式：行内推荐 `$z_g$` 或 `\(z_g\)`，块级支持 `$$…$$` 和 `\[…\]`。兼容 Typora 中 `\($z_g$\)`、`\(结果记为$D_g$\)` 这类混写，将外层括号保留为标点、内层公式正常渲染，无需修改原笔记；真正的公式语法错误仍会阻止导入。公式兼容回归检查：`npm run test:markdown`。
- Word：将主 DOCX 放在主题目录并命名为 `note.docx`；辅助资料放在 `attachments/`。
- 图片集：每个章节各建一个 `chapters/<章节名>/` 目录，支持嵌套子章节，图片按文件名顺序浏览；`chapters/` 根目录图片归入总览。辅助资料放在 `attachments/`。
- 更改主题名称、路由、类型或来源记录时，同步更新 `notes/taxonomy.yml` 和对应的 `note.yml`。
- 同一源 Markdown 按章节拆分时，用 `sourceSections` 记录原始一级标题；前端笔记已拆为 Web 基础与前端工程/Vue。旧路由通过 `legacySlugs` 保留跳转。

顶部搜索使用 Pagefind，可切换“知识目录”“章节目录”“笔记正文”三个范围；正文范围可搜索全部笔记或仅当前笔记。同一主文件中多个命中段落会分别列出，关键词高亮，点击正文结果会跳到对应段落，章节结果跳到章节标题。结果较多时每批显示 40 条，点击“显示更多匹配”继续查看。最近 8 个搜索词只保存在当前标签页的临时会话存储中，可点击重搜或清除；输入停顿不会保存，点击输入框以外的位置、操作搜索选项、按 Enter/Tab 或关闭搜索时才保存本次完整输入，清除历史后不会重新补存当前词。正文索引包含 Markdown 和 Word 主文档，不读取辅助文件；图片集可按章节目录标题搜索。修改笔记后，通过管理工具保存或重新运行 `npm run dev` 可刷新索引；发布时自动重建。搜索回归检查：`npm run test:search`。

桌面阅读页左侧依次为知识目录、本页目录，两者可分别收起并记住状态，各自独立滚动。知识目录切换笔记或刷新时保留当前标签页内的滚动位置。本页目录为可折叠树，默认展示两级，可逐支展开，或一键全部展开/收起到一级；手机上知识目录使用顶部菜单，本页目录在正文前折叠展示。

两个目录的右边界可拖动调整宽度，方向键可微调，双击边界恢复默认；默认知识目录较窄，本页目录较宽，宽度会跨页面保存。辅助文件默认收在右侧，不占正文宽度；展开后按原有文件夹名称和层级浏览，第一层默认展开，更深层默认折叠。点击文件会在当前页面弹窗预览图片、PDF、文本或 DOCX，并保留下载入口。图片笔记按章节连续排列所有页面，支持章节跳转、上下页定位和图片放大。

语言相关内容位于“编程语言与数据格式”，前端、Java Web 与 Android 位于“应用开发”。二级分组默认收起，当前笔记所属分组自动展开，历史路径继续跳转到新位置。

构建时会从这些规范目录生成 Starlight 页面和静态资源，并校验目录配置、公式、图片引用和文档。`scripts/import-notes.mjs` 是初次迁移原始资料的脚本，需要目标目录为空并提供原始来源记录；日常新增请使用上面的管理工具，不要重复运行迁移脚本：

```powershell
node scripts/import-notes.mjs H:\github\note
```

