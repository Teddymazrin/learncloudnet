"use client";
import { useRouter } from "next/navigation";
import { TIERS, levelsIn } from "@/content";
import { useProgress } from "@/lib/progress";

/** Pick a tier and start. Choosing a later tier skips ahead to it; your progress picks up at its first unsolved level. */
export function TierCards() {
  const p = useProgress();
  const router = useRouter();
  return (
    <div className="tier-grid">
      {TIERS.map((t) => {
        const levels = levelsIn(t.id);
        const solved = levels.filter((l) => p.done[l.id]).length;
        const go = () => {
          if (!p.unlocked(t.id)) p.skipTo(t.id);
          const next = levels.find((l) => !p.done[l.id]) ?? levels[0];
          router.push(`/learn/${next.id}/`);
        };
        return (
          <button type="button" className="tier-card pickable" key={t.id} onClick={go} disabled={!levels.length}>
            <div className="style">{t.style}</div>
            <h3>{t.name}</h3>
            <p style={{ margin: 0, fontSize: 14 }}>{t.blurb}</p>
            <span className="tier-foot">
              <span className="lock">{p.ready && solved ? `${solved}/${levels.length} solved` : `${levels.length} levels`}</span>
              <span className="go">{solved ? "Continue" : "Start here"} →</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
