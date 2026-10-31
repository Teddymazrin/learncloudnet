"use client";
import { useEffect, useRef, type ReactNode } from "react";
import type { Action, Built } from "@/lib/forms";
import { ActionForm, ActionList } from "./ActionForm";
import { Output, type Line } from "./Terminal";
import type { ResultCard } from "@/lib/result";

export type PortalGroup = "selected" | "services" | "create" | "diagnose";

interface Props {
  lines: Line[];
  headExtra?: ReactNode;
  group: PortalGroup;
  setGroup: (g: PortalGroup) => void;
  selectedLabel: string | null;
  groups: Record<PortalGroup, Action[] | null>;
  form: Action | null;
  setForm: (a: Action | null) => void;
  cost: (a: Action) => string | undefined;
  onRun: (a: Action, b: Built) => boolean;
  note?: string;
  result?: ResultCard | null;
  onDismiss?: () => void;
  onClear?: () => void;
}

const LABEL: Record<PortalGroup, string> = { selected: "Selected", services: "Services", create: "＋ Create", diagnose: "Diagnose" };

export function Portal({ lines, headExtra, group, setGroup, selectedLabel, groups, form, setForm, cost, onRun, note, result, onDismiss, onClear }: Props) {
  const tabs = (Object.keys(LABEL) as PortalGroup[]).filter((g) => groups[g] !== null);
  const list = groups[group] ?? [];
  const compact = !!result && !form;
  // A new result shows from the top: the tabs, the card, then the tools.
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { if (result) body.current?.scrollTo({ top: 0 }); }, [result]);
  return (
    <div className={`term portal${compact ? " compact" : ""}`}>
      <div className="term-head"><span className="dot" /><span>Portal</span>{headExtra}<span>rg-lab · eastus2</span></div>
      <div className="portal-body" ref={body}>
        <div className="portal-nav" role="tablist" aria-label="Portal actions">
          {tabs.map((g) => (
            <button key={g} role="tab" type="button" aria-selected={group === g} className={group === g ? "on" : ""} onClick={() => { setGroup(g); setForm(null); }}>
              {g === "selected" ? (selectedLabel ? `Selected: ${selectedLabel}` : "Selected") : LABEL[g]}
            </button>
          ))}
        </div>
        {result && (
          <div className={`result-card ${result.tone}`} role="status">
            <div><b>{result.title}</b><span>{result.detail}</span></div>
            <button type="button" className="result-x" aria-label="Close result" onClick={onDismiss}>×</button>
          </div>
        )}
        {form ? (
          <ActionForm key={form.id} action={form} cost={cost(form)} onRun={(b) => onRun(form, b)} onClose={() => setForm(null)} />
        ) : group === "selected" && !selectedLabel ? (
          <p className="note" style={{ margin: 0 }}>Tap a virtual network, subnet, VM, peering or DNS zone on the map to see what you can change.</p>
        ) : list.length ? (
          <ActionList actions={list} onPick={setForm} compact={compact} cost={list.some((a) => cost(a)) ? "costs a star" : undefined} />
        ) : (
          <p className="note" style={{ margin: 0 }}>Nothing to change here in this level. Tap something else on the map.</p>
        )}
        {note && <p className="aform-help" style={{ margin: 0 }}>{note}</p>}
      </div>
      <div className="portal-log-head"><span>Activity · every form runs a real az command</span>{onClear && <button type="button" onClick={onClear}>Clear</button>}</div>
      <Output lines={lines} />
    </div>
  );
}
