// Small helpers for writing level setups and objectives.
import { emptyState, type HostKind, type NsgRule, type State } from "@/sim/types";
import { reach } from "@/sim/network";
import type { Objective, ObjectiveCtx } from "./types";

export const base = emptyState;

export function vnet(st: State, name: string, prefixes: string[], subnets: Record<string, { p: string; nsg?: string; rt?: string }> = {}) {
  st.vnets[name] = { prefixes, subnets: {} };
  for (const [s, d] of Object.entries(subnets)) st.vnets[name].subnets[s] = { prefixes: [d.p], nsg: d.nsg ?? null, rt: d.rt ?? null };
  st.layout.push(name);
}

export function host(st: State, name: string, vnetName: string, subnet: string, ip: string, o: { kind?: HostKind; nicNsg?: string; ports?: number[]; forwarding?: boolean; label?: string } = {}) {
  st.hosts[name] = { name, kind: o.kind ?? "vm", vnet: vnetName, subnet, ip, nic: `${name}-nic`, nicNsg: o.nicNsg ?? null, ports: o.ports ?? [22], forwarding: !!o.forwarding, label: o.label };
}

const short = (v: string) => v.replace(/^vnet-/, "");
export function peer(st: State, a: string, b: string, o: { access?: boolean; fwd?: boolean } = {}) {
  const name = `${short(a)}-to-${short(b)}`;
  st.peerings[`${a}/${name}`] = { name, vnet: a, remote: b, allowVnetAccess: o.access !== false, allowForwarded: !!o.fwd };
}

export function rule(st: State, nsg: string, r: Omit<NsgRule, "def">) {
  (st.nsgs[nsg] ??= { rules: [] }).rules.push(r);
}

export const sub = (st: State, v: string, s: string) => st.vnets[v]?.subnets[s];
export const can = (st: State, from: string, ip: string, port: number) => reach(st, from, ip, port).ok;

/** True when the learner ran a successful command starting with this text. */
export const ran = (ctx: ObjectiveCtx, prefix: string, inVm: string | null = null) =>
  ctx.session.log.some((e) => e.ok && e.inVm === inVm && (e.canon ?? e.raw).toLowerCase().replace(/\s+/g, " ").startsWith(prefix.toLowerCase()));

const norm = (s: string) => s.toLowerCase().replace(/[\s,_"'.]/g, "");

/** A question objective answered with `answer <n> <value>`. */
export function ask(n: number, question: string, accept: string[]): Objective {
  return {
    text: `Q${n}. ${question}`,
    question,
    test: (ctx) => {
      const a = ctx.session.answers[String(n)];
      return a !== undefined && accept.some((x) => norm(x) === norm(a));
    },
  };
}

export const did = (text: string, prefix: string, inVm: string | null = null): Objective => ({ text, action: true, test: (ctx) => ran(ctx, prefix, inVm) });

// ---------- Helpers for Advanced and Expert labs ----------
import type { FwCollection } from "@/sim/types";
import { resolveFrom } from "@/sim/network";

/** An on-premises site, drawn like a VNet and reached only through a VPN gateway. */
export function onprem(st: State, name: string, prefixes: string[], subnets: Record<string, { p: string }>) {
  vnet(st, name, prefixes, subnets);
  st.vnets[name].onprem = true;
}
/** A VPN gateway in the hub's GatewaySubnet, connected to on-premises sites. */
export function gateway(st: State, hubVnet: string, name: string, ip: string, sites: string[]) {
  host(st, name, hubVnet, "GatewaySubnet", ip, { kind: "gw", ports: [], label: "VPN gateway" });
  (st.gateways ??= {})[hubVnet] = { name, host: name, connections: sites };
}
/** A storage account's blob endpoint: public DNS, public IP and its network settings. */
export function storage(st: State, name: string, publicIp: string, o: { publicAccess?: boolean; defaultAction?: "Allow" | "Deny"; rules?: { vnet: string; subnet: string }[]; privatelink?: boolean } = {}) {
  const fqdn = `${name}.blob.core.windows.net`;
  if (o.privatelink) { st.publicDns.cname[fqdn] = `${name}.privatelink.blob.core.windows.net`; st.publicDns.a[`${name}.privatelink.blob.core.windows.net`] = publicIp; }
  else st.publicDns.a[fqdn] = publicIp;
  st.publicEndpoints[publicIp] = { name, publicAccess: o.publicAccess !== false, defaultAction: o.defaultAction ?? "Allow", vnetRules: o.rules ?? [] };
}
/** Azure Firewall in AzureFirewallSubnet, with network rule collections. */
export function azfw(st: State, name: string, vnetName: string, ip: string, rules: FwCollection[]) {
  host(st, name, vnetName, "AzureFirewallSubnet", ip, { kind: "fw", ports: [], forwarding: true, label: "Azure Firewall" });
  st.hosts[name].fwRules = rules;
}
/** A DNS server VM with conditional forwarders and its default for everything else. */
export function dnsVm(st: State, name: string, vnetName: string, subnet: string, ip: string, o: { forwarders?: Record<string, string>; fallback?: "public" | "azure"; zones?: Record<string, Record<string, string>> } = {}) {
  host(st, name, vnetName, subnet, ip, { kind: "dns", ports: [22, 53], label: "DNS server" });
  Object.assign(st.hosts[name], { dnsForwarders: o.forwarders ?? {}, dnsDefault: o.fallback ?? "public", dnsZones: o.zones ?? {} });
}
/** Azure DNS Private Resolver with an inbound endpoint (drawn as a host) and optionally an outbound endpoint and ruleset. */
export function resolver(st: State, name: string, vnetName: string, inbound: { subnet: string; ip: string }, outbound?: { subnet: string; ruleset: string; rules?: Record<string, { domain: string; targets: string[] }>; links?: Record<string, string> }) {
  const h = `${name}-in`;
  host(st, h, vnetName, inbound.subnet, inbound.ip, { kind: "dnsin", ports: [53], label: "Inbound endpoint" });
  (st.resolvers ??= {})[name] = { vnet: vnetName, inbound: { "in-endpoint": { subnet: inbound.subnet, host: h } }, outbound: outbound ? { "out-endpoint": { subnet: outbound.subnet } } : {} };
  if (outbound) {
    const rules = Object.fromEntries(Object.entries(outbound.rules ?? {}).map(([n, r]) => [n, { ...r, enabled: true }]));
    (st.rulesets ??= {})[outbound.ruleset] = { resolver: name, rules, links: outbound.links ?? {} };
  }
}
/** Name resolution exactly as a VM would see it, for objectives. */
export const looksUp = (st: State, from: string, name: string) => resolveFrom(st, from, name).ip ?? null;

/** A site on the public internet, with a public DNS name. */
export function site(st: State, name: string, ip: string) {
  (st.internet ??= {})[ip] = { name };
  st.publicDns.a[name] = ip;
}
/** A Linux VM with services and, optionally, UFW turned on with allow rules. SSH and running services listen; stopped ones don't. */
export function linuxVm(st: State, name: string, vnetName: string, subnet: string, ip: string, o: { services: Record<string, number>; stopped?: string[]; ufw?: [number, string][]; nicNsg?: string }) {
  const running = Object.entries(o.services).filter(([s]) => !o.stopped?.includes(s)).map(([, p]) => p);
  host(st, name, vnetName, subnet, ip, { ports: [22, ...running], nicNsg: o.nicNsg });
  st.hosts[name].services = { ...o.services };
  if (o.ufw) st.hosts[name].guestFw = { active: true, rules: o.ufw.map(([port, from]) => ({ port, from, action: "ALLOW" as const })) };
}
/** UFW is still on: Learn says not to disable the guest firewall as a fix. */
export const ufwOn = (st: State, vm: string) => !!st.hosts[vm]?.guestFw?.active;
/** Everything Azure's network tools can change. Equal snapshots mean nobody touched the network. */
export const netSnapshot = (st: State) => JSON.stringify([st.vnets, st.nsgs, st.rts, st.peerings, st.zones, st.natGateways ?? null, st.lbs ?? null, Object.values(st.hosts).map((h) => [h.nicNsg, h.forwarding, h.publicIp ?? null])]);

/** An internal load balancer: a frontend IP drawn as a host, a TCP probe, one rule, and its backends. */
export function lb(st: State, name: string, vnetName: string, subnet: string, ip: string, o: { probePort: number; port: number; backendPort?: number; backends: string[] }) {
  host(st, `${name}-fe`, vnetName, subnet, ip, { kind: "lb", ports: [o.port], label: "Load balancer" });
  (st.lbs ??= {})[name] = { host: `${name}-fe`, probe: { name: "probe-app", protocol: "Tcp", port: o.probePort }, rule: { name: "rule-app", frontendPort: o.port, backendPort: o.backendPort ?? o.port }, backends: o.backends };
}
