"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Logo, SiteHeader } from "./SiteHeader";

const REPO = "https://github.com/Teddymazrin/learncloudnet";
const PROFILE = "https://github.com/Teddymazrin";
const SPONSOR = "https://github.com/sponsors/Teddymazrin";

/** Level and sandbox pages are a full-window workspace: compact header, no footer, nothing else to look at. */
export const isPlayPath = (p: string | null) => !!p && (/^\/learn\/[^/]+\/?$/.test(p) || /^\/sandbox\/?$/.test(p));

export function Shell({ children }: { children: ReactNode }) {
  const focus = isPlayPath(usePathname());
  return (
    <div className={`app${focus ? " focus" : ""}`}>
      <SiteHeader compact={focus} />
      {children}
      {!focus && (
        <footer className="site-foot">
          <div className="wrap foot-grid">
            <Link href="/" className="brand foot-brand"><Logo /><b>Learn Cloud Net</b></Link>
            <nav className="foot-links" aria-label="Footer">
              <a href={REPO} target="_blank" rel="noopener noreferrer">
                <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.83-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.66 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" /></svg>
                GitHub
              </a>
              <a href={SPONSOR} target="_blank" rel="noopener noreferrer">
                <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M8 14.25 6.9 13.2C3.1 9.75.75 7.6.75 4.95A3.2 3.2 0 0 1 4 1.75c1.55 0 3 .72 4 1.86a5.3 5.3 0 0 1 4-1.86 3.2 3.2 0 0 1 3.25 3.2c0 2.65-2.35 4.8-6.15 8.25Z" /></svg>
                Support the project
              </a>
              <Link href="/legal/">Legal notice</Link>
            </nav>
          </div>
          <div className="foot-bottom">Learn Cloud Net · made by <a href={PROFILE} target="_blank" rel="noopener noreferrer">Teddy Mazrin</a> · not affiliated with Microsoft</div>
        </footer>
      )}
    </div>
  );
}
