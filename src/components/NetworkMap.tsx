"use client";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cidr, usable } from "@/sim/ip";
import { findLink } from "@/sim/network";
import type { State, TraceResult } from "@/sim/types";
import type { FlowResult } from "@/content/flows";

export type Selection =
  | { kind: "vnet"; id: string }
  | { kind: "subnet"; vnet: string; subnet: string }
  | { kind: "host"; id: string }
  | { kind: "peer"; a: string; b: string }
  | { kind: "zone"; id: string }
  | { kind: "service"; id: string };

export const selKey = (s: Selection | null) => {
  if (!s) return "";
  switch (s.kind) {
    case "subnet": return `subnet:${s.vnet}/${s.subnet}`;
    case "peer": return `peer:${[s.a, s.b].sort().join("|")}`;
    default: return `${s.kind}:${s.id}`;
  }
};

interface Props {
  st: State;
  trace: TraceResult | null;
  flows?: FlowResult[];
  changed?: Set<string>;
  selected?: Selection | null;
  onSelect?: (s: Selection) => void;
  tour?: string | null;
  /** Pixels per map unit. Omit to fill the container width. */
  scale?: number;
  /** A packet to animate along the last test or a goal connection. A new key replays it. */
  packet?: Packet | null;
  /** Goal connections that just started working, drawn with a soft glow. */
  celebrate?: Set<number>;
  /** Zoom to the VNets that matter right now: what just changed, else broken goal connections, else the last test. */
  focus?: boolean;
}

export type Packet = { key: number; from: "trace" } | { key: number; from: "flow"; index: number };

/** A dot that travels the path once, then settles into a soft ring: green when it arrives, red where it stops. */
function PacketDot({ d, ok }: { d: string; ok: boolean }) {
  const path = useRef<SVGPathElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const [end, setEnd] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const p = path.current, c = dot.current;
    if (!p) return;
    const len = p.getTotalLength();
    const last = p.getPointAtLength(len);
    if (!c || len < 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setEnd({ x: last.x, y: last.y }); return; }
    const dur = Math.min(2600, Math.max(900, len * 3.2));
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const pt = p.getPointAtLength(len * e);
      c.setAttribute("cx", String(pt.x)); c.setAttribute("cy", String(pt.y));
      if (k < 1) raf = requestAnimationFrame(step); else setEnd({ x: last.x, y: last.y });
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [d]);
  return (
    <g className={`packet ${ok ? "ok" : "bad"}`} aria-hidden="true">
      <path ref={path} d={d} fill="none" stroke="none" />
      {!end && <circle ref={dot} r={5.5} className="packet-dot" />}
      {end && <circle cx={end.x} cy={end.y} r={7} className="packet-burst" />}
    </g>
  );
}

const fit = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
const COL = 300, GAP = 84, PADX = 22, HEAD = 54, SHEAD = 44, TILE = 70;

/* Original diagram icons, drawn in the style of cloud architecture diagrams. */
export function VmIcon({ x, y, nicNsg }: { x: number; y: number; nicNsg: boolean }) {
  return (
    <g className="ic ic-vm" transform={`translate(${x} ${y})`}>
      <rect x={-6} y={4} width={9} height={20} rx={1.5} className="ic-nic" />
      <text x={-1.5} y={11} className="ic-nic-t">N</text><text x={-1.5} y={17.5} className="ic-nic-t">I</text><text x={-1.5} y={24} className="ic-nic-t">C</text>
      <rect x={5} y={2} width={34} height={23} rx={2.5} className="ic-screen" />
      <path d="M15 8 l7 -3.5 l7 3.5 v8 l-7 3.5 l-7 -3.5 Z" className="ic-cube" />
      <path d="M18 25 h8 l2 6 h-12 Z" className="ic-stand" />
      {nicNsg && <path d="M-9 26 l5 -2 l5 2 v4 c0 3 -2.5 5 -5 6 c-2.5 -1 -5 -3 -5 -6 Z" className="ic-shield" />}
    </g>
  );
}
export function NvaIcon({ x, y }: { x: number; y: number }) {
  return (
    <g className="ic ic-nva" transform={`translate(${x} ${y})`}>
      <rect x={2} y={3} width={36} height={27} rx={3} className="ic-fw" />
      <path d="M2 12 h36 M2 21 h36 M14 3 v9 M26 3 v9 M8 12 v9 M20 12 v9 M32 12 v9 M14 21 v9 M26 21 v9" className="ic-fw-line" />
    </g>
  );
}
export function PeIcon({ x, y }: { x: number; y: number }) {
  return (
    <g className="ic ic-pe" transform={`translate(${x} ${y})`}>
      <rect x={4} y={3} width={32} height={27} rx={6} className="ic-pe-bg" />
      <path d="M14 10 l-5 6.5 l5 6.5 M26 10 l5 6.5 l-5 6.5" className="ic-pe-line" />
      <circle cx={20} cy={16.5} r={3} className="ic-pe-dot" />
    </g>
  );
}
/** Small round badge with a short label, for managed services: firewall, DNS, gateway, Bastion. */
export function BadgeIcon({ x, y, text, cls }: { x: number; y: number; text: string; cls: string }) {
  return (
    <g className={`ic ic-badge ${cls}`} transform={`translate(${x} ${y})`}>
      <rect x={4} y={3} width={32} height={27} rx={8} />
      <text x={20} y={21} textAnchor="middle">{text}</text>
    </g>
  );
}
const hostIcon = (kind: string, x: number, y: number, nicNsg: boolean) => {
  switch (kind) {
    case "vm": case "dns": return <VmIcon x={x} y={y} nicNsg={nicNsg} />;
    case "nva": return <NvaIcon x={x} y={y} />;
    case "pe": return <PeIcon x={x} y={y} />;
    case "fw": return <BadgeIcon x={x} y={y} text="FW" cls="b-fw" />;
    case "dnsin": return <BadgeIcon x={x} y={y} text="DNS" cls="b-dns" />;
    case "gw": return <BadgeIcon x={x} y={y} text="VPN" cls="b-gw" />;
    case "lb": return <BadgeIcon x={x} y={y} text="LB" cls="b-lb" />;
    default: return <BadgeIcon x={x} y={y} text="B" cls="b-bastion" />;
  }
};
export const Shield = ({ x, y }: { x: number; y: number }) => <path transform={`translate(${x} ${y})`} d="M0 2 l6 -2.5 l6 2.5 v5 c0 4 -3 6.5 -6 7.5 c-3 -1 -6 -3.5 -6 -7.5 Z" className="ic-shield" />;
export const RouteIc = ({ x, y }: { x: number; y: number }) => <g transform={`translate(${x} ${y})`} className="ic-route"><rect x={0} y={0} width={13} height={13} rx={2.5} /><path d="M3 9 h4 v-5 h3 M8 2 l2 2 l-2 2" /></g>;
export const VnetIc = ({ x, y }: { x: number; y: number }) => (
  <g transform={`translate(${x} ${y})`} className="ic-vnet"><rect x={0} y={0} width={34} height={18} rx={4} /><path d="M8 5 l-4 4 l4 4 M26 5 l4 4 l-4 4" /><circle cx={12.5} cy={9} r={1.6} /><circle cx={17} cy={9} r={1.6} /><circle cx={21.5} cy={9} r={1.6} /></g>
);

/** Whether the last test went along the same path as a goal line already on the map. */
export const traceOverlaps = (trace: TraceResult, flows: FlowResult[]) =>
  flows.some((f) => !!f.trace && !(f.flow.want === "closed" && !f.ok) && f.trace.path.join("|") === trace.path.join("|"));

/** Which kinds of line are on the map right now, so the key only explains what you can see. */
export function linesOnMap(st: State, flows: FlowResult[], trace: TraceResult | null) {
  const drawn = flows.filter((f) => !(f.flow.want === "closed" && !f.ok));
  return {
    goals: drawn.length > 0,
    failing: drawn.some((f) => !f.good),
    // The grey dashed line: a broken connection that's meant to reach somewhere other than where it stops.
    shouldGo: drawn.some((f) => !f.ok && !!(f.target ?? f.expected) && (f.trace?.path.at(-1) ?? f.flow.from) !== (f.target ?? f.expected)),
    privateLink: Object.values(st.publicEndpoints).some((e) => !!st.hosts[`pe-${e.name}`]),
    lastTest: !!trace && trace.path.length > 1 && !traceOverlaps(trace, flows),
    peering: Object.keys(st.peerings).length > 0,
    zones: Object.keys(st.zones).length > 0,
  };
}

/** Which VNet columns hold what the player should look at now, most urgent signal first. */
function focusColumns(st: State, order: string[], changed: Set<string>, flows: FlowResult[], trace: TraceResult | null): number[] {
  const vnetOf = (host: string) => st.hosts[host]?.vnet;
  const cols = (names: (string | undefined)[]) => [...new Set(names.filter((n): n is string => !!n).map((n) => order.indexOf(n)).filter((i) => i >= 0))];
  const fromChanged = cols([...changed].flatMap((k) => {
    const kind = k.slice(0, k.indexOf(":")), rest = k.slice(k.indexOf(":") + 1);
    if (kind === "vnet") return [rest];
    if (kind === "subnet") return [rest.split("/")[0]];
    if (kind === "host") return [vnetOf(rest)];
    if (kind === "peer") return rest.split("|");
    return [];
  }));
  if (fromChanged.length) return fromChanged;
  // A broken goal connection: where its packet stops is where the problem is.
  const fromFlows = cols(flows.filter((f) => !f.good).map((f) => vnetOf((f.trace?.path ?? [f.flow.from]).at(-1) ?? f.flow.from)));
  if (fromFlows.length) return fromFlows;
  return cols((trace?.path ?? []).map(vnetOf));
}

export function NetworkMap({ st, trace, flows = [], changed = new Set(), selected = null, onSelect, tour = null, scale, packet = null, celebrate = new Set(), focus = false }: Props) {
  const sel = selKey(selected);
  const act = (s: Selection) => ({
    role: "button", tabIndex: 0, style: { cursor: "pointer" },
    onClick: (e: { stopPropagation: () => void }) => { e.stopPropagation(); onSelect?.(s); },
    onKeyDown: (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect?.(s); } },
  });
  const cls = (base: string, key: string) => `${base}${changed.has(key) ? " pulse" : ""}${sel === key ? " sel" : ""}`;

  const order0 = st.layout.filter((n) => st.vnets[n]).concat(Object.keys(st.vnets).filter((n) => !st.layout.includes(n)));
  const groups = st.groups ? Object.keys(st.groups) : null;
  const rgOf = (vn: string) => st.vnets[vn]?.rg ?? "rg-lab";
  const order = groups ? groups.flatMap((g) => order0.filter((vn) => rgOf(vn) === g)).concat(order0.filter((vn) => !groups.includes(rgOf(vn)))) : order0;
  const outerKind = groups ? (st.subscriptions?.length ?? 1) > 1 ? "Subscriptions" : "Subscription" : "Resource group";
  const outerName = groups ? (st.subscriptions ?? ["Lab subscription"]).join(", ") : "rg-lab";
  const emptyGroups = groups ? groups.filter((g) => !order.some((vn) => rgOf(vn) === g)) : [];
  if (!order.length) {
    return (
      <svg className="diagram" viewBox="0 0 600 220" style={scale ? { width: 600 * scale, height: 220 * scale } : { maxWidth: 690 }} role="img" aria-label="Empty resource group rg-lab. No virtual networks yet">
        <g className="rg">
          <rect x={6} y={6} width={588} height={208} rx={6} />
          <g transform="translate(16 13)" className="ic-rg"><path d="M2 3 h3 M2 3 v12 M2 15 h3 M15 3 h-3 M15 3 v12 M15 15 h-3" /><path d="M8.5 5.5 l3.5 2 v4 l-3.5 2 l-3.5 -2 v-4 Z" /></g>
          <text x={38} y={26} className="rg-t">{outerKind}</text>
          <text x={groups ? 38 + outerKind.length * 7.4 + 10 : 136} y={26} className="rg-n mono">{outerName}</text>
          {groups && <text x={584} y={26} textAnchor="end" className="rg-n mono">{`Resource groups: ${groups.join(", ")}`}</text>}
        </g>
        <rect x={150} y={56} width={300} height={124} rx={12} className="v-empty" />
        <VnetIc x={283} y={84} />
        <text x={300} y={134} textAnchor="middle" className="empty-map">No virtual networks yet</text>
        <text x={300} y={154} textAnchor="middle" className="empty-map small">Create one and it appears here</text>
      </svg>
    );
  }
  const needArc = Object.values(st.peerings).some((p) => Math.abs(order.indexOf(p.vnet) - order.indexOf(p.remote)) > 1);
  const RG = 34;
  const GROUPED = groups ? 30 : 0;
  const TOP = RG + 12 + GROUPED + (needArc ? 26 : 0);
  const ROW = TILE + (flows.length ? 22 : 8);
  const chips: Record<string, { x: number; y: number; w: number; b: number }> = {};
  const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {};
  const body: ReactNode[] = [];
  let maxH = 0;

  order.forEach((vn, i) => {
    const v = st.vnets[vn];
    const x = PADX + i * (COL + GAP), y = TOP;
    const subs = Object.keys(v.subnets);
    let h = HEAD;
    const layout = subs.map((sn) => {
      const hosts = Object.values(st.hosts).filter((hh) => hh.vnet === vn && hh.subnet === sn);
      const rows = Math.ceil(hosts.length / 3);
      const sh = SHEAD + rows * ROW + (rows ? 0 : 4);
      const o = { sn, hosts, y: y + h, h: sh };
      h += sh + 12;
      return o;
    });
    h += 16 + (subs.length ? 0 : 30);
    maxH = Math.max(maxH, h);
    boxes[vn] = { x, y, w: COL, h };
    body.push(
      <g key={vn}>
        <g {...act({ kind: "vnet", id: vn })} aria-label={`Inspect ${vn}`}>
          <title>{`${vn}: tap to inspect`}</title>
          <rect x={x} y={y} width={COL} height={h} rx={12} className={cls("v-box", `vnet:${vn}`)} />
          <text x={x + 14} y={y + 18} className="v-kind">{v.onprem ? "On-premises network" : "Virtual network"}</text>
          <text x={x + 14} y={y + 36} className="v-title">{fit(vn, 26)}</text>
          <text x={x + COL - 14} y={y + 36} textAnchor="end" className="v-sub mono">{fit(v.prefixes.join(", "), 24)}</text>
          <VnetIc x={x + COL - 50} y={y + h - 9} />
        </g>
        {!subs.length && <text x={x + 14} y={y + HEAD + 18} className="v-sub">No subnets yet</text>}
        {layout.map((o) => {
          const sx = x + 14, sw = COL - 28;
          const s = v.subnets[o.sn];
          const c = cidr(s.prefixes[0])!;
          const key = `subnet:${vn}/${o.sn}`;
          let tx = sx + sw - 6;
          const tags = ([[s.rt, "tag-rt"], [s.nsg, "tag-nsg"]] as const).filter((t) => t[0]).map(([name, tcls]) => {
            const label = fit(name!, 14), w = label.length * 6 + 26;
            tx -= w;
            const el = (
              <g key={tcls} className={`tag ${tcls}`}>
                <rect x={tx} y={o.y + 6} width={w} height={18} rx={9} />
                {tcls === "tag-nsg" ? <Shield x={tx + 5} y={o.y + 8} /> : <RouteIc x={tx + 5} y={o.y + 8.5} />}
                <text x={tx + 21} y={o.y + 19}>{label}</text>
              </g>
            );
            tx -= 4;
            return el;
          });
          return (
            <g key={o.sn}>
              <g {...act({ kind: "subnet", vnet: vn, subnet: o.sn })} aria-label={`Inspect ${o.sn}`}>
                <title>{`${o.sn}: tap to inspect`}</title>
                <rect x={sx} y={o.y} width={sw} height={o.h} rx={3} className={cls("s-box", key)} />
                <text x={sx + 10} y={o.y + 18} className="s-name">{fit(o.sn, tags.length > 1 ? 12 : 20)}</text>
                <text x={sx + 10} y={o.y + 34} className="s-cidr mono">{`${s.prefixes.join(" ")} · ${usable(c)} usable`}</text>
                {tags}
              </g>
              {o.hosts.map((hst, k) => {
                const cw = (sw - 16) / 3, cx = sx + 8 + (k % 3) * cw, cy = o.y + SHEAD + Math.floor(k / 3) * ROW;
                const mid = cx + cw / 2;
                chips[hst.name] = { x: mid, y: cy + 20, w: cw, b: cy + TILE - 2 };
                return (
                  <g key={hst.name} {...act({ kind: "host", id: hst.name })} aria-label={`Inspect ${hst.name}`}>
                    <title>{`${hst.name} ${hst.ip}: tap to inspect`}</title>
                    <rect x={cx + 3} y={cy} width={cw - 6} height={TILE - 2} rx={6} className={cls("h-box", `host:${hst.name}`)} />
                    {hostIcon(hst.kind, mid - 20, cy + 3, !!hst.nicNsg)}
                    <text x={mid} y={cy + 50} textAnchor="middle" className="h-name">{fit(hst.name, 13)}</text>
                    <text x={mid} y={cy + 63} textAnchor="middle" className="h-ip mono">{hst.ip}</text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </g>,
    );
  });

  const W = PADX * 2 + order.length * COL + (order.length - 1) * GAP;
  // One dashed box per resource group around its networks, labeled with the group (and its subscription when there are several).
  const groupEls: ReactNode[] = groups ? groups.flatMap((g) => {
    const cols = order.filter((vn) => rgOf(vn) === g).map((vn) => boxes[vn]).filter(Boolean);
    if (!cols.length) return [];
    const x0 = Math.min(...cols.map((b) => b.x)) - 10, x1 = Math.max(...cols.map((b) => b.x + b.w)) + 10;
    const y0 = RG + 10, y1 = TOP + Math.max(...cols.map((b) => b.h)) + 8;
    const sub = (st.subscriptions?.length ?? 1) > 1 ? ` · ${st.groups![g].sub}` : "";
    return [
      <g key={`rg-${g}`} className="rg-group">
        <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx={8} />
        <text x={x0 + 12} y={y0 + 18} className="rg-t">Resource group</text>
        <text x={x0 + 112} y={y0 + 18} className="rg-n mono">{g + sub}</text>
      </g>,
    ];
  }) : [];
  const lines: ReactNode[] = [];
  const pairs = new Map<string, [string, string]>();
  Object.values(st.peerings).forEach((p) => { if (st.vnets[p.remote]) { const k = [p.vnet, p.remote].sort().join("|"); pairs.set(k, k.split("|") as [string, string]); } });
  let arcs = 0;
  pairs.forEach(([a0, b0], key) => {
    let a = a0, b = b0;
    if (order.indexOf(a) > order.indexOf(b)) [a, b] = [b, a];
    const A = boxes[a], B = boxes[b];
    if (!A || !B) return;
    const la = findLink(st, a, b), lb = findLink(st, b, a);
    const conn = !!la && !!lb, access = conn && la!.allowVnetAccess && lb!.allowVnetAccess;
    const pcls = "peer" + (!conn ? " half" : !access ? " noacc" : "");
    const full = !conn ? `Initiated from ${(la ? a : b).replace("vnet-", "")}` : !access ? "Connected, VNet access off" : "Connected";
    const adjacent = order.indexOf(b) - order.indexOf(a) === 1;
    let d: string, lx: number, ly: number;
    if (adjacent) { const y0 = TOP + 28; d = `M${A.x + A.w} ${y0} L${B.x} ${y0}`; lx = (A.x + A.w + B.x) / 2; ly = y0 - 8; }
    else {
      const top = RG + 6 + (arcs++ % 2) * 10;
      d = `M${A.x + A.w / 2} ${TOP} C${A.x + A.w / 2} ${top} ${B.x + B.w / 2} ${top} ${B.x + B.w / 2} ${TOP}`;
      lx = (A.x + A.w / 2 + B.x + B.w / 2) / 2; ly = top + 12;
    }
    const short = adjacent ? (!conn ? "Initiated" : !access ? "no access" : "peered") : full;
    const tw = short.length * 5.8 + 8;
    const pk = `peer:${key}`;
    lines.push(
      <g key={key} {...act({ kind: "peer", a, b })} aria-label={`Inspect peering ${a} and ${b}`}>
        <title>{`${full}: tap to inspect`}</title>
        <path d={d} className="peer-hit" />
        <path d={d} className={pcls + (changed.has(pk) ? " pulse-line" : "") + (sel === pk ? " sel-line" : "")} />
        {adjacent && <g className="ic-peer" transform={`translate(${lx - 11} ${ly + 1})`}><circle cx={11} cy={7} r={10} /><path d="M5 5 h12 l-3 -3 M17 9 h-12 l3 3" /></g>}
        <rect x={lx - tw / 2} y={ly - 10 - (adjacent ? 6 : 0)} width={tw} height={14} rx={3} className={cls("peer-lbl-bg", pk)} />
        <text x={lx} y={ly - (adjacent ? 6 : 0)} textAnchor="middle" className="peer-lbl">{short}</text>
      </g>,
    );
  });

  // VPN connections from a gateway's VNet to on-premises networks.
  Object.entries(st.gateways ?? {}).forEach(([hub, g]) => g.connections.forEach((o) => {
    const A0 = boxes[hub], B0 = boxes[o];
    if (!A0 || !B0) return;
    const [A, B] = A0.x < B0.x ? [A0, B0] : [B0, A0];
    const adjacent = Math.abs(order.indexOf(hub) - order.indexOf(o)) === 1;
    const y0 = TOP + 52;
    const d = adjacent ? `M${A.x + A.w} ${y0} L${B.x} ${y0}` : `M${A.x + A.w / 2} ${TOP} C${A.x + A.w / 2} ${RG + 2} ${B.x + B.w / 2} ${RG + 2} ${B.x + B.w / 2} ${TOP}`;
    const lx = adjacent ? (A.x + A.w + B.x) / 2 : (A.x + A.w / 2 + B.x + B.w / 2) / 2, ly = adjacent ? y0 - 6 : RG + 14;
    lines.push(
      <g key={`vpn-${hub}-${o}`}>
        <title>{`VPN connection from ${g.name} to ${o}`}</title>
        <path d={d} className="vpn" />
        <rect x={lx - 16} y={ly - 10} width={32} height={14} rx={3} className="peer-lbl-bg" />
        <text x={lx} y={ly} textAnchor="middle" className="peer-lbl">VPN</text>
      </g>,
    );
  }));

  let H = TOP + maxH + 14;
  const zones = Object.keys(st.zones);
  const zoneEls = zones.map((z, zi) => {
    const links = Object.values(st.zones[z].links);
    // Show the A records, so a name can be matched to the host it points at.
    const recs = Object.entries(st.zones[z].records ?? {});
    const recText = recs.length ? ` · ${recs.slice(0, 3).map(([n, ip]) => `${n} → ${ip}`).join(", ")}${recs.length > 3 ? ` +${recs.length - 3}` : ""}` : " · no records";
    const label = `Private DNS zone · ${z} · ${links.length} link${links.length === 1 ? "" : "s"}${recText}`;
    const zw = Math.min(W - 60, label.length * 6.6 + 60), zx = (W - zw) / 2, zy = H + 18 + zi * 48;
    return (
      <g key={z}>
        {links.map((l, k) => { const B = boxes[l.vnet]; if (!B) return null; const bx = B.x + B.w / 2; return <path key={k} d={`M${bx} ${B.y + B.h} L${bx} ${zy}`} className={"zone-link" + (changed.has(`zone:${z}`) ? " pulse-line" : "")} />; })}
        <g className="zone" {...act({ kind: "zone", id: z })} aria-label={`Inspect zone ${z}`}>
          <title>{`${z}: tap to inspect`}</title>
          <rect x={zx} y={zy} width={zw} height={32} rx={6} className={cls("", `zone:${z}`)} />
          <g className="ic-dns" transform={`translate(${zx + 8} ${zy + 4})`}><circle cx={12} cy={12} r={11} /><text x={12} y={15.5} textAnchor="middle">DNS</text></g>
          <text x={zx + 40} y={zy + 20} className="mono">{label}</text>
        </g>
      </g>
    );
  });
  H = H + (zones.length ? 18 + zones.length * 48 : -6) + 10;

  // Storage accounts: Azure services outside your networks, with a public endpoint. A private endpoint links one into a subnet.
  const svcs = Object.entries(st.publicEndpoints);
  const svcAt: Record<string, { x: number; y: number }> = {};
  const linkEls: ReactNode[] = [];
  let svcRows = 0;
  const svcEls = svcs.map(([ip, ep], si) => {
    const access = !ep.publicAccess ? "public access disabled" : ep.defaultAction === "Deny" ? "selected networks only" : "public access on";
    const sub = `${ep.name}.blob.core.windows.net · public IP ${ip} · ${access}`;
    const sw = Math.min(W - 60, Math.max(250, sub.length * 6.2 + 56));
    const per = Math.max(1, Math.floor((W - 40) / (sw + 16)));
    const row = Math.floor(si / per), col = si % per, inRow = Math.min(per, svcs.length - row * per);
    const sx = (W - inRow * sw - (inRow - 1) * 16) / 2 + col * (sw + 16), sy = H + 14 + row * 58;
    svcAt[ip] = { x: sx + sw / 2, y: sy };
    svcRows = Math.max(svcRows, row + 1);
    const key = `service:${ep.name}`;
    const pe = Object.values(st.hosts).find((h) => h.kind === "pe" && h.name === `pe-${ep.name}`);
    const c = pe && chips[pe.name];
    if (c) {
      const d = `M${c.x} ${c.b} C${c.x} ${c.b + 60} ${sx + sw / 2} ${sy - 50} ${sx + sw / 2} ${sy}`;
      linkEls.push(<g key={`pl-${ep.name}`} className="pl-link"><title>{`${pe!.name} is ${ep.name}'s private endpoint (Private Link)`}</title><path d={d} /></g>);
    }
    return (
      <g key={ep.name} className="svc" {...act({ kind: "service", id: ep.name })} aria-label={`Inspect storage account ${ep.name}`}>
        <title>{`Storage account ${ep.name}: tap to inspect`}</title>
        <rect x={sx} y={sy} width={sw} height={44} rx={8} className={cls("svc-box", key) + (ep.publicAccess ? "" : " locked")} />
        <BadgeIcon x={sx + 4} y={sy + 6} text="ST" cls="b-st" />
        <text x={sx + 46} y={sy + 19} className="svc-t">{`Storage account · ${ep.name}`}{pe ? <tspan className="svc-pl">{`  ⇠ Private Link via ${pe.name}`}</tspan> : null}</text>
        <text x={sx + 46} y={sy + 35} className="svc-s mono">{sub}</text>
      </g>
    );
  });
  if (svcRows) H += 14 + svcRows * 58;

  // Live goal flows: always drawn, re-checked after every command.
  const flowEls: ReactNode[] = [];
  const flowMarks: ReactNode[] = [];
  const flowD: Record<number, { d: string; ok: boolean }> = {};
  flows.forEach((fr, fi) => {
    if (fr.flow.want === "closed" && !fr.ok) return; // correctly blocked: nothing to draw
    const off = 6 + (fi % 3) * 5;
    const pts = (fr.trace?.path ?? [fr.flow.from]).map((n) => chips[n]).filter(Boolean).map((p) => ({ x: p.x, y: p.b + off }));
    const t0 = fr.target ? chips[fr.target] : fr.expected ? chips[fr.expected] : null;
    const tgt = t0 ? { x: t0.x, y: t0.b + off } : null;
    const color = fr.good ? "ok" : "bad";
    const d = pts.map((p, k) => `${k ? "L" : "M"}${p.x} ${p.y}`).join(" ");
    if (pts.length) flowD[fi] = { d, ok: fr.ok };
    if (pts.length > 1) flowEls.push(<path key={`f${fi}`} d={d} className={`flow ${color}${celebrate.has(fi) ? " glow" : ""}`} />);
    const end = pts[pts.length - 1];
    // The name resolved to a storage account's public IP: draw the request going there, outside your networks, where it's refused.
    const svcHit = !fr.target && fr.targetIp ? svcAt[fr.targetIp] : undefined;
    if (svcHit && end) {
      flowEls.push(<path key={`s${fi}`} d={`M${end.x} ${end.y} L${svcHit.x} ${svcHit.y}`} className={`flow ${color}`} />);
      const t = `${fr.flow.dns} → ${fr.targetIp} (public)`, w = t.length * 6.2 + 12, lx = (end.x + svcHit.x) / 2, ly = (end.y + svcHit.y) / 2;
      flowMarks.push(<g key={`p${fi}`} className={`flow-name ${color}`}><rect x={lx - w / 2} y={ly - 11} width={w} height={16} rx={8} /><text x={lx} y={ly + 1} textAnchor="middle">{t}</text></g>);
    }
    if (!fr.ok && tgt && end && (Math.abs(tgt.x - end.x) > 1 || Math.abs(tgt.y - end.y) > 1)) {
      flowEls.push(<path key={`g${fi}`} d={`M${end.x} ${end.y} L${tgt.x} ${tgt.y}`} className="flow ghost" />);
      // A name that doesn't lead anywhere yet: label the dashed line with it, so it's clear where it's meant to go.
      if (fr.flow.dns && !fr.target) {
        const want = st.hosts[fr.expected ?? ""]?.ip;
        const lx = (end.x + tgt.x) / 2, ly = (end.y + tgt.y) / 2 + 4, t = svcHit && want ? `should resolve to ${want}` : `${fr.flow.dns}?`, w = t.length * 6.4 + 12;
        flowMarks.push(<g key={`n${fi}`} className="flow-name"><rect x={lx - w / 2} y={ly - 11} width={w} height={16} rx={8} /><text x={lx} y={ly + 1} textAnchor="middle">{t}</text></g>);
      }
    }
    if (!end) return;
    const label = `:${fr.flow.port} ${fr.good ? "✓" : "✗"}`;
    const lw = label.length * 6.4 + 10;
    const mx = pts.length > 1 ? (pts[0].x + pts[1].x) / 2 : end.x + 40, my = end.y + 14;
    flowMarks.push(
      <g key={`m${fi}`} className={`flow-tag ${color}`}>
        <rect x={mx - lw / 2} y={my - 11} width={lw} height={16} rx={8} />
        <text x={mx} y={my + 1} textAnchor="middle">{label}</text>
      </g>,
    );
    if (!fr.ok) {
      const X = svcHit && !fr.ok ? svcHit.x : end.x, Y = svcHit ? svcHit.y : end.y;
      flowMarks.push(<g key={`x${fi}`}><line x1={X - 6} y1={Y - 6} x2={X + 6} y2={Y + 6} className="x-mark" /><line x1={X - 6} y1={Y + 6} x2={X + 6} y2={Y - 6} className="x-mark" /></g>);
    }
  });

  let traceEl: ReactNode = null;
  let traceD = "";
  if (trace?.path.length) {
    const pts = trace.path.map((n) => chips[n]).filter(Boolean);
    traceD = pts.map((p, k) => `${k ? "L" : "M"}${p.x} ${p.b + 4}`).join(" ");
    // A test along the same path as a goal line adds nothing but a second line on top of it, so leave it out.
    if (pts.length > 1 && !traceOverlaps(trace, flows)) traceEl = <path d={traceD} className={`trace ${trace.ok ? "ok" : "bad"}`} />;
  }
  const pk = packet?.from === "trace" ? (traceD && trace ? { d: traceD, ok: trace.ok } : null) : packet ? flowD[packet.index] ?? null : null;
  let VX = 0, VW = W;
  const VH = Math.max(H, TOP + 80);
  const zoomEls: ReactNode[] = [];
  if (focus && order.length > 2) {
    const cols = focusColumns(st, order, changed, flows, trace);
    if (cols.length && cols.length < order.length) {
      const lo = Math.min(...cols), hi = Math.max(...cols);
      VX = boxes[order[lo]].x - PADX;
      VW = boxes[order[hi]].x + COL + PADX - VX;
      const hidden = (n: number, side: string) => n > 0 && zoomEls.push(
        <text key={side} x={side === "l" ? VX + 10 : VX + VW - 10} y={26} textAnchor={side === "l" ? "start" : "end"} className="zoom-more">{side === "l" ? `‹ ${n} more` : `${n} more ›`}</text>,
      );
      hidden(lo, "l");
      hidden(order.length - 1 - hi, "r");
    }
  }

  return (
    <svg className={`diagram${tour ? " tour-" + tour : ""}`} viewBox={`${VX} 0 ${VW} ${VH}`} style={scale ? { width: VW * scale, height: VH * scale } : { width: "100%", maxWidth: W * 1.15, minWidth: Math.min(W, Math.max(560, W * 0.68)) }} role="group" aria-label="Map of virtual networks, subnets and hosts in this lab. Tap anything to inspect it.">
      <g className="rg">
        <rect x={6} y={6} width={VW - 12} height={VH - 12} rx={6} />
        <g transform="translate(16 13)" className="ic-rg"><path d="M2 3 h3 M2 3 v12 M2 15 h3 M15 3 h-3 M15 3 v12 M15 15 h-3" /><path d="M8.5 5.5 l3.5 2 v4 l-3.5 2 l-3.5 -2 v-4 Z" /></g>
        <text x={38} y={26} className="rg-t">{outerKind}</text>
        <text x={groups ? 38 + outerKind.length * 7.4 + 10 : 136} y={26} className="rg-n mono">{outerName}</text>
        {emptyGroups.length > 0 && <text x={VX + VW - 16} y={26} textAnchor="end" className="rg-n mono">{`Empty groups: ${emptyGroups.join(", ")}`}</text>}
      </g>
      {groupEls}
      {body}
      {lines}
      {linkEls}
      {zoneEls}
      {svcEls}
      {flowEls}
      {traceEl}
      {flowMarks}
      {pk && packet && <PacketDot key={packet.key} d={pk.d} ok={pk.ok} />}
      {zoomEls}
    </svg>
  );
}
