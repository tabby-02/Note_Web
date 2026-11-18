import * as cheerio from 'cheerio';
import { renderNoteMarkdown } from './note-markdown.mjs';
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
