/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL?: string;
  readonly PUBLIC_SUPABASE_KEY?: string;
}

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
