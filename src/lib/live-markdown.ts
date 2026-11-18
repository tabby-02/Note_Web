import DOMPurify from 'dompurify';

const colors = /^background-color:\s*#(?:fff2a8|d7f5dd|d9ecff)\s*;?$/i;
DOMPurify.addHook('uponSanitizeAttribute', (node, attribute) => {
  if (attribute.attrName.toLowerCase() !== 'style') return;
  const value = attribute.attrValue.trim();
  if (colors.test(value)) return;
  // KaTeX generates these numeric styles for fraction, radical and matrix layout.
  const inMath = node instanceof Element && Boolean(node.closest('.katex'));
  const allowed = inMath && value.split(';').filter(Boolean).every((part) =>
    /^\s*(?:height|width|min-width|top|bottom|left|right|margin(?:-(?:left|right|top|bottom))?|padding(?:-(?:left|right|top|bottom))?|vertical-align|font-size|border-(?:top|bottom|left|right)-width)\s*:\s*-?(?:\d*\.)?\d+(?:em|ex|px|%|pt)?\s*$/i.test(part) ||
    /^\s*(?:position:\s*(?:relative|absolute)|color:\s*(?:#[a-f\d]{3,8}|[a-z]+))\s*$/i.test(part));
  if (!allowed) attribute.keepAttr = false;
});
export function sanitizeNoteHtml(html: string): string {
  return DOMPurify.sanitize(html, { ADD_ATTR: ['style', 'target', 'rel'], FORBID_TAGS: ['iframe', 'object', 'embed', 'form', 'input', 'button'] });
}
export function assignBrowserPassages(article: HTMLElement) {
  const passages: Array<{ id: string; text: string }> = [];
  for (const element of article.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,p,li,pre,td,th')) {
    const copy = element.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('p,li,pre,td,th,script,style,.katex-mathml').forEach((child) => child.remove());
    const text = (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    element.id ||= `search-paragraph-${String(passages.length + 1).padStart(6, '0')}`;
    element.dataset.searchPassage = '';
    passages.push({ id: element.id, text });
  }
  return passages;
}
