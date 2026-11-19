# 个人学习笔记网站

基于 Astro 和 Starlight 的学习笔记站。GitHub Pages 托管公开静态界面，Supabase Edge Function、Postgres 和私有 Storage 提供无需本地常驻服务器的实时笔记读取与管理。笔记按 `notes/taxonomy.yml` 中的知识主题组织；云端活动版本支持 Markdown、DOCX 和图片集。

## 实时托管状态

实时架构实施记录见 [`DYNAMIC_HOSTING_PLAN.md`](DYNAMIC_HOSTING_PLAN.md)。Supabase 项目已完成数据库迁移、私有 `note-assets` Storage、`site-api` Edge Function 和初始内容导入；GitHub Pages 继续负责应用代码发布。

网页管理入口为 `/admin/`：使用管理员密码登录，编辑 Markdown 并实时发布；也可导入 Markdown、Word、图片集文件夹，更新现有主文件/图片/附件或整个叶子目录，管理语义分类、移动、回收站和版本恢复。内容发布直接切换 Postgres 活动版本与 Storage 对象，不触发 Astro 构建。Git 提交仍用于部署应用代码和保留源码备份。

管理员密码只由 Supabase Edge Function Secret 校验；密码使用 PBKDF2 哈希保存，原密码不进入前端、数据库或 Git。运行 `npm run supabase:secrets` 可在本机隐藏输入密码并设置 `ADMIN_PASSWORD_HASH` 与 `SESSION_SIGNING_SECRET`，不要把 Secret 或 service-role key 发到聊天或提交到仓库。

## 技术架构与服务

阅读网站使用 Astro 静态生成，Starlight 提供文档站框架，自定义 Astro 组件实现知识目录、章节目录、阅读器、搜索和附件弹窗。交互使用 TypeScript / JavaScript、Web Components 和浏览器原生 API；样式使用 CSS，构建由 Astro 内置的 Vite 完成。

| 服务 / 平台 | 启动方式 / 地址 | 用途与部署范围 |
| --- | --- | --- |
| 本地阅读开发服务 | `npm run dev`，默认 `http://localhost:4321/` | 查看笔记和开发界面，支持页面更新；端口占用时以终端地址为准 |
| 本地笔记管理服务 | `npm run manage`，默认 `http://127.0.0.1:4322/` | Node.js 原生 HTTP 服务，导入、移动、删除、恢复本地笔记；单独运行，仅监听本机 |
| 本地产物预览服务 | `npm run preview`，默认 `http://localhost:4321/` | 检查 `dist/` 中已构建的网站；先停止占用相同端口的开发服务 |
| GitHub Actions | `.github/workflows/deploy.yml` | 在仓库默认分支上安装依赖、构建、校验并上传静态产物 |
| GitHub Pages | 当前配置：`https://tabby-02.github.io/Note_Web/` | 托管 `dist/` 静态文件，供公开阅读 |

公开网站不需要常驻 Node.js 后端或账号系统。管理页面随静态界面发布，写入只通过受保护的 Supabase API；浏览器中的主题、目录宽度等偏好保存在 `localStorage`，搜索历史和知识目录滚动位置保存在 `sessionStorage`。`.env.local` 只保存公开 URL/key，service-role key 和密码 Secret 仅用于本机导入/部署。

### 动态内容数据流

Astro 构建从 GitHub 仓库中的 `notes/` 生成静态回退页面。页面加载后会调用 Supabase `site-api` 的公开接口；接口可用时，阅读页、目录和搜索结果使用 Supabase 当前 `published` 版本。管理页的保存和上传先写入 `staging` 版本，完成资源清单、文件大小、类型、哈希和正文索引校验后，再以数据库事务切换活动版本。上传中断、浏览器关闭或并发版本变化不会替换访客正在阅读的版本。

Supabase 的主要表为 `taxonomy_nodes`（语义树）、`note_versions`（版本状态）、`note_assets`（版本资源和哈希）、`search_passages`（搜索段落和锚点）、`content_events`（审计记录）及 `admin_login_attempts`（登录限速）。`note-assets` Storage bucket 为私有 bucket，浏览器只拿到短期签名 URL。管理员密码只以 PBKDF2 哈希存在 Edge Function Secret；service-role key 只用于本机脚本和 Supabase CLI。

### 公开接口和管理接口

| 范围 | 接口 | 作用 |
| --- | --- | --- |
| 公开 | `/api/health`、`/api/tree` | 检查内容服务和读取已发布语义树 |
| 公开 | `/api/notes/<path>`、`/api/assets/<path>` | 读取笔记正文、Word 文档、图库资源和附件签名 URL |
| 公开 | `/api/search` | 按知识目录、章节或正文搜索，支持指定单篇笔记 |
| 管理 | `/api/auth/login`、`/api/admin/session` | 管理员登录、会话和 CSRF token |
| 管理 | `/api/admin/taxonomy` | 新建、重命名、移动、回收和恢复目录或笔记 |
| 管理 | `/api/admin/notes/*` | Markdown 保存、文件上传、发布、历史版本和恢复 |

管理写入接口要求管理员会话、合法来源、CSRF token 和 `expectedVersion`；版本不一致返回 `409`，管理页会要求重新载入并比较内容。

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
│  ├─ import-notes.mjs          将原始目录整理到 notes/ 的初次迁移脚本
│  ├─ supabase-import.mjs       Supabase 空库首次导入（有强保护）
│  ├─ supabase-sync.mjs         云端活动版本差异检查和快照
│  └─ note-manager/             本机管理服务、页面、导入整理逻辑及测试
├─ public/
│  ├─ library/                  自动复制的主文件、图片及辅助资料
│  ├─ pdfjs/                    自动复制的 PDF 运行资源
│  └─ scoped-search/            自动生成的分范围搜索索引
├─ .notes-manager/trash/        本机回收站，不提交到 Git
├─ .astro/                     Astro 缓存和搜索目标校验清单
├─ dist/                       正式构建产物，部署时发布此目录
├─ .github/workflows/deploy.yml GitHub Pages 构建发布流程
├─ AGENTS.md                   后续开发对话必须先阅读的长期维护上下文
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
| `npm run test:reading` | 验证长笔记目录定位、重新排版后的定位和滚动时 DOM 更新次数 |
| `npm run supabase:check` | 检查 Supabase Edge Function 类型和依赖 |
| `npm run supabase:import:dry` | 校验 23 篇笔记和 932 个资源的导入清单，不修改云端 |
| `npm run supabase:import:initial` | 仅在确认 Supabase 为空时执行首次导入；已有数据会停止 |
| `npm run supabase:sync:check` | 只读比较本地 `notes/` 与 Supabase 活动版本，列出本地独有、云端独有和双方修改 |
| `npm run supabase:sync:guard` | 同步前保护检查；发现差异时以退出码 2 停止后续命令 |
| `npm run supabase:sync:snapshot` | 下载当前云端活动版本到被 Git 忽略的 `.supabase-snapshots/`，同时记录版本基线 |
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
4. 构建任务使用 Ubuntu 和 Node.js 24，安装锁定依赖、配置 Pages、执行类型检查及 Markdown / 阅读 / 搜索 / 管理工具测试，再设置 `GITHUB_PAGES=true` 执行 `npm run build`，通过 `actions/upload-pages-artifact` 上传 `dist/`。
5. 部署任务使用 `actions/deploy-pages` 发布产物。当前工作流已声明 `contents: read`、`pages: write`、`id-token: write` 权限，无需额外配置部署令牌。

Actions 同时执行类型检查、四套回归测试、笔记校验和产物校验；全部通过后才发布。

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

部署后更新笔记直接使用公开站点的 `/admin/`，保存后立即写入 Supabase 活动版本，不触发构建。代码和分类结构变化仍需提交 Git 并触发 GitHub Pages 发布。具体操作见下节。

### GitHub 代码与云端笔记的冲突规则

GitHub Actions 只构建和发布应用代码，当前工作流不会执行完整 Supabase 导入；因此普通 `git push` 不会覆盖云端笔记。`npm run supabase:import:initial` 仅用于空数据库的首次迁移，并且会同时检查目录、版本、资源、搜索段落和审计表是否为空。已有云端内容时，脚本会直接停止；普通 `npm run supabase:import` 不带显式确认参数，会直接拒绝执行。

需要把本地 `notes/` 与线上内容对照时，先在本机运行：

```powershell
npm run supabase:sync:check
```

准备继续修改代码前，先保留完整云端副本并建立三方比较基线：

```powershell
npm run supabase:sync:snapshot
```

快照写入 `.supabase-snapshots/`，不会改写本地 `notes/`，其中包含当前活动版本、主文件、图片和附件；`.supabase-sync-baseline.json` 只记录版本号和文件哈希，均已加入 `.gitignore`。之后再次运行 `npm run supabase:sync:check`：

- `clean`：本地与云端一致，可以直接发布代码。
- `local-changed`：只有本地变更，先在管理页按当前版本上传，成功后再推送代码。
- `cloud-changed`：只有网页管理页变更，先把云端快照或正文合并回本地，再提交 Git。
- `both-changed`：双方都改过，禁止直接导入；以快照为一侧、`notes/` 为另一侧人工合并，确认内容后通过管理页上传，遇到版本号 409 时重新加载并再次比较。
- `drift`、`local-only`、`cloud-only`、`cloud-deleted`：表示没有可用基线或目录一侧缺少、删除了条目，先完成迁移决策再发布。

推荐的日常顺序是“网页编辑后先快照，再改代码；代码发布前运行同步检查；有冲突先合并，再从管理页发布”。不要把 `supabase:import` 加入 GitHub Actions，也不要用旧的本地文件夹直接覆盖线上活动版本。`npm run supabase:sync:guard` 可放在本地发布脚本中，发现未处理差异时直接阻止构建发布。

## 维护笔记

线上内容维护使用公开站点的管理页，无需运行本机管理服务器：

打开已部署站点的 `/admin/`，输入管理员密码。

管理页提供以下操作：

1. **导入笔记**：选择文件夹，管理页识别 Markdown、Word 或图片集，并显示上传清单；可选择主文件后确认发布。
2. **更新内容**：可只更新主文件、主文件和图片、附件，或整个文件夹重新识别；上传完成后立即切换活动版本。
3. **整理目录**：新建、重命名、移动分类或笔记；删除为可恢复的回收站操作。
4. **编辑 Markdown**：源码编辑、预览、公式、文字高亮和预设底色，保存后实时生效。
5. **阅读页轻量标注**：平时不显示工具条；在 Markdown 正文中选中同一段纯文本后，工具条会紧贴选区上方浮动，空间不足时自动放到下方并避开视口边界。可加粗、斜体、删除线、高亮、预设底色，以及替换、前插、后插或删除文字。首次保存会要求管理员密码，认证失败会在弹窗中显示原因；改动按当前版本号提交，遇到并发修改会拒绝覆盖并提示刷新。公式、图片、链接、代码、表格和跨段选区会引导到管理页，避免破坏原 Markdown 结构。
6. **恢复版本**：在历史版本中选择旧版本恢复；使用乐观版本号避免覆盖其他标签页的修改。

本机 `npm run manage` 仍可用于离线整理源码目录，但它不参与线上实时发布。线上内容位于 Supabase；建议定期导出数据库和 Storage 对象，并保留 GitHub 仓库作为源文件备份。

### 网站部署后更新笔记

部署的网站的笔记内容由 Supabase 实时服务提供，网页管理页保存后立即可被新访客读取，不需要构建。应用代码、阅读器和静态目录结构的改动仍在本机提交并推送：

```powershell
git add src scripts supabase notes README.md AGENTS.md package.json package-lock.json .github
git commit -m "Describe the change"
git push origin main
```

提交前确认 `git status` 没有 `.env*`、service-role key、管理员密码、`.supabase-snapshots/`、`.astro/`、`dist/` 或其他生成文件。若同时修改了网页代码和笔记，应先运行 `npm run supabase:sync:guard`，再按上面的冲突规则处理。推送到仓库默认分支后，GitHub Actions 会自动重新构建并发布 Pages。换电脑维护时，先克隆仓库或拉取最新改动；管理工具本身无需部署，也不会出现在公开网站中。

自动化验证管理工具：`npm run test:manager`。以下为手工维护时的目录约定：

- Markdown：编辑对应主题目录中的 `note.md`。正文引用的图片放在 `media/`，未引用的补充资料放在 `attachments/`。
- 公式：行内推荐 `$z_g$` 或 `\(z_g\)`，块级支持 `$$…$$` 和 `\[…\]`。兼容 Typora 中 `\($z_g$\)`、`\(结果记为$D_g$\)` 这类混写，将外层括号保留为标点、内层公式正常渲染，无需修改原笔记；真正的公式语法错误仍会阻止导入。公式兼容回归检查：`npm run test:markdown`。
- Word：将主 DOCX 放在主题目录并命名为 `note.docx`；辅助资料放在 `attachments/`。
- 图片集：每个章节各建一个 `chapters/<章节名>/` 目录，支持嵌套子章节，图片按文件名顺序浏览；`chapters/` 根目录图片归入总览。辅助资料放在 `attachments/`。
- 更改主题名称、路由、类型或来源记录时，同步更新 `notes/taxonomy.yml` 和对应的 `note.yml`。
- 同一源 Markdown 按章节拆分时，用 `sourceSections` 记录原始一级标题；前端笔记已拆为 Web 基础与前端工程/Vue。旧路由通过 `legacySlugs` 保留跳转。

顶部搜索使用 Pagefind，可切换“知识目录”“章节目录”“笔记正文”三个范围；正文范围可搜索全部笔记或仅当前笔记。同一主文件中多个命中段落会分别列出，关键词高亮，点击正文结果会跳到对应段落，章节结果跳到章节标题。实时 API 可在保存后立即更新索引；静态回退页面仍由构建时 Pagefind 提供搜索。搜索回归检查：`npm run test:search`。

桌面阅读页左侧依次为知识目录、本页目录，两者可分别收起并记住状态，各自独立滚动。知识目录切换笔记或刷新时保留当前标签页内的滚动位置。本页目录为可折叠树，默认展示两级，可逐支展开，或一键全部展开/收起到一级；手机上知识目录使用顶部菜单，本页目录在正文前折叠展示。

长笔记的目录高亮使用二分查找，只在章节变化时修改前后两个链接；折叠目录后暂停高亮计算。图片加载、字体加载和调整目录宽度后依据实际标题位置重新定位，避免持续扫描整页或反复修改全部目录条目。

两个目录的右边界可拖动调整宽度，方向键可微调，双击边界恢复默认；默认知识目录较窄，本页目录较宽，宽度会跨页面保存。辅助文件默认收在右侧，不占正文宽度；展开后按原有文件夹名称和层级浏览，第一层默认展开，更深层默认折叠。点击文件会在当前页面弹窗预览图片、PDF、文本或 DOCX，并保留下载入口。图片笔记按章节连续排列所有页面，支持章节跳转、上下页定位和图片放大。

语言相关内容位于“编程语言与数据格式”，前端、Java Web 与 Android 位于“应用开发”。二级分组默认收起，当前笔记所属分组自动展开，历史路径继续跳转到新位置。

构建时会从这些规范目录生成 Starlight 页面和静态资源，并校验目录配置、公式、图片引用和文档。`scripts/import-notes.mjs` 是初次迁移原始资料的脚本，需要目标目录为空并提供原始来源记录；日常新增请使用上面的管理工具，不要重复运行迁移脚本：

```powershell
node scripts/import-notes.mjs H:\github\note
```

## 故障排查

- **页面显示旧笔记**：先检查 `/api/health` 和浏览器中的 `site-api` 请求；API 正常时以 Supabase 活动版本为准，API 不可用时才会显示 GitHub 构建时的静态回退版本。
- **保存提示 409**：当前编辑页使用的版本已经过期。重新载入笔记，比较当前正文和待保存内容后再提交，不要重复点击覆盖。
- **导入提示数据库不为空**：这是保护机制。不要再次执行初始导入；运行 `npm run supabase:sync:check`，需要保留云端内容时先运行 `npm run supabase:sync:snapshot`。
- **本地管理文件夹窗口没有出现**：确认只运行一个 `npm run manage`，使用页面中的取消按钮释放旧请求，或设置 `NOTES_MANAGER_PORT` 使用其他端口。
- **构建出现大 chunk 或 `/404` 路由警告**：当前是非阻塞警告；只要 `npm run build` 最终通过 `validate-site.mjs` 即可发布。修改路由或打包策略时需重新验证。

长期维护上下文、架构决策、危险操作和修改历史见 [`AGENTS.md`](AGENTS.md)。后续开发对话应先阅读该文件，再决定是否修改代码或云端内容。

## 最近维护记录

- 2026-11-19：知识目录统一为单一自定义树，静态回退和 Supabase 在线目录采用相同的展开、当前项高亮和滚动保留逻辑，避免加载在线数据时在两套目录样式之间切换。
- 2026-11-19：本页目录移除独立左侧箭头，章节分支改为整行点击展开或收起，右侧箭头仅作为状态提示；点击分支仍会更新 URL 片段并定位正文标题。
- 2026-11-19：已在本地预览中用桌面和移动视口检查目录收起、独立滚动、当前项高亮、章节定位和辅助文件入口，并通过 Astro 检查、阅读交互测试、完整构建及产物校验。

