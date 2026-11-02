// Markdown for reading, as the journal's logs are written: headings, lists
// (also "-item" without a space), task boxes [ ] / [x], **bold**, *italic*,
// ~~struck~~, `code`, links, images, quotes, code blocks, rules, and escapes
// such as "\-". Builds React elements only (no innerHTML), so no text can
// inject markup. Line breaks inside a paragraph are kept, as in the notes
// (trees such as "└── Part B" stay aligned).
import { Fragment, type ReactNode } from 'react';

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', apos: "'" };
export const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITY[e.toLowerCase()] ?? m;
  });

// only links that cannot run code
export function safeUrl(u: string): string | null {
  const t = u.trim();
  if (/^(https?:|mailto:)/i.test(t)) return t;
  if (/^\/(?!\/)/.test(t) || /^#/.test(t)) return t;
  return null;
}

// ---- inline ----
type Tok = { re: RegExp; make: (m: RegExpExecArray, key: string) => ReactNode };
const ESC = '\u0000';
const TOKS: Tok[] = [
  { re: /`([^`]+)`/, make: (m, k) => <code key={k}>{m[1]}</code> },
  {
    re: /!\[([^\]]*)\]\(([^)\s]+)\)/,
    make: (m, k) => {
      const u = safeUrl(m[2]);
      return u ? <img key={k} src={u} alt={m[1]} loading="lazy" /> : m[0];
    },
  },
  {
    re: /\[([^\]]+)\]\(([^)\s]+)\)/,
    make: (m, k) => {
      const u = safeUrl(m[2]);
      return u ? (
        <a key={k} href={u} target={u.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
          {inline(m[1], k)}
        </a>
      ) : (
        m[1]
      );
    },
  },
  {
    re: /\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/,
    make: (m, k) => (
      <a key={k} href={m[0]} target="_blank" rel="noreferrer">
        {m[0]}
      </a>
    ),
  },
  { re: /\*\*([^*]+?)\*\*|__([^_]+?)__/, make: (m, k) => <strong key={k}>{inline(m[1] ?? m[2], k)}</strong> },
  { re: /~~([^~]+?)~~/, make: (m, k) => <del key={k}>{inline(m[1], k)}</del> },
  { re: /(?<![\w*])\*([^*\s][^*]*?)\*(?!\w)|(?<!\w)_([^_\s][^_]*?)_(?!\w)/, make: (m, k) => <em key={k}>{inline(m[1] ?? m[2], k)}</em> },
  { re: /\[( |x|X|pass)\]/, make: (m, k) => <span key={k} className={`jr-box is-${m[1] === ' ' ? 'open' : m[1] === 'pass' ? 'pass' : 'done'}`} aria-label={m[1] === ' ' ? 'open' : m[1] === 'pass' ? 'passed' : 'done'} /> },
];

export function inline(text: string, key = 'i'): ReactNode[] {
  // backslash escapes: the character stays literal
  const src = decodeEntities(text).replace(/\\([\\`*_{}[\]()#+\-.!~|>])/g, (_, c: string) => ESC + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const out: ReactNode[] = [];
  let rest = src;
  let n = 0;
  while (rest) {
    let best: { i: number; m: RegExpExecArray; t: Tok } | null = null;
    for (const t of TOKS) {
      const m = t.re.exec(rest);
      if (m && (!best || m.index < best.i)) best = { i: m.index, m, t };
    }
    if (!best) {
      out.push(unescape(rest));
      break;
    }
    if (best.i) out.push(unescape(rest.slice(0, best.i)));
    out.push(best.t.make(best.m, `${key}.${n++}`));
    rest = rest.slice(best.i + best.m[0].length);
  }
  return out;
}
const unescape = (s: string) => s.replace(/\u0000([0-9a-f]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

// ---- blocks ----
// "- item", "* item", "1. item"; the hand-written "-item" (no space) too, but
// never "**bold**", "---" or "-5"
const LIST = /^(\s*)(?:([*+])\s+|(-)(?:\s+|(?=\p{L}))|(\d+)[.)]\s+)(.*)$/u;

export function Markdown({ md, className }: { md: string; className?: string }) {
  return <div className={`jr-md${className ? ` ${className}` : ''}`}>{blocks(md ?? '')}</div>;
}

function blocks(md: string): ReactNode[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  const key = () => `b${k++}`;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    // fenced code
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push(
        <pre key={key()}>
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = Math.min(6, h[1].length + 1); // a "#" inside an entry is below the entry's own title
      const Tag = `h${level}` as 'h2';
      out.push(<Tag key={key()}>{inline(h[2], `h${k}`)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(<hr key={key()} />);
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(<blockquote key={key()}>{blocks(body.join('\n'))}</blockquote>);
      continue;
    }
    if (LIST.test(line)) {
      const items: { ordered: boolean; text: string[] }[] = [];
      while (i < lines.length && lines[i].trim()) {
        const m = LIST.exec(lines[i]);
        if (m) items.push({ ordered: !!m[4], text: [m[5]] });
        else if (items.length) items[items.length - 1].text.push(lines[i].trim());
        else break;
        i++;
      }
      const Tag = items[0].ordered ? 'ol' : 'ul';
      out.push(
        <Tag key={key()}>
          {items.map((it, j) => (
            <li key={j}>
              {it.text.map((t, x) => (
                <Fragment key={x}>
                  {x > 0 && <br />}
                  {inline(t, `l${k}.${j}.${x}`)}
                </Fragment>
              ))}
            </li>
          ))}
        </Tag>,
      );
      continue;
    }
    // a paragraph: up to the next empty line or block
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s/.test(lines[i]) && !LIST.test(lines[i]) && !/^\s*(```|~~~|>)/.test(lines[i])) body.push(lines[i++]);
    if (!body.length) body.push(lines[i++]);
    out.push(<p key={key()}>{inline(body.join('\n'), `p${k}`)}</p>);
  }
  return out;
}

// plain text of Markdown (for search, suggestions and previews)
export const plainText = (md: string) =>
  decodeEntities(md)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~`]|\\(?=\S)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
