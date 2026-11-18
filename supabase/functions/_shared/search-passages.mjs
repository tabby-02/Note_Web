// Keep indexed passages and rendered anchors identical, including formula-only blocks.
export function markdownSearchPassages($) {
  const passages = [];
  for (const element of $('h1,h2,h3,h4,h5,h6,p,li,pre,td,th').toArray()) {
    const copy = $(element).clone();
    // Nested lists and paragraphs have their own results; do not index them twice.
    copy.find('p,li,pre,td,th,script,style,.katex-mathml').remove();
    const text = copy.text().replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const id = $(element).attr('id') || `search-paragraph-${String(passages.length + 1).padStart(6, '0')}`;
    $(element).attr('id', id).attr('data-search-passage', '');
    passages.push({ id, text });
  }
  return passages;
}

export function wordSearchPassages($) {
  const passages = [];
  $('w\\:body w\\:p').each((_, element) => {
    let text = '';
    $(element).find('w\\:t,w\\:tab,w\\:br,w\\:cr').each((_, run) => {
      if ($(run).closest('w\\:del').length) return;
      text += run.tagName === 'w:t' ? $(run).text() : ' ';
    });
    text = text.replace(/\s+/g, ' ').trim();
    if (text) passages.push({ id: `search-paragraph-${String(passages.length + 1).padStart(6, '0')}`, text });
  });
  return passages;
}
