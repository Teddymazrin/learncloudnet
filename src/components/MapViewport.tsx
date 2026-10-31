"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

/** Below this the map's smallest labels get hard to read, so fit stops shrinking and lets you pan instead. */
const READABLE = 0.72;
const MIN = 0.35, MAX = 2.4;
const clamp = (z: number) => Math.min(MAX, Math.max(MIN, z));

interface Props {
  /** Renders the map at a scale. */
  children: (scale: number) => ReactNode;
  /** Changes when the map's content changes, so fit can be recomputed. */
  version: unknown;
  /** Overlays drawn above the map, positioned against the viewport. */
  overlay?: ReactNode;
  stageRef?: RefObject<HTMLDivElement | null>;
}

/** Fit, zoom and drag-to-pan around the network map, with a button that brings the goal path into view. */
export function MapViewport({ children, version, overlay, stageRef }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [fitZ, setFitZ] = useState(1);
  const drag = useRef<{ x: number; y: number; l: number; t: number; moved: boolean } | null>(null);
  const scale = zoom ?? fitZ;

  const measure = useCallback(() => {
    const el = box.current;
    const svg = el?.querySelector("svg.diagram") as SVGSVGElement | null;
    if (!el || !svg) return;
    const vb = svg.viewBox.baseVal;
    if (!vb?.width) return;
    const z = Math.min((el.clientWidth - 16) / vb.width, (el.clientHeight - 16) / vb.height);
    setFitZ(clamp(Math.min(1.25, Math.max(READABLE, z))));
  }, []);

  useLayoutEffect(measure, [measure, version]);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  /** Scroll so the goal connections (or the whole map) sit in the middle of the view. */
  const focusGoal = useCallback((smooth = true) => {
    const el = box.current;
    if (!el) return;
    const marks = Array.from(el.querySelectorAll<SVGGraphicsElement>(".flow, .flow-tag, .x-mark, .trace"));
    const rects = (marks.length ? marks : Array.from(el.querySelectorAll<SVGGraphicsElement>("svg.diagram"))).map((m) => m.getBoundingClientRect());
    if (!rects.length) return;
    const b = el.getBoundingClientRect();
    const cx = (Math.min(...rects.map((r) => r.left)) + Math.max(...rects.map((r) => r.right))) / 2;
    const cy = (Math.min(...rects.map((r) => r.top)) + Math.max(...rects.map((r) => r.bottom))) / 2;
    el.scrollTo({ left: el.scrollLeft + cx - (b.left + b.width / 2), top: el.scrollTop + cy - (b.top + b.height / 2), behavior: smooth ? "smooth" : "auto" });
  }, []);

  // When the map first appears larger than the view, start on the goal rather than the top-left corner.
  const first = useRef(true);
  useEffect(() => {
    if (!first.current) return;
    first.current = false;
    requestAnimationFrame(() => focusGoal(false));
  }, [focusGoal, fitZ]);

  const zoomBy = (f: number) => {
    const el = box.current;
    const next = clamp(scale * f);
    if (el) {
      const cx = (el.scrollLeft + el.clientWidth / 2) / scale, cy = (el.scrollTop + el.clientHeight / 2) / scale;
      requestAnimationFrame(() => el.scrollTo({ left: cx * next - el.clientWidth / 2, top: cy * next - el.clientHeight / 2 }));
    }
    setZoom(next);
  };

  return (
    <div className="map-stage" ref={stageRef}>
      <div
        className="map-view"
        ref={box}
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as Element).closest('[role="button"]')) return;
          const el = box.current!;
          drag.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x, dy = e.clientY - d.y;
          if (!d.moved && Math.hypot(dx, dy) < 4) return;
          if (!d.moved) { d.moved = true; box.current!.setPointerCapture(e.pointerId); box.current!.classList.add("dragging"); }
          box.current!.scrollLeft = d.l - dx; box.current!.scrollTop = d.t - dy;
        }}
        onPointerUp={() => { drag.current = null; box.current?.classList.remove("dragging"); }}
        onPointerCancel={() => { drag.current = null; box.current?.classList.remove("dragging"); }}
        onWheel={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); } }}
      >
        <div className="map-canvas">{children(scale)}</div>
      </div>
      {overlay}
      <div className="map-zoom" role="toolbar" aria-label="Map view">
        <button type="button" onClick={() => focusGoal()} title="Center the goal connections" aria-label="Center the goal connections">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="1.6" className="fill" /></svg>
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">−</button>
        <button type="button" onClick={() => { setZoom(null); requestAnimationFrame(() => focusGoal()); }} className={zoom === null ? "on" : ""} title="Fit the map to this pane">Fit</button>
        <button type="button" onClick={() => zoomBy(1.2)} aria-label="Zoom in">+</button>
      </div>
    </div>
  );
}
