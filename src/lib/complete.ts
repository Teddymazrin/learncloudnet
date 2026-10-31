// Autocomplete for the Cloud Shell: command paths, flags, and the names of things in the lab.
// Flags come from every command the levels themselves use, so suggestions are always ones the simulator accepts.
import { SUPPORTED } from "@/sim/az";
import type { State } from "@/sim/types";
import { LEVELS } from "@/content";

export interface Suggestion { label: string; value: string }

const isFlag = (t: string) => /^-{1,2}[a-z]/i.test(t);
const verbOf = (tokens: string[]) => { const i = tokens.findIndex(isFlag); return (i < 0 ? tokens : tokens.slice(0, i)).join(" "); };

/** Flags seen per command across all level solutions and guided steps. */
const FLAGS: Map<string, string[]> = (() => {
  const m = new Map<string, Set<string>>();
  for (const l of LEVELS) {
    for (const c of [...l.solution, ...(l.steps ?? []).map((s) => s.cmd ?? "")]) {
      const t = c.split(/\s+/).filter(Boolean);
      if (t[0] !== "az") continue;
      const v = verbOf(t);
      const set = m.get(v) ?? new Set<string>();
      t.filter((x) => x.startsWith("--") || x === "-g" || x === "-n").forEach((f) => set.add(f.split("=")[0]));
      m.set(v, set);
    }
  }
  return new Map([...m].map(([k, v]) => [k, [...v]]));
})();

/** Everything in the lab that has a name, for value completion. */
function names(st: State): string[] {
  const out = new Set<string>(["rg-lab"]);
  Object.entries(st.vnets).forEach(([v, x]) => { out.add(v); Object.keys(x.subnets).forEach((s) => out.add(s)); });
  [st.nsgs, st.rts, st.zones, st.lbs ?? {}, st.natGateways ?? {}, st.publicIps ?? {}, st.bastions ?? {}, st.rulesets ?? {}, st.resolvers ?? {}].forEach((o) => Object.keys(o).forEach((k) => out.add(k)));
  Object.values(st.hosts).forEach((h) => { out.add(h.name); if (h.kind !== "lb" && h.kind !== "pe") out.add(h.nic); });
  Object.values(st.peerings).forEach((p) => out.add(p.name));
  Object.values(st.publicEndpoints).forEach((e) => out.add(e.name));
  return [...out];
}

/** Up to five suggestions for what's typed so far. Each value is the whole new line. */
export function suggest(draft: string, st: State, inVm: boolean): Suggestion[] {
  if (inVm || !draft.trim() || draft.includes("\n")) return [];
  const endsSpace = /\s$/.test(draft);
  const tokens = draft.trim().split(/\s+/);
  const partial = endsSpace ? "" : tokens[tokens.length - 1];
  const done = endsSpace ? tokens : tokens.slice(0, -1);
  const head = done.join(" ") + (done.length ? " " : "");
  const pick = (vals: string[], fmt: (v: string) => string = (v) => v) =>
    vals.filter((v) => v.toLowerCase().startsWith(partial.toLowerCase()) && v !== partial).slice(0, 5).map((v) => ({ label: fmt(v), value: `${head}${v} ` }));

  if (tokens[0] !== "az") return "az".startsWith(tokens[0]) && !endsSpace ? [{ label: "az network", value: "az network " }] : [];
  // Still typing the command path: complete the next word from the commands the simulator supports.
  if (!done.some(isFlag) && !partial.startsWith("-")) {
    const typed = done.join(" ");
    const next = new Set<string>();
    for (const c of SUPPORTED) {
      if (!c.startsWith(typed + " ")) continue;
      const w = c.slice(typed.length + 1).split(" ")[0];
      if (w) next.add(w);
    }
    if (next.size) return pick([...next]);
    // A full command: offer its usual flags.
    return endsSpace ? (FLAGS.get(typed) ?? []).slice(0, 5).map((f) => ({ label: f, value: `${head}${f} ` })) : [];
  }
  const verb = verbOf(tokens);
  const used = new Set(done.filter(isFlag));
  const prev = done[done.length - 1];
  if (partial.startsWith("-") || (endsSpace && !isFlag(prev))) return pick((FLAGS.get(verb) ?? []).filter((f) => !used.has(f)));
  // A value right after a flag: suggest names from the lab.
  if (isFlag(prev)) {
    if (prev === "-g" || prev === "--resource-group") return pick(["rg-lab"]);
    if (/name|^-n$|vm|vnet|nsg|route-table|gateway|source-resource|remote-vnet|virtual-network|address-pool|lb|zone|account|ruleset/.test(prev)) return pick(names(st));
  }
  return [];
}
