import * as cheerio from 'cheerio';
import { markdownImageAssetPath, renderNoteMarkdown } from './note-markdown.mjs';
import { markdownSearchPassages } from './search-passages.mjs';

// The importer, Edge Function and reader share the same parser and paragraph IDs.
export function markdownPassages(markdown) {
  const $ = cheerio.load(renderNoteMarkdown(markdown), null, false);
  return passagesFromHtml($);
}

function passagesFromHtml($) {
  const passages = markdownSearchPassages($);
  const elementsById = new Map($('[id]').toArray().map((element) => [$(element).attr('id'), element]));
  let heading = '正文';
  return passages.map((passage) => {
    const element = elementsById.get(passage.id);
    const isHeading = /^h[1-6]$/.test(element?.tagName?.toLowerCase() ?? '');
    if (isHeading) heading = passage.text;
    return { scope: isHeading ? 'outline' : 'body', anchor: passage.id, title: heading, content: passage.text };
  });
}

function imageIssuesFromHtml($, mediaPaths) {
  const available = mediaPaths instanceof Set ? mediaPaths : new Set(mediaPaths ?? []);
  const issues = [];
  for (const element of $('img[src], source[src]').toArray()) {
    const source = $(element).attr('src') ?? '';
    if (/^(?:[a-z]+:|\/\/|#|data:)/i.test(source.trim())) continue;
    const assetPath = markdownImageAssetPath(source);
    if (!assetPath) issues.push(`Image reference must resolve inside media/: ${source}`);
    else if (!available.has(assetPath)) issues.push(`Referenced image is missing from media/: ${source}`);
  }
  return issues;
}

export function inspectMarkdown(markdown, mediaPaths) {
  const $ = cheerio.load(renderNoteMarkdown(markdown), null, false);
  return { issues: imageIssuesFromHtml($, mediaPaths), passages: passagesFromHtml($) };
}

export function markdownImageSources(markdown) {
  const $ = cheerio.load(renderNoteMarkdown(markdown), null, false);
  return $('img[src], source[src]').toArray().map((element) => $(element).attr('src') ?? '');
}

export function validateMarkdownImageAssets(markdown, mediaPaths) {
  const $ = cheerio.load(renderNoteMarkdown(markdown), null, false);
  return imageIssuesFromHtml($, mediaPaths);
}
