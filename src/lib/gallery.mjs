import fs from 'node:fs';
import path from 'node:path';
import { imageSize } from 'image-size';

export const isGalleryImage = (name) => /\.(?:png|jpe?g|gif|svg|webp|avif)$/i.test(name);
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

export function inspectGallery(root) {
  const chapters = [];
  const issues = [];
  if (!fs.existsSync(root)) return { chapters, issues: ['缺少 chapters 图片目录'] };
  function visit(dir, relative = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => collator.compare(a.name, b.name));
    const images = [];
    const folders = [];
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      const fileRelative = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) { issues.push(`图片目录不能包含符号链接：${fileRelative}`); continue; }
      if (entry.isDirectory()) { folders.push(entry); continue; }
      if (!isGalleryImage(entry.name)) { issues.push(`请将辅助文件放入 attachments：${fileRelative}`); continue; }
      try {
        const { width, height } = imageSize(fs.readFileSync(file));
        if (!width || !height) throw new Error('missing image dimensions');
        images.push({ name: entry.name, relative: fileRelative, width, height });
      } catch { issues.push(`图片损坏或无法识别：${fileRelative}`); }
    }
    if (images.length) {
      const title = relative.split('/').map((part) => part.replace(/^\d+[-.、\s]*/, '') || part).filter(Boolean).join(' / ') || '总览';
      chapters.push({ folder: relative, title, images });
    }
    if (!images.length && !folders.length) issues.push(`空图片章节：${relative || 'chapters'}`);
    for (const folder of folders) visit(path.join(dir, folder.name), path.posix.join(relative, folder.name));
  }
  visit(root);
  if (!chapters.length && !issues.length) issues.push('图片集至少需要一张有效图片');
  return { chapters, issues };
}
