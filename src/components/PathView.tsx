"use client";
import { useState } from "react";
import Link from "next/link";
import { LEVELS, TIERS, levelsIn } from "@/content";
import type { Level } from "@/content/types";
import { useProgress } from "@/lib/progress";

/** Consecutive levels that share a topic, so each tier reads as a few short chapters instead of one long grid. */
function chapters(levels: Level[]) {
  const out: { stage: string; items: { l: Level; n: number }[] }[] = [];
  levels.forEach((l, i) => {
    const last = out[out.length - 1];
    if (last && last.stage === l.stage) last.items.push({ l, n: i + 1 });
    else out.push({ stage: l.stage, items: [{ l, n: i + 1 }] });
  });
  return out;
}

const ICON: Record<string, string> = { beginner: "1", intermediate: "2", advanced: "3", expert: "4" };

export function PathView() {
  const p = useProgress();
  const solved = LEVELS.filter((l) => p.done[l.id]).length;
  // The next level to play: the first unsolved one in a tier that's open.
  const next = LEVELS.find((l) => p.unlocked(l.tier) && !p.done[l.id]);
  const nextTier = next && TIERS.find((t) => t.id === next.tier);
  const nextN = next ? levelsIn(next.tier).findIndex((l) => l.id === next.id) + 1 : 0;

  return (
    <div className="wrap path" style={{ paddingBlock: "24px 36px" }}>
      <section className={`path-hero${next ? ` tier-${next.tier}` : ""}`}>
        <div className="path-hero-text">
          <span className="label">{!p.ready ? "Your path" : solved === 0 ? "Start here" : next ? "Pick up where you left off" : "Path complete"}</span>
          <h1>{next ? next.title : "Every level solved"}</h1>
          {next && nextTier && <p className="muted">{nextTier.name} · Level {nextN} · {next.stage}</p>}
          <div className="path-meter" aria-label={`${solved} of ${LEVELS.length} levels solved`}>
            <i style={{ width: `${p.ready ? (100 * solved) / LEVELS.length : 0}%` }} />
          </div>
          <small className="muted">{p.ready ? solved : 0} of {LEVELS.length} levels solved · {p.ready ? p.xp : 0} XP</small>
        </div>
        {next && <Link className="btn primary big" href={`/learn/${next.id}/`}>{solved === 0 ? "Start level 1" : "Continue"}</Link>}
      </section>

      <nav className="tier-jump" aria-label="Tiers">
        {TIERS.map((t) => {
          const ls = levelsIn(t.id);
          const done = ls.filter((l) => p.done[l.id]).length;
          const open = p.unlocked(t.id);
          return (
            <a key={t.id} href={`#tier-${t.id}`} className={`tier-chip tier-${t.id}${open ? "" : " locked"}`}>
              <span className="tier-badge">{ICON[t.id]}</span>
              <span><b>{t.name}</b><small>{open ? `${done} of ${ls.length}` : "Locked"}</small></span>
              <i className="tier-bar"><i style={{ width: `${ls.length ? (100 * done) / ls.length : 0}%` }} /></i>
            </a>
          );
        })}
      </nav>

      {TIERS.map((t) => {
        const levels = levelsIn(t.id);
        const open = p.unlocked(t.id);
        const done = levels.filter((l) => p.done[l.id]).length;
        return (
          <section className={`path-tier tier-${t.id}${open ? "" : " locked"}`} id={`tier-${t.id}`} key={t.id}>
            <header>
              <span className="tier-badge big">{ICON[t.id]}</span>
              <div>
                <h2>{t.name} <span className="tier-style">{t.style}</span></h2>
                <p className="muted">{t.blurb}</p>
              </div>
              <span className="tier-count">{open ? `${done}/${levels.length}` : "Locked"}</span>
              {!open && <button className="btn ghost start-here" type="button" onClick={() => p.skipTo(t.id)}>Unlock and start here</button>}
            </header>
            {chapters(levels).map((c) => (
              <div className="chapter" key={`${c.stage}-${c.items[0].n}`}>
                <h3>{c.stage}</h3>
                <ol className="trail">
                  {c.items.map(({ l, n }) => {
                    const s = p.done[l.id] ?? 0;
                    const isNext = next?.id === l.id;
                    return (
                      <li key={l.id}>
                        <Link href={`/learn/${l.id}/`} className={`stop${s ? " solved" : ""}${isNext ? " next" : ""}`} aria-disabled={!open}>
                          <span className="stop-n">{s ? "✓" : n}</span>
                          <span className="stop-body">
                            <b>{l.title}</b>
                            <small>{isNext ? "Up next" : s ? "★★★".slice(0, s) + "☆☆☆".slice(0, 3 - s) : `Level ${n}`}</small>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </section>
        );
      })}

      <details className="skills-wrap">
        <summary>Your skills by topic</summary>
        <Skills done={p.done} />
      </details>
      <ResetProgress />
    </div>
  );
}

function ResetProgress() {
  const p = useProgress();
  // Ask once more, then say it's done: the XP counter that changes is at the top of the page, out of sight on a phone.
  const [sure, setSure] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <details className="note" onToggle={() => { setSure(false); setDone(false); }}>
      <summary style={{ cursor: "pointer" }}>Clear my progress</summary>
      <p>This removes all stars and unlocks saved in this browser.</p>
      {done ? <p className="reset-done" role="status">Progress cleared. Every level is back to the start.</p>
        : sure ? (
          <div className="row">
            <button className="btn danger" type="button" onClick={() => { p.reset(); setSure(false); setDone(true); }}>Yes, clear everything</button>
            <button className="btn ghost" type="button" onClick={() => setSure(false)}>Cancel</button>
          </div>
        ) : <button className="btn" type="button" onClick={() => setSure(true)}>Clear progress on this device</button>}
    </details>
  );
}

/** One ring per topic: how many of its stars you've earned across every tier. Review levels count toward everything they mix. */
function Skills({ done }: { done: Record<string, number> }) {
  const topics = Array.from(new Set(LEVELS.map((l) => l.stage).filter((x) => x !== "Review")));
  return (
    <section className="skills" aria-label="Your skills">
      {topics.map((t) => {
        const ls = LEVELS.filter((l) => l.stage === t);
        const got = ls.reduce((a, l) => a + (done[l.id] ?? 0), 0);
        const k = got / (ls.length * 3);
        const C = 2 * Math.PI * 17;
        return (
          <div key={t} className="skill" title={`${got} of ${ls.length * 3} stars`}>
            <svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">
              <circle cx="22" cy="22" r="17" className="ring-bg" />
              <circle cx="22" cy="22" r="17" className="ring" opacity={k ? 1 : 0} strokeDasharray={`${C * k} ${C}`} transform="rotate(-90 22 22)" />
            </svg>
            <span><b>{t}</b><small>{ls.filter((l) => done[l.id]).length} of {ls.length} levels</small></span>
          </div>
        );
      })}
    </section>
  );
}
