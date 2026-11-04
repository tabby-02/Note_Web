export interface GalleryImage { name: string; relative: string; width: number; height: number }
export interface GalleryChapter { folder: string; title: string; images: GalleryImage[] }
export function isGalleryImage(name: string): boolean;
export function inspectGallery(root: string): { chapters: GalleryChapter[]; issues: string[] };
