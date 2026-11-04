import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import starlight from '@astrojs/starlight';
import path from 'node:path';
import { loadTaxonomy, getSidebarItems, getRedirects } from './scripts/taxonomy.mjs';

const taxonomy = loadTaxonomy();
const isPagesBuild = process.env.GITHUB_PAGES === 'true';
const base = isPagesBuild ? '/Note_Web' : '/';
const notesRoot = path.resolve('notes');

export default defineConfig({
  site: 'https://tabby-02.github.io',
  base,
  redirects: getRedirects(taxonomy, base),
  integrations: [
    starlight({
      title: '个人学习笔记',
      description: '按知识主题整理的个人学习笔记',
      locales: { root: { label: '简体中文', lang: 'zh-CN' } },
      customCss: ['katex/dist/katex.min.css', './src/styles/global.css'],
      sidebar: getSidebarItems(taxonomy),
      tableOfContents: false,
      components: {
        Sidebar: './src/components/Sidebar.astro',
        Search: './src/components/Search.astro',
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeToggle.astro',
      },
    }),
    mdx(),
  ],
  vite: {
    resolve: {
      alias: {
        '@': path.resolve('./src'),
      },
    },
    plugins: [
      {
        name: 'watch-note-library',
        configureServer(server) {
          server.watcher.add(notesRoot);
          server.watcher.on('change', (file) => {
            const changed = path.resolve(file);
            if (changed.startsWith(`${notesRoot}${path.sep}`)) server.ws.send({ type: 'full-reload' });
          });
        },
      },
    ],
  },
});
