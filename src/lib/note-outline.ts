// Read live geometry so images, font loading and directory resizing cannot leave
// a stale position cache. Headings are in document order, so only O(log n) reads
// are needed, even near the end of a long note.
export function findCurrentHeading(count: number, topAt: (index: number) => number, offset: number): number {
  if (!count) return -1;
  let low = 0, high = count;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (topAt(middle) <= offset) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

type HighlightLink = Pick<Element, 'setAttribute' | 'removeAttribute'>;

export function createActiveLinkSetter() {
  let current: HighlightLink | undefined;
  return (next: HighlightLink | undefined) => {
    if (next === current) return;
    current?.removeAttribute('aria-current');
    next?.setAttribute('aria-current', 'location');
    current = next;
  };
}

export function initNoteOutline(outline: HTMLElement) {
  const document = outline.ownerDocument;
  const view = document.defaultView!;
  const targetFor = (href: string) => {
    const id = href.slice(1);
    let decoded = id;
    try { decoded = decodeURIComponent(id); } catch {}
    return document.getElementById(id) ?? document.getElementById(decoded);
  };
  const entries = [...outline.querySelectorAll<HTMLAnchorElement>('.outline-links a')].flatMap((link) => {
    const heading = targetFor(link.getAttribute('href') ?? '');
    return heading ? [{ link, heading }] : [];
  });
  const byTarget = new Map(entries.map((entry) => [entry.heading, entry]));
  const header = document.querySelector<HTMLElement>('.header');
  const setCurrent = createActiveLinkSetter();
  let visible = entries;
  let frame = 0;

  const updateCurrent = () => {
    frame = 0;
    // No layout reads or highlight writes while the entire outline is closed.
    if (document.documentElement.dataset.outlineCollapsed === 'true') return;
    const offset = (header?.getBoundingClientRect().bottom ?? 64) + 40;
    const index = findCurrentHeading(visible.length, (index) => visible[index].heading.getBoundingClientRect().top, offset);
    setCurrent(visible[index]?.link);
  };
  const schedule = () => {
    if (!frame) frame = view.requestAnimationFrame(updateCurrent);
  };
  const refreshVisible = () => {
    // Rebuild only when branches change, never on every scroll frame.
    visible = entries.filter(({ link }) => !link.closest('[hidden]'));
    schedule();
  };
  const revealHash = () => {
    const target = targetFor(view.location.hash);
    if (!target || !view.location.hash) return;
    let item = byTarget.get(target)?.link.closest<HTMLElement>('[data-outline-item]');
    while (item) {
      const parent = item.parentElement?.closest<HTMLElement>('[data-outline-item]');
      if (parent) {
        const branch = parent.querySelector<HTMLButtonElement>(':scope > .outline-row > [data-outline-branch]');
        const children = parent.querySelector<HTMLElement>(':scope > [data-outline-children]');
        if (branch && children && children.hidden) {
          branch.setAttribute('aria-expanded', 'true');
          branch.setAttribute('aria-label', `收起${branch.parentElement?.querySelector('a')?.textContent ?? ''}的子目录`);
          branch.title = '收起子目录';
          children.hidden = false;
        }
      }
      item = parent ?? undefined;
    }
    refreshVisible();
    view.requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
  };

  const branches = new MutationObserver(refreshVisible);
  branches.observe(outline, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  const layout = new ResizeObserver(schedule);
  if (header) layout.observe(header);
  const article = document.querySelector('.note-prose');
  if (article) layout.observe(article);
  view.addEventListener('scroll', schedule, { passive: true });
  view.addEventListener('resize', schedule, { passive: true });
  view.addEventListener('pageshow', schedule);
  view.addEventListener('hashchange', revealHash);
  outline.addEventListener('click', schedule);
  void document.fonts.ready.then(schedule);
  refreshVisible();
  revealHash();
}
