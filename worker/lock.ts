// The site lock: every page and API that isn't a participant's needs a
// password first, checked here before anything of the game is sent.
// Unlocking sets a signed, HttpOnly cookie (30 days); the dashboard's
// password and the main site's lock are the same (FEEDBACK_ADMIN_TOKEN).
// (The review Worker, worker/review.ts, has no lock: nothing to protect.)
//
//   POST /api/unlock   the login form (password, next) → cookie + back
//   GET  /api/lock     forget the cookie
//
// The login page is plain HTML: no game code, no paths, nothing to learn.

const UNLOCK_COOKIE = 'asciia_unlock';
const UNLOCK_DAYS = 30;

export function cookieOf(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const secure = (request: Request) => (new URL(request.url).protocol === 'https:' ? '; Secure' : '');

// a cookie that unlocks until it expires: "<expiry>.<signature>"
async function unlockCookie(request: Request, secret: string): Promise<string> {
  const exp = Date.now() + UNLOCK_DAYS * 86400e3;
  return `${UNLOCK_COOKIE}=${exp}.${await hmac(secret, `unlock:${exp}`)}; Path=/; Max-Age=${UNLOCK_DAYS * 86400}; HttpOnly; SameSite=Lax${secure(request)}`;
}

export async function isUnlocked(request: Request, secret: string | undefined): Promise<boolean> {
  if (!secret) return false;
  const v = cookieOf(request, UNLOCK_COOKIE);
  const m = v ? /^(\d+)\.([\w-]+)$/.exec(v) : null;
  if (!m || Number(m[1]) < Date.now()) return false;
  return sameText(m[2], await hmac(secret, `unlock:${m[1]}`));
}

// only a path on this site, never somewhere else
const safeNext = (next: string | null) => (next && /^\/(?!\/)[\w\-./?=&%]*$/.test(next) ? next : '/');

// slows down guessing: per isolate, a short pause that grows with misses
const misses = new Map<string, number>();

export async function handleUnlock(request: Request, secret: string | undefined, title: string): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/api/lock') {
    return new Response(null, {
      status: 303,
      headers: { Location: '/', 'Set-Cookie': `${UNLOCK_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure(request)}`, 'Cache-Control': 'no-store' },
    });
  }
  if (url.pathname !== '/api/unlock') return null;
  if (request.method !== 'POST') return loginPage(title, '/', 405);
  const form = await request.formData().catch(() => null);
  const password = String(form?.get('password') ?? '');
  const next = safeNext(String(form?.get('next') ?? '/'));
  const who = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (!secret || !password || !sameText(password, secret)) {
    const n = (misses.get(who) ?? 0) + 1;
    misses.set(who, n);
    await new Promise((ok) => setTimeout(ok, Math.min(5000, 400 * n)));
    return loginPage(title, next, 401, secret ? 'Wrong password.' : 'This site has no password set yet.');
  }
  misses.delete(who);
  return new Response(null, { status: 303, headers: { Location: next, 'Set-Cookie': await unlockCookie(request, secret), 'Cache-Control': 'no-store' } });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function loginPage(title: string, next: string, status = 401, error = ''): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title><style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1d1a14;color:#efe6d2;font:16px/1.5 ui-monospace,Menlo,Consolas,monospace}
form{display:flex;flex-direction:column;gap:12px;width:min(320px,calc(100vw - 32px))}h1{font-size:20px;margin:0 0 4px;color:#e8c46a}
input,button{font:inherit;padding:10px 12px;border-radius:6px;border:1px solid #5a503c;background:#2a251c;color:inherit}
button{background:#e8c46a;color:#1d1a14;border:0;cursor:pointer;font-weight:700}p{margin:0;color:#e88a6a}
</style></head><body><form method="post" action="/api/unlock"><h1>${esc(title)}</h1>
<input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required>
<input type="hidden" name="next" value="${esc(next)}"><button>Open</button>${error ? `<p>${esc(error)}</p>` : ''}</form></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

// a static file (has an extension: scripts, styles, fonts, pictures): code
// and art, no data; a page has none
export const isStaticFile = (pathname: string) => /\.[a-z0-9]{1,6}$/i.test(pathname.split('/').pop() ?? '');
