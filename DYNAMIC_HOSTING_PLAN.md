# 实时笔记站点方案与执行记录

## 已确定方案

GitHub Pages 托管 Astro/Starlight 的公开界面；Supabase 提供实时内容服务：

| 部分 | 服务 | 责任 |
| --- | --- | --- |
| 静态应用 | GitHub Pages + GitHub Actions | 发布阅读器、管理页和动态阅读模板 |
| API | Supabase Edge Function `site-api` | 公开读取、搜索、管理员登录、编辑、上传、目录和版本恢复 |
| 元数据 | Supabase Postgres | 语义目录、版本、资源清单、搜索段落和审计事件 |
| 文件 | 私有 Storage bucket `note-assets` | Markdown、图片、DOCX、PDF 和附件 |

管理员密码只以 PBKDF2 哈希放在 Edge Function Secret；会话签名使用独立随机 Secret。公开浏览器只持有 publishable key，不能访问 service-role key、数据库密码或私有 Storage。写入采用 staging 版本、资源清单校验和原子发布，上传中断不会覆盖访客正在阅读的版本。

## 内容规则

- 语义树和叶子类型仍以 `notes/taxonomy.yml`、叶子 `note.yml` 为 Git 源码备份。
- Markdown、Word、图片集的主文件和附件在 Storage 中按版本保存；数据库保存原始相对路径，因此 Unicode 文件夹名称仍可完整展示。
- Markdown 正文图片只解析 `media/` 中的资源并映射到签名 Storage URL；附件图片不会作为正文图片兜底。导入和发布校验 Markdown/HTML 嵌入图片引用，普通超链接图片属于附件。正文、公式、代码高亮、Typora 换行和 `:yum:` 表情使用同一解析规则。
- 搜索只索引分类、章节和主文件正文；每个段落保留独立锚点，单文件多处命中分别返回。
- 管理页支持源码编辑、预览、高亮、预设底色、主文件/图片/附件/整文件夹上传、新建、重命名、移动、软删除、恢复和历史版本恢复；公开阅读页的轻量标注使用 DOM Range 与 Markdown 源行映射精确编辑选区，提供即时预览和撤销，复杂节点继续由管理页源码编辑。

## 执行状态

- [x] 选择免绑卡 Supabase 方案，项目 `qsfwywubqvahisqprvxu` 已建立。
- [x] 执行 Postgres schema：目录、版本、资源、搜索、登录限速、审计、RLS 和私有 Storage bucket。
- [x] 实现 `site-api` Edge Function，Deno 类型检查通过并已部署。
- [x] 实现 ASCII Storage 对象键映射，保留原始 Unicode 相对路径。
- [x] 实现上传清单、签名直传、大小/类型/路径校验、重试和原子发布。
- [x] 初始导入完成：23 个叶子、932 个文件、约 205.9 MB；所有版本均已发布。
- [x] 部署管理员 PBKDF2 哈希和会话 Secret；原密码未进入仓库。
- [x] `/api/health`、树读取、编译原理 Markdown 读取和正文搜索在线检查通过。
- [x] 公式、目录、搜索回归测试、Supabase 函数检查、Astro 检查通过。
- [x] 阅读页轻量选区编辑、管理页响应式整理、移动端辅助文件把手定位修复并完成生产构建检查。
- [x] 按本地删除和图片归位结果同步 10 篇云端资源清单：10 篇升至 v2，删除 96 个旧附件路径，新增 6 个 `media/` 图片路径；发布后 23 篇资源哈希全部一致，目录无差异。
- [x] 将本次代码提交并推送 GitHub，让 GitHub Actions 发布包含 `.env.local` 公开配置的静态界面。
- [ ] 在已发布 Pages 地址上完成桌面/手机手工验收：登录、编辑保存、四种上传、搜索、恢复和动态新路径。
- [ ] 增加定期数据库/Storage 导出和跨项目恢复演练。

## 本地命令

```powershell
npm ci
npm run dev
npm run check
npm run supabase:check
npm run supabase:import:dry
npm run build
```

首次或更换管理员密码时，在项目根目录运行 `npm run supabase:secrets`；密码在本机隐藏输入，不要写入聊天或 Git。初次导入/重新迁移需要本机忽略文件 `.env.import.local` 中的 service-role key，导入脚本要求 `--confirm-initial-import`，并会检查目录、版本、资源、搜索段落和审计表均为空；不要把该文件提交。日常同步使用 `npm run supabase:sync:check`，不写云端；`npm run supabase:sync:snapshot` 将活动版本下载到被忽略的本地快照目录并记录哈希基线。

## 维护方式

Markdown 主格式的管理体验改进见 `MODERNIZATION_PLAN.md`。管理页已接入 CodeMirror 6 和冲突差异比较；现有 Supabase schema、staging 与原子发布保持不变，不需要数据库迁移。`npm run supabase:sync:review` 生成本机逐文件只读报告。共同基线升级为 schemaVersion 2，下载不一致快照不再错误重置共同祖先；旧基线需按未知差异审阅。`npm run supabase:sync:publish-local` 可预演严格限定为文件新增、删除、移动的差异，并在显式 `--publish` 后以 expectedVersion 发布完整资源清单；共享路径内容变化、分类差异或图片引用错误都会停止。

笔记内容修改：打开线上 `/admin/`，输入管理员密码，保存后立即可见，不需要 Astro 构建。代码、组件、分类源文件或静态回退页面修改：本机运行检查后提交 Git，GitHub Actions 重新发布 Pages。Supabase 内容和 Git 源码是两套备份。网页编辑后若要继续改本地文件，先运行 `npm run supabase:sync:snapshot`，再运行 `npm run supabase:sync:check`；双方同时修改时以快照和本地文件做人工合并，最终通过管理页按最新版本发布，避免旧文件覆盖云端。恢复历史版本优先使用管理页，应用代码故障则回退 Git 提交。

## 风险与边界

- 免费额度、Storage 容量、Edge Function 执行和流量按 Supabase 当前计划计费规则变化；目前导入约 205.9 MB，低于 Free Storage 1 GB，但需定期检查用量。
- 私有 Storage 使用短期签名 URL；不要把 service-role key、数据库密码或管理员密码提交到仓库。
- 动态阅读页面需要 API 可用；静态 `/notes/...` 页面作为构建时回退，新增或移动后的云端路径通过 `/reader/*?liveNote=...` 模板读取。
- 当前没有网页整库一键导出界面；本机 `npm run supabase:sync:snapshot` 可保存活动版本的文件快照，数据库级恢复仍依赖 Supabase 导出和 Git 源码备份。
