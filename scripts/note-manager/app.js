const $ = (selector) => document.querySelector(selector);
const token = $('meta[name="notes-token"]').content;
const types = { markdown: 'Markdown', docx: 'Word', gallery: '图片集', category: '分类' };
let library = { nodes: [], trash: [] };
let analyzedSource = '';
let summary = null;
let working = false;
let pickerController = null;
const openGroups = new Map();

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function notice(message, error = false) {
  const node = $('#notice'); node.textContent = message; node.classList.toggle('error', error); node.hidden = false;
  document.querySelectorAll('.dialog-error').forEach((entry) => entry.remove());
  if (error) {
    const form = document.querySelector('dialog[open] form');
    if (form) { const entry = element('p', message, 'issue error dialog-error'); entry.setAttribute('role', 'alert'); form.querySelector('.form-footer').before(entry); }
  }
}
async function api(route, data, options = {}) {
  const response = await fetch(`/api/${route}`, { ...options, method: data === undefined ? 'GET' : 'POST', headers: { 'X-Notes-Token': token, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作失败');
  return result;
}
async function action(callback) {
  if (working) return;
  working = true;
  document.querySelectorAll('.dialog-error').forEach((entry) => entry.remove());
  document.querySelectorAll('button:not([data-allow-busy])').forEach((button) => { button.disabled = true; });
  try { await callback(); }
  catch (error) { notice(error.message, true); }
  finally {
    working = false;
    document.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    $('#import-submit').disabled = !summary || summary.missing.length > 0;
  }
}
function showTab(name) {
  document.querySelectorAll('[data-tab]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.tab === name)));
  for (const tab of ['library', 'import', 'trash']) $(`#panel-${tab}`).hidden = tab !== name;
}
document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => showTab(button.dataset.tab)));
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));

function categoryOptions(select, { root = false, exclude = '', selected = '' } = {}) {
  select.replaceChildren();
  const placeholder = element('option', root ? '顶层分类' : '请选择知识分类'); placeholder.value = ''; placeholder.disabled = !root; select.append(placeholder);
  for (const node of library.nodes) {
    if (node.type !== 'category' || (exclude && (node.slug === exclude || node.slug.startsWith(`${exclude}/`)))) continue;
    const option = element('option', `${'　'.repeat(node.names.length - 1)}${node.names.join(' / ')}`);
    option.value = node.slug; select.append(option);
  }
  select.value = selected;
}
function edit(node) {
  $('#edit-slug').value = node.slug; $('#edit-title').value = node.title;
  categoryOptions($('#edit-parent'), { root: node.type === 'category', exclude: node.type === 'category' ? node.slug : '', selected: node.parent });
  $('#edit-heading').textContent = node.type === 'category' ? '整理知识分类' : '整理笔记';
  $('#edit-dialog').showModal();
}
function renderTree() {
  const tree = $('#library-tree');
  tree.querySelectorAll('details[data-slug]').forEach((folder) => openGroups.set(folder.dataset.slug, folder.open));
  tree.replaceChildren();
  const query = $('#filter').value.trim().toLocaleLowerCase();
  const matches = new Set(library.nodes.filter((node) => node.names.join(' / ').toLocaleLowerCase().includes(query)).map((node) => node.slug));
  const visible = (node) => !query || matches.has(node.slug) || [...matches].some((slug) => slug.startsWith(`${node.slug}/`));
  function build(parent) {
    const list = element('ul');
    for (const node of library.nodes.filter((entry) => entry.parent === parent && visible(entry))) {
      const item = element('li');
      const row = element(node.type === 'category' ? 'summary' : 'div', undefined, `tree-row ${node.type === 'category' ? 'category-row' : ''}`);
      row.append(element('span', node.type === 'category' ? '⌄' : '▤', `tree-icon ${node.type === 'category' ? 'caret' : ''}`));
      const copy = element('span', undefined, 'tree-title'); copy.append(element('span', node.title, 'tree-name'), element('span', node.slug, 'tree-path'));
      row.append(copy, element('span', types[node.type], 'type-tag'));
      const button = element('button', '整理'); button.type = 'button'; button.setAttribute('aria-label', `整理 ${node.title}`);
      button.addEventListener('click', (event) => { event.preventDefault(); edit(node); }); row.append(button);
      if (node.type === 'category') {
        const folder = element('details'); folder.dataset.slug = node.slug; folder.open = query ? true : openGroups.get(node.slug) ?? node.names.length === 1;
        folder.append(row, build(node.slug)); item.append(folder);
      } else item.append(row);
      list.append(item);
    }
    return list;
  }
  const list = build('');
  tree.append(list.children.length ? list : element('p', query ? '没有找到匹配的笔记。' : '知识库还是空的。先新建分类，再导入笔记。', 'empty'));
}
function renderTrash() {
  const list = $('#trash-list'); list.replaceChildren();
  if (!library.trash.length) { list.append(element('p', '回收站是空的。', 'empty')); return; }
  for (const entry of library.trash) {
    const row = element('div', undefined, 'trash-row'); const copy = element('div');
    copy.append(element('strong', entry.title), element('small', `${entry.slug} · ${new Date(entry.deletedAt).toLocaleString('zh-CN')}`));
    const restore = element('button', '恢复'); restore.type = 'button'; restore.setAttribute('aria-label', `恢复 ${entry.title}`);
    restore.addEventListener('click', () => action(async () => { const result = await api('restore', { id: entry.id }); await refresh(); notice(result.warning || `已恢复「${entry.title}」。`, Boolean(result.warning)); }));
    row.append(copy, restore); list.append(row);
  }
}
async function refresh() {
  library = await api('library');
  $('#note-count').textContent = library.noteCount; $('#trash-count').textContent = library.trash.length;
  const selected = $('#import-parent').value; categoryOptions($('#import-parent'), { selected }); renderTree(); renderTrash();
}
$('#filter').addEventListener('input', renderTree);
$('#new-category').addEventListener('click', () => {
  $('#category-form').reset(); categoryOptions($('#category-parent'), { root: true }); $('#category-dialog').showModal();
});
$('#category-form').addEventListener('submit', (event) => {
  event.preventDefault(); action(async () => {
    const result = await api('category', { title: $('#category-title').value, id: $('#category-id').value.trim(), parent: $('#category-parent').value });
    $('#category-dialog').close(); await refresh(); notice(result.warning || `已创建分类「${result.title}」。`, Boolean(result.warning));
  });
});
$('#edit-form').addEventListener('submit', (event) => {
  event.preventDefault(); action(async () => {
    const result = await api('update', { slug: $('#edit-slug').value, title: $('#edit-title').value, parent: $('#edit-parent').value });
    $('#edit-dialog').close(); await refresh(); notice(result.warning || `已保存「${result.title}」。`, Boolean(result.warning));
  });
});
$('#delete-node').addEventListener('click', () => {
  const node = library.nodes.find((entry) => entry.slug === $('#edit-slug').value);
  const nested = library.nodes.filter((entry) => entry.slug.startsWith(`${node.slug}/`) && entry.type !== 'category').length;
  $('#delete-message').textContent = `将「${node.title}」${node.type === 'category' ? `及其中 ${nested} 篇笔记一起` : ''}移入回收站？`;
  $('#edit-dialog').close(); $('#delete-dialog').showModal();
});
$('#delete-form').addEventListener('submit', (event) => {
  event.preventDefault(); action(async () => {
    const result = await api('delete', { slug: $('#edit-slug').value }); $('#delete-dialog').close(); await refresh();
    notice(result.warning || `「${result.title}」已移入回收站。`, Boolean(result.warning));
  });
});
$('#validate').addEventListener('click', () => action(async () => { await api('validate', {}); notice(`当前 ${library.noteCount} 篇笔记检查通过，未发现目录、公式、图片引用或文内跳转错误。`); }));

function sourceChanged() { analyzedSource = ''; summary = null; $('#import-fields').hidden = true; }
$('#source').addEventListener('input', sourceChanged);
async function analyze(keep = false) {
  const options = { source: $('#source').value.trim(), ...(keep ? { type: $('#import-type').value, mainFile: $('#import-main').value } : {}) };
  let data;
  try { data = await api('analyze', options); }
  catch (error) { summary = null; throw error; }
  analyzedSource = options.source; summary = data;
  $('#import-fields').hidden = false;
  if (!keep) { $('#import-title').value = data.suggestedTitle; $('#import-id').value = ''; }
  $('#import-type').value = data.type;
  const selectedMain = data.mainFile;
  const main = $('#import-main'); main.replaceChildren();
  for (const candidate of data.candidates.filter((candidate) => candidate.type === data.type)) {
    const option = element('option', candidate.file); option.value = candidate.file; main.append(option);
  }
  main.value = selectedMain; $('#main-field').hidden = data.type === 'gallery';
  const counts = $('#import-summary'); counts.replaceChildren();
  for (const [count, text] of [[data.fileCount, '个来源文件'], [data.imageCount, data.type === 'gallery' ? '张图片' : '张正文图片'], [data.attachmentCount, '份辅助资料']]) {
    const item = element('span'); item.append(element('b', count), document.createTextNode(text)); counts.append(item);
  }
  const issues = $('#import-issues'); issues.replaceChildren();
  for (const warning of data.warnings) issues.append(element('div', warning, 'issue'));
  if (data.externalFiles.length) issues.append(element('div', `以下文内引用来自所选文件夹外，导入时也会复制：\n${data.externalFiles.join('\n')}`, 'issue'));
  if (data.missing.length) issues.append(element('div', `发现以下问题，请先修复后导入：\n${data.missing.join('\n')}`, 'issue error'));
  $('#import-submit').disabled = data.missing.length > 0;
}
$('#pick-folder').addEventListener('click', () => action(async () => {
  const controller = new AbortController();
  pickerController = controller;
  $('#notice').hidden = true;
  $('#folder-picker-status').hidden = false;
  let result;
  try {
    result = await api('pick-folder', {}, { signal: controller.signal });
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    notice('已取消文件夹选择，可以重新选择或直接填写完整路径。');
    return;
  } finally {
    if (pickerController === controller) pickerController = null;
    $('#folder-picker-status').hidden = true;
  }
  if (result.source) { $('#source').value = result.source; sourceChanged(); await analyze(); }
}));
$('#cancel-folder-picker').addEventListener('click', () => pickerController?.abort());
window.addEventListener('pagehide', () => pickerController?.abort());
$('#analyze').addEventListener('click', () => action(() => analyze()));
$('#import-type').addEventListener('change', () => { $('#import-main').value = ''; action(() => analyze(true)); });
$('#import-main').addEventListener('change', () => action(() => analyze(true)));
$('#import-form').addEventListener('submit', (event) => {
  event.preventDefault(); action(async () => {
    if (!summary || analyzedSource !== $('#source').value.trim()) throw new Error('文件夹已改变，请先重新识别内容');
    const result = await api('import', { source: analyzedSource, title: $('#import-title').value, id: $('#import-id').value.trim(), parent: $('#import-parent').value, type: $('#import-type').value, mainFile: $('#import-main').value });
    $('#import-form').reset(); sourceChanged(); await refresh(); showTab('library');
    notice(result.warning || `已导入「${result.title}」。图片与辅助文件已整理好。`, Boolean(result.warning));
  });
});
action(refresh);
