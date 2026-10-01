// A short fingerprint of a JSON document, used by the world editor's save to
// notice that a file changed on disk since the editor loaded it (another tab,
// a git pull, a hand edit). Shared by the browser (src/editor/) and the dev
// server's save endpoint (vite.config.ts), which must hash the same way:
// FNV-1a over the document's compact JSON text.
export function docHash(doc: unknown): string {
  const s = JSON.stringify(doc);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
