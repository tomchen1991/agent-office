/** Production build generates lossless WebP counterparts without modifying source artwork. */
export function demoAssetUrl(src: string): string {
  const delivery = import.meta.env.PROD && src.startsWith('assets/demo/') && src.endsWith('.png') ? src.slice(0, -4) + '.webp' : src;
  return `${import.meta.env.BASE_URL}${delivery}`;
}
