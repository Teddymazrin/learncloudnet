// How packets move: routes, NSGs, peering, DNS. Behavior follows Microsoft Learn,
// and each level links the pages behind the rules it uses.
import { cidr, mustCidr, inC, ip2n, isPrivate, type Cidr } from "./ip";
import type { Direction, Host, HopType, NsgRule, Peering, PublicService, State, TraceResult } from "./types";

// ---------- Peering ----------
export const peeringsOf = (st: State, vnet: string): Peering[] => Object.values(st.peerings).filter((p) => p.vnet === vnet);
export const findLink = (st: State, from: string, to: string): Peering | null => peeringsOf(st, from).find((p) => p.remote === to) ?? null;
export function peeringState(st: State, p: Peering): "Initiated" | "Connected" | "Disconnected" {
  // Deleting one link of a Connected peering leaves the other Disconnected, not Initiated.
  if (!st.vnets[p.remote] || p.disconnected) return "Disconnected";
  return findLink(st, p.remote, p.vnet) ? "Connected" : "Initiated";
}
export const connectedPeers = (st: State, vnet: string) => peeringsOf(st, vnet).filter((p) => peeringState(st, p) === "Connected").map((p) => p.remote);

// ---------- Routes ----------
export const HOP_LABEL: Record<HopType, string> = {
  VnetLocal: "Virtual network", VNetPeering: "Virtual network peering", Internet: "Internet", None: "None",
  VirtualAppliance: "Virtual appliance", VirtualNetworkGateway: "Virtual network gateway", VirtualNetworkServiceEndpoint: "VirtualNetworkServiceEndpoint",
};
export const HOP_WATCHER: Record<HopType, string> = {
  VnetLocal: "VirtualNetwork", VNetPeering: "VirtualNetworkPeering", Internet: "Internet", None: "None",
  VirtualAppliance: "VirtualAppliance", VirtualNetworkGateway: "VirtualNetworkGateway", VirtualNetworkServiceEndpoint: "VirtualNetworkServiceEndpoint",
};

export interface EffRoute {
  source: "Default" | "User" | "VirtualNetworkGateway";
  state: "Active" | "Invalid";
  prefix: string;
  c: Cidr;
  type: HopType;
  nhIp?: string;
  name?: string;
  rt?: string;
  remote?: string;
}

/** The remote address space a peering link routes to: what it last synced, or the live space. */
export const linkPrefixes = (st: State, p: Peering) => p.remotePrefixes ?? st.vnets[p.remote]?.prefixes ?? [];

/** VNets whose traffic can use the VPN gateway in hub: the hub itself, plus spokes using its gateway over peering. */
export function gatewayUsers(st: State, hub: string): string[] {
  const out = [hub];
  peeringsOf(st, hub).forEach((h2s) => {
    const s2h = findLink(st, h2s.remote, hub);
    if (s2h && h2s.allowGatewayTransit && s2h.useRemoteGateways) out.push(h2s.remote);
  });
  return out;
}
/** The hub whose gateway this VNet uses, if any. */
export function gatewayFor(st: State, vnet: string): string | null {
  const gws = st.gateways ?? {};
  if (gws[vnet]) return vnet;
  for (const hub of Object.keys(gws)) if (gatewayUsers(st, hub).includes(vnet)) return hub;
  return null;
}

export function effectiveRoutes(st: State, vnetName: string, subnetName: string): EffRoute[] {
  const v = st.vnets[vnetName];
  const sn = v.subnets[subnetName];
  const sys: Omit<EffRoute, "c" | "state">[] = [];
  v.prefixes.forEach((p) => sys.push({ source: "Default", prefix: p, type: "VnetLocal" }));
  peeringsOf(st, vnetName).forEach((p) => {
    if (peeringState(st, p) !== "Connected") return;
    linkPrefixes(st, p).forEach((rp) => sys.push({ source: "Default", prefix: rp, type: "VNetPeering", remote: p.remote }));
  });
  // Routes learned from a VPN gateway: on-premises prefixes in Azure, Azure prefixes on-premises.
  const gws = st.gateways ?? {};
  if (v.onprem) {
    for (const [hub, g] of Object.entries(gws)) {
      if (!g.connections.includes(vnetName)) continue;
      gatewayUsers(st, hub).forEach((u) => st.vnets[u].prefixes.forEach((p) => sys.push({ source: "VirtualNetworkGateway", prefix: p, type: "VirtualNetworkGateway", remote: hub })));
    }
  } else {
    const hub = gatewayFor(st, vnetName);
    if (hub) gws[hub].connections.forEach((o) => st.vnets[o]?.prefixes.forEach((p) => sys.push({ source: "VirtualNetworkGateway", prefix: p, type: "VirtualNetworkGateway", remote: o })));
  }
  // A service endpoint adds routes to the service's public addresses.
  if (sn.serviceEndpoints?.some((e) => /^Microsoft\.Storage/i.test(e))) {
    Object.keys(st.publicEndpoints).forEach((ip) => sys.push({ source: "Default", prefix: `${ip}/32`, type: "VirtualNetworkServiceEndpoint" }));
  }
  sys.push({ source: "Default", prefix: "0.0.0.0/0", type: "Internet" });
  ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10"].forEach((p) => sys.push({ source: "Default", prefix: p, type: "None" }));
  const user: Omit<EffRoute, "c" | "state">[] = [];
  if (sn.rt && st.rts[sn.rt]) {
    st.rts[sn.rt].routes.forEach((r) => user.push({ source: "User", prefix: r.prefix, type: r.type, nhIp: r.nhIp, name: r.name, rt: sn.rt! }));
  }
  return [...sys, ...user].map((r) => ({
    ...r,
    c: mustCidr(r.prefix),
    // A user-defined route with the same prefix as a system route takes precedence, except over service endpoint routes.
    state: r.source !== "User" && r.type !== "VirtualNetworkServiceEndpoint" && user.some((u) => u.prefix === r.prefix) ? "Invalid" : "Active",
  }));
}

/** Longest prefix match; on a tie a user-defined route beats a system route. */
export function lookup(routes: EffRoute[], ipn: number): EffRoute | null {
  let best: EffRoute | null = null;
  for (const r of routes) {
    if (r.state !== "Active" || !inC(r.c, ipn)) continue;
    // Service endpoint routes override user-defined routes for the service's addresses.
    if (best?.type === "VirtualNetworkServiceEndpoint") break;
    if (r.type === "VirtualNetworkServiceEndpoint") { best = r; continue; }
    if (!best || r.c.len > best.c.len || (r.c.len === best.c.len && r.source === "User" && best.source !== "User")) best = r;
  }
  return best;
}

// ---------- NSGs ----------
const D = (name: string, priority: number, access: "Allow" | "Deny", src: string[], dst: string[]): NsgRule =>
  ({ name, priority, access, protocol: "*", src, dst, ports: ["*"], direction: "Inbound", def: true });
export const DEFAULT_RULES: Record<Direction, NsgRule[]> = {
  Inbound: [
    D("AllowVnetInBound", 65000, "Allow", ["VirtualNetwork"], ["VirtualNetwork"]),
    D("AllowAzureLoadBalancerInBound", 65001, "Allow", ["AzureLoadBalancer"], ["*"]),
    D("DenyAllInBound", 65500, "Deny", ["*"], ["*"]),
  ],
  Outbound: [
    D("AllowVnetOutBound", 65000, "Allow", ["VirtualNetwork"], ["VirtualNetwork"]),
    D("AllowInternetOutBound", 65001, "Allow", ["*"], ["Internet"]),
    D("DenyAllOutBound", 65500, "Deny", ["*"], ["*"]),
  ].map((r) => ({ ...r, direction: "Outbound" as const })),
};

/** VirtualNetwork service tag: own address space, peered VNets, and prefixes used on UDRs. */
export function vnetTag(st: State, vnetName: string): Cidr[] {
  let list = [...st.vnets[vnetName].prefixes];
  connectedPeers(st, vnetName).forEach((r) => (list = list.concat(st.vnets[r].prefixes)));
  // Connected on-premises address spaces count too.
  const hub = gatewayFor(st, vnetName);
  if (hub) st.gateways![hub].connections.forEach((o) => (list = list.concat(st.vnets[o]?.prefixes ?? [])));
  Object.values(st.vnets[vnetName].subnets).forEach((s) => {
    if (s.rt && st.rts[s.rt]) st.rts[s.rt].routes.forEach((r) => list.push(r.prefix));
  });
  return list.map((p) => cidr(p)).filter((c): c is Cidr => !!c);
}

function addrMatch(vals: string[], ipn: number, tag: Cidr[], storage: number[] = []): boolean {
  return vals.some((v) => {
    const lv = v.toLowerCase();
    if (lv === "*" || lv === "any") return true;
    if (lv === "virtualnetwork") return tag.some((c) => inC(c, ipn));
    if (lv === "internet") return !isPrivate(ipn) && !tag.some((c) => inC(c, ipn));
    // Load balancer health probes come from 168.63.129.16.
    if (lv === "azureloadbalancer") return ipn === ip2n(AZURE_DNS);
    // The Storage tag covers Azure Storage's public addresses: here, the lab's storage accounts.
    if (lv === "storage") return storage.includes(ipn);
    const c = cidr(v);
    return c ? inC(c, ipn) : false;
  });
}
function portMatch(vals: string[], port: number): boolean {
  return vals.some((v) => {
    if (v === "*") return true;
    const m = v.match(/^(\d+)-(\d+)$/);
    if (m) return port >= Number(m[1]) && port <= Number(m[2]);
    return Number(v) === port;
  });
}
const protoMatch = (rp: string, p: string) => rp === "*" || rp.toLowerCase() === p.toLowerCase();

export function nsgRules(st: State, nsgName: string, dir: Direction): NsgRule[] {
  const custom = (st.nsgs[nsgName]?.rules ?? []).filter((r) => r.direction === dir);
  return [...custom].sort((a, b) => a.priority - b.priority).concat(DEFAULT_RULES[dir]);
}

export interface NsgVerdict { access: "Allow" | "Deny"; rule: string; priority: number; def: boolean; nsg: string; missed?: string[]; skipped?: { rule: string; why: string }[] }

export function evalNsg(st: State, nsgName: string, dir: Direction, pkt: Packet, tagVnet: string): NsgVerdict {
  const tag = vnetTag(st, tagVnet);
  const sto = Object.keys(st.publicEndpoints).map((ip) => ip2n(ip)!);
  const s = ip2n(pkt.src)!, d = ip2n(pkt.dst)!;
  // Your rules that were checked first and fit the port and protocol, but not the addresses: the usual reason an allow "should have" worked.
  const missed: string[] = [];
  const skipped: { rule: string; why: string }[] = [];
  for (const r of nsgRules(st, nsgName, dir)) {
    const fits = protoMatch(r.protocol, pkt.proto) && portMatch(r.ports, pkt.port);
    const srcOk = addrMatch(r.src, s, tag, sto), dstOk = addrMatch(r.dst, d, tag, sto);
    if (fits && srcOk && dstOk) return { access: r.access, rule: r.name, priority: r.priority, def: !!r.def, nsg: nsgName, missed, skipped };
    if (fits && !r.def) skipped.push({ rule: r.name, why: srcOk ? `destination doesn't include ${pkt.dst}` : `source doesn't include ${pkt.src}` });
    if (fits && !r.def) missed.push(`${r.name} (priority ${r.priority}) is checked first but doesn't match: its ${srcOk ? `destination is ${r.dst.join(", ")}, which doesn't include ${pkt.dst}` : `source is ${r.src.join(", ")}, which doesn't include ${pkt.src}`}.`);
  }
  return { access: "Deny", rule: "none", priority: 0, def: false, nsg: nsgName };
}

export interface Packet { src: string; dst: string; port: number; proto: string }

// ---------- Hosts ----------
export const hostByIp = (st: State, vnet: string, ip: string): Host | null =>
  Object.values(st.hosts).find((h) => h.vnet === vnet && h.ip === ip) ?? null;
export const vnetOfIp = (st: State, ipn: number): string | null =>
  Object.keys(st.vnets).find((n) => st.vnets[n].prefixes.some((p) => inC(mustCidr(p), ipn))) ?? null;
export const subnetNsg = (st: State, h: Host) => st.vnets[h.vnet].subnets[h.subnet].nsg;

// ---------- Azure Firewall ----------
const fwAddr = (vals: string[], ip: string) => vals.some((v) => v === "*" || (cidr(v.includes("/") ? v : `${v}/32`) ? inC(cidr(v.includes("/") ? v : `${v}/32`)!, ip2n(ip)!) : false));
/** Network rule collections by priority; first match wins; nothing matched means deny. */
export function fwDecide(fw: Host, pkt: Packet): { allow: boolean; text: string; missed: string[] } {
  // Rules that fit the port and protocol but not the addresses: why an allow "should have" matched and didn't.
  const missed: string[] = [];
  for (const c of [...(fw.fwRules ?? [])].sort((a, b) => a.priority - b.priority)) {
    for (const r of c.rules) {
      const proto = r.protocols.some((p) => /^any$/i.test(p) || p.toLowerCase() === pkt.proto.toLowerCase());
      const fits = proto && portMatch(r.ports, pkt.port), srcOk = fwAddr(r.src, pkt.src), dstOk = fwAddr(r.dst, pkt.dst);
      if (fits && !(srcOk && dstOk)) missed.push(`Rule ${r.name} in ${c.name} (priority ${c.priority}) is checked but doesn't match: its ${srcOk ? `destination is ${r.dst.join(", ")}, which doesn't include ${pkt.dst}` : `source is ${r.src.join(", ")}, which doesn't include ${pkt.src}`}.`);
      if (fits && srcOk && dstOk) {
        return { missed, allow: c.action === "Allow", text: `Azure Firewall ${fw.name}: rule ${r.name} in collection ${c.name} (priority ${c.priority}, ${c.action}) matches, so it ${c.action === "Allow" ? "allows" : "denies"} it. First match wins.` };
      }
    }
  }
  return { missed, allow: false, text: `Azure Firewall ${fw.name}: no network rule matches ${pkt.src} to ${pkt.dst}:${pkt.port}, and Azure Firewall denies all traffic that no rule allows.` };
}

// ---------- Trace ----------
export interface TraceStep { ok: boolean; text: string }
interface TraceOpts { skipNsg?: boolean; skipPort?: boolean; log?: TraceStep[] }

// ---------- Guest OS firewall (UFW) ----------
const fromMatch = (from: string, ip: string) => /^any(where)?$/i.test(from) || (cidr(from.includes("/") ? from : `${from}/32`) ? inC(cidr(from.includes("/") ? from : `${from}/32`)!, ip2n(ip)!) : false);
/** UFW processes rules in order and stops at the first match. When it's active, a port no rule allows is denied. */
export function guestAllows(h: Host, src: string, port: number): { allow: boolean; text: string } {
  const fw = h.guestFw;
  if (!fw?.active) return { allow: true, text: `The guest OS firewall on ${h.name} is inactive, so it blocks nothing.` };
  const i = fw.rules.findIndex((r) => r.port === port && fromMatch(r.from, src));
  if (i < 0) return { allow: false, text: `The guest OS firewall (UFW) on ${h.name} is active and no rule allows port ${port} from ${src}, so it denies it by default. NSG tools can't see this: it's inside the VM.` };
  const r = fw.rules[i];
  return { allow: r.action === "ALLOW", text: `The guest OS firewall (UFW) on ${h.name}: rule ${i + 1} (${r.port}/tcp ${r.action} from ${r.from}) matches first, so it ${r.action === "ALLOW" ? "allows" : "denies"} it.` };
}

/** A backend is healthy when its NSGs and its own firewall let the probe in from 168.63.129.16, and something listens on the probe port. */
export function probeOk(st: State, lb: { probe: { port: number } }, backend: string): boolean {
  const h = st.hosts[backend];
  if (!h || !h.ports.includes(lb.probe.port)) return false;
  const pkt: Packet = { src: AZURE_DNS, dst: h.ip, port: lb.probe.port, proto: "Tcp" };
  return [subnetNsg(st, h), h.nicNsg].every((n) => !n || evalNsg(st, n, "Inbound", pkt, h.vnet).access === "Allow") && guestAllows(h, AZURE_DNS, lb.probe.port).allow;
}

export function trace(st: State, srcName: string, dstIp: string, port: number, proto = "Tcp", opts: TraceOpts = {}): TraceResult {
  const src = st.hosts[srcName];
  const path = [src.name];
  const via: string[] = [];
  const pkt: Packet = { src: src.ip, dst: dstIp, port, proto };
  const dn = ip2n(dstIp);
  const log = (ok: boolean, text: string) => opts.log?.push({ ok, text });
  const fail = (reason: string, stage?: TraceResult["stage"]): TraceResult => { log(false, reason); return { ok: false, reason, path, via, stage }; };
  // Leaving for the internet: NAT gateway first, then the NIC's own public IP, then default outbound access unless the subnet is private.
  const internetSite = (name: string, vn: string, sn: string): TraceResult => {
    const subnet = st.vnets[vn].subnets[sn];
    const nat = subnet.natGateway ? st.natGateways?.[subnet.natGateway] : null;
    const natIp = nat ? st.publicIps?.[nat.pips[0]]?.ip : null;
    let egress: string;
    if (nat && natIp) egress = `the NAT gateway ${subnet.natGateway}, so the site sees ${natIp}`;
    else if (vn === src.vnet && sn === src.subnet && src.publicIp) egress = `${src.name}'s own public IP ${src.publicIp}`;
    else if (subnet.defaultOutbound === false) return fail(`${sn} is a private subnet with no explicit outbound method: no NAT gateway, no public IP on the NIC, no route to an appliance. Default outbound access is off, so it can't reach ${name}.`, "route");
    else egress = "default outbound access, an IP Microsoft owns and can change";
    log(true, `Traffic to ${name} leaves Azure through ${egress}.`);
    return { ok: true, path, via, service: name, egress };
  };
  // A PaaS public endpoint, like a storage account, decides by its own network settings.
  const publicService = (ep: PublicService, viaEndpoint: boolean): TraceResult => {
    if (!ep.publicAccess) return fail(`Reached the public endpoint of ${ep.name}, which has public network access disabled, so the service rejects it.`, "public");
    if (ep.defaultAction === "Deny") {
      const ruled = (ep.vnetRules ?? []).some((x) => x.vnet === src.vnet && x.subnet === src.subnet);
      if (!viaEndpoint || !ruled) return fail(`Reached the public endpoint of ${ep.name}, but its firewall denies by default and ${!viaEndpoint ? `the request didn't come through a service endpoint, so it arrives from an address no rule allows` : `has no virtual network rule for ${src.vnet}/${src.subnet}`}. The service answers 403 AuthorizationFailure.`, "public");
      log(true, `${ep.name} has a virtual network rule for ${src.vnet}/${src.subnet}, and the request came through the service endpoint, so it's allowed.`);
    } else log(true, `${ep.name} accepts requests on its public endpoint.`);
    return { ok: true, path, via, service: ep.name };
  };
  if (dn === null) return fail(`not an IPv4 address: ${dstIp}`);

  // Outbound: NIC NSG first, then the subnet NSG.
  if (!opts.skipNsg) {
    for (const nsg of [src.nicNsg, subnetNsg(st, src)]) {
      if (!nsg) continue;
      const v = evalNsg(st, nsg, "Outbound", pkt, src.vnet);
      if (v.access === "Deny") v.missed?.forEach((m) => log(false, m));
      if (v.access === "Deny") return fail(`Outbound check on ${nsg}: rule ${v.rule} (priority ${v.priority}) denies it. Azure stops at the first matching rule.`, "nsg");
      log(true, `Outbound check on ${nsg}: rule ${v.rule} (priority ${v.priority}) allows it.`);
    }
  }

  let cur = { vnet: src.vnet, subnet: src.subnet };
  let forwarded = false;
  let target: Host | null = null;
  for (let hop = 0; hop < 5 && !target; hop++) {
    const r = lookup(effectiveRoutes(st, cur.vnet, cur.subnet), dn);
    if (!r) return fail(`no route to ${dstIp}`, "route");
    const where = `${cur.vnet}/${cur.subnet}`;
    if (r.type !== "None") log(true, `Routing in ${where}: longest prefix match for ${dstIp} is ${r.prefix} (${r.source === "User" ? "user-defined route" + (r.name ? " " + r.name : "") : "system route"}), next hop ${HOP_LABEL[r.type]}${r.nhIp ? " " + r.nhIp : ""}.`);
    if (r.type === "None") return fail(`Routing in ${where}: the longest prefix match for ${dstIp} is ${r.prefix} (${r.source === "User" ? "user-defined route" + (r.name ? " " + r.name : "") : "system route"}) with next hop None, so the packet is dropped.`, "route");
    if (r.type === "VirtualNetworkGateway") {
      const fromOnprem = !!st.vnets[cur.vnet].onprem;
      const hub = fromOnprem ? r.remote! : gatewayFor(st, cur.vnet);
      const g = hub ? st.gateways?.[hub] : null;
      if (!g || !hub) return fail(`route ${r.prefix} points at a virtual network gateway, and none is reachable from ${cur.vnet}, so the packet is dropped`, "route");
      if (!fromOnprem && hub !== cur.vnet) {
        const link = findLink(st, cur.vnet, hub), back = findLink(st, hub, cur.vnet);
        if (!link || !back) return fail(`peering between ${cur.vnet} and ${hub} is not Connected`, "peering");
        if (!link.allowVnetAccess) return fail(`peering ${link.name} on ${cur.vnet} has allowVirtualNetworkAccess = false, so no traffic flows through it`, "peering");
      }
      log(true, `${fromOnprem ? "From on-premises, the VPN tunnel" : `${cur.vnet} uses the VPN gateway ${g.name} in ${hub}, which`} carries the packet ${fromOnprem ? `to ${g.name} in ${hub}` : "toward on-premises"}.`);
      path.push(g.host);
      if (fromOnprem) { cur = { vnet: hub, subnet: st.hosts[g.host].subnet }; continue; }
      // A user-defined route to the gateway doesn't name the site, so find it by the destination address.
      const site = r.remote ?? g.connections.find((o) => st.vnets[o]?.prefixes.some((p) => inC(mustCidr(p), dn)));
      target = site ? hostByIp(st, site, dstIp) : null;
      if (!target) return fail(`nothing answers at ${dstIp} on-premises`, "host");
      break;
    }
    if (r.type === "Internet" || r.type === "VirtualNetworkServiceEndpoint") {
      const ep = st.publicEndpoints[dstIp];
      if (ep) return publicService(ep, r.type === "VirtualNetworkServiceEndpoint");
      const site = st.internet?.[dstIp];
      if (site) return internetSite(site.name, cur.vnet, cur.subnet);
      if (isPrivate(dn)) return fail(`private address ${dstIp} matched the Internet route, so it goes nowhere useful`, "route");
      return fail("the public internet is not modeled in this lab", "route");
    }
    if (r.type === "VnetLocal") {
      target = hostByIp(st, cur.vnet, dstIp);
      if (!target) return fail(`nothing answers at ${dstIp} in ${cur.vnet}`, "host");
      break;
    }
    let nextVnet: string | null;
    let nextIp: string;
    if (r.type === "VNetPeering") { nextVnet = r.remote!; nextIp = dstIp; }
    else {
      nextIp = r.nhIp!;
      nextVnet = vnetOfIp(st, ip2n(nextIp)!);
      if (!nextVnet || (nextVnet !== cur.vnet && !connectedPeers(st, cur.vnet).includes(nextVnet))) {
        return fail(`next hop ${nextIp} (route ${r.name ?? r.prefix}) is not reachable from ${cur.vnet}`, "route");
      }
    }
    if (nextVnet !== cur.vnet) {
      const link = findLink(st, cur.vnet, nextVnet), back = findLink(st, nextVnet, cur.vnet);
      if (!link || !back) return fail(`peering between ${cur.vnet} and ${nextVnet} is not Connected`, "peering");
      if (!link.allowVnetAccess) return fail(`peering ${link.name} on ${cur.vnet} has allowVirtualNetworkAccess = false, so no traffic flows through it`, "peering");
      if (forwarded && !back.allowForwarded) return fail(`forwarded traffic from ${cur.vnet} is not accepted by ${nextVnet} (peering ${back.name} has allowForwardedTraffic = false)`, "peering");
      log(true, `Peering ${cur.vnet} to ${nextVnet} is Connected with VNet access allowed${forwarded ? " and forwarded traffic accepted" : ""}.`);
    }
    if (r.type === "VNetPeering") {
      target = hostByIp(st, nextVnet, dstIp);
      if (!target) return fail(`nothing answers at ${dstIp} in ${nextVnet}`, "host");
      break;
    }
    const nva = hostByIp(st, nextVnet, nextIp);
    if (!nva) return fail(`next hop ${nextIp} (route ${r.name ?? r.prefix}) does not exist. Nothing is listening at that address, so the packet is dropped`, "route");
    if (nextIp === dstIp) { target = nva; break; }
    if (!nva.forwarding) return fail(`${nva.name} at ${nextIp} doesn't have IP forwarding enabled on its NIC, so Azure drops packets that aren't addressed to it`, "route");
    if (nva.kind === "fw" && !opts.skipNsg) {
      const d = fwDecide(nva, pkt);
      if (!d.allow) { d.missed.forEach((m) => log(false, m)); path.push(nva.name); return fail(d.text, "firewall"); }
      log(true, d.text);
    } else log(true, `${nva.name} at ${nextIp} ${nva.kind === "fw" ? "is the Azure Firewall" : "is a network virtual appliance"}, so it forwards the packet on.`);
    path.push(nva.name);
    via.push(nva.name);
    cur = { vnet: nva.vnet, subnet: nva.subnet };
    forwarded = true;
  }
  if (!target) return fail("routing loop, gave up after 5 hops", "route");

  // An internal load balancer hands the flow to a backend that passes its health probe.
  if (target.kind === "lb") {
    const lbName = Object.keys(st.lbs ?? {}).find((n) => st.lbs![n].host === target!.name);
    const lb = lbName ? st.lbs![lbName] : null;
    if (!lb) return fail(`nothing answers at ${dstIp}`, "host");
    path.push(target.name);
    if (port !== lb.rule.frontendPort) return fail(`${lbName} has no load-balancing rule for port ${port}`, "port");
    const healthy = lb.backends.filter((b) => probeOk(st, lb, b));
    if (!healthy.length) return fail(`All backend instances for load balancer ${lbName} are probed down. The health probe ${lb.probe.name} (${lb.probe.protocol} ${lb.probe.port}) from 168.63.129.16 gets no answer from any backend.`, "probe");
    log(true, `${lbName} sends the flow to ${healthy[0]}, a backend that passes its health probe (${healthy.length} of ${lb.backends.length} healthy).`);
    target = st.hosts[healthy[0]];
    pkt.dst = target.ip; pkt.port = lb.rule.backendPort; port = lb.rule.backendPort;
  }

  // Inbound: subnet NSG first, then the NIC NSG.
  if (!opts.skipNsg) {
    for (const nsg of [subnetNsg(st, target), target.nicNsg]) {
      if (!nsg) continue;
      const v = evalNsg(st, nsg, "Inbound", pkt, target.vnet);
      if (v.access === "Deny") { v.missed?.forEach((m) => log(false, m)); path.push(target.name); return fail(`Inbound check on ${nsg}: rule ${v.rule} (priority ${v.priority}) denies it. Azure stops at the first matching rule.`, "nsg"); }
      log(true, `Inbound check on ${nsg}: rule ${v.rule} (priority ${v.priority}) allows it.`);
    }
  }
  if (!opts.skipNsg && !subnetNsg(st, target) && !target.nicNsg) log(true, `No NSG on ${target.name}'s subnet or NIC, so nothing filters it inbound.`);
  path.push(target.name);
  // Past Azure's filters, the VM's own firewall decides next.
  if (!opts.skipNsg && target.guestFw) {
    const g = guestAllows(target, pkt.src, port);
    if (!g.allow) return fail(g.text, "guest");
    log(true, g.text);
  }
  if (!opts.skipPort && !target.ports.includes(port)) return fail(`${target.name} is reachable but nothing listens on port ${port}`, "port");
  if (!opts.skipPort) log(true, `${target.name} is listening on port ${port}.`);
  return { ok: true, path, via, target: target.name };
}

/** A TCP session: the forward path, then the reply's routing path through the same appliances. */
export function connect(st: State, srcName: string, dstIp: string, port: number, log?: TraceStep[]): TraceResult {
  if (log && !st.hosts[srcName].nicNsg && !subnetNsg(st, st.hosts[srcName])) log.push({ ok: true, text: `No NSG on ${srcName}'s subnet or NIC, so nothing filters it outbound.` });
  const f = trace(st, srcName, dstIp, port, "Tcp", { log });
  if (!f.ok || f.service) return f;
  // The reply comes back from the backend a load balancer picked, not from the frontend.
  log?.push({ ok: true, text: "Now the reply has to get back the same way." });
  const back = trace(st, f.target!, st.hosts[srcName].ip, port, "Tcp", { skipNsg: true, skipPort: true, log });
  if (!back.ok) return { ...f, ok: false, stage: "return", reason: `the request arrived, but the reply was lost on the way back: ${back.reason}` };
  if (back.via.join(",") !== f.via.join(",")) {
    const fw = f.via[0] ?? back.via[0];
    const desc = (v: string[]) => (v.length ? "through " + v.join(", ") : "direct");
    log?.push({ ok: false, text: `The reply went ${back.via.length ? "through " + back.via.join(", ") : "direct"}, but the request went ${f.via.length ? "through " + f.via.join(", ") : "direct"}. A stateful appliance that sees only one direction drops the session.` });
    return { ...f, ok: false, stage: "return", reason: `asymmetric routing: the request went ${desc(f.via)} but the reply went ${desc(back.via)}. ${fw} only saw one direction of the session and dropped it` };
  }
  return f;
}

/** Can host a reach ip:port? Convenience for level objectives. */
export const reach = (st: State, a: string, ip: string, port: number) => (st.hosts[a] ? connect(st, a, ip, port) : { ok: false, path: [], via: [] } as TraceResult);

// ---------- DNS (Azure-provided DNS, 168.63.129.16) ----------
export interface DnsAnswer { ip?: string; nx?: boolean; name: string; aliases: string[]; zone?: string; public?: boolean }

export function resolve(st: State, vnetName: string, name: string): DnsAnswer {
  let q = name.toLowerCase().replace(/\.$/, "");
  const aliases: string[] = [];
  for (let i = 0; i < 4; i++) {
    const zones = Object.keys(st.zones).filter((z) => {
      if (!(q === z || q.endsWith("." + z))) return false;
      return Object.values(st.zones[z].links).some((l) => l.vnet === vnetName);
    });
    if (zones.length) {
      const z = zones.sort((a, b) => b.length - a.length)[0];
      const label = q === z ? "@" : q.slice(0, q.length - z.length - 1);
      const ip = st.zones[z].records[label];
      return ip ? { ip, name: q, aliases, zone: z } : { nx: true, name: q, aliases, zone: z };
    }
    if (st.publicDns.cname[q]) { aliases.push(q); q = st.publicDns.cname[q]; continue; }
    if (st.publicDns.a[q]) return { ip: st.publicDns.a[q], name: q, aliases, public: true };
    return { nx: true, name: q, aliases };
  }
  return { nx: true, name: q, aliases };
}

// ---------- DNS as a VM sees it: custom DNS servers, DNS Private Resolver, forwarding rulesets ----------
export const AZURE_DNS = "168.63.129.16";
export interface Lookup extends DnsAnswer { server: string; timeout?: boolean; steps: TraceStep[] }

/** Azure-provided DNS for a VNet, after any forwarding ruleset linked to it. */
function azureDns(st: State, vnet: string, name: string, steps: TraceStep[], depth: number): DnsAnswer & { timeout?: boolean } {
  const q = name.toLowerCase().replace(/\.$/, "");
  // Private DNS zones linked to the VNet are consulted first, then forwarding ruleset links.
  const zoneHit = Object.keys(st.zones).some((z) => (q === z || q.endsWith("." + z)) && Object.values(st.zones[z].links).some((l) => l.vnet === vnet));
  let best: { rs: string; domain: string; targets: string[] } | null = null;
  if (!zoneHit) for (const [rsName, rs] of Object.entries(st.rulesets ?? {})) {
    if (!Object.values(rs.links).includes(vnet)) continue;
    for (const r of Object.values(rs.rules)) {
      const d = r.domain.toLowerCase().replace(/\.$/, "");
      if (r.enabled && (q === d || q.endsWith("." + d)) && (!best || d.length > best.domain.length)) best = { rs: rsName, domain: d, targets: r.targets };
    }
  }
  if (best && depth < 4) {
    const ip = best.targets[0]?.split(":")[0] ?? "";
    steps.push({ ok: true, text: `Forwarding ruleset ${best.rs} is linked to ${vnet}, and its rule for ${best.domain}. sends the query to ${ip}.` });
    const t = Object.values(st.hosts).find((h) => h.ip === ip && (h.kind === "dns" || h.kind === "dnsin"));
    if (!t) { steps.push({ ok: false, text: `Nothing answers DNS at ${ip}.` }); return { nx: true, name: q, aliases: [], timeout: true }; }
    return t.kind === "dnsin" ? azureDns(st, t.vnet, q, steps, depth + 1) : serverResolve(st, t, q, steps, depth + 1);
  }
  const r = resolve(st, vnet, q);
  steps.push({ ok: !r.nx && !r.public, text: r.nx ? `Azure DNS in ${vnet}: ${q} doesn't resolve.` : r.public ? `Azure DNS in ${vnet}: ${q} resolves to the public IP ${r.ip}. No private DNS zone linked to ${vnet} answered.` : `Azure DNS in ${vnet}: ${q} resolves to ${r.ip} through the private zone ${r.zone}, which is linked to ${vnet}.` });
  return r;
}

/** A DNS server VM: its own zones, then conditional forwarders, then its default (public recursion or Azure DNS). */
function serverResolve(st: State, srv: Host, name: string, steps: TraceStep[], depth: number): DnsAnswer & { timeout?: boolean } {
  let q = name.toLowerCase().replace(/\.$/, "");
  const aliases: string[] = [];
  for (let i = 0; i < 5; i++) {
    for (const [z, recs] of Object.entries(srv.dnsZones ?? {})) {
      if (q === z || q.endsWith("." + z)) {
        const label = q === z ? "@" : q.slice(0, q.length - z.length - 1);
        steps.push({ ok: !!recs[label], text: `${srv.name} hosts ${z} and ${recs[label] ? `answers ${recs[label]}` : "has no record for it"}.` });
        return recs[label] ? { ip: recs[label], name: q, aliases, zone: z } : { nx: true, name: q, aliases, zone: z };
      }
    }
    const fwd = Object.keys(srv.dnsForwarders ?? {}).filter((z) => q === z || q.endsWith("." + z)).sort((a, b) => b.length - a.length)[0];
    if (fwd && depth < 4) {
      const ip = srv.dnsForwarders![fwd];
      steps.push({ ok: true, text: `${srv.name} has a conditional forwarder for ${fwd} to ${ip}.` });
      if (ip === AZURE_DNS) { const r = azureDns(st, srv.vnet, q, steps, depth + 1); return { ...r, aliases: [...aliases, ...r.aliases] }; }
      const t = Object.values(st.hosts).find((h) => h.ip === ip && (h.kind === "dns" || h.kind === "dnsin"));
      if (!t) { steps.push({ ok: false, text: `Nothing answers DNS at ${ip}.` }); return { nx: true, name: q, aliases, timeout: true }; }
      const r = t.kind === "dnsin" ? azureDns(st, t.vnet, q, steps, depth + 1) : serverResolve(st, t, q, steps, depth + 1);
      return { ...r, aliases: [...aliases, ...r.aliases] };
    }
    if (srv.dnsDefault === "azure") { const r = azureDns(st, srv.vnet, q, steps, depth + 1); return { ...r, aliases: [...aliases, ...r.aliases] }; }
    // Public recursion: follow public records only. A CNAME may lead into a name a forwarder covers.
    if (st.publicDns.cname[q]) { aliases.push(q); q = st.publicDns.cname[q]; continue; }
    if (st.publicDns.a[q]) { steps.push({ ok: false, text: `${srv.name} resolved ${name} on the public internet, which returns the public IP ${st.publicDns.a[q]}. No forwarder sent it to Azure DNS.` }); return { ip: st.publicDns.a[q], name: q, aliases, public: true }; }
    steps.push({ ok: false, text: `${srv.name} can't find ${q}.` });
    return { nx: true, name: q, aliases };
  }
  return { nx: true, name: q, aliases };
}

/** Resolve a name the way a host's VNet is configured: Azure DNS, or the custom DNS server it points at. */
export function resolveFrom(st: State, fromHost: string, name: string): Lookup {
  const h = st.hosts[fromHost];
  const steps: TraceStep[] = [];
  const servers = (st.vnets[h.vnet].dnsServers ?? []).filter(Boolean);
  if (!servers.length || servers[0] === AZURE_DNS) return { ...azureDns(st, h.vnet, name, steps, 0), server: AZURE_DNS, steps };
  const ip = servers[0];
  steps.push({ ok: true, text: `${h.vnet} uses the custom DNS server ${ip}, so the query goes there instead of Azure DNS.` });
  // DNS goes over the network like anything else: routing and peering must get the query there.
  const t = trace(st, fromHost, ip, 53, "Udp", { skipNsg: true, skipPort: true });
  const srv = t.ok && t.target ? st.hosts[t.target] : null;
  if (!srv || (srv.kind !== "dns" && srv.kind !== "dnsin")) {
    steps.push({ ok: false, text: t.ok ? `Nothing at ${ip} answers DNS.` : `The query can't reach ${ip}: ${t.reason}.` });
    return { nx: true, name, aliases: [], server: ip, timeout: true, steps };
  }
  const r = srv.kind === "dnsin" ? (steps.push({ ok: true, text: `${ip} is a DNS Private Resolver inbound endpoint in ${srv.vnet}, which answers with Azure DNS as seen from ${srv.vnet}.` }), azureDns(st, srv.vnet, name, steps, 1)) : serverResolve(st, srv, name, steps, 1);
  return { ...r, server: ip, steps };
}
