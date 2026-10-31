"use client";
// Click-to-explain: a small "?" next to a form field.
import { useEffect, useRef, useState } from "react";

/** Closes when you click anywhere else or press Escape. */
function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open, close]);
  return ref;
}

/** A "?" that opens a short explanation. */
export function Info({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  return (
    <span className="info" ref={ref}>
      <button type="button" className="info-btn" aria-expanded={open} aria-label={`What is ${label}?`} onClick={() => setOpen(!open)}>?</button>
      {open && <span className="bubble" role="note">{text}</span>}
    </span>
  );
}
