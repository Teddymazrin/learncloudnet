"use client";
import Link from "next/link";
import { getLevel, TIERS } from "@/content";
import { useProgress } from "@/lib/progress";
import { LevelPlayer } from "./LevelPlayer";

export function LevelGate({ id }: { id: string }) {
  const p = useProgress();
  const level = getLevel(id)!;
  if (p.ready && !p.unlocked(level.tier)) {
    const t = TIERS.find((x) => x.id === level.tier)!;
    return (
      <div className="wrap prose">
        <h1>{t.name} is locked</h1>
        <p>Finish the tier before it to unlock {t.name}, or skip ahead if you already know the material.</p>
        <div className="row">
          <button className="btn primary" type="button" onClick={() => p.skipTo(level.tier)}>Skip ahead and play</button>
          <Link className="btn" href="/learn/">Back to the path</Link>
        </div>
      </div>
    );
  }
  return <LevelPlayer key={id} id={id} />;
}
