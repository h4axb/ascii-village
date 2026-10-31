// The page head stays at the top while scrolling; under its title and filters a
// row of links jumps to the page's sections (every element with data-nav).
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

interface Entry {
  label: string;
  el: HTMLElement;
}

// the sticky head: its height and what sits above it (the saved-state bar, the
// phone's top bar) as CSS variables, so jumps land just below it; and "stuck"
// once the page has scrolled (the head then gets compact on small screens)
export function useStickyHead(head: RefObject<HTMLElement | null>, root: RefObject<HTMLElement | null>, deps: unknown[]) {
  const [stuck, setStuck] = useState(false);
  useLayoutEffect(() => {
    const h = head.current;
    const r = root.current;
    if (!h || !r) return;
    const measure = () => {
      let top = 0;
      for (const el of r.querySelectorAll<HTMLElement>('.st-viewbar, .st-topbar')) if (getComputedStyle(el).position === 'sticky' && el.offsetHeight) top += el.offsetHeight;
      r.style.setProperty('--st-stick-top', `${top}px`);
      r.style.setProperty('--st-head-h', `${h.offsetHeight}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(h);
    for (const el of r.querySelectorAll<HTMLElement>('.st-viewbar, .st-topbar')) ro.observe(el);
    window.addEventListener('resize', measure);
    // (a gap between on and off, so the head changing size never flips it back)
    const onScroll = () => setStuck((s) => (s ? window.scrollY > 8 : window.scrollY > 48));
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', onScroll);
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return stuck;
}

const headBottom = () => {
  const h = document.querySelector<HTMLElement>('.st-pagehead');
  return h ? h.getBoundingClientRect().bottom : 0;
};

export function SectionNav({ main, route }: { main: RefObject<HTMLElement | null>; route: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [active, setActive] = useState(-1);
  const bar = useRef<HTMLDivElement>(null);
  const jumping = useRef(0);

  // the page's sections, read again whenever the page changes
  useEffect(() => {
    const m = main.current;
    if (!m) return;
    let frame = 0;
    const read = () => {
      const found: Entry[] = [];
      for (const el of m.querySelectorAll<HTMLElement>('[data-nav]')) {
        const label = el.dataset.nav?.trim();
        if (label && !found.some((e) => e.label === label)) found.push({ label, el });
      }
      setEntries((cur) => (cur.length === found.length && cur.every((e, k) => e.label === found[k].label && e.el === found[k].el) ? cur : found));
    };
    read();
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(read);
    });
    mo.observe(m, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-nav'] });
    return () => {
      mo.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [main, route]);

  // the section being read: the last one whose top has passed below the head
  useEffect(() => {
    let frame = 0;
    const pick = () => {
      if (Date.now() < jumping.current) return;
      const line = headBottom() + 40;
      let k = -1;
      entries.forEach((e, i) => {
        if (e.el.isConnected && e.el.getBoundingClientRect().top <= line) k = i;
      });
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2 && entries.length) k = entries.length - 1;
      setActive(k < 0 && entries.length ? 0 : k);
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(pick);
    };
    pick();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [entries]);

  // the active link stays in view in the row (scrolling only the row, never the
  // page); again when the row changes size (the head gets compact while scrolling)
  useEffect(() => {
    const b = bar.current;
    if (!b) return;
    const keep = () => {
      const a = b.querySelector<HTMLElement>('.is-on');
      if (!a) return;
      const l = a.getBoundingClientRect().left - b.getBoundingClientRect().left + b.scrollLeft;
      if (l < b.scrollLeft || l + a.offsetWidth > b.scrollLeft + b.clientWidth - 24) b.scrollTo({ left: Math.max(0, l - 24), behavior: 'smooth' });
    };
    const t = window.setTimeout(keep, 60);
    const ro = new ResizeObserver(keep);
    ro.observe(b);
    return () => {
      window.clearTimeout(t);
      ro.disconnect();
    };
  }, [active, entries]);

  if (entries.length < 2) return null;
  return (
    <nav className="st-secnav" aria-label="Abschnitte">
      <svg className="st-secnav-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
      </svg>
      <div className="st-secnav-row" ref={bar}>
        {entries.map((e, k) => (
          <button
            key={e.label}
            type="button"
            className={`st-chip${k === active ? ' is-on' : ''}`}
            aria-current={k === active ? 'true' : undefined}
            onClick={() => {
              setActive(k);
              jumping.current = Date.now() + 900;
              const target = () => Math.max(0, window.scrollY + e.el.getBoundingClientRect().top - headBottom() - 12);
              window.scrollTo({ top: target(), behavior: 'smooth' });
              // (the head may get compact on the way: then once more to the right place)
              window.setTimeout(() => {
                if (Math.abs(target() - window.scrollY) > 4) window.scrollTo({ top: target(), behavior: 'smooth' });
              }, 750);
            }}
          >
            {e.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
