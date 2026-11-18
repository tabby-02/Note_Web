import JSZip from 'jszip';
import * as cheerio from 'cheerio';

export async function wordSearchPassages(bytes) {
  const archive = await JSZip.loadAsync(bytes);
  const document = archive.file('word/document.xml');
  if (!document) throw new Error('The DOCX package has no main document XML');
  const $ = cheerio.load(await document.async('string'), { xmlMode: true });
  const passages = [];
  $('w\\:body w\\:p').each((_, element) => {
    let text = '';
    $(element).find('w\\:t,w\\:tab,w\\:br,w\\:cr').each((__, run) => {
      if ($(run).closest('w\\:del').length) return;
      text += run.tagName === 'w:t' ? $(run).text() : ' ';
    });
    text = text.replace(/\\s+/g, ' ').trim();
    if (text) passages.push({ id: `search-paragraph-${String(passages.length + 1).padStart(6, '0')}`, text });
  });
  return passages;
}
