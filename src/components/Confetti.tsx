"use client";
import { useMemo } from "react";

const COLORS = ["var(--accent)", "var(--ok)", "var(--warn)", "var(--nva)"];

/** A light shower of paper bits behind the solved card. Hidden when the viewer prefers reduced motion. */
export function Confetti({ n = 28 }: { n?: number }) {
  const bits = useMemo(() => Array.from({ length: n }, (_, i) => ({
    left: (i * 37) % 100,
    delay: ((i * 53) % 60) / 100,
    dur: 2.2 + ((i * 29) % 12) / 10,
    drift: ((i * 17) % 80) - 40,
    rot: (i * 47) % 360,
    color: COLORS[i % COLORS.length],
  })), [n]);
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <i key={i} style={{ left: `${b.left}%`, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`, background: b.color, ["--drift" as string]: `${b.drift}px`, ["--rot" as string]: `${b.rot}deg` }} />
      ))}
    </div>
  );
}
