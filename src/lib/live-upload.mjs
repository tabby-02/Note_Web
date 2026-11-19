const image = /\.(?:avif|gif|jpe?g|png|webp|svg)$/i;
export function uploadSourcePath(file) {
  const original = (file.webkitRelativePath || file.name).replaceAll('\\', '/');
  return file.webkitRelativePath ? original.split('/').slice(1).join('/') : original;
}
export function visibleUploadFiles(files) {
  return files.filter((file) => !uploadSourcePath(file).split('/').some((part) => part.startsWith('.') || /^(?:note\.ya?ml|thumbs\.db)$/i.test(part)));
}
export function mainCandidates(files, type) {
  return visibleUploadFiles(files).filter((file) => /\.(?:md|docx)$/i.test(file.name) && !/^attachments\//i.test(uploadSourcePath(file)))
    .filter((file) => !type || (type === 'markdown' ? /\.md$/i.test(file.name) : type === 'docx' && /\.docx$/i.test(file.name)));
}
export function prepareUpload(files, type, mode, mainPath, referencedImages = new Set()) {
  const prepared = [];
  for (const file of visibleUploadFiles(files)) {
    const original = uploadSourcePath(file);
    let relative;
    if (original === mainPath && type !== 'gallery') relative = type === 'markdown' ? 'note.md' : 'note.docx';
    else if (mode === 'main') continue;
    else if (mode === 'attachments') relative = `attachments/${original.replace(/^attachments\//, '')}`;
    else if (mode === 'main-media' && image.test(original) && !original.startsWith('attachments/')) {
      if (!referencedImages.has(original)) continue;
      relative = `media/${original.replace(/^(?:media|attachments)\//, '')}`;
    }
    else if (mode === 'main-media') continue;
    else if (image.test(original) && !original.startsWith('attachments/')) relative = type === 'gallery' ? `chapters/${original.replace(/^chapters\//, '')}` : referencedImages.has(original) ? `media/${original.replace(/^(?:media|attachments)\//, '')}` : `attachments/${original.replace(/^attachments\//, '')}`;
    else relative = original.startsWith('attachments/') ? original : `attachments/${original.replace(/^media\//, '')}`;
    if (relative.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('文件路径不合法');
    if (prepared.some((entry) => entry.relative === relative)) throw new Error(`目标路径重复：${relative}`);
    if (file.size > (relative === 'note.md' ? 2 : 25) * 1024 * 1024) throw new Error(`文件过大：${original}`);
    prepared.push({ file, relative });
  }
  if (!prepared.length) throw new Error('没有可上传的文件');
  if (mode !== 'attachments' && type !== 'gallery' && !prepared.some((entry) => entry.relative === (type === 'markdown' ? 'note.md' : 'note.docx'))) throw new Error('请选择主文件');
  if (type === 'gallery' && mode !== 'attachments' && !prepared.some((entry) => entry.relative.startsWith('chapters/'))) throw new Error('图片集需要至少一张图片');
  return prepared;
}
