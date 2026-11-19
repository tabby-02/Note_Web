# Note_Web 长期维护说明

这是一份给后续开发对话和维护者使用的项目上下文文件。每次开始修改前，先阅读本文件和 `README.md`；涉及线上内容时，再阅读 `DYNAMIC_HOSTING_PLAN.md`。不要凭旧对话猜测当前状态，以仓库代码、工作流和本文件为准。

## 项目目标

Note_Web 是个人学习笔记网站。它把 `H:\github\note` 迁移后的笔记副本放在仓库 `notes/` 中，按知识含义组织成语义树，并为 Markdown、DOCX 和图片集提供不同阅读器。公开阅读页面部署在 GitHub Pages；线上笔记内容通过 Supabase 实时读取和保存，因此网页管理页保存后不需要重新构建。

当前公开地址：`https://tabby-02.github.io/Note_Web/`。

## 架构边界

```text
GitHub repository
  notes/ + src/ + scripts/ + supabase/ + workflow
       │
       ├─ GitHub Actions: check -> tests -> build -> GitHub Pages
       │                    （不会执行完整 Supabase 导入）
       │
       └─ Supabase
          Edge Function site-api
          Postgres taxonomy/version/search/audit metadata
          private Storage note-assets
```

- **GitHub 是应用代码和本地笔记备份源**：保存 Astro 页面、组件、构建脚本、`notes/` 目录和 Supabase 函数源码。
- **Supabase 是线上活动内容源**：访客阅读、搜索和管理页优先读取 Supabase 当前 `published` 版本。网页编辑不会自动回写 GitHub。
- **GitHub Pages 是静态应用托管**：它发布阅读器、管理页和静态回退页面；它不是数据库，也不保存管理员密码。
- **本机管理器和线上管理页是两套工具**：`npm run manage` 只整理本地 `notes/`；公开站点 `/admin/` 通过受保护的 Edge Function 写 Supabase。
- **不新增常驻后端**：实时能力由 Supabase Edge Function、Postgres 和私有 Storage 提供。

### 线上内容数据流

1. Astro 构建从 `notes/taxonomy.yml` 和叶子目录生成静态页面、资源和 Pagefind 索引。
2. 页面加载后，`src/lib/live-backend.ts` 调用 `site-api` 的公开读取接口；成功时用 Supabase 活动版本替换静态回退内容。
3. 管理员登录得到短期 HMAC 会话和 CSRF token。密码只以 PBKDF2 哈希存在 Edge Function Secret。
4. 编辑或上传先创建 `staging` 版本，上传资源并生成搜索段落，最后用数据库函数原子切换为 `published`。
5. 所有写入带 `expectedVersion`。活动版本改变时返回 HTTP 409，防止旧标签页或旧本地文件覆盖新内容。

### Supabase 数据模型

- `taxonomy_nodes`：语义目录组和叶子笔记，记录父子关系、路由、类型、位置和软删除状态。
- `note_versions`：每篇笔记的 staging、published、superseded、discarded 版本和资源清单。
- `note_assets`：版本内原始相对路径、Storage 对象键、类型、大小和 SHA-256。
- `search_passages`：分类、章节和正文段落索引，每个段落有独立锚点。
- `content_events`：发布、恢复、目录变更等审计事件。
- `admin_login_attempts`：登录失败窗口和限速记录。
- `note-assets` Storage bucket：私有文件；浏览器只使用短期签名 URL。

## 内容结构

`notes/taxonomy.yml` 是语义目录的唯一配置。每个叶子目录位于 `notes/<taxonomy parts>/`，必须包含 `note.yml` 和对应主文件：

```text
Markdown leaf/
  note.yml
  note.md
  media/          正文引用的图片
  attachments/    未被正文引用的辅助文件

Word leaf/
  note.yml
  note.docx
  attachments/

Gallery leaf/
  note.yml
  chapters/       按章节目录排列的图片
  attachments/
```

`note.yml` 的 `title`、`type` 和 `mainFile` 必须与 `taxonomy.yml` 一致。Markdown 支持 `$...$`、`$$...$$`、`\(...\)`、`\[...\]`、代码语言高亮、表格、HTML 图片和 `:yum:` 等 emoji shortcode。正文通过 Markdown 图片语法、引用式图片或 HTML `<img>/<source>` 嵌入的图片必须放在 `media/`；未嵌入正文的文件（包括通过普通超链接打开的图片）放在 `attachments/`。渲染器只从 `media/` 解析正文图片，不会从附件或叶子根目录回退查找；缺失/错目录引用会被构建和云端发布校验拒绝。新增导入、全文件夹上传和“主文件和图片”上传均按嵌入引用分类。

## 代码入口

### 阅读和交互

- `src/components/Sidebar.astro`：知识树和大目录。
- `src/components/NoteOutline.astro`、`OutlineTree.astro`：正文小目录、折叠、滚动高亮和章节定位。
- `src/components/DirectoryResize.astro`、`DirectoryToggle.astro`：两侧目录拖动宽度和收起状态。
- `src/components/MarkdownNote.astro`、`WordNote.astro`、`ImageGallery.astro`：三类叶子阅读器。
- `src/components/AttachmentTree.astro`、`AttachmentPreview.astro`：按原目录层级展示和弹窗预览辅助文件。
- `src/components/Search.astro`、`src/lib/note-search.mjs`：知识目录、章节、正文三范围搜索及多段落命中。
- `src/components/InlineNoteEditor.astro`、`src/lib/markdown-edit.mjs`：阅读页 DOM Range 选区编辑，渲染块带 Markdown 源行标记，按段内偏移精确改写并即时预览；复杂 Markdown 修改仍在管理页完成。
- `src/lib/markdown-editor.ts`、`markdown-merge.ts` 和 `src/styles/admin.css`：管理页 CodeMirror 6 编辑、409 左右差异合并和工作室界面。编辑器、差异比较和 Markdown 预览按需加载。Markdown 继续是主格式，不做整篇富文本序列化。
- `src/lib/note-markdown.mjs`、`live-markdown.ts`：Markdown、公式、emoji、代码和图片路径解析。

### 构建和校验

- `scripts/prepare-notes.mjs`：清理并生成 `src/content/docs/notes`、`public/library`、PDF 运行资源和搜索索引。
- `scripts/search-index.mjs`：生成分范围 Pagefind 目标和段落锚点。
- `scripts/validate-notes.mjs`：校验叶子结构、公式、图片引用、内部链接、DOCX 和图库。
- `scripts/markdown-assets.test.mjs`、`src/lib/live-upload.test.mjs`：校验图片引用语法、`media/` 资源路径和线上上传分类。
- `scripts/validate-site.mjs`：校验构建后的 HTML、导航、资源链接、搜索目标和目录唯一性。
- `scripts/taxonomy.mjs`：加载语义树、叶子、旧路由重定向和 Starlight sidebar。
- `scripts/import-notes.mjs` 和 `scripts/note-manager/`：本地初次迁移和本机笔记整理工具。
- `scripts/supabase-import.mjs`：Supabase 空库首次导入，严禁作为日常部署命令。
- `scripts/supabase-sync.mjs`：本地与 Supabase 活动版本的只读差异检查和云端快照。
- `scripts/sync-model.mjs`、`sync-report.mjs`：逐文件三方比较和本机只读 HTML 审阅报告。共同基线 schemaVersion 2 只记录双方一致的文件；差异文件保留已知旧基线或 unknownPaths。旧云端快照不是可信共同祖先，不能直接复用。

### 云端 API

`supabase/functions/site-api/index.ts` 提供：

- 公开：`/api/health`、`/api/tree`、`/api/notes/<path>`、`/api/assets/<path>`、`/api/search`。
- 管理：登录、会话、目录新建/移动/重命名/回收站、Markdown 保存、分块上传、发布、历史版本和恢复。
- 认证：管理员密码、PBKDF2、HMAC 会话、CSRF、来源校验、登录限速和版本号冲突保护。

## 日常命令

推荐 Node.js 24，GitHub Actions 使用同一版本。

```powershell
npm ci
npm run dev                 # 本地阅读开发服务，默认 4321
npm run manage              # 本地笔记整理服务，默认 4322
npm run check               # Astro 类型检查
npm run test:manager
npm run test:search
npm run test:markdown
npm run test:assets
npm run test:inline-edit
npm run test:reading
npm run supabase:check
npm run build               # 生成并校验 dist/
npm run preview             # 预览已构建产物
```

首次或修改管理员密码：`npm run supabase:secrets`。密码和 service-role key 只能放在被忽略的本机环境文件或 Supabase Secret，不能进入 Git、前端或聊天。

## 云端与本地冲突规则

普通 `git push` 只触发 GitHub Pages 构建，不会写 Supabase。日常发布前不运行完整导入，也不要把 `supabase:import` 放入 GitHub Actions。

```powershell
npm run supabase:sync:check       # 只读检查
npm run supabase:sync:review      # 只读生成逐文件 HTML/JSON 审阅报告
npm run supabase:sync:snapshot    # 下载云端活动版本到被忽略快照并建立基线
npm run supabase:sync:guard       # 有未处理差异时返回退出码 2
npm run supabase:sync:publish-local # 预演仅有文件增删/移动的同步；加 -- --publish 才写入云端
```

状态处理：

- `clean`：Git 与云端一致，可发布应用代码。
- `local-changed`：先用线上管理页上传本地内容，再推送代码。
- `cloud-changed`：把快照中的云端修改合并回 `notes/`，再提交代码。
- `both-changed`：必须人工合并；通过管理页按最新版本发布，不能直接导入旧文件。
- `local-only`、`cloud-only`、`cloud-deleted`、`drift`：先决定目录和内容的归属，再发布。

快照默认写入 `.supabase-snapshots/`，哈希基线写入 `.supabase-sync-baseline.json`，两者均被 Git 忽略。恢复单篇笔记优先使用管理页历史版本；恢复整个项目需要 Git 和 Supabase 数据库/Storage 备份。

审阅报告写入 `.supabase-sync-reviews/`，同样被 Git 忽略。快照下载校验 SHA-256、大小和目标路径；不会把双方不一致的文件重置为新的共同基线。管理页 HTTP 409 使用 CodeMirror Merge 比较云端最新正文与可编辑草稿；采用合并后须再次保存，仍带最新 expectedVersion。新增同步逻辑运行 `npm run test:sync`，不以云端写入作为测试手段。

## 部署流程

1. 修改组件、脚本或本地笔记后运行同步检查和完整验证。
   移动 Markdown 正文图片后，同步检查会将对应条目标为 `drift`；若共享文件哈希未变且仅有资源路径增删，可预演并运行 `npm run supabase:sync:publish-local -- --publish`，否则先人工合并，再从 `/admin/` 发布。严格图片解析不会从云端 `attachments/` 兜底，因此不能先发布解析器再更新云端资源清单。
2. 确认 `git status` 中没有环境文件、快照、生成目录或密钥。
3. `git add`、`git commit`、`git push origin main`。
4. GitHub Actions 执行 `check`、Markdown/阅读/搜索/管理测试、Supabase 函数类型检查、导入 dry-run、构建和产物校验。
5. 所有步骤通过后，GitHub Pages 发布 `dist/`。

Supabase Edge Function 只有在 `supabase/functions/` 改动后才需要 `npm run supabase:deploy`；数据库迁移只有在 `supabase/migrations/` 改动后才需要单独执行。当前 GitHub Pages 工作流不会自动部署函数、执行迁移或导入内容。任何云端发布前必须确认目标项目和迁移内容，禁止用初始导入覆盖已有活动版本。

## 修改纪律

- 先读本文件、README 和相关模块，再编辑；保持现有 Astro/Starlight、原生组件和 Supabase 版本模型。
- 不把生成文件当作源文件修改；笔记源只改 `notes/`，页面源只改 `src/`，脚本只改 `scripts/`。
- 修改 Markdown 解析时必须同时检查 `$...$` 公式、Typora 换行、`<img>` 引用、内部标题链接、代码围栏、emoji 和私有区字符归一化。
- 正文图片路径只允许通过 `media/` 提供；不要添加附件或叶子根目录的图片回退。更新导入/上传逻辑时区分图片嵌入引用与普通文件超链接，并同步检查本地校验、Supabase 发布校验和附件栏。
- 阅读页标注必须使用浏览器 Range 与渲染块的 `data-source-start/end` 行映射，不得在整篇 Markdown 中搜索选中文字；修改后须即时预览，取消时恢复原正文，并验证重复文本不会改错位置。
- 修改目录时同步考虑大目录、小目录、移动端折叠、拖动宽度、滚动位置保留和旧路由重定向。
- 修改上传或发布时保持 staging、资源清单、SHA-256、原子发布和 `expectedVersion` 冲突保护。
- 不打印或提交 `SUPABASE_SERVICE_ROLE_KEY`、数据库密码、管理员原密码、Session Secret 或任何 `.env` 内容。
- 不使用 `git reset --hard`、`git checkout --` 覆盖其他未提交工作；先理解现有差异。

## 已知边界和待办

- Supabase 当前活动内容和 Git `notes/` 是两套备份，不会自动双向同步；必须按上面的快照/检查/人工合并流程操作。
- 页面构建仍可能出现 Vite 大 chunk 警告和 Astro `/404` 路由冲突警告，但当前不阻止构建；修改路由时重新评估。
- 当前没有网页整库导出按钮；本机 `supabase:sync:snapshot` 可导出活动文件，数据库级恢复仍需 Supabase 导出。
- 需要持续关注 Supabase Free 计划的 Storage、函数执行和流量额度；当前导入约 205.9 MB。
- 后续若更换框架、托管平台或内容源，先更新本文件和 README，再修改实现。

## 修改历史

- 2026-11-18：完成实时 Supabase 架构、私有 Storage、管理员管理页、版本发布、搜索和动态阅读。
- 2026-11-18：修复长 Markdown 的 Typora 换行、`$...$` 公式、`:yum:`、代码高亮、图片标题换行、文内链接和私有区乱码归一化。
- 2026-11-18：完善大目录/小目录折叠、拖动宽度、滚动保留、辅助文件层级弹窗和连续图片集阅读。
- 2026-11-18：增加阅读页轻量标注、管理页上传/移动/删除/恢复/版本历史和管理员密码保护。
- 2026-11-19：增加 Supabase 初始导入空库保护、同步差异检查、云端快照、冲突分类和管理页 409 提示；补齐长期维护上下文和项目文档。
- 2026-11-19：将阅读页轻量标注改为选区上方的临时浮动工具条，默认隐藏并自动避让正文；修复认证表单点击无反馈和网络错误不可见的问题。
- 2026-11-19：统一静态与在线知识目录 DOM，移除 Starlight 原生目录与自定义目录切换；本页目录改为整行章节点击展开，右侧内嵌箭头并保留章节跳转。
- 2026-11-19：统一 Markdown 正文图片与辅助附件规则；正文图片只从 `media/` 读取，导入/上传按嵌入引用而非图片扩展名或普通超链接分类，云端保存与发布校验图片资源。将编译原理、数据库原理、现代密码学、Ubuntu 中 6 张错放图片移入 `media/`。
- 2026-11-19：重做阅读页标注定位与反馈；按真实 DOM 选区和 Markdown 块源行精确映射，取消全文文本检索，增加选区高亮、紧凑工具栏及保存前实时预览/撤销。
- 2026-11-19：标注源映射兼容同一段落内的 Markdown 行内链接，保证链接外选区可独立定位；资源引用校验通过（23 篇笔记、786 张图片、无缺失引用），应用构建和 57 页产物校验通过。之后新增受保护的 `supabase:sync:publish-local` 本地资源发布命令，按预演清单将 10 篇笔记从 v1 发布为 v2，清理 96 个云端独有附件路径并加入 6 个正确的 `media/` 图片路径；逐篇通过 expectedVersion staging/原子发布，最终复核 23 篇全部 clean、taxonomy 无差异。
- 2026-11-19：按用户确认保留 Markdown 主格式，实施 `MODERNIZATION_PLAN.md`。管理页改为 CodeMirror 6，加入未保存提示、快捷键与 409 左右合并；阅读页使用 Floating UI 定位选区工具栏，修复 HTML 图片补空行导致的源行偏移，手写目录折叠展示。高亮器改为常用语言集合，Markdown 模块约从 1.60 MB 减至 0.79 MB；无需新增服务器或付费服务。同步升级逐文件三方比较、目录移动/排序检查及 HTML 审阅，修复分歧快照误建基线。本轮保留用户附件删除，未提交、推送或写入云端。
- 2026-11-19：完成本轮本机验收：45 项测试、Astro/Deno 检查和 57 页构建校验通过。实际测试桌面/390px 手机布局、源码格式/撤销/查找/预览、模拟 409 比较与合并保存、图片后段落精确标注和暗色主题；修复 Markdown 全局间距污染工具栏、手机版本弹层越界、移动合并面板被 flex 压扁、动态目录数量和浅色底色文字对比度。隔离测试未调用真实云端写入接口，完整记录见方案文件。
- 2026-11-19：修正阅读页轻量编辑的失败反馈，保留草稿并显示 HTTP 状态；撤销按钮改为带文字的 Undo 控件，与关闭 X 分离。Markdown 发布时同步写入 `note.md` 的云端资源清单、大小和 SHA-256。Astro/Deno 检查及构建通过；本轮未能接管当前浏览器，computer-use URL 白名单拒绝了页面自动化。

维护完成后应把验证结果和有意义的架构变化补到本节；不要记录密码、Token 或完整云端文件内容。
