import { MergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { editorExtensions } from './markdown-editor';

export function createMarkdownMerge(host: HTMLElement, cloud: string, draft: string) {
  const view = new MergeView({ parent: host,
    a: { doc: cloud, extensions: [...editorExtensions(() => {}), EditorState.readOnly.of(true), EditorView.editable.of(false)] },
    b: { doc: draft, extensions: editorExtensions(() => {}) },
    highlightChanges: true, gutter: true, collapseUnchanged: { margin: 3, minSize: 8 },
  });
  return { get value() { return view.b.state.doc.toString(); }, destroy() { view.destroy(); } };
}
