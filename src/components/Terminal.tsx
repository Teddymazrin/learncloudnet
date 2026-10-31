"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Suggestion } from "@/lib/complete";

export interface Line { text: string; cls?: "cmd" | "err" | "lab" | "good" }

interface Props {
  lines: Line[];
  prompt: string;
  title: string;
  draft: string;
  setDraft: (v: string) => void;
  onRun: (line: string) => void;
  focusKey?: number;
  /** Extra controls in the header, like the Terminal | Portal switch. */
  headExtra?: ReactNode;
  /** Quick buttons under the prompt. */
  quick?: string[];
  /** Autocomplete for what's typed so far. */
  suggest?: (draft: string) => Suggestion[];
}

export function Output({ lines }: { lines: Line[] }) {
  const out = useRef<HTMLDivElement>(null);
  useEffect(() => { out.current?.scrollTo({ top: out.current.scrollHeight }); }, [lines]);
  return (
    <div className="term-out" ref={out} aria-live="polite">
      {lines.flatMap((l, i) => l.text.split("\n").map((t, j) => {
        const cls = l.cls ?? (/^lab:|^lab trace:/.test(t) ? "lab" : undefined);
        return <div key={`${i}-${j}`} className={cls}>{t || " "}</div>;
      }))}
    </div>
  );
}

export function Terminal({ lines, prompt, title, draft, setDraft, onRun, focusKey, headExtra, quick = ["help", "goals", "hint", "clear"], suggest }: Props) {
  const out = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState(0);

  useEffect(() => { out.current?.scrollTo({ top: out.current.scrollHeight }); }, [lines]);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "1.5em";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [draft]);
  // After "Type it", land in the prompt with the caret at the end so Enter runs it.
  useEffect(() => {
    if (!focusKey) return;
    const raf = requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
      el.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(raf);
  }, [focusKey]);

  const sugg = suggest ? suggest(draft) : [];
  const accept = (v: string) => { setDraft(v); requestAnimationFrame(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(v.length, v.length); } }); };

  const submit = (v: string) => {
    if (!v.trim()) return;
    const nh = [...history, v.trimEnd()];
    setHistory(nh); setHIdx(nh.length);
    setDraft("");
    onRun(v);
  };

  return (
    <div className="term">
      <div className="term-head"><span className="dot" /><span>{title}</span>{headExtra}<span>rg-lab · eastus2</span></div>
      <div className="term-out" ref={out} aria-live="polite" onClick={() => { if (!window.getSelection()?.toString()) input.current?.focus(); }}>
        {lines.flatMap((l, i) => l.text.split("\n").map((t, j) => {
          const cls = l.cls ?? (/^lab:|^lab trace:/.test(t) ? "lab" : undefined);
          return <div key={`${i}-${j}`} className={cls}>{t || " "}</div>;
        }))}
      </div>
      {sugg.length > 0 && (
        <div className="suggest" aria-label="Suggestions">
          {sugg.map((s) => <button key={s.value} type="button" onClick={() => accept(s.value)}>{s.label}</button>)}
        </div>
      )}
      <div className="prompt-row">
        <span className="ps">{prompt}</span>
        <textarea
          ref={input} id="cmd" rows={1} spellCheck={false} autoCapitalize="off" autoComplete="off" autoCorrect="off" aria-label="Command"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Tab" && sugg.length) {
              e.preventDefault(); accept(sugg[0].value);
            } else if (e.key === "Enter" && !e.shiftKey) {
              if (/[\\`]\s*$/.test(draft)) return; // line continuation
              e.preventDefault(); submit(draft);
            } else if (e.key === "ArrowUp" && !draft.includes("\n") && hIdx > 0) {
              e.preventDefault(); setHIdx(hIdx - 1); setDraft(history[hIdx - 1]);
            } else if (e.key === "ArrowDown" && !draft.includes("\n") && hIdx < history.length) {
              e.preventDefault(); setHIdx(hIdx + 1); setDraft(history[hIdx + 1] ?? "");
            }
          }}
        />
      </div>
      <div className="quick">
        {quick.map((q) => <button key={q} type="button" onClick={() => { submit(q); input.current?.focus(); }}>{q}</button>)}
      </div>
    </div>
  );
}
