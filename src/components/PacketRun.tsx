"use client";
// The landing page's little story, on a loop: a packet bonks off a deny rule, the rule gets fixed, and it makes it home.
import { useEffect, useRef, useState } from "react";
import { NvaIcon, VmIcon } from "./NetworkMap";

type Phase = "go" | "bonk" | "fix" | "run" | "win";

const PATH = "M118 150 L470 150 C540 150 560 82 620 82 L700 82 C760 82 770 150 812 150";
const GATE = 140; // where the packet hits the shield, as a length along PATH
const T = { go: 1300, bonk: 900, fix: 1100, run: 2300, win: 1900 }; // ms per phase
const ORDER: Phase[] = ["go", "bonk", "fix", "run", "win"];

const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

export function PacketRun() {
  const path = useRef<SVGPathElement>(null);
  const pkt = useRef<SVGGElement>(null);
  const trail = useRef<(SVGCircleElement | null)[]>([]);
  const box = useRef<SVGSVGElement>(null);
  const [phase, setPhase] = useState<Phase>("go");
  const [loop, setLoop] = useState(0);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const p = path.current, g = pkt.current, svg = box.current;
    if (!p || !g || !svg) return;
    const line: SVGPathElement = p;
    const len = p.getTotalLength();
    const put = (at: number, squish = 1) => {
      const pt = p.getPointAtLength(Math.max(0, Math.min(len, at)));
      g.setAttribute("transform", `translate(${pt.x} ${pt.y}) scale(${2 - squish} ${squish})`);
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setStill(true); setPhase("win"); put(len); return; }

    const hist: number[] = [];
    let raf = 0, i = 0, t0 = -1, n = 0;
    // Browsers pause requestAnimationFrame in background tabs, so the loop costs nothing when nobody's looking.
    function step(now: number) {
      if (t0 < 0) t0 = now;
      const ph = ORDER[i], k = Math.min(1, (now - t0) / T[ph]);
      let at = 0, sq = 1;
      if (ph === "go") at = ease(k) * GATE;
      else if (ph === "bonk") { at = GATE - Math.sin(Math.min(1, k * 1.6) * Math.PI / 2) * 46; sq = k < 0.15 ? 0.7 : 1; }
      else if (ph === "fix") at = GATE - 46 + Math.sin(k * Math.PI * 4) * 2;
      else if (ph === "run") at = GATE - 46 + ease(k) * (len - GATE + 46);
      else { at = len; sq = k < 0.12 ? 0.75 : 1; }
      put(at, sq);
      // A short glowing trail while it moves.
      hist.unshift(at); hist.length = Math.min(hist.length, 18);
      trail.current.forEach((c, j) => {
        if (!c) return;
        const h = hist[(j + 1) * 3];
        const moving = (ph === "go" || ph === "run") && h !== undefined;
        c.style.opacity = moving ? String(0.5 - j * 0.08) : "0";
        if (moving) { const pt = line.getPointAtLength(Math.max(0, h)); c.setAttribute("cx", String(pt.x)); c.setAttribute("cy", String(pt.y)); }
      });
      if (k >= 1) {
        i = (i + 1) % ORDER.length; t0 = now;
        if (i === 0) { n += 1; setLoop(n); }
        setPhase(ORDER[i]);
      }
      raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  const allowed = phase === "fix" || phase === "run" || phase === "win";
  return (
    <div className={`packet-run ph-${phase}${still ? " still" : ""}`} aria-hidden="true">
      <svg ref={box} viewBox="0 0 900 230" className="pr-svg">
        <path ref={path} d={PATH} className="pr-wire" />
        <path d={PATH} className="pr-wire-flow" />
        <text x={660} y={66} textAnchor="middle" className="pr-tag">peered</text>

        <g className="pr-node"><VmIcon x={70} y={128} nicNsg={false} /><text x={92} y={190} textAnchor="middle">vm-client</text></g>
        <g className="pr-node"><NvaIcon x={450} y={133} /><text x={470} y={190} textAnchor="middle">fw-hub</text></g>
        <g className={`pr-node pr-home${phase === "win" ? " lit" : ""}`}><VmIcon x={820} y={128} nicNsg={false} /><text x={842} y={190} textAnchor="middle">vm-web</text></g>

        {/* The NSG gate: red and shaking on the bonk, green once the rule is fixed. */}
        <g className={`pr-gate${allowed ? " open" : ""}${phase === "bonk" ? " hit" : ""}`} transform="translate(276 150)">
          <path d="M-14 -22 l14 -6 l14 6 v14 c0 12 -7 19 -14 22 c-7 -3 -14 -10 -14 -22 Z" />
          <text y={4} textAnchor="middle" className="pr-gate-ic">{allowed ? "✓" : "✕"}</text>
          <g transform="translate(0 -46)">
            <rect x={-52} y={-13} width={104} height={20} rx={10} />
            <text y={1.5} textAnchor="middle">{allowed ? "Allow · 150" : "Deny · 200"}</text>
          </g>
          <text y={52} textAnchor="middle" className="pr-gate-name">nsg-web</text>
        </g>

        {phase === "bonk" && <text key={`b${loop}`} x={226} y={112} textAnchor="middle" className="pr-pop bad">bonk!</text>}
        {phase === "fix" && <text key={`f${loop}`} x={276} y={222} textAnchor="middle" className="pr-cmd">$ az network nsg rule update --priority 150</text>}

        {[0, 1, 2, 3, 4].map((j) => <circle key={j} ref={(el) => { trail.current[j] = el; }} r={6 - j} className="pr-trail" />)}

        {/* The packet: a little glowing block with eyes. */}
        <g ref={pkt} className="pr-packet" transform="translate(118 150)">
          <g transform="translate(0 -2)">
            <rect x={-11} y={-11} width={22} height={22} rx={5} className="pr-body" />
            <g className="pr-eyes">
              {phase === "bonk" || phase === "fix"
                ? <><path d="M-6 -3 l3 3 M-3 -3 l-3 3 M3 -3 l3 3 M6 -3 l-3 3" className="pr-x" /></>
                : <><circle cx={-4} cy={-1.5} r={2} /><circle cx={4} cy={-1.5} r={2} /></>}
              {phase === "win" ? <path d="M-4 4 q4 4 8 0" className="pr-mouth" /> : null}
            </g>
          </g>
        </g>

        {phase === "win" && (
          <g key={`w${loop}`} className="pr-win">
            <text x={884} y={100} textAnchor="end" className="pr-pop xp">+50 XP</text>
            {[[-34, -30], [30, -36], [-44, 4], [42, 0], [0, -48]].map(([dx, dy], j) => (
              <text key={j} x={842} y={150} className="pr-spark" style={{ ["--dx" as string]: `${dx}px`, ["--dy" as string]: `${dy}px`, animationDelay: `${j * 60}ms` }}>★</text>
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}
