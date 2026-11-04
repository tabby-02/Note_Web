import { getDocument, GlobalWorkerOptions, type PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;
const base = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/pdfjs/`;

export async function renderPdfPreview(url: string, view: HTMLElement, scroller: HTMLElement, signal: AbortSignal) {
  const loading = getDocument({ url, cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/` });
  let observer: IntersectionObserver | undefined;
  let resize: ResizeObserver | undefined;
  signal.addEventListener('abort', () => { observer?.disconnect(); resize?.disconnect(); void loading.destroy(); }, { once: true });
  const document = await loading.promise;
  if (signal.aborted) return;
  view.replaceChildren();
  const summary = window.document.createElement('p');
  summary.className = 'pdf-document-summary';
  summary.textContent = `共 ${document.numPages} 页 · 向下滚动阅读`;
  view.append(summary);
  const states: Array<{ page: PDFPageProxy; holder: HTMLElement; width: number; visible: boolean }> = [];
  const queue = new Set<number>();
  let rendering = false;
  const render = async () => {
    if (rendering || signal.aborted) return;
    rendering = true;
    try {
      while (queue.size && !signal.aborted) {
        const index = queue.values().next().value!;
        queue.delete(index);
        const state = states[index];
        const width = Math.floor(state.holder.clientWidth);
        if (width === state.width || width <= 0) continue;
        const viewport = state.page.getViewport({ scale: width / state.page.getViewport({ scale: 1 }).width * Math.min(devicePixelRatio || 1, 2) });
        const canvas = window.document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.setAttribute('aria-label', `PDF 第 ${index + 1} 页`);
        canvas.setAttribute('role', 'img');
        try {
          await state.page.render({ canvas, viewport }).promise;
          if (signal.aborted) return;
          state.holder.replaceChildren(canvas);
          state.width = width;
        } catch {
          if (!signal.aborted) state.holder.textContent = '本页预览失败，可下载原文件查看。';
        }
      }
    } finally { rendering = false; }
  };
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const index = Number((entry.target as HTMLElement).dataset.pdfPage);
      states[index].visible = entry.isIntersecting;
      if (entry.isIntersecting) queue.add(index);
    }
    void render();
  }, { root: scroller, rootMargin: '600px 0px' });
  for (let index = 0; index < document.numPages; index++) {
    const page = await document.getPage(index + 1);
    if (signal.aborted) return;
    const size = page.getViewport({ scale: 1 });
    const sheet = window.document.createElement('figure');
    sheet.className = 'pdf-sheet';
    const holder = window.document.createElement('div');
    holder.className = 'pdf-page';
    holder.dataset.pdfPage = String(index);
    holder.style.aspectRatio = `${size.width} / ${size.height}`;
    holder.textContent = '正在载入页面…';
    const label = window.document.createElement('figcaption');
    label.textContent = `第 ${index + 1} / ${document.numPages} 页`;
    sheet.append(holder, label);
    view.append(sheet);
    states.push({ page, holder, width: 0, visible: false });
    observer.observe(holder);
  }
  resize = new ResizeObserver(() => {
    states.forEach((state, index) => { if (state.visible && Math.floor(state.holder.clientWidth) !== state.width) queue.add(index); });
    void render();
  });
  resize.observe(view);
}
