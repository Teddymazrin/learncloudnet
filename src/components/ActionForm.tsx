"use client";
import { useEffect, useRef, useState } from "react";
import { initialValues, type Action, type Built, type Values } from "@/lib/forms";
import { fieldHelp } from "@/lib/glossary";
import { Info } from "./Explain";

interface Props {
  action: Action;
  /** Text for the run button's cost, if any. */
  cost?: string;
  onRun: (b: Built) => boolean;
  onClose: () => void;
}

export function ActionForm({ action, cost, onRun, onClose }: Props) {
  const [v, setV] = useState<Values>(() => initialValues(action));
  const set = (k: string, val: string) => {
    let n = { ...v, [k]: val };
    if (action.prefillOn === k && action.prefill) n = { ...n, ...action.prefill(n) };
    setV(n);
  };
  const built = action.build(v);
  const ok = "cmds" in built;
  const id = (k: string) => `af-${action.id}-${k}`;
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, []);

  return (
    <form ref={ref} className="aform" onSubmit={(e) => { e.preventDefault(); if (ok && onRun(built)) onClose(); }}>
      <div className="aform-head">
        <span className={`aform-kind ${action.kind}`}>{action.kind === "fix" ? "Change" : "Diagnose"}</span>
        <b>{action.title}</b>
      </div>
      {action.about && <p className="aform-about">{action.about}{action.learnUrl && <> <a href={action.learnUrl} target="_blank" rel="noopener noreferrer">Learn more</a></>}</p>}
      <div className="aform-grid">
      {action.fields.filter((f) => !f.show || f.show(v)).map((f) => (
        <div key={f.key} className={`aform-field${f.type === "check" ? " check" : ""}`}>
          {f.type === "check" ? (
            <label><input type="checkbox" checked={v[f.key] === "true"} onChange={(e) => set(f.key, String(e.target.checked))} /> {f.label}{fieldHelp(f.label) && <Info text={fieldHelp(f.label)!} label={f.label} />}</label>
          ) : (
            <>
              <span className="aform-label"><label htmlFor={id(f.key)}>{f.label}</label>{fieldHelp(f.label, f.help) && <Info text={fieldHelp(f.label, f.help)!} label={f.label} />}</span>
              {f.type === "select" ? (
                <select id={id(f.key)} value={v[f.key]} onChange={(e) => set(f.key, e.target.value)} disabled={!f.options?.length}>
                  {f.options?.map(([val, lab]) => <option key={val} value={val}>{lab}</option>)}
                </select>
              ) : (
                <input id={id(f.key)} value={v[f.key] ?? ""} placeholder={f.placeholder} spellCheck={false} autoComplete="off" onChange={(e) => set(f.key, e.target.value)} />
              )}
            </>
          )}
          {f.help && <span className="aform-help">{f.help}</span>}
        </div>
      ))}
      </div>
      {built.warn && <p className="aform-warn" role="status">{built.warn}</p>}
      <div className="aform-preview">
        <div className="label" style={{ margin: 0 }}>{ok ? (built.cmds.length > 1 ? "This runs these commands" : "This runs") : "Not ready"}</div>
        {ok ? built.cmds.map((c) => <code key={c}>{c}</code>) : <p className="note" style={{ margin: 0 }}>{built.error}</p>}
      </div>
      <div className="row">
        <button className="btn primary" type="submit" disabled={!ok}>{action.kind === "fix" ? "Apply" : "Run"}{cost ? ` (${cost})` : ""}</button>
        <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

export function ActionList({ actions, onPick, cost, compact }: { actions: Action[]; onPick: (a: Action) => void; cost?: string; compact?: boolean }) {
  if (!actions.length) return null;
  return (
    <div className="alist">
      {actions.map((a) => a.about && !compact
        ? <button key={a.id} type="button" className="btn ghost tool" onClick={() => onPick(a)}><b>{a.title}</b><small>{a.about}</small></button>
        : <button key={a.id} type="button" className="btn ghost" title={a.about} onClick={() => onPick(a)}>{a.title}</button>)}
      {cost && <span className="aform-help">Using a form here {cost}.</span>}
    </div>
  );
}
