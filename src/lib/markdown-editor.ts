import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { search, searchKeymap } from '@codemirror/search';
import { defaultHighlightStyle, syntaxHighlighting, bracketMatching } from '@codemirror/language';

export function editorExtensions(onSave: () => void) {
  return [EditorState.phrases.of({ 'Find': '查找', 'Replace': '替换', 'next': '下一处', 'previous': '上一处', 'all': '全部', 'match case': '区分大小写', 'regexp': '正则表达式', 'by word': '完整单词', 'replace': '替换', 'replace all': '全部替换', 'close': '关闭', '$ lines': '$ 行', '$ unchanged lines': '$ 行未变化', 'No matches': '没有匹配结果' }), lineNumbers(), drawSelection(), highlightActiveLine(), highlightActiveLineGutter(), history(), markdown(), bracketMatching(),
    syntaxHighlighting(defaultHighlightStyle), search({ top: true }), EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': 'Markdown 正文', spellcheck: 'false' }),
    keymap.of([{ key: 'Mod-s', run: () => { onSave(); return true; } }, ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...markdownKeymap]),
    EditorView.theme({
      '&': { fontSize: '14px', backgroundColor: 'var(--admin-panel)', color: 'var(--admin-text)', height: 'min(65vh, 780px)', minHeight: '320px' },
      '.cm-scroller': { overflow: 'auto', fontFamily: '"Cascadia Code", Consolas, monospace', lineHeight: '1.8' },
      '.cm-content': { padding: '20px 0', caretColor: 'var(--admin-accent)' }, '.cm-line': { padding: '0 20px' },
      '.cm-gutters': { backgroundColor: 'var(--admin-panel)', color: 'var(--admin-muted)', border: '0', paddingRight: '8px' },
      '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--admin-accent-soft)' },
      '&.cm-focused': { outline: 'none' }, '.cm-cursor': { borderLeftColor: 'var(--admin-accent)' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--admin-accent) 22%, transparent)' },
      '.cm-panels': { backgroundColor: 'var(--admin-bg)', color: 'var(--admin-text)' },
      '.cm-search input': { maxWidth: '160px' },
    })];
}

export function createMarkdownEditor(host: HTMLElement, initial: string, onChange: () => void, onSave: () => void) {
  const extensions = [...editorExtensions(onSave), EditorView.updateListener.of((update) => { if (update.docChanged) onChange(); })];
  const view = new EditorView({ parent: host, state: EditorState.create({ doc: initial, extensions }) });
  return {
    get value() { return view.state.doc.toString(); },
    // Loading another note resets undo history so undo cannot bring back the previous note.
    set value(value: string) { view.setState(EditorState.create({ doc: value, extensions })); },
    get selectionStart() { return view.state.selection.main.from; },
    get selectionEnd() { return view.state.selection.main.to; },
    setRangeText(value: string, start: number, end: number, mode = 'select') {
      view.dispatch({ changes: { from: start, to: end, insert: value }, selection: { anchor: mode === 'end' ? start + value.length : start, head: start + value.length }, scrollIntoView: true });
    },
    focus() { view.focus(); },
    destroy() { view.destroy(); },
  };
}
