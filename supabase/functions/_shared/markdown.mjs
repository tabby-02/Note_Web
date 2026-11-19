import * as cheerio from 'cheerio';
import { markdownImageAssetPath, renderNoteMarkdown } from './note-markdown.mjs';
import { markdownSearchPassages } from './search-passages.mjs';

// The importer, Edge Function and reader share the same parser and paragraph IDs.
export function markdownPassages(markdown) {
  const $ = cheerio.load(renderNoteMarkdown(markdown), null, false);
  const passages = markdownSearchPassages($);
  let heading = '正文';
  return passages.map((passage) => {
    const element = $(`[id="${passage.id}"]`).first();
    const isHeading = /^h[1-6]$/.test(element.prop('tagName')?.toLowerCase() ?? '');
    if (isHeading) heading = passage.text;
    return { scope: isHeading ? 'outline' : 'body', anchor: passage.id, title: heading, content: passage.text };
  });
}

export function markdownImageSources(markdown) {
  const $ = cheerio.load(renderNoteMarkdown(markdown), null, false);
  return $('img[src], source[src]').toArray().map((element) => $(element).attr('src') ?? '');
}

export function validateMarkdownImageAssets(markdown, mediaPaths) {
  const available = mediaPaths instanceof Set ? mediaPaths : new Set(mediaPaths ?? []);
  const issues = [];
  for (const source of markdownImageSources(markdown)) {
    if (/^(?:[a-z]+:|\/\/|#|data:)/i.test(source.trim())) continue;
    const assetPath = markdownImageAssetPath(source);
    if (!assetPath) issues.push(`Image reference must resolve inside media/: ${source}`);
    else {
      if (!available.has(assetPath)) issues.push(`Referenced image is missing from media/: ${source}`);
    }
  }
  return issues;
}
