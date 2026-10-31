"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { setSound, soundOn } from "@/lib/sound";
import { useProgress, solvedCount } from "@/lib/progress";
import { LEVELS } from "@/content";
import { applyTheme, DEFAULT_THEME, THEME_KEY, THEMES, type ThemeId } from "@/lib/theme";

/** A small menu to switch color themes. */
function ThemePicker() {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState<ThemeId>(DEFAULT_THEME);
  useEffect(() => { try { const t = localStorage.getItem(THEME_KEY); if (t && THEMES.some((x) => x.id === t)) setCur(t as ThemeId); } catch { /* ignore */ } }, []);
  return (
    <span className="theme-pick">
      <button type="button" className="icon-btn" aria-expanded={open} aria-label="Color theme" title="Color theme" onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="10" cy="10" r="7.5" /><circle cx="7" cy="8" r="1.4" className="fill" /><circle cx="12.5" cy="7" r="1.4" className="fill" /><circle cx="13" cy="12" r="1.4" className="fill" /></svg>
      </button>
      {open && (
        <span className="theme-menu" role="menu">
          {THEMES.map((t) => (
            <button key={t.id} type="button" role="menuitemradio" aria-checked={cur === t.id} className={cur === t.id ? "on" : ""} onClick={() => { applyTheme(t.id); setCur(t.id); setOpen(false); }}>
              <span className="theme-sw">{t.swatch.map((c) => <i key={c} style={{ background: c }} />)}</span>{t.name}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

const NAV = [["/learn/", "Learning path"], ["/sandbox/", "Sandbox"], ["/cheatsheet/", "Cheat sheet"], ["/about/", "About"]] as const;

export function Logo() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <defs><linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--accent)" /><stop offset="1" stopColor="var(--accent2)" /></linearGradient></defs>
      <rect x="1" y="1" width="32" height="32" rx="8" fill="url(#logo-g)" />
      <circle cx="9" cy="24" r="3" fill="var(--surface-2)" />
      <circle cx="25" cy="10" r="3" fill="var(--surface-2)" />
      <path d="M9 24 L9 15 L25 15 L25 10" stroke="var(--surface-2)" strokeWidth="2.4" fill="none" strokeLinejoin="round" />
    </svg>
  );
}

export function SiteHeader({ compact = false }: { compact?: boolean }) {
  const path = usePathname();
  const p = useProgress();
  const [sound, setS] = useState(true);
  useEffect(() => setS(soundOn()), []);
  return (
    <header className={`site-head${compact ? " compact" : ""}`}>
      <div className="wrap">
        <Link href="/" className="brand"><Logo /><span><b>Learn Cloud Net</b><small>Azure networking, beginner to advanced</small></span></Link>
        <nav className="nav" aria-label="Main">
          {NAV.map(([href, label]) => <Link key={href} href={href} aria-current={path?.startsWith(href.slice(0, -1)) ? "page" : undefined}>{label}</Link>)}
        </nav>
        {compact && (
          <button type="button" className="icon-btn" aria-pressed={sound} title={sound ? "Sounds on" : "Sounds off"} aria-label={sound ? "Turn sounds off" : "Turn sounds on"} onClick={() => { setSound(!sound); setS(!sound); }}>
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M3 8h3l4-3v10l-4-3H3z" className="fill" />{sound ? <path d="M13 7.5a3.5 3.5 0 0 1 0 5M15 5.5a6 6 0 0 1 0 9" /> : <path d="M13 8l4 4M17 8l-4 4" />}</svg>
          </button>
        )}
        <ThemePicker />
        <span className="pill" title={`${solvedCount(p.done)} of ${LEVELS.length} levels solved`}>
          {p.ready ? p.xp : 0} XP
          <span className="xpbar" aria-hidden="true"><i style={{ width: `${p.ready ? (100 * solvedCount(p.done)) / LEVELS.length : 0}%` }} /></span>
          {p.ready ? solvedCount(p.done) : 0}/{LEVELS.length}
        </span>
      </div>
    </header>
  );
}
