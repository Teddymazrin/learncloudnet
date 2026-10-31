// Fingerprints of each thing on the map, so the UI can pulse what a command changed.
import type { State } from "@/sim/types";

export function signatures(st: State): Map<string, string> {
  const m = new Map<string, string>();
  const j = (x: unknown) => JSON.stringify(x);
  for (const [vn, v] of Object.entries(st.vnets)) {
    m.set(`vnet:${vn}`, j([v.prefixes, v.dnsServers ?? []]));
    for (const [sn, s] of Object.entries(v.subnets)) {
      m.set(`subnet:${vn}/${sn}`, j([s, s.nsg ? st.nsgs[s.nsg]?.rules : null, s.rt ? st.rts[s.rt]?.routes : null]));
    }
  }
  for (const h of Object.values(st.hosts)) m.set(`host:${h.name}`, j([h.ip, h.nicNsg, h.nicNsg ? st.nsgs[h.nicNsg]?.rules : null, h.forwarding, h.fwRules ?? null, h.guestFw ?? null, h.ports]));
  for (const p of Object.values(st.peerings)) {
    const key = `peer:${[p.vnet, p.remote].sort().join("|")}`;
    m.set(key, (m.get(key) ?? "") + j(p));
  }
  for (const [z, d] of Object.entries(st.zones)) m.set(`zone:${z}`, j(d));
  return m;
}

/** A short, readable name for a changed map key, like "subnet-web" or "vnet-hub ⇄ vnet-spoke1". */
export function changeLabel(key: string): string {
  const kind = key.slice(0, key.indexOf(":")), rest = key.slice(key.indexOf(":") + 1);
  if (kind === "subnet") return rest.split("/")[1];
  if (kind === "peer") return rest.split("|").join(" ⇄ ");
  return rest;
}

export function changedKeys(before: Map<string, string>, after: Map<string, string>): Set<string> {
  const out = new Set<string>();
  after.forEach((v, k) => { if (before.get(k) !== v) out.add(k); });
  return out;
}
