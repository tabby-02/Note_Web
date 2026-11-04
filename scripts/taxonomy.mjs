import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

export function loadTaxonomy(root = process.cwd()) {
  const taxonomy = parse(fs.readFileSync(path.join(root, 'notes', 'taxonomy.yml'), 'utf8'));
  const issues = validateTaxonomy(taxonomy);
  if (issues.length) throw new Error(`知识目录配置无效：\n${issues.join('\n')}`);
  return taxonomy;
}

export function validId(value) {
  return typeof value === 'string' && /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(value) && !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(value);
}

export function validateTaxonomy(taxonomy) {
  const issues = [];
  const active = new Set();
  const aliases = new Set();
  function visit(nodes, parent = '') {
    if (!Array.isArray(nodes)) { issues.push(`${parent || '根目录'}：children/groups 必须是列表`); return; }
    const siblings = new Set();
    for (const node of nodes) {
      if (!node || typeof node !== 'object') { issues.push('目录条目必须是对象'); continue; }
      const slug = [parent, node.id].filter(Boolean).join('/');
      if (!validId(node.id)) issues.push(`${slug}：目录标识仅支持字母、数字、中文、连字符及下划线`);
      const key = String(node.id).toLocaleLowerCase();
      if (siblings.has(key)) issues.push(`${slug}：同级目录标识重复`);
      siblings.add(key);
      active.add(slug.toLocaleLowerCase());
      if (typeof node.title !== 'string' || !node.title.trim()) issues.push(`${slug}：缺少标题`);
      if (node.type) {
        if (!['markdown', 'docx', 'gallery'].includes(node.type)) issues.push(`${slug}：未知笔记类型 ${node.type}`);
        if (node.children) issues.push(`${slug}：笔记不能同时包含子目录`);
      } else visit(node.children, slug);
      if (node.legacySlugs !== undefined && !Array.isArray(node.legacySlugs)) { issues.push(`${slug}：legacySlugs 必须是列表`); continue; }
      for (const alias of node.legacySlugs ?? []) {
        if (typeof alias !== 'string' || !alias.split('/').every(validId)) { issues.push(`${slug}：旧路径无效`); continue; }
        const key = alias.toLocaleLowerCase();
        if (aliases.has(key)) issues.push(`${alias}：旧路径重复`);
        aliases.add(key);
      }
    }
  }
  visit(taxonomy?.groups);
  for (const alias of aliases) if (active.has(alias)) issues.push(`${alias}：旧路径与现有目录冲突`);
  return issues;
}

function walkNodes(nodes, parents = []) {
  return nodes.flatMap((node) => {
    const parts = [...parents, node.id];
    if (node.type) return [{ ...node, parts, slug: parts.join('/') }];
    return walkNodes(node.children ?? [], parts);
  });
}

export function flattenLeaves(taxonomy) {
  return walkNodes(taxonomy.groups ?? []);
}

function sidebarNode(node, parents) {
  const parts = [...parents, node.id];
  const link = `/notes/${parts.join('/')}/`;
  if (node.type) return { label: node.title, link };
  return {
    label: node.title,
    collapsed: parents.length > 0,
    items: (node.children ?? []).map((child) => sidebarNode(child, parts)),
  };
}

export function getSidebarItems(taxonomy) {
  return (taxonomy.groups ?? []).map((group) => sidebarNode(group, []));
}

export function getRedirects(taxonomy, base = '/') {
  const redirects = {
    '/notes/programming-and-app-development/': '/',
  };
  function visit(nodes, parents = []) {
    for (const node of nodes) {
      const parts = [...parents, node.id];
      for (const slug of node.legacySlugs ?? []) redirects[`/notes/${slug}/`] = `/notes/${parts.join('/')}/`;
      visit(node.children ?? [], parts);
    }
  }
  visit(taxonomy.groups ?? []);
  const prefix = base.replace(/\/$/, '');
  return Object.fromEntries(Object.entries(redirects).map(([from, to]) => [from, `${prefix}${to}`]));
}
