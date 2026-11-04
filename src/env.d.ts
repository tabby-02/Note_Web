/// <reference types="astro/client" />

declare module 'markdown-it-texmath' {
  import type MarkdownIt from 'markdown-it';

  const texmath: (markdown: MarkdownIt, options?: Record<string, unknown>) => void;
  export default texmath;
}

interface Window {
  NotesThemeProvider?: {
    set(theme: 'light' | 'dark'): void;
  };
}
