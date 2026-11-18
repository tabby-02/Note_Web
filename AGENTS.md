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

`note.yml` 的 `title`、`type` 和 `mainFile` 必须与 `taxonomy.yml` 一致。Markdown 支持 `$...$`、`$$...$$`、`\(...\)`、`\[...\]`、代码语言高亮、表格、HTML 图片和 `:yum:` 等 emoji shortcode。正文已引用的图片只作为 `media/` 资源，不在辅助文件目录重复显示。

## 代码入口

### 阅读和交互

- `src/components/Sidebar.astro`：知识树和大目录。
- `src/components/NoteOutline.astro`、`OutlineTree.astro`：正文小目录、折叠、滚动高亮和章节定位。
- `src/components/DirectoryResize.astro`、`DirectoryToggle.astro`：两侧目录拖动宽度和收起状态。
- `src/components/MarkdownNote.astro`、`WordNote.astro`、`ImageGallery.astro`：三类叶子阅读器。
- `src/components/AttachmentTree.astro`、`AttachmentPreview.astro`：按原目录层级展示和弹窗预览辅助文件。
- `src/components/Search.astro`、`src/lib/note-search.mjs`：知识目录、章节、正文三范围搜索及多段落命中。
- `src/components/InlineNoteEditor.astro`：阅读页轻量选区编辑；复杂 Markdown 修改仍在管理页完成。
- `src/lib/note-markdown.mjs`、`live-markdown.ts`：Markdown、公式、emoji、代码和图片路径解析。

### 构建和校验

- `scripts/prepare-notes.mjs`：清理并生成 `src/content/docs/notes`、`public/library`、PDF 运行资源和搜索索引。
- `scripts/search-index.mjs`：生成分范围 Pagefind 目标和段落锚点。
- `scripts/validate-notes.mjs`：校验叶子结构、公式、图片引用、内部链接、DOCX 和图库。
- `scripts/validate-site.mjs`：校验构建后的 HTML、导航、资源链接、搜索目标和目录唯一性。
- `scripts/taxonomy.mjs`：加载语义树、叶子、旧路由重定向和 Starlight sidebar。
- `scripts/import-notes.mjs` 和 `scripts/note-manager/`：本地初次迁移和本机笔记整理工具。
- `scripts/supabase-import.mjs`：Supabase 空库首次导入，严禁作为日常部署命令。
- `scripts/supabase-sync.mjs`：本地与 Supabase 活动版本的只读差异检查和云端快照。

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
npm run supabase:sync:snapshot    # 下载云端活动版本到被忽略快照并建立基线
npm run supabase:sync:guard       # 有未处理差异时返回退出码 2
```

状态处理：

- `clean`：Git 与云端一致，可发布应用代码。
- `local-changed`：先用线上管理页上传本地内容，再推送代码。
- `cloud-changed`：把快照中的云端修改合并回 `notes/`，再提交代码。
- `both-changed`：必须人工合并；通过管理页按最新版本发布，不能直接导入旧文件。
- `local-only`、`cloud-only`、`cloud-deleted`、`drift`：先决定目录和内容的归属，再发布。

快照默认写入 `.supabase-snapshots/`，哈希基线写入 `.supabase-sync-baseline.json`，两者均被 Git 忽略。恢复单篇笔记优先使用管理页历史版本；恢复整个项目需要 Git 和 Supabase 数据库/Storage 备份。

## 部署流程

1. 修改组件、脚本或本地笔记后运行同步检查和完整验证。
2. 确认 `git status` 中没有环境文件、快照、生成目录或密钥。
3. `git add`、`git commit`、`git push origin main`。
4. GitHub Actions 执行 `check`、Markdown/阅读/搜索/管理测试、Supabase 函数类型检查、导入 dry-run、构建和产物校验。
5. 所有步骤通过后，GitHub Pages 发布 `dist/`。

Supabase Edge Function 只有在 `supabase/functions/` 改动后才需要 `npm run supabase:deploy`；数据库迁移只有在 `supabase/migrations/` 改动后才需要单独执行。当前 GitHub Pages 工作流不会自动部署函数、执行迁移或导入内容。任何云端发布前必须确认目标项目和迁移内容，禁止用初始导入覆盖已有活动版本。

## 修改纪律

- 先读本文件、README 和相关模块，再编辑；保持现有 Astro/Starlight、原生组件和 Supabase 版本模型。
- 不把生成文件当作源文件修改；笔记源只改 `notes/`，页面源只改 `src/`，脚本只改 `scripts/`。
- 修改 Markdown 解析时必须同时检查 `$...$` 公式、Typora 换行、`<img>` 引用、内部标题链接、代码围栏、emoji 和私有区字符归一化。
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

维护完成后应把验证结果和有意义的架构变化补到本节；不要记录密码、Token 或完整云端文件内容。
