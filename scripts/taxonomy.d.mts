export type NoteType = 'markdown' | 'gallery' | 'docx';

export interface TaxonomyNode {
  id: string;
  title: string;
  type?: NoteType;
  sourceDir?: string;
  sourceFile?: string;
  sourceSections?: string[];
  legacySlugs?: string[];
  children?: TaxonomyNode[];
  parts?: string[];
  slug?: string;
}

export interface Taxonomy {
  groups: TaxonomyNode[];
}

export function loadTaxonomy(root?: string): Taxonomy;
export function validId(value: unknown): boolean;
export function validateTaxonomy(taxonomy: unknown): string[];
export function flattenLeaves(taxonomy: Taxonomy): Array<TaxonomyNode & { type: NoteType; parts: string[]; slug: string }>;
export function getSidebarItems(taxonomy: Taxonomy): Array<Record<string, unknown>>;
export function getRedirects(taxonomy: Taxonomy, base?: string): Record<string, string>;
