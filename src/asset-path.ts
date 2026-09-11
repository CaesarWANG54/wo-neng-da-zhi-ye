const PUBLIC_BASE_URL = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

/**
 * Resolves files copied from `public/` against Vite's configured deployment base.
 * Local development keeps `/assets/...`; GitHub Pages receives the repository
 * prefix without duplicating or hard-coding it throughout the runtime.
 */
export function publicAssetPath(path: string) {
  return `${PUBLIC_BASE_URL}${path.replace(/^\/+/, "")}`;
}
