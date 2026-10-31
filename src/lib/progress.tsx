"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LEVELS, levelsIn, type Tier } from "@/content";

const KEY = "next-hop.progress.v1";

interface Saved { done: Record<string, number>; skipped: Tier[]; last?: string }
interface Progress extends Saved {
  ready: boolean;
  record: (id: string, stars: number) => void;
  setLast: (id: string) => void;
  skipTo: (tier: Tier) => void;
  unlocked: (tier: Tier) => boolean;
  xp: number;
  reset: () => void;
}

const BUILT: Tier[] = ["beginner", "intermediate", "advanced", "expert"];
const ORDER: Tier[] = ["beginner", "intermediate", "advanced", "expert"];
const Ctx = createContext<Progress | null>(null);

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { done: {}, skipped: [], ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return { done: {}, skipped: [] };
}

export function ProgressProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Saved>({ done: {}, skipped: [] });
  const [ready, setReady] = useState(false);
  // Child effects run before this provider's, so a level page can write before storage is read.
  // Every write starts from what's stored until the first read, so saved progress is never replaced by the empty default.
  const cur = useRef<Saved | null>(null);
  const latest = () => (cur.current ??= load());
  useEffect(() => { setS(latest()); setReady(true); }, []);
  const save = useCallback((f: (prev: Saved) => Saved) => {
    const next = f(latest());
    cur.current = next;
    setS(next); setReady(true);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  const value = useMemo<Progress>(() => {
    const tierDone = (t: Tier) => levelsIn(t).length > 0 && levelsIn(t).every((l) => s.done[l.id]);
    const unlocked = (t: Tier) => {
      if (!BUILT.includes(t)) return false;
      const i = ORDER.indexOf(t);
      if (i === 0) return true;
      return s.skipped.includes(t) || tierDone(ORDER[i - 1]);
    };
    return {
      ...s, ready, unlocked,
      xp: Object.values(s.done).reduce((a, b) => a + b * 50, 0),
      record: (id, stars) => save((p) => ({ ...p, done: { ...p.done, [id]: Math.max(p.done[id] ?? 0, stars) } })),
      setLast: (id) => save((p) => (p.last === id ? p : { ...p, last: id })),
      skipTo: (t) => save((p) => ({ ...p, skipped: Array.from(new Set([...p.skipped, ...ORDER.slice(1, ORDER.indexOf(t) + 1)])) })),
      reset: () => save(() => ({ done: {}, skipped: [] })),
    };
  }, [s, ready, save]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProgress(): Progress {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProgress outside ProgressProvider");
  return v;
}

export const solvedCount = (done: Record<string, number>) => LEVELS.filter((l) => done[l.id]).length;
