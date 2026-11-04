import MarkdownIt from 'markdown-it';

// Use Markdown's block parser so a # inside a code fence is never a section boundary.
export function splitMarkdownSections(source) {
  const lines = source.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) ?? [];
  const tokens = new MarkdownIt({ html: true }).parse(source, {});
  const headings = tokens.flatMap((token, index) => token.type === 'heading_open' && token.tag === 'h1' && token.map
    ? [{ title: tokens[index + 1].content.trim(), line: token.map[0] }]
    : []);
  if (headings.length && headings[0].line !== 0 && lines.slice(0, headings[0].line).join('').trim()) {
    throw new Error('Cannot split a note with content before its first level-one heading.');
  }
  return headings.map((heading, index) => ({
    title: heading.title,
    source: lines.slice(index === 0 ? 0 : heading.line, headings[index + 1]?.line).join(''),
  }));
}

export function selectMarkdownSections(source, titles) {
  if (!titles?.length) return source;
  const sections = splitMarkdownSections(source);
  return titles.map((title) => {
    const matches = sections.filter((section) => section.title === title);
    if (matches.length !== 1) throw new Error(`Expected exactly one source section: ${title}`);
    return matches[0].source;
  }).join('');
}
