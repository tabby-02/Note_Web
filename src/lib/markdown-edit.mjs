function normalizedWithMap(value) {
  let text = '';
  const map = [];
  let pendingSpace = false;
  for (let index = 0; index < value.length; index += 1) {
    if (/\s/.test(value[index])) {
      pendingSpace = Boolean(text);
      continue;
    }
    if (pendingSpace) {
      text += ' ';
      map.push(index - 1);
    }
    pendingSpace = false;
    text += value[index];
    map.push(index);
  }
  return { text, map };
}

function markdownVisibleMap(raw) {
  const chars = [];
  const offsets = [];
  let lineStart = true;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '<') {
      const tag = raw.slice(index).match(/^<\/?[a-z][^>]*>/i)?.[0];
      if (tag) {
        index += tag.length - 1;
        continue;
      }
    }
    if (char === '!' && raw[index + 1] === '[') {
      const close = raw.indexOf('](', index + 2);
      const end = close < 0 ? -1 : raw.indexOf(')', close + 2);
      if (end >= 0) {
        index = end;
        continue;
      }
    }
    if (char === '[' && (raw.indexOf('](', index + 1) >= 0 || raw.indexOf('][', index + 1) >= 0)) continue;
    if (char === ']' && raw[index + 1] === '(') {
      const end = raw.indexOf(')', index + 2);
      if (end >= 0) {
        index = end;
        continue;
      }
    }
    if (char === ']' && raw[index + 1] === '[') {
      const end = raw.indexOf(']', index + 2);
      if (end >= 0) {
        index = end;
        continue;
      }
    }
    if (char === '\\' && index + 1 < raw.length) {
      chars.push(raw[index + 1]);
      offsets.push(index + 1);
      index += 1;
      lineStart = false;
      continue;
    }
    if (lineStart) {
      const prefix = raw.slice(index).match(/^(?: {0,3}(?:#{1,6}[ \t]+|>[ \t]?|[-+*][ \t]+|\d+[.)、][ \t]+))+/)?.[0];
      if (prefix) {
        index += prefix.length - 1;
        lineStart = false;
        continue;
      }
    }
    if (char === '*' || char === '_' || char === '~' || char === '`') continue;
    chars.push(char);
    offsets.push(index);
    lineStart = char === '\n' || char === '\r';
  }
  const normalized = normalizedWithMap(chars.join(''));
  return { text: normalized.text, offsets: normalized.map.map((index) => offsets[index]) };
}

export function mapSelectionToMarkdown(markdown, startLine, endLine, blockText, startOffset, endOffset) {
  const lines = markdown.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 0 || endLine <= startLine || endLine > lines.length) return null;
  const lineOffsets = [0];
  for (const line of lines) lineOffsets.push(lineOffsets.at(-1) + line.length);
  const blockStart = lineOffsets[startLine];
  const blockEnd = lineOffsets[endLine];
  const raw = markdown.slice(blockStart, blockEnd);
  const sourceText = markdownVisibleMap(raw);
  const rendered = normalizedWithMap(blockText);
  if (!sourceText.text || sourceText.text !== rendered.text || startOffset < 0 || endOffset <= startOffset) return null;

  const selectedStart = rendered.map.findIndex((offset) => offset >= startOffset);
  const selectedEnd = rendered.map.findIndex((offset) => offset >= endOffset);
  const endIndex = selectedEnd < 0 ? rendered.map.length : selectedEnd;
  if (selectedStart < 0 || endIndex <= selectedStart) return null;
  const selectedText = rendered.text.slice(selectedStart, endIndex);
  if (!selectedText || sourceText.text.slice(selectedStart, endIndex) !== selectedText) return null;

  const rawStart = sourceText.offsets[selectedStart];
  const rawEnd = sourceText.offsets[endIndex - 1];
  if (rawStart === undefined || rawEnd === undefined) return null;
  return { start: blockStart + rawStart, end: blockStart + rawEnd + 1, text: selectedText };
}
