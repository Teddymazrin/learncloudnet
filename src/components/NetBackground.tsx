"use client";
// A faint network behind the home page: packets hop between nodes, and now and then one bonks off a shield and turns back.
import { useEffect, useRef } from "react";

interface Node { x: number; y: number; shield: boolean; links: number[] }
interface Packet { from: number; to: number; t: number; speed: number; color: string; bonk: number; trail: { x: number; y: number }[] }

const GAP = 120; // px between nodes
// Colors come from the theme, so the background follows whichever one is picked.
const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const rgba = (hex: string, a: number) => { const n = parseInt(hex.replace("#", ""), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
const palette = () => {
  const accent = cssVar("--accent") || "#A36BFF", bad = cssVar("--bad") || "#FF6B8B";
  return { packets: [cssVar("--accent2") || "#38E1FF", cssVar("--reward") || "#4DF2C1", accent], link: rgba(accent, 0.10), node: rgba(accent, 0.22), shield: rgba(bad, 0.30), bad };
};

function build(w: number, h: number): Node[] {
  const nodes: Node[] = [];
  const cols = Math.ceil(w / GAP) + 1, rows = Math.ceil(h / GAP) + 1;
  // A jittered grid, so it reads as a network rather than graph paper. Seeded for a stable layout.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    nodes.push({ x: c * GAP + (rnd() - 0.5) * GAP * 0.55, y: r * GAP + (rnd() - 0.5) * GAP * 0.55, shield: rnd() < 0.07, links: [] });
  }
  const at = (r: number, c: number) => (r >= 0 && c >= 0 && r < rows && c < cols ? r * cols + c : -1);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = at(r, c);
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1]]) {
      const j = at(r + dr, c + dc);
      if (j < 0 || (dr && dc && rnd() < 0.7) || rnd() < 0.18) continue;
      nodes[i].links.push(j); nodes[j].links.push(i);
    }
  }
  return nodes;
}

export function NetBackground() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let nodes: Node[] = [], packets: Packet[] = [], w = 0, h = 0, raf = 0, last = 0;
    let pal = palette();

    const spawn = (): Packet => {
      let from = Math.floor(Math.random() * nodes.length);
      for (let k = 0; k < 20 && (!nodes[from].links.length || nodes[from].shield); k++) from = Math.floor(Math.random() * nodes.length);
      const to = nodes[from].links[Math.floor(Math.random() * nodes[from].links.length)] ?? from;
      return { from, to, t: Math.random(), speed: 0.35 + Math.random() * 0.4, color: pal.packets[Math.floor(Math.random() * pal.packets.length)], bonk: 0, trail: [] };
    };
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth; h = window.innerHeight;
      cv.width = w * dpr; cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      nodes = build(w, h);
      packets = Array.from({ length: Math.round((w * h) / 52000) + 6 }, spawn);
    };

    const draw = (dt: number) => {
      ctx.clearRect(0, 0, w, h);
      // Links and nodes, very faint.
      ctx.lineWidth = 1;
      ctx.strokeStyle = pal.link;
      ctx.beginPath();
      nodes.forEach((n, i) => n.links.forEach((j) => { if (j > i) { ctx.moveTo(n.x, n.y); ctx.lineTo(nodes[j].x, nodes[j].y); } }));
      ctx.stroke();
      for (const n of nodes) {
        ctx.fillStyle = n.shield ? pal.shield : pal.node;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.shield ? 3.5 : 2.2, 0, Math.PI * 2); ctx.fill();
      }
      for (const p of packets) {
        p.t += p.speed * dt;
        const b = nodes[p.to];
        if (p.t >= 1) {
          if (b.shield) { // Denied: flash the shield and send the packet back where it came from.
            p.bonk = 1; [p.from, p.to] = [p.to, p.from]; p.t = 0;
          } else {
            const next = b.links.filter((j) => j !== p.from);
            p.from = p.to; p.to = next.length ? next[Math.floor(Math.random() * next.length)] : p.from; p.t = 0;
          }
        }
        const A = nodes[p.from], B = nodes[p.to];
        const x = A.x + (B.x - A.x) * p.t, y = A.y + (B.y - A.y) * p.t;
        p.trail.unshift({ x, y }); if (p.trail.length > 10) p.trail.pop();
        p.trail.forEach((q, k) => { ctx.globalAlpha = 0.16 * (1 - k / 10); ctx.fillStyle = p.color; ctx.fillRect(q.x - 2, q.y - 2, 4, 4); });
        ctx.globalAlpha = 0.6; ctx.fillStyle = p.color;
        ctx.shadowColor = p.color; ctx.shadowBlur = 10;
        ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
        ctx.shadowBlur = 0;
        if (p.bonk > 0) { // A red ring where it hit.
          ctx.globalAlpha = 0.5 * p.bonk; ctx.strokeStyle = pal.bad; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(A.x, A.y, 6 + (1 - p.bonk) * 16, 0, Math.PI * 2); ctx.stroke();
          p.bonk = Math.max(0, p.bonk - dt * 1.4);
        }
        ctx.globalAlpha = 1;
      }
    };

    const loop = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      draw(dt);
      raf = requestAnimationFrame(loop);
    };
    size();
    if (still) draw(0); else raf = requestAnimationFrame(loop);
    // Phones resize as the address bar slides; only rebuild when the size really changes.
    const onResize = () => { if (window.innerWidth === w && Math.abs(window.innerHeight - h) < 160) return; size(); if (still) draw(0); };
    window.addEventListener("resize", onResize);
    const onTheme = () => { pal = palette(); packets.forEach((p) => { p.color = pal.packets[Math.floor(Math.random() * pal.packets.length)]; }); if (still) draw(0); };
    window.addEventListener("next-hop-theme", onTheme);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); window.removeEventListener("next-hop-theme", onTheme); };
  }, []);

  return <canvas ref={canvas} className="net-bg" aria-hidden="true" />;
}
