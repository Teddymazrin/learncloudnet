import { connect, resolveFrom, type TraceStep } from "@/sim/network";
import type { State, TraceResult } from "@/sim/types";
import type { Flow } from "./types";

export interface FlowResult {
  flow: Flow;
  ok: boolean;
  /** ok matches what the level wants. */
  good: boolean;
  targetIp: string | null;
  target: string | null;
  /** Where the connection is meant to go, for drawing, even before a name resolves. */
  expected: string | null;
  trace: TraceResult | null;
  status: string;
}

const STAGE: Record<string, string> = {
  nsg: "blocked by a network security group",
  route: "dropped by routing",
  peering: "stopped at a peering",
  host: "nothing answers at that address",
  port: "reached the host, but nothing listens on that port",
  public: "resolved to a public IP and was rejected",
  return: "request arrived, but the reply was lost",
  firewall: "denied by the firewall",
  probe: "every backend failed its health probe",
  guest: "reached the VM, but its own firewall drops it",
};

export function evalFlow(st: State, f: Flow): FlowResult {
  const src = st.hosts[f.from];
  let ip: string | null = null;
  let note = "";
  if (f.to) ip = st.hosts[f.to]?.ip ?? null;
  else if (f.dns && src) {
    const r = resolveFrom(st, f.from, f.dns);
    if (r.timeout) note = "DNS query timed out";
    else if (r.nx) note = "name doesn't resolve";
    else { ip = r.ip!; note = r.public ? `resolves to public IP ${ip}` : `resolves to ${ip}`; }
  }
  const target = f.to ?? (ip ? Object.values(st.hosts).find((h) => h.ip === ip)?.name ?? null : null);
  const expected = f.to ?? f.expect ?? target;
  if (!src || !ip) return { flow: f, ok: false, good: f.want === "closed", targetIp: ip, target, expected, trace: null, status: note || "no target" };
  const trace = connect(st, f.from, ip, f.port);
  const good = f.want === "open" ? trace.ok : !trace.ok;
  let status: string;
  if (trace.ok) status = f.want === "open" ? "working" : "open, but it should be blocked";
  else status = f.want === "closed" ? "blocked, as it should be" : STAGE[trace.stage ?? ""] ?? "failing";
  if (note && f.dns) status = `${note}, ${status}`;
  return { flow: f, ok: trace.ok, good, targetIp: ip, target, expected, trace, status };
}

export const flowName = (f: Flow) => `${f.from} → ${f.to ?? f.dns}:${f.port}`;

/** Walk the packet step by step, for the Explain button. */
export function explainSteps(st: State, f: FlowResult): TraceStep[] {
  const steps: TraceStep[] = [];
  const src = st.hosts[f.flow.from];
  if (f.flow.dns) {
    const r = resolveFrom(st, f.flow.from, f.flow.dns);
    steps.push(...r.steps);
    if (r.nx) { if (!r.steps.some((x) => !x.ok)) steps.push({ ok: false, text: `DNS: ${f.flow.dns} doesn't resolve from ${src.vnet}.` }); return steps; }
  }
  if (!f.targetIp) return steps;
  connect(st, f.flow.from, f.targetIp, f.flow.port, steps);
  if (f.trace?.ok) steps.push({ ok: true, text: "Session complete in both directions." });
  return steps;
}

