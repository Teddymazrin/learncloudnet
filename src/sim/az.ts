// The simulated `az network` command surface. Flags and behavior follow the
// Azure CLI reference on Microsoft Learn. Messages starting with "lab:" are the simulator.
import { cidr, n2ip, overlap, within, ip2n, mustCidr, type Cidr } from "./ip";
import {
  DEFAULT_RULES, HOP_LABEL, HOP_WATCHER, connect, connectedPeers, effectiveRoutes, evalNsg, findLink, linkPrefixes, lookup, resolveFrom,
  nsgRules, peeringState, peeringsOf, subnetNsg,
} from "./network";
import type { Direction, Flags, Host, HopType, NsgRule, Peering, Route, State } from "./types";
import { runScript } from "./guest";
import { overlapNote } from "./overlap";
import { suggestCommand } from "./didyoumean";

export const RG = "rg-lab";
const SUB = "00000000-0000-0000-0000-000000000000";

export class LabError extends Error {}
const E = (msg: string): never => { throw new LabError(msg); };

const id = (type: string, name: string, parent?: string) =>
  `/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.Network/${parent ? parent + "/" : ""}${type}/${name}`;
const lastSeg = (v: string) => String(v).split("/").filter(Boolean).pop() ?? "";
const truthy = (v: string) => /^(1|t|true|y|yes)$/i.test(v);
const isBoolLit = (v: string) => /^(0|1|f|false|n|no|t|true|y|yes)$/i.test(v);

// ---------- Output ----------
export function getPath(obj: unknown, path: string): unknown {
  path = path.replace(/^["']|["']$/g, "");
  let cur: any = obj;
  for (const p of path.split(".")) {
    if (cur === null || cur === undefined) return null;
    const arr = p.match(/^(\w+)\[\]$/);
    const idx = p.match(/^(\w+)\[(\d+)\]$/);
    if (arr) { cur = cur[arr[1]]; continue; }
    if (idx) { cur = cur[idx[1]]?.[Number(idx[2])]; continue; }
    if (Array.isArray(cur)) { cur = cur.map((x) => (x ? x[p] : null)); continue; }
    cur = cur[p];
  }
  return cur === undefined ? null : cur;
}

export function table(rows: Record<string, unknown>[], cols?: string[]): string {
  if (!rows.length) return "";
  const c = cols ?? Object.keys(rows[0]);
  const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  const w = c.map((k) => Math.max(k.length, ...rows.map((r) => str(r[k]).length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(w[i])).join("  ").replace(/\s+$/, "");
  return [line(c), line(w.map((n) => "-".repeat(n))), ...rows.map((r) => line(c.map((k) => str(r[k]))))].join("\n");
}

function fmt(obj: unknown, f: Flags): string {
  if (f.query) obj = getPath(obj, f.query.join(" "));
  const o = (f.output?.[0] ?? "json").toLowerCase();
  if (o === "tsv") {
    const flat = (x: any) => (x && typeof x === "object" ? Object.values(x).map((v) => (typeof v === "object" ? "" : v)).join("\t") : x);
    if (Array.isArray(obj)) return obj.map(flat).join("\n");
    return obj === null ? "" : String(flat(obj));
  }
  if (o === "table") {
    const rows = Array.isArray(obj) ? obj : [obj];
    if (rows.length && typeof rows[0] !== "object") return rows.join("\n");
    return table(rows.map((r: any) => {
      const out: Record<string, unknown> = {};
      Object.keys(r ?? {}).forEach((k) => { if (typeof r[k] !== "object" || r[k] === null) out[k[0].toUpperCase() + k.slice(1)] = r[k]; });
      return out;
    }));
  }
  return typeof obj === "string" ? JSON.stringify(obj) : JSON.stringify(obj, null, 2);
}
const isTable = (f: Flags) => f.output?.[0]?.toLowerCase() === "table" && !f.query;

// ---------- Views ----------
function subnetView(st: State, vnet: string, s: string) {
  const sn = st.vnets[vnet].subnets[s];
  return {
    addressPrefix: sn.prefixes.length === 1 ? sn.prefixes[0] : undefined,
    addressPrefixes: sn.prefixes.length > 1 ? sn.prefixes : undefined,
    id: id("subnets", s, `virtualNetworks/${vnet}`), name: s,
    networkSecurityGroup: sn.nsg ? { id: id("networkSecurityGroups", sn.nsg) } : null,
    provisioningState: "Succeeded", resourceGroup: RG,
    routeTable: sn.rt ? { id: id("routeTables", sn.rt) } : null,
    serviceEndpoints: (sn.serviceEndpoints ?? []).map((service) => ({ locations: ["eastus2"], provisioningState: "Succeeded", service })),
    defaultOutboundAccess: sn.defaultOutbound !== false,
    natGateway: sn.natGateway ? { id: id("natGateways", sn.natGateway) } : null,
  };
}
function peeringView(st: State, p: Peering) {
  return {
    allowForwardedTraffic: p.allowForwarded, allowGatewayTransit: !!p.allowGatewayTransit, allowVirtualNetworkAccess: p.allowVnetAccess,
    id: id("virtualNetworkPeerings", p.name, `virtualNetworks/${p.vnet}`), name: p.name, peeringState: peeringState(st, p),
    provisioningState: "Succeeded", remoteAddressSpace: { addressPrefixes: linkPrefixes(st, p) },
    remoteVirtualNetwork: { id: id("virtualNetworks", p.remote) }, resourceGroup: RG, useRemoteGateways: !!p.useRemoteGateways,
  };
}
function vnetView(st: State, name: string) {
  const v = st.vnets[name];
  return {
    addressSpace: { addressPrefixes: [...v.prefixes] }, dhcpOptions: { dnsServers: [...(v.dnsServers ?? [])] }, id: id("virtualNetworks", name), location: "eastus2", name,
    provisioningState: "Succeeded", resourceGroup: RG,
    subnets: Object.keys(v.subnets).map((s) => subnetView(st, name, s)),
    virtualNetworkPeerings: peeringsOf(st, name).map((p) => peeringView(st, p)),
  };
}
const one1 = (a: string[]) => (a.length === 1 ? a[0] : "");
const many = (a: string[]) => (a.length > 1 ? a : []);
function ruleView(r: NsgRule, nsg: string) {
  return {
    access: r.access, description: r.description ?? null, destinationAddressPrefix: one1(r.dst), destinationAddressPrefixes: many(r.dst),
    destinationPortRange: one1(r.ports), destinationPortRanges: many(r.ports), direction: r.direction,
    id: id(r.def ? "defaultSecurityRules" : "securityRules", r.name, `networkSecurityGroups/${nsg}`), name: r.name, priority: r.priority,
    protocol: r.protocol, provisioningState: "Succeeded", resourceGroup: RG, sourceAddressPrefix: one1(r.src), sourceAddressPrefixes: many(r.src), sourcePortRange: "*",
  };
}
function routeView(r: Route, rt: string) {
  return { addressPrefix: r.prefix, id: id("routes", r.name, `routeTables/${rt}`), name: r.name, nextHopIpAddress: r.nhIp, nextHopType: r.type, provisioningState: "Succeeded", resourceGroup: RG };
}
function ipConfigView(h: Host) {
  return { name: "ipconfig1", primary: true, privateIPAddress: h.ip, provisioningState: "Succeeded", resourceGroup: RG, subnet: { id: id("subnets", h.subnet, `virtualNetworks/${h.vnet}`) } };
}

// ---------- Validation helpers ----------
const need = (f: Flags, key: string, example?: string): string[] => {
  if (!f[key]?.length) E(`the following arguments are required: --${key}${example ? "\nTry: " + example : ""}`);
  return f[key];
};
const one = (f: Flags, key: string, example?: string) => need(f, key, example)[0];
const opt = (f: Flags, key: string) => (f[key]?.length ? f[key][0] : null);
// The state the current command runs against, so resource group checks can see the lab's groups.
let CUR: State | null = null;
function rgCheck(f: Flags) {
  const g = one(f, "resource-group");
  const groups = CUR?.groups;
  if (groups) { if (!Object.keys(groups).some((k) => k.toLowerCase() === g.toLowerCase())) E(`(ResourceGroupNotFound) Resource group '${g}' could not be found.\nlab: create it first with az group create --name ${g}. Groups here: ${Object.keys(groups).join(", ")}.`); return; }
  if (g.toLowerCase() !== RG) E(`lab: resource group '${g}' does not exist here. Everything in this lab lives in ${RG}.`);
}
const getVnet = (st: State, n: string) => st.vnets[n] ?? E(`lab: virtual network '${n}' was not found in ${RG}.`);
const getSubnet = (st: State, v: string, s: string) => getVnet(st, v).subnets[s] ?? E(`lab: subnet '${s}' was not found in ${v}.`);
const getNsg = (st: State, n: string) => st.nsgs[n] ?? E(`lab: network security group '${n}' was not found.`);
const getRt = (st: State, n: string) => st.rts[n] ?? E(`lab: route table '${n}' was not found.`);

function parseCidrs(vals: string[], what: string): Cidr[] {
  return vals.map((v) => {
    const c = cidr(v);
    if (!c || !v.includes("/")) return E(`lab: '${v}' is not a valid CIDR for ${what}.`);
    if (!c.aligned) E(`lab: ${v} is not a valid network address. Did you mean ${c.text}?`);
    return c;
  });
}
function checkVnetSpace(cs: Cidr[]) {
  const bad = ["224.0.0.0/4", "255.255.255.255/32", "127.0.0.0/8", "169.254.0.0/16", "168.63.129.16/32"].map(mustCidr);
  cs.forEach((c, i) => {
    bad.forEach((b) => { if (overlap(c, b)) E(`lab: ${c.text} overlaps a range Azure doesn't allow in a virtual network (${b.text}).`); });
    cs.forEach((d, j) => { if (i < j && overlap(c, d)) E(`lab: address ranges ${c.text} and ${d.text} overlap. Ranges in one virtual network can't overlap.`); });
  });
}
function validateSubnet(st: State, vnet: string, name: string, cs: Cidr[]) {
  const v = st.vnets[vnet];
  cs.forEach((c) => {
    if (c.len > 29) E(`lab: ${c.text} is too small. The smallest IPv4 subnet Azure supports is /29 (8 addresses minus 5 reserved = 3 usable).`);
    if (!v.prefixes.some((p) => within(c, mustCidr(p)))) E(`lab: ${c.text} is not inside the address space of ${vnet} (${v.prefixes.join(", ")}).`);
    Object.entries(v.subnets).forEach(([s, sn]) => {
      if (s === name) return;
      sn.prefixes.forEach((p) => { if (overlap(c, mustCidr(p))) E(`lab: ${c.text} overlaps subnet ${s} (${p}).`); });
    });
  });
}
const pick = <T extends string>(v: string, opts: readonly T[], flag: string): T =>
  opts.find((o) => o.toLowerCase() === v.toLowerCase()) ?? E(`lab: --${flag} must be one of ${opts.join(", ")}.`);
const PROTOCOLS = ["*", "Ah", "Esp", "Icmp", "Tcp", "Udp"] as const;
const DIRS = ["Inbound", "Outbound"] as const;
const ACCESS = ["Allow", "Deny"] as const;
const HOPS = ["Internet", "None", "VirtualAppliance", "VirtualApplianceEcmp", "VirtualNetworkGateway", "VnetLocal"] as const;
function prio(p: string) {
  const n = Number(p);
  if (!Number.isInteger(n) || n < 100 || n > 4096) E("lab: --priority must be a whole number between 100 and 4096.");
  return n;
}
function ports(vals: string[]) {
  vals.forEach((v) => { if (!(v === "*" || (/^\d+$/.test(v) && Number(v) <= 65535) || /^\d+-\d+$/.test(v))) E(`lab: '${v}' is not a valid port or port range.`); });
  return [...vals];
}
const vnetFromRef = (st: State, ref: string) => { const n = lastSeg(ref); getVnet(st, n); return n; };
function hostByNic(st: State, nic: string): Host {
  return Object.values(st.hosts).find((h) => h.nic === nic) ?? E(`lab: network interface '${nic}' was not found. NIC names in this lab look like <vm-name>-nic.`);
}
function hostByVm(st: State, vm: string): Host {
  const h = st.hosts[lastSeg(vm)];
  if (!h || h.kind === "pe") E(`lab: virtual machine '${vm}' was not found.`);
  return h;
}
function ipPort(v: string, what: string) {
  const m = v.match(/^(\d+\.\d+\.\d+\.\d+):(\*|\d+)$/);
  if (!m) return E(`lab: --${what} must look like X.X.X.X:PORT, for example 10.0.0.4:443.`);
  return { ip: m[1], port: m[2] === "*" ? 0 : Number(m[2]) };
}

export interface AzResult { text: string; mut: boolean }

// ---------- Handlers ----------
type Handler = (st: State, f: Flags, notes: string[]) => AzResult | unknown;
const READ = new Set<string>();
const H: Record<string, Handler> = {};
const def = (key: string, fn: Handler, read = false) => { H[key] = fn; if (read) READ.add(key); };

def("vnet create", (st, f) => {
  rgCheck(f);
  const name = one(f, "name");
  if (st.vnets[name]) E(`lab: a virtual network named ${name} already exists.`);
  const cs = parseCidrs(f["address-prefixes"] ?? ["10.0.0.0/16"], "--address-prefixes");
  checkVnetSpace(cs);
  const note = overlapNote(st, cs.map((c) => c.text));
  st.vnets[name] = { prefixes: cs.map((c) => c.text), subnets: {}, ...(st.groups ? { rg: groupOf(f) } : {}) };
  const sn = opt(f, "subnet-name");
  if (sn) {
    const scs = f["subnet-prefixes"] ? parseCidrs(f["subnet-prefixes"], "--subnet-prefixes") : [mustCidr(`${n2ip(cs[0].net)}/${Math.max(24, cs[0].len)}`)];
    try { validateSubnet(st, name, sn, scs); } catch (e) { delete st.vnets[name]; throw e; }
    st.vnets[name].subnets[sn] = { prefixes: scs.map((c) => c.text), nsg: null, rt: null };
  }
  if (!st.layout.includes(name)) st.layout.push(name);
  if (note) return { mut: true, text: `${JSON.stringify({ newVNet: vnetView(st, name) }, null, 2)}\nlab: note: ${note}` };
  return { newVNet: vnetView(st, name) };
});
def("vnet update", (st, f) => {
  rgCheck(f);
  const vn = one(f, "name"); const v = getVnet(st, vn);
  if (f["address-prefixes"]) {
    const ncs = parseCidrs(f["address-prefixes"], "--address-prefixes");
    checkVnetSpace(ncs);
    Object.entries(v.subnets).forEach(([s, sn]) => sn.prefixes.forEach((p) => {
      if (!ncs.some((c) => within(mustCidr(p), c))) E(`lab: subnet ${s} (${p}) would fall outside the new address space. An address range can't be removed while a subnet uses it.`);
    }));
    peeringsOf(st, vn).forEach((p) => ncs.forEach((c) => st.vnets[p.remote]?.prefixes.forEach((rp) => {
      if (overlap(c, mustCidr(rp))) E(`lab: ${c.text} would overlap peered virtual network ${p.remote} (${rp}).`);
    })));
    v.prefixes = ncs.map((c) => c.text);
  }
  if (f["dns-servers"]) {
    const ips = f["dns-servers"].filter(Boolean);
    ips.forEach((ip) => { if (ip2n(ip) === null) E(`lab: '${ip}' is not an IPv4 address for --dns-servers.`); });
    v.dnsServers = ips;
  }
  return vnetView(st, vn);
});
def("vnet show", (st, f) => { rgCheck(f); const n = one(f, "name"); getVnet(st, n); return vnetView(st, n); }, true);
def("vnet list", (st, f) => {
  rgCheck(f);
  const list = Object.keys(st.vnets).map((n) => vnetView(st, n));
  if (isTable(f)) return { mut: false, text: table(list.map((x) => ({ Name: x.name, ResourceGroup: RG, Location: "eastus2", AddressPrefixes: x.addressSpace.addressPrefixes.join(" "), Subnets: x.subnets.length }))) };
  return list;
}, true);
def("vnet subnet create", (st, f) => {
  rgCheck(f);
  const vn = one(f, "vnet-name"); getVnet(st, vn);
  const sn = one(f, "name");
  if (st.vnets[vn].subnets[sn]) E(`lab: subnet ${sn} already exists in ${vn}.`);
  const sc = parseCidrs(need(f, "address-prefixes"), "--address-prefixes");
  validateSubnet(st, vn, sn, sc);
  const nsg = opt(f, "network-security-group"), rt = opt(f, "route-table");
  if (nsg) getNsg(st, lastSeg(nsg));
  if (rt) getRt(st, lastSeg(rt));
  st.vnets[vn].subnets[sn] = { prefixes: sc.map((c) => c.text), nsg: nsg ? lastSeg(nsg) : null, rt: rt ? lastSeg(rt) : null };
  return subnetView(st, vn, sn);
});
def("vnet subnet update", (st, f) => {
  rgCheck(f);
  const vn = one(f, "vnet-name"), sn = one(f, "name"); const s = getSubnet(st, vn, sn);
  if (!f["address-prefixes"] && !f["network-security-group"] && !f["route-table"] && !f["service-endpoints"] && !f["nat-gateway"] && !f["default-outbound"] && !f["default-outbound-access"]) E("lab: nothing to update. Pass --route-table, --network-security-group, --service-endpoints, --nat-gateway, --default-outbound or --address-prefixes.");
  if (f["nat-gateway"]) { const n = lastSeg(f["nat-gateway"][0]); if (n === "null") s.natGateway = null; else { if (!st.natGateways?.[n]) E(`lab: NAT gateway '${n}' was not found.`); s.natGateway = n; } }
  const dob = f["default-outbound"] ?? f["default-outbound-access"];
  if (dob) { if (!isBoolLit(dob[0])) E("lab: --default-outbound takes true or false."); s.defaultOutbound = truthy(dob[0]); }
  if (f["service-endpoints"]) {
    const eps = f["service-endpoints"].filter(Boolean);
    const bad = eps.find((e) => !/^Microsoft\.Storage(\.Global)?$/i.test(e));
    if (bad) E(`lab: this lab models the Microsoft.Storage and Microsoft.Storage.Global service endpoints, not ${bad}.`);
    if (eps.length > 1) E("lab: Microsoft.Storage and Microsoft.Storage.Global can't both be on one subnet. Pick one.");
    s.serviceEndpoints = eps;
  }
  if (f["address-prefixes"]) { const c = parseCidrs(f["address-prefixes"], "--address-prefixes"); validateSubnet(st, vn, sn, c); s.prefixes = c.map((x) => x.text); }
  if (f["network-security-group"]) { const n = lastSeg(f["network-security-group"][0]); getNsg(st, n); s.nsg = n; }
  if (f["route-table"]) { const n = lastSeg(f["route-table"][0]); getRt(st, n); s.rt = n; }
  return subnetView(st, vn, sn);
});
def("vnet subnet show", (st, f) => { rgCheck(f); const vn = one(f, "vnet-name"), sn = one(f, "name"); getSubnet(st, vn, sn); return subnetView(st, vn, sn); }, true);

def("nsg create", (st, f) => {
  rgCheck(f);
  const n = one(f, "name");
  if (st.nsgs[n]) E(`lab: network security group ${n} already exists.`);
  st.nsgs[n] = { rules: [], ...(st.groups ? { rg: groupOf(f) } : {}) };
  return { NewNSG: { defaultSecurityRules: [...DEFAULT_RULES.Inbound, ...DEFAULT_RULES.Outbound].map((r) => ruleView(r, n)), id: id("networkSecurityGroups", n), name: n, provisioningState: "Succeeded", resourceGroup: RG, securityRules: [] } };
});
def("nsg show", (st, f) => {
  rgCheck(f); const n = one(f, "name"); const g = getNsg(st, n);
  const subnets: { id: string }[] = [];
  Object.entries(st.vnets).forEach(([vn, v]) => Object.entries(v.subnets).forEach(([sn, s]) => { if (s.nsg === n) subnets.push({ id: id("subnets", sn, `virtualNetworks/${vn}`) }); }));
  const nics = Object.values(st.hosts).filter((h) => h.nicNsg === n).map((h) => ({ id: id("networkInterfaces", h.nic) }));
  return { defaultSecurityRules: [...DEFAULT_RULES.Inbound, ...DEFAULT_RULES.Outbound].map((r) => ruleView(r, n)), id: id("networkSecurityGroups", n), name: n, networkInterfaces: nics, resourceGroup: RG, securityRules: g.rules.map((r) => ruleView(r, n)), subnets };
}, true);
function ruleWrite(create: boolean): Handler {
  return (st, f) => {
    rgCheck(f);
    const nsgName = one(f, "nsg-name"); const nsg = getNsg(st, nsgName);
    const rn = one(f, "name");
    const existing = nsg.rules.find((r) => r.name === rn);
    if (create && existing) E(`lab: rule ${rn} already exists in ${nsgName}. Use az network nsg rule update to change it.`);
    if (!create && !existing) E(`lab: rule ${rn} was not found in ${nsgName}.`);
    if (create) { need(f, "priority", "--priority 300"); need(f, "direction"); need(f, "access"); need(f, "protocol"); need(f, "destination-port-ranges"); }
    const r: NsgRule = existing ? JSON.parse(JSON.stringify(existing)) : { name: rn, src: ["*"], dst: ["*"] } as NsgRule;
    if (f.priority) r.priority = prio(f.priority[0]);
    if (f.direction) r.direction = pick(f.direction[0], DIRS, "direction");
    if (f.access) r.access = pick(f.access[0], ACCESS, "access");
    if (f.protocol) r.protocol = pick(f.protocol[0], PROTOCOLS, "protocol");
    if (f["destination-port-ranges"]) r.ports = ports(f["destination-port-ranges"]);
    if (f["source-address-prefixes"]) r.src = [...f["source-address-prefixes"]];
    if (f["destination-address-prefixes"]) r.dst = [...f["destination-address-prefixes"]];
    if (f.description) r.description = f.description.join(" ");
    const clash = nsg.rules.find((x) => x.name !== rn && x.direction === r.direction && x.priority === r.priority);
    if (clash) E(`lab: priority ${r.priority} is already used by ${clash.name} for ${r.direction} rules in ${nsgName}. Priorities must be unique per direction.`);
    if (existing) nsg.rules[nsg.rules.indexOf(existing)] = r; else nsg.rules.push(r);
    return ruleView(r, nsgName);
  };
}
def("nsg rule create", ruleWrite(true));
def("nsg rule update", ruleWrite(false));
def("nsg rule delete", (st, f) => {
  rgCheck(f); const n = one(f, "nsg-name"); const g = getNsg(st, n); const rn = one(f, "name");
  if (!g.rules.some((r) => r.name === rn)) E(`lab: rule ${rn} was not found in ${n}.`);
  g.rules = g.rules.filter((r) => r.name !== rn);
  return { mut: true, text: "" };
});
def("nsg rule show", (st, f) => {
  rgCheck(f); const n = one(f, "nsg-name"); const g = getNsg(st, n); const rn = one(f, "name");
  const r = g.rules.find((x) => x.name === rn) ?? E(`lab: rule ${rn} was not found in ${n}.`);
  return ruleView(r, n);
}, true);
def("nsg rule list", (st, f) => {
  rgCheck(f);
  const n = one(f, "nsg-name"); const g = getNsg(st, n);
  let rules = [...g.rules].sort((a, b) => (a.direction === b.direction ? a.priority - b.priority : a.direction < b.direction ? -1 : 1));
  if (f["include-default"] && truthy(f["include-default"][0])) rules = rules.concat(DEFAULT_RULES.Inbound, DEFAULT_RULES.Outbound);
  if (isTable(f)) return { mut: false, text: table(rules.map((r) => ({ Name: r.name, Priority: r.priority, Direction: r.direction, Access: r.access, Protocol: r.protocol, SourceAddressPrefixes: r.src.join(" "), DestinationAddressPrefixes: r.dst.join(" "), DestinationPortRanges: r.ports.join(" ") }))) || "lab: no custom rules. Add --include-default to see the default rules." };
  return rules.map((r) => ruleView(r, n));
}, true);

def("route-table create", (st, f) => {
  rgCheck(f); const n = one(f, "name");
  if (st.rts[n]) E(`lab: route table ${n} already exists.`);
  st.rts[n] = { routes: [], ...(st.groups ? { rg: groupOf(f) } : {}) };
  return { disableBgpRoutePropagation: false, id: id("routeTables", n), location: "eastus2", name: n, provisioningState: "Succeeded", resourceGroup: RG, routes: [] };
});
function routeWrite(create: boolean): Handler {
  return (st, f) => {
    rgCheck(f);
    const tn = one(f, "route-table-name"); const t = getRt(st, tn);
    const rn = one(f, "name");
    const ex = t.routes.find((x) => x.name === rn);
    if (create && ex) E(`lab: route ${rn} already exists in ${tn}. Use az network route-table route update.`);
    if (!create && !ex) E(`lab: route ${rn} was not found in ${tn}.`);
    if (create && !f["address-prefixes"]) E("the following arguments are required: --address-prefix");
    if (create) need(f, "next-hop-type");
    const r: Route = ex ? { ...ex } : ({ name: rn } as Route);
    if (f["address-prefixes"]) r.prefix = parseCidrs([f["address-prefixes"][0]], "--address-prefix")[0].text;
    if (f["next-hop-type"]) {
      const t2 = pick(f["next-hop-type"][0], HOPS, "next-hop-type");
      if (t2 === "VirtualApplianceEcmp") E("lab: VirtualApplianceEcmp isn't modeled in this lab. Use VirtualAppliance.");
      r.type = t2 as HopType;
    }
    if (f["next-hop-ip-address"]) { if (ip2n(f["next-hop-ip-address"][0]) === null) E("lab: --next-hop-ip-address must be an IPv4 address."); r.nhIp = f["next-hop-ip-address"][0]; }
    if (r.type !== "VirtualAppliance") delete r.nhIp;
    if (r.type === "VirtualAppliance" && !r.nhIp) E("lab: a VirtualAppliance route needs --next-hop-ip-address (the appliance's private IP).");
    const dup = t.routes.find((x) => x.name !== rn && x.prefix === r.prefix);
    if (dup) E(`lab: route ${dup.name} in ${tn} already uses ${r.prefix}. A prefix can't appear in more than one route in the same table.`);
    if (ex) t.routes[t.routes.indexOf(ex)] = r; else t.routes.push(r);
    return routeView(r, tn);
  };
}
def("route-table route create", routeWrite(true));
def("route-table route update", routeWrite(false));

def("vnet peering create", (st, f, notes) => {
  rgCheck(f);
  const pn = one(f, "name"), pv = one(f, "vnet-name"); getVnet(st, pv);
  const rv = vnetFromRef(st, one(f, "remote-vnet"));
  if (rv === pv) E("lab: a virtual network can't be peered with itself.");
  if (peeringsOf(st, pv).some((p) => p.name === pn)) E(`lab: a peering named ${pn} already exists on ${pv}.`);
  if (findLink(st, pv, rv)) E(`lab: ${pv} already has a peering to ${rv}.`);
  const ov = st.vnets[pv].prefixes.some((a) => st.vnets[rv].prefixes.some((b) => overlap(mustCidr(a), mustCidr(b))));
  if (ov) E(`Cannot create or update peering because address space of virtual networks overlap.\n(lab: ${pv} ${st.vnets[pv].prefixes.join(", ")} vs ${rv} ${st.vnets[rv].prefixes.join(", ")})`);
  for (const k of PEER_FLAGS) if (f[k] && !isBoolLit(f[k][0])) E(`lab: --${k} takes true or false.`);
  const b = (k: string) => (f[k] ? truthy(f[k][0]) : false);
  const p: Peering = { name: pn, vnet: pv, remote: rv, allowVnetAccess: b("allow-vnet-access"), allowForwarded: b("allow-forwarded-traffic"), allowGatewayTransit: b("allow-gateway-transit"), useRemoteGateways: b("use-remote-gateways"), remotePrefixes: [...st.vnets[rv].prefixes] };
  checkGatewayFlags(st, p);
  st.peerings[`${pv}/${pn}`] = p;
  if (!p.allowVnetAccess) notes.push("lab: --allow-vnet-access wasn't passed, so it defaults to false. The link exists but carries no traffic.");
  return peeringView(st, p);
});
def("vnet peering update", (st, f) => {
  rgCheck(f);
  const p = st.peerings[`${one(f, "vnet-name")}/${one(f, "name")}`] ?? E(`lab: peering ${f.name[0]} was not found on ${f["vnet-name"][0]}.`);
  for (const k of PEER_FLAGS) if (f[k] && !isBoolLit(f[k][0])) E(`lab: --${k} takes true or false.`);
  const next = { ...p };
  if (f["allow-vnet-access"]) next.allowVnetAccess = truthy(f["allow-vnet-access"][0]);
  if (f["allow-forwarded-traffic"]) next.allowForwarded = truthy(f["allow-forwarded-traffic"][0]);
  if (f["allow-gateway-transit"]) next.allowGatewayTransit = truthy(f["allow-gateway-transit"][0]);
  if (f["use-remote-gateways"]) next.useRemoteGateways = truthy(f["use-remote-gateways"][0]);
  checkGatewayFlags(st, next);
  Object.assign(p, next);
  return peeringView(st, p);
});
def("vnet peering sync", (st, f) => {
  rgCheck(f);
  const p = st.peerings[`${one(f, "vnet-name")}/${one(f, "name")}`] ?? E(`lab: peering ${f.name[0]} was not found on ${f["vnet-name"][0]}.`);
  p.remotePrefixes = [...st.vnets[p.remote].prefixes];
  return peeringView(st, p);
});
const PEER_FLAGS = ["allow-vnet-access", "allow-forwarded-traffic", "allow-gateway-transit", "use-remote-gateways"];
/** Gateway transit rules from the az reference and the peering docs. */
function checkGatewayFlags(st: State, p: Peering) {
  const gws = st.gateways ?? {};
  if (p.allowGatewayTransit && !gws[p.vnet]) E(`lab: ${p.vnet} has no virtual network gateway, so it can't allow gateway transit. The virtual network must contain a gateway or route server.`);
  if (p.useRemoteGateways) {
    if (gws[p.vnet]) E(`lab: ${p.vnet} already has its own gateway. --use-remote-gateways can't be set if the VNet already has a gateway.`);
    if (!gws[p.remote]) E(`lab: ${p.remote} has no virtual network gateway to use.`);
    const back = findLink(st, p.remote, p.vnet);
    if (!back?.allowGatewayTransit) E(`lab: the remote peering on ${p.remote} must have --allow-gateway-transit enabled before ${p.vnet} can use its gateway.`);
    if (peeringsOf(st, p.vnet).some((x) => x.name !== p.name && x.useRemoteGateways)) E("lab: only 1 peering can have --use-remote-gateways enabled.");
  }
}
def("vnet peering delete", (st, f) => {
  rgCheck(f);
  const key = `${one(f, "vnet-name")}/${one(f, "name")}`;
  if (!st.peerings[key]) E(`lab: peering ${f.name[0]} was not found on ${f["vnet-name"][0]}.`);
  delete st.peerings[key];
  return { mut: true, text: "" };
});
def("vnet peering list", (st, f) => {
  rgCheck(f); const v = one(f, "vnet-name"); getVnet(st, v);
  const pl = peeringsOf(st, v).map((p) => peeringView(st, p));
  if (isTable(f)) return { mut: false, text: table(pl.map((p) => ({ AllowForwardedTraffic: p.allowForwardedTraffic, AllowVirtualNetworkAccess: p.allowVirtualNetworkAccess, Name: p.name, PeeringState: p.peeringState, RemoteVnet: lastSeg(p.remoteVirtualNetwork.id) }))) || "lab: no peerings on " + v + "." };
  return pl;
}, true);
def("vnet peering show", (st, f) => {
  rgCheck(f);
  const p = st.peerings[`${one(f, "vnet-name")}/${one(f, "name")}`] ?? E(`lab: peering ${f.name[0]} was not found on ${f["vnet-name"][0]}.`);
  return peeringView(st, p);
}, true);

def("private-dns zone list", (st) => Object.entries(st.zones).map(([z, d]) => ({ name: z, numberOfRecordSets: Object.keys(d.records).length + 1, numberOfVirtualNetworkLinks: Object.keys(d.links).length, resourceGroup: RG })), true);
def("private-dns link vnet list", (st, f) => {
  rgCheck(f); const z = one(f, "zone-name");
  const d = st.zones[z] ?? E(`lab: private DNS zone '${z}' was not found.`);
  return Object.entries(d.links).map(([l, k]) => ({ name: l, registrationEnabled: k.reg, virtualNetwork: { id: id("virtualNetworks", k.vnet) }, virtualNetworkLinkState: "Completed" }));
}, true);
def("private-dns link vnet create", (st, f) => {
  rgCheck(f); const z = one(f, "zone-name");
  const d = st.zones[z] ?? E(`lab: private DNS zone '${z}' was not found. Zones here: ${Object.keys(st.zones).join(", ")}`);
  const ln = one(f, "name");
  const vn = vnetFromRef(st, one(f, "virtual-network"));
  const reg = one(f, "registration-enabled");
  if (!isBoolLit(reg)) E("lab: --registration-enabled takes true or false.");
  if (d.links[ln]) E(`lab: a link named ${ln} already exists on ${z}.`);
  if (Object.values(d.links).some((l) => l.vnet === vn)) E(`lab: ${vn} is already linked to ${z}.`);
  d.links[ln] = { vnet: vn, reg: truthy(reg) };
  return { name: ln, provisioningState: "Succeeded", registrationEnabled: truthy(reg), resolutionPolicy: "Default", virtualNetwork: { id: id("virtualNetworks", vn) }, virtualNetworkLinkState: "Completed" };
});

def("nic show", (st, f) => {
  rgCheck(f); const h = hostByNic(st, one(f, "name"));
  return { enableIPForwarding: h.forwarding, id: id("networkInterfaces", h.nic), ipConfigurations: [ipConfigView(h)], name: h.nic, networkSecurityGroup: h.nicNsg ? { id: id("networkSecurityGroups", h.nicNsg) } : null, provisioningState: "Succeeded", resourceGroup: RG, virtualMachine: h.kind === "pe" ? null : { id: `/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.Compute/virtualMachines/${h.name}` } };
}, true);
def("nic update", (st, f) => {
  rgCheck(f); const h = hostByNic(st, one(f, "name"));
  if (!f["network-security-group"] && !f["ip-forwarding"]) E("lab: nothing to update. Pass --network-security-group or --ip-forwarding.");
  if (f["network-security-group"]) { const n = lastSeg(f["network-security-group"][0]); getNsg(st, n); h.nicNsg = n; }
  if (f["ip-forwarding"]) { const v = f["ip-forwarding"][0] ?? "true"; if (!isBoolLit(v)) E("lab: --ip-forwarding takes true or false."); h.forwarding = truthy(v); }
  return { enableIPForwarding: h.forwarding, name: h.nic, networkSecurityGroup: h.nicNsg ? { id: id("networkSecurityGroups", h.nicNsg) } : null, provisioningState: "Succeeded", resourceGroup: RG };
});
def("nic ip-config list", (st, f) => {
  rgCheck(f); const h = hostByNic(st, one(f, "nic-name"));
  if (isTable(f)) return { mut: false, text: table([{ Name: "ipconfig1", Primary: true, PrivateIPAddress: h.ip, Subnet: h.subnet, ResourceGroup: RG }]) };
  return [ipConfigView(h)];
}, true);
def("nic show-effective-route-table", (st, f) => {
  rgCheck(f); const h = hostByNic(st, one(f, "name"));
  const routes = effectiveRoutes(st, h.vnet, h.subnet);
  if (f.output?.[0]?.toLowerCase() === "table") return { mut: false, text: table(routes.map((r) => ({ Source: r.source, State: r.state, AddressPrefix: r.prefix, NextHopType: HOP_LABEL[r.type], NextHopIP: r.nhIp ?? "" }))) };
  return routes.map((r) => ({ addressPrefix: [r.prefix], nextHopIpAddress: r.nhIp ? [r.nhIp] : [], nextHopType: HOP_LABEL[r.type], source: r.source, state: r.state }));
}, true);
def("nic list-effective-nsg", (st, f) => {
  rgCheck(f); const h = hostByNic(st, one(f, "name"));
  const rows: Record<string, unknown>[] = [];
  ([["subnet", subnetNsg(st, h)], ["nic", h.nicNsg]] as const).forEach(([at, nsg]) => {
    if (!nsg) return;
    (["Inbound", "Outbound"] as Direction[]).forEach((d) => nsgRules(st, nsg, d).forEach((r) => rows.push({ AssociatedTo: at, Nsg: nsg, Direction: d, Priority: r.priority, Name: r.name, Access: r.access, Protocol: r.protocol, Source: r.src.join(" "), Destination: r.dst.join(" "), Ports: r.ports.join(" ") })));
  });
  return { mut: false, text: rows.length ? table(rows) : `lab: no network security group is associated with ${h.nic} or its subnet, so no NSG filtering applies.` };
}, true);
def("watcher test-ip-flow", (st, f) => {
  const vm = hostByVm(st, one(f, "vm"));
  const dir = pick(one(f, "direction"), DIRS, "direction");
  const proto = one(f, "protocol").toUpperCase();
  if (proto !== "TCP" && proto !== "UDP") E("lab: --protocol must be TCP or UDP.");
  const loc = ipPort(one(f, "local"), "local"), rem = ipPort(one(f, "remote"), "remote");
  if (loc.ip !== vm.ip) E(`lab: --local must be the VM's own private IP (${vm.ip}).`);
  const pkt = dir === "Inbound" ? { src: rem.ip, dst: loc.ip, port: loc.port, proto } : { src: loc.ip, dst: rem.ip, port: rem.port, proto };
  const order = dir === "Inbound" ? [subnetNsg(st, vm), vm.nicNsg] : [vm.nicNsg, subnetNsg(st, vm)];
  let res: { access: string; ruleName: string | null } = { access: "Allow", ruleName: null };
  for (const nsg of order) {
    if (!nsg) continue;
    const v = evalNsg(st, nsg, dir, pkt, vm.vnet);
    res = { access: v.access, ruleName: `${v.def ? "defaultSecurityRules" : "securityRules"}/${v.rule}` };
    if (v.access === "Deny") break;
  }
  return res;
}, true);
def("watcher show-next-hop", (st, f) => {
  const vm = hostByVm(st, one(f, "vm"));
  const si = one(f, "source-ip");
  if (si !== vm.ip) E(`lab: --source-ip must be the VM's own private IP (${vm.ip}).`);
  const dn = ip2n(one(f, "dest-ip"));
  if (dn === null) E("lab: --dest-ip must be an IPv4 address.");
  const best = lookup(effectiveRoutes(st, vm.vnet, vm.subnet), dn!);
  return { nextHopIpAddress: best?.nhIp ?? null, nextHopType: best ? HOP_WATCHER[best.type] : "None", routeTableId: best?.source === "User" ? id("routeTables", best.rt!) : "System Route" };
}, true);


// ---------- Private DNS zones and records ----------
def("private-dns zone create", (st, f) => {
  rgCheck(f); const z = one(f, "name").toLowerCase();
  if (st.zones[z]) E(`lab: private DNS zone ${z} already exists.`);
  st.zones[z] = { records: {}, links: {} };
  return { name: z, numberOfRecordSets: 1, numberOfVirtualNetworkLinks: 0, provisioningState: "Succeeded", resourceGroup: RG };
});
def("private-dns record-set a add-record", (st, f) => {
  rgCheck(f); const z = one(f, "zone-name").toLowerCase();
  const d = st.zones[z] ?? E(`lab: private DNS zone '${z}' was not found.`);
  const n = one(f, "record-set-name").toLowerCase(); const ip = one(f, "ipv4-address");
  if (ip2n(ip) === null) E(`lab: '${ip}' is not an IPv4 address.`);
  d.records[n] = ip;
  return { aRecords: [{ ipv4Address: ip }], fqdn: `${n === "@" ? "" : n + "."}${z}.`, name: n, provisioningState: "Succeeded", resourceGroup: RG, ttl: 3600 };
});
def("private-dns record-set a list", (st, f) => {
  rgCheck(f); const z = one(f, "zone-name").toLowerCase();
  const d = st.zones[z] ?? E(`lab: private DNS zone '${z}' was not found.`);
  const rows = Object.entries(d.records).map(([n, ip]) => ({ name: n, fqdn: `${n === "@" ? "" : n + "."}${z}.`, aRecords: [{ ipv4Address: ip }] }));
  if (isTable(f)) return { mut: false, text: table(rows.map((r) => ({ Name: r.name, Fqdn: r.fqdn, IPv4Address: r.aRecords[0].ipv4Address }))) || `lab: no A records in ${z}.` };
  return rows;
}, true);

// ---------- VPN gateways ----------
def("vnet-gateway list", (st, f) => {
  rgCheck(f);
  const rows = Object.entries(st.gateways ?? {}).map(([vn, g]) => ({ name: g.name, gatewayType: "Vpn", vpnType: "RouteBased", sku: { name: "VpnGw1" }, virtualNetwork: vn, connections: g.connections }));
  if (isTable(f)) return { mut: false, text: table(rows.map((r) => ({ Name: r.name, GatewayType: r.gatewayType, Sku: r.sku.name, VirtualNetwork: r.virtualNetwork }))) || "lab: no virtual network gateways in this lab." };
  return rows;
}, true);
def("local-gateway list", (st, f) => {
  rgCheck(f);
  const rows = Object.values(st.gateways ?? {}).flatMap((g) => g.connections.map((o) => ({ name: `lng-${o}`, localNetworkAddressSpace: { addressPrefixes: [...st.vnets[o].prefixes] } })));
  if (isTable(f)) return { mut: false, text: table(rows.map((r) => ({ Name: r.name, AddressPrefixes: r.localNetworkAddressSpace.addressPrefixes.join(" ") }))) || "lab: no local network gateways in this lab." };
  return rows;
}, true);

// ---------- Storage account network settings (az storage) ----------
const account = (st: State, name: string) => {
  const e = Object.entries(st.publicEndpoints).find(([, v]) => v.name === name);
  return e ? { ip: e[0], acc: e[1] } : E(`lab: storage account '${name}' was not found.`);
};
const accountView = (st: State, name: string) => {
  const { acc } = account(st, name);
  return {
    name, kind: "StorageV2", publicNetworkAccess: acc.publicAccess ? "Enabled" : "Disabled", resourceGroup: RG,
    networkRuleSet: { defaultAction: acc.defaultAction ?? "Allow", virtualNetworkRules: (acc.vnetRules ?? []).map((r) => ({ action: "Allow", virtualNetworkResourceId: id("subnets", r.subnet, `virtualNetworks/${r.vnet}`) })) },
  };
};
def("storage account show", (st, f) => accountView(st, one(f, "name")), true);
def("storage account update", (st, f) => {
  const name = one(f, "name"); const { acc } = account(st, name);
  if (!f["default-action"] && !f["public-network-access"]) E("lab: nothing to update. Pass --default-action or --public-network-access.");
  if (f["default-action"]) { const v = f["default-action"][0]; if (!/^(Allow|Deny)$/i.test(v)) E("lab: --default-action takes Allow or Deny."); acc.defaultAction = /^allow$/i.test(v) ? "Allow" : "Deny"; }
  if (f["public-network-access"]) { const v = f["public-network-access"][0]; if (!/^(Enabled|Disabled)$/i.test(v)) E("lab: --public-network-access takes Enabled or Disabled."); acc.publicAccess = /^enabled$/i.test(v); }
  return accountView(st, name);
});
def("storage account network-rule add", (st, f) => {
  const name = one(f, "account-name"); const { acc } = account(st, name);
  const sref = one(f, "subnet");
  const vn = sref.includes("/") ? (sref.match(/virtualNetworks\/([^/]+)/i)?.[1] ?? "") : one(f, "vnet-name");
  const sn = lastSeg(sref);
  const sub = getSubnet(st, vn, sn);
  if (!sub.serviceEndpoints?.length) E(`lab: subnet ${sn} in ${vn} doesn't have the Microsoft.Storage service endpoint. Enable it on the subnet first, then add the rule.`);
  if (!(acc.vnetRules ??= []).some((r) => r.vnet === vn && r.subnet === sn)) acc.vnetRules.push({ vnet: vn, subnet: sn });
  return accountView(st, name).networkRuleSet;
});
def("storage account network-rule list", (st, f) => ({ virtualNetworkRules: accountView(st, one(f, "account-name")).networkRuleSet.virtualNetworkRules }), true);

// ---------- Azure DNS Private Resolver (az dns-resolver) ----------
const resolvers = (st: State) => (st.resolvers ??= {});
const rulesets = (st: State) => (st.rulesets ??= {});
const getResolver = (st: State, n: string) => resolvers(st)[n] ?? E(`lab: DNS resolver '${n}' was not found.`);
const getRuleset = (st: State, n: string) => rulesets(st)[n] ?? E(`lab: DNS forwarding ruleset '${n}' was not found.`);
const subnetFromId = (st: State, ref: string) => {
  const m = ref.match(/virtualNetworks\/([^/,}\]]+)\/subnets\/([^/,}\]]+)/i);
  if (!m) return E("lab: pass the subnet's resource ID, like /subscriptions/.../virtualNetworks/<vnet>/subnets/<subnet>.");
  getSubnet(st, m[1], m[2]);
  return { vnet: m[1], subnet: m[2] };
};
def("dns-resolver list", (st, f) => {
  rgCheck(f);
  const rows = Object.entries(resolvers(st)).map(([n, r]) => ({ name: n, virtualNetwork: { id: id("virtualNetworks", r.vnet) }, resourceGroup: RG, dnsResolverState: "Connected" }));
  if (isTable(f)) return { mut: false, text: table(rows.map((r) => ({ Name: r.name, VirtualNetwork: lastSeg(r.virtualNetwork.id), State: r.dnsResolverState }))) || "lab: no DNS resolvers in this lab." };
  return rows;
}, true);
def("dns-resolver inbound-endpoint list", (st, f) => {
  rgCheck(f); const rn = one(f, "dns-resolver-name"); const r = getResolver(st, rn);
  const rows = Object.entries(r.inbound).map(([n, e]) => ({ name: n, ipConfigurations: [{ privateIpAddress: st.hosts[e.host].ip, privateIpAllocationMethod: "Dynamic", subnet: { id: id("subnets", e.subnet, `virtualNetworks/${r.vnet}`) } }] }));
  if (isTable(f)) return { mut: false, text: table(rows.map((x) => ({ Name: x.name, PrivateIpAddress: x.ipConfigurations[0].privateIpAddress, Subnet: lastSeg(x.ipConfigurations[0].subnet.id) }))) || "lab: no inbound endpoints." };
  return rows;
}, true);
def("dns-resolver inbound-endpoint create", (st, f) => {
  rgCheck(f); const rn = one(f, "dns-resolver-name"); const r = getResolver(st, rn); const n = one(f, "name");
  if (r.inbound[n]) E(`lab: inbound endpoint ${n} already exists.`);
  const { vnet, subnet } = subnetFromId(st, need(f, "ip-configurations", `--ip-configurations "[{private-ip-allocation-method:Dynamic,id:<subnet-id>}]"`).join(" "));
  if (vnet !== r.vnet) E(`lab: the endpoint's subnet must be in the resolver's virtual network, ${r.vnet}.`);
  const c = mustCidr(st.vnets[vnet].subnets[subnet].prefixes[0]);
  if (c.len > 28 || c.len < 24) E(`lab: ${subnet} is ${c.text}. A DNS resolver endpoint subnet must be between /28 and /24.`);
  if (Object.values(st.hosts).some((h) => h.vnet === vnet && h.subnet === subnet)) E(`lab: ${subnet} already has other resources in it. A DNS resolver endpoint needs a dedicated subnet, delegated to Microsoft.Network/dnsResolvers, with nothing else in it.`);
  const ip = n2ip(c.net + 4);
  const host = `${rn}-${n}`;
  st.hosts[host] = { name: host, kind: "dnsin", vnet, subnet, ip, nic: `${host}-nic`, nicNsg: null, ports: [53], forwarding: false, label: "Inbound endpoint" };
  r.inbound[n] = { subnet, host };
  return { name: n, ipConfigurations: [{ privateIpAddress: ip, privateIpAllocationMethod: "Dynamic" }], provisioningState: "Succeeded", resourceGroup: RG };
});
def("dns-resolver forwarding-ruleset list", (st, f) => {
  rgCheck(f);
  return Object.entries(rulesets(st)).map(([n, rs]) => ({ name: n, dnsResolverOutboundEndpoints: [{ id: `${rs.resolver}/outboundEndpoints` }], resourceGroup: RG }));
}, true);
def("dns-resolver forwarding-rule list", (st, f) => {
  rgCheck(f); const rs = getRuleset(st, one(f, "ruleset-name"));
  const rows = Object.entries(rs.rules).map(([n, r]) => ({ name: n, domainName: r.domain, forwardingRuleState: r.enabled ? "Enabled" : "Disabled", targetDnsServers: r.targets.map((t) => ({ ipAddress: t.split(":")[0], port: Number(t.split(":")[1] ?? 53) })) }));
  if (isTable(f)) return { mut: false, text: table(rows.map((r) => ({ Name: r.name, DomainName: r.domainName, State: r.forwardingRuleState, Targets: r.targetDnsServers.map((t) => `${t.ipAddress}:${t.port}`).join(" ") }))) || "lab: no rules in this ruleset." };
  return rows;
}, true);
function parseTargets(raw: string): string[] {
  const ips = [...raw.matchAll(/ip-?address[:=]\s*([\d.]+)(?:[^}]*?port[:=]\s*(\d+))?/gi)].map((m) => `${m[1]}:${m[2] ?? 53}`);
  return ips.length ? ips : E(`lab: --target-dns-servers looks like "[{ip-address:10.0.0.4,port:53}]".`);
}
def("dns-resolver forwarding-rule create", (st, f) => {
  rgCheck(f); const rs = getRuleset(st, one(f, "ruleset-name")); const n = one(f, "name");
  if (rs.rules[n]) E(`lab: rule ${n} already exists.`);
  const domain = one(f, "domain-name");
  if (!domain.endsWith(".")) E(`lab: forwarding rule domain names end with a dot, like ${domain}.`);
  const targets = parseTargets(need(f, "target-dns-servers").join(" "));
  if (targets.some((t) => t.startsWith("168.63.129.16:"))) E("Exception while making add request for rule\n(lab: 168.63.129.16 can't be the target of a forwarding rule.)");
  rs.rules[n] = { domain, targets, enabled: !/^disabled$/i.test(opt(f, "forwarding-rule-state") ?? "Enabled") };
  return { name: n, domainName: domain, forwardingRuleState: rs.rules[n].enabled ? "Enabled" : "Disabled", provisioningState: "Succeeded" };
});
def("dns-resolver forwarding-rule update", (st, f) => {
  rgCheck(f); const rs = getRuleset(st, one(f, "ruleset-name")); const n = one(f, "name");
  const r = rs.rules[n] ?? E(`lab: rule ${n} was not found.`);
  if (f["target-dns-servers"]) { const t = parseTargets(f["target-dns-servers"].join(" ")); if (t.some((x) => x.startsWith("168.63.129.16:"))) E("Exception while making add request for rule"); r.targets = t; }
  if (f["forwarding-rule-state"]) r.enabled = !/^disabled$/i.test(f["forwarding-rule-state"][0]);
  return { name: n, domainName: r.domain, forwardingRuleState: r.enabled ? "Enabled" : "Disabled", provisioningState: "Succeeded" };
});
def("dns-resolver vnet-link list", (st, f) => {
  rgCheck(f); const rs = getRuleset(st, one(f, "ruleset-name"));
  return Object.entries(rs.links).map(([n, v]) => ({ name: n, virtualNetwork: { id: id("virtualNetworks", v) } }));
}, true);
def("dns-resolver vnet-link create", (st, f) => {
  rgCheck(f); const rs = getRuleset(st, one(f, "ruleset-name")); const n = one(f, "name");
  const vn = vnetFromRef(st, one(f, "id"));
  if (rs.links[n]) E(`lab: link ${n} already exists.`);
  if (Object.values(rs.links).includes(vn)) E(`lab: ${vn} is already linked to this ruleset.`);
  rs.links[n] = vn;
  return { name: n, provisioningState: "Succeeded", virtualNetwork: { id: id("virtualNetworks", vn) } };
});

// ---------- Azure Firewall (az network firewall) ----------
const getFw = (st: State, n: string) => { const h = st.hosts[n]; return h?.kind === "fw" ? h : E(`lab: Azure Firewall '${n}' was not found.`); };
def("firewall show", (st, f) => { rgCheck(f); const h = getFw(st, one(f, "name")); return { name: h.name, ipConfigurations: [{ name: "FW-config", privateIpAddress: h.ip, subnet: { id: id("subnets", h.subnet, `virtualNetworks/${h.vnet}`) } }], networkRuleCollections: (h.fwRules ?? []).map((c) => ({ name: c.name, priority: c.priority, action: { type: c.action }, rules: c.rules })), provisioningState: "Succeeded", resourceGroup: RG }; }, true);
def("firewall ip-config list", (st, f) => { rgCheck(f); const h = getFw(st, one(f, "firewall-name")); return [{ name: "FW-config", privateIpAddress: h.ip }]; }, true);
def("firewall network-rule collection list", (st, f) => {
  rgCheck(f); const h = getFw(st, one(f, "firewall-name"));
  const cols = [...(h.fwRules ?? [])].sort((a, b) => a.priority - b.priority);
  if (isTable(f)) return { mut: false, text: table(cols.flatMap((c) => c.rules.map((r) => ({ Priority: c.priority, Collection: c.name, Action: c.action, Rule: r.name, Protocols: r.protocols.join(" "), Source: r.src.join(" "), Destination: r.dst.join(" "), Ports: r.ports.join(" ") })))) || "lab: no network rule collections. Azure Firewall denies everything until a rule allows it." };
  return cols.map((c) => ({ name: c.name, priority: c.priority, action: { type: c.action }, rules: c.rules.map((r) => ({ name: r.name, protocols: r.protocols, sourceAddresses: r.src, destinationAddresses: r.dst, destinationPorts: r.ports })) }));
}, true);
def("firewall network-rule create", (st, f) => {
  rgCheck(f); const h = getFw(st, one(f, "firewall-name"));
  const cn = one(f, "collection-name"), rn = one(f, "name");
  const protocols = need(f, "protocols").map((p) => p.toUpperCase());
  if (protocols.some((p) => !["ANY", "ICMP", "TCP", "UDP"].includes(p))) E("lab: --protocols takes Any, ICMP, TCP or UDP.");
  const ports = need(f, "destination-ports");
  const src = f["source-addresses"] ?? E("lab: pass --source-addresses (or --source-ip-groups).");
  const dst = f["destination-addresses"] ?? f["dest-addr"] ?? E("lab: pass --destination-addresses.");
  const cols = (h.fwRules ??= []);
  let c = cols.find((x) => x.name === cn);
  if (!c) {
    const pr = Number(one(f, "priority", "--priority 200 --action Allow (needed when the collection is new)"));
    const act = one(f, "action");
    if (!Number.isInteger(pr) || pr < 100 || pr > 65000) E("lab: --priority must be from 100 (high) to 65000 (low).");
    if (!/^(Allow|Deny)$/i.test(act)) E("lab: --action takes Allow or Deny.");
    if (cols.some((x) => x.priority === pr)) E(`lab: another rule collection already uses priority ${pr}.`);
    c = { name: cn, priority: pr, action: /^allow$/i.test(act) ? "Allow" : "Deny", rules: [] };
    cols.push(c);
  } else if (f.priority || f.action) E(`lab: collection ${cn} already exists. --priority and --action are only for a new collection.`);
  if (c.rules.some((r) => r.name === rn)) E(`lab: rule ${rn} already exists in ${cn}.`);
  c.rules.push({ name: rn, protocols, src, dst, ports });
  return { name: rn, protocols, sourceAddresses: src, destinationAddresses: dst, destinationPorts: ports };
});

// ---------- Public IPs and Azure Bastion ----------
def("public-ip create", (st, f) => {
  rgCheck(f); const n = one(f, "name");
  const ips = (st.publicIps ??= {});
  if (ips[n]) E(`lab: public IP ${n} already exists.`);
  const sku = opt(f, "sku") ?? "Standard";
  if (/^basic$/i.test(sku)) E("lab: Basic SKU public IP addresses were retired on September 30, 2025. Use --sku Standard.");
  ips[n] = { sku, ip: `198.51.100.${10 + Object.keys(ips).length}`, region: opt(f, "location") ?? "eastus2" };
  return { publicIp: { name: n, ipAddress: ips[n].ip, publicIPAllocationMethod: "Static", sku: { name: ips[n].sku }, provisioningState: "Succeeded" } };
});
const bastionView = (st: State, n: string) => { const b = st.bastions![n]; return { name: n, sku: { name: b.sku }, enableTunneling: b.tunneling, ipConfigurations: [{ subnet: { id: id("subnets", "AzureBastionSubnet", `virtualNetworks/${b.vnet}`) } }], provisioningState: "Succeeded", resourceGroup: RG }; };
def("bastion create", (st, f) => {
  rgCheck(f); const n = one(f, "name"); const vn = one(f, "vnet-name"); getVnet(st, vn);
  const bs = (st.bastions ??= {});
  if (bs[n]) E(`lab: Bastion ${n} already exists.`);
  const sku = opt(f, "sku") ?? "Standard";
  if (!/^(Basic|Standard|Premium|Developer)$/i.test(sku)) E("lab: --sku takes Basic, Standard, Premium or Developer.");
  if (!/^developer$/i.test(sku)) {
    const sn = st.vnets[vn].subnets["AzureBastionSubnet"];
    if (!sn) E(`lab: ${vn} has no subnet named AzureBastionSubnet. Bastion needs a dedicated subnet with exactly that name, /26 or larger.`);
    const c = mustCidr(sn!.prefixes[0]);
    if (c.len > 26) E(`lab: AzureBastionSubnet is ${c.text}. It must be /26 or larger.`);
    if (Object.values(st.hosts).some((h) => h.vnet === vn && h.subnet === "AzureBastionSubnet")) E("lab: AzureBastionSubnet can't contain other resources.");
    const pip = opt(f, "public-ip-address") ?? E("lab: --public-ip-address is required for all SKUs but Developer.");
    const ip = st.publicIps?.[lastSeg(pip)] ?? E(`lab: public IP '${pip}' was not found. Create one with az network public-ip create --sku Standard.`);
    if (!/^standard$/i.test(ip.sku)) E("lab: the SKU of the public IP must be Standard.");
    if ((ip.region ?? "eastus2") !== "eastus2") E(`lab: public IP ${lastSeg(pip)} is in ${ip.region}, but the Bastion and its virtual network are in eastus2. The public IP must be in the same region.`);
    const host = `${n}`;
    st.hosts[host] = { name: host, kind: "bastion", vnet: vn, subnet: "AzureBastionSubnet", ip: n2ip(c.net + 4), nic: `${host}-nic`, nicNsg: null, ports: [443], forwarding: false, label: "Bastion" };
    bs[n] = { vnet: vn, sku: sku[0].toUpperCase() + sku.slice(1).toLowerCase(), tunneling: truthy(opt(f, "enable-tunneling") ?? "false"), host };
  } else bs[n] = { vnet: vn, sku: "Developer", tunneling: false, host: "" };
  return bastionView(st, n);
});
def("bastion show", (st, f) => { rgCheck(f); const n = one(f, "name"); if (!st.bastions?.[n]) E(`lab: Bastion '${n}' was not found.`); return bastionView(st, n); }, true);
def("bastion list", (st, f) => { rgCheck(f); return Object.keys(st.bastions ?? {}).map((n) => bastionView(st, n)); }, true);


// ---------- Outbound access: NAT gateway ----------
def("nat gateway create", (st, f) => {
  rgCheck(f); const n = one(f, "name");
  const gws = (st.natGateways ??= {});
  if (gws[n]) E(`lab: NAT gateway ${n} already exists.`);
  const pips = need(f, "public-ip-addresses", "--public-ip-addresses pip-nat").map(lastSeg);
  pips.forEach((p) => { const ip = st.publicIps?.[p] ?? E(`lab: public IP '${p}' was not found.`); if (!/^standard/i.test(ip.sku)) E("lab: a NAT gateway needs Standard SKU public IPs."); });
  gws[n] = { pips };
  return { name: n, idleTimeoutInMinutes: Number(opt(f, "idle-timeout") ?? 4), publicIpAddresses: pips.map((p) => ({ id: id("publicIPAddresses", p) })), provisioningState: "Succeeded", resourceGroup: RG, sku: { name: "Standard" } };
});
def("nat gateway list", (st, f) => { rgCheck(f); return Object.entries(st.natGateways ?? {}).map(([n, g]) => ({ name: n, publicIpAddresses: g.pips.map((p) => ({ id: id("publicIPAddresses", p) })) })); }, true);
def("public-ip list", (st, f) => {
  rgCheck(f);
  const rows = Object.entries(st.publicIps ?? {}).map(([n, p]) => ({ name: n, ipAddress: p.ip ?? null, publicIPAllocationMethod: "Static", sku: { name: p.sku } }));
  if (isTable(f)) return { mut: false, text: table(rows.map((r) => ({ Name: r.name, IpAddress: r.ipAddress ?? "", Sku: r.sku.name }))) || "lab: no public IPs in this lab." };
  return rows;
}, true);

// ---------- Internal load balancer ----------
const getLb = (st: State, n: string) => st.lbs?.[n] ?? E(`lab: load balancer '${n}' was not found.`);
const probeView = (lbName: string, p: { name: string; protocol: string; port: number }) => ({ id: id("probes", p.name, `loadBalancers/${lbName}`), name: p.name, port: p.port, protocol: p.protocol, intervalInSeconds: 5 });
def("lb show", (st, f) => {
  rgCheck(f); const n = one(f, "name"); const lb = getLb(st, n); const fe = st.hosts[lb.host];
  return { name: n, sku: { name: "Standard" }, frontendIPConfigurations: [{ name: "frontend", privateIPAddress: fe.ip, subnet: { id: id("subnets", fe.subnet, `virtualNetworks/${fe.vnet}`) } }], backendAddressPools: [{ name: "backend-pool", backendIPConfigurations: lb.backends.map((b) => ({ id: id("ipConfigurations", "ipconfig1", `networkInterfaces/${st.hosts[b].nic}`) })) }], probes: [probeView(n, lb.probe)], loadBalancingRules: [{ name: lb.rule.name, frontendPort: lb.rule.frontendPort, backendPort: lb.rule.backendPort, protocol: "Tcp", probe: { id: id("probes", lb.probe.name, `loadBalancers/${n}`) } }], resourceGroup: RG };
}, true);
def("lb probe list", (st, f) => { rgCheck(f); const n = one(f, "lb-name"); const lb = getLb(st, n); if (isTable(f)) return { mut: false, text: table([{ Name: lb.probe.name, Protocol: lb.probe.protocol, Port: lb.probe.port, IntervalInSeconds: 5 }]) }; return [probeView(n, lb.probe)]; }, true);
def("lb probe update", (st, f) => {
  rgCheck(f); const n = one(f, "lb-name"); const lb = getLb(st, n);
  if (one(f, "name") !== lb.probe.name) E(`lab: probe ${f.name[0]} was not found on ${n}.`);
  if (f.port) { const p = Number(f.port[0]); if (!Number.isInteger(p) || p < 1 || p > 65535) E("lab: --port must be from 1 to 65535."); lb.probe.port = p; }
  if (f.protocol) { const v = f.protocol[0]; if (!/^(Http|Https|Tcp)$/i.test(v)) E("lab: --protocol takes Http, Https or Tcp."); if (!/^tcp$/i.test(v)) E("lab: this lab models TCP probes only."); lb.probe.protocol = "Tcp"; }
  return probeView(n, lb.probe);
});
def("route-table route delete", (st, f) => {
  rgCheck(f); const tn = one(f, "route-table-name"); const t = getRt(st, tn); const rn = one(f, "name");
  if (!t.routes.some((r) => r.name === rn)) E(`lab: route ${rn} was not found in ${tn}.`);
  t.routes = t.routes.filter((r) => r.name !== rn);
  return { mut: true, text: "" };
});

// ---------- Connection troubleshoot ----------
def("watcher test-connectivity", (st, f) => {
  rgCheck(f);
  const vm = hostByVm(st, one(f, "source-resource"));
  const addr = one(f, "dest-address"); const port = Number(one(f, "dest-port"));
  const proto = (opt(f, "protocol") ?? "Tcp").toLowerCase();
  if (!["tcp", "http", "https"].includes(proto)) E("lab: this lab models --protocol Tcp, Http and Https.");
  let ip = addr;
  if (ip2n(addr) === null) {
    const r = resolveFrom(st, vm.name, addr);
    if (!r.ip) return { connectionStatus: "Unreachable", hops: [{ type: "Source", address: vm.ip, issues: [{ origin: "Local", severity: "Error", type: "DnsResolution" }] }] };
    ip = r.ip;
  }
  const t = connect(st, vm.name, ip, port);
  const hopType = (n: string) => (st.hosts[n]?.kind === "nva" || st.hosts[n]?.kind === "fw" ? "VirtualAppliance" : "VnetLocal");
  const hops: Record<string, unknown>[] = [{ type: "Source", address: vm.ip, issues: [] as unknown[] }];
  t.path.slice(1).forEach((n) => hops.push({ type: hopType(n), address: st.hosts[n]?.ip ?? n, issues: [] }));
  if (t.service) hops.push({ type: "Internet", address: ip, issues: [] });
  if (!t.ok) {
    const nsgRule = t.reason?.match(/rule (\S+) \(priority/)?.[1];
    const type = t.stage === "nsg" ? "NetworkSecurityRule" : t.stage === "route" && /user-defined route|route \S+ points/.test(t.reason ?? "") ? "UserDefinedRoute" : t.stage === "firewall" ? "NetworkSecurityRule" : t.stage === "guest" ? "GuestFirewall" : t.stage === "port" ? "NoListenerOnDestination" : t.stage === "probe" ? "DIPProbeDown" : undefined;
    const origin = /^Outbound/.test(t.reason ?? "") ? "Outbound" : t.stage === "guest" || t.stage === "port" ? "Local" : "Inbound";
    const last = hops[hops.length - 1] as { issues: unknown[] };
    if (type) last.issues.push({ origin, severity: "Error", type, context: nsgRule ? [{ key: "RuleName", value: nsgRule }] : [] });
    return { connectionStatus: "Unreachable", probesSent: 30, probesFailed: 30, hops, lab: t.reason };
  }
  return { connectionStatus: "Reachable", avgLatencyInMs: 1, probesSent: 66, probesFailed: 0, hops };
}, true);

// ---------- Run Command: scripts inside the VM through the VM agent ----------
def("vm run-command invoke", (st, f) => {
  rgCheck(f);
  const vm = hostByVm(st, one(f, "name", "az vm run-command invoke -g rg-lab -n vm-web --command-id RunShellScript --scripts \"ufw status\""));
  if (vm.kind !== "vm" && vm.kind !== "dns") E(`lab: ${vm.name} is a managed network resource, not a virtual machine.`);
  const cmdId = one(f, "command-id");
  if (cmdId.toLowerCase() !== "runshellscript") E(cmdId.toLowerCase() === "ifconfig" ? "lab: this lab models RunShellScript only." : "The entity was not found in this Azure location");
  // --scripts takes space-separated script lines, so each value is its own line.
  const r = runScript(st, vm.name, need(f, "scripts").join("\n"));
  const message = `Enable succeeded: \n[stdout]\n${r.text}\n\n[stderr]\n`;
  const out = { value: [{ code: "ProvisioningState/succeeded", displayStatus: "Provisioning succeeded", level: "Info", message, time: null }] };
  // --query 'value[0].message' prints the message itself, the way Learn's examples read it.
  const picked = f.query ? getPath(out, f.query.join(" ")) : null;
  if (typeof picked === "string") return { mut: r.mut, text: picked };
  return { mut: r.mut, text: `${fmt(out, f)}${f.query || f.output ? "" : `\nlab: the message's stdout, readable:\n${r.text || "(no output)"}`}` };
});

// ---------- Sandbox: build anything, delete anything ----------
// Delete rules follow Microsoft Learn: an NSG or route table that's still associated can't be deleted, a subnet with
// resources in it can't be deleted, and a virtual network with resources attached can't be deleted.
const groupOf = (f: Flags) => { const g = one(f, "resource-group"); return Object.keys(CUR?.groups ?? { [RG]: 1 }).find((k) => k.toLowerCase() === g.toLowerCase()) ?? g; };
const sandboxOnly = (st: State, what: string) => { if (!st.groups) E(`lab: ${what} is only available in the sandbox. Levels keep their resources fixed.`); };

def("group create", (st, f) => {
  sandboxOnly(st, "Creating resource groups");
  const n = one(f, "name", "az group create --name rg-app --location eastus2");
  if (Object.keys(st.groups!).some((k) => k.toLowerCase() === n.toLowerCase())) E(`lab: resource group ${n} already exists.`);
  const subs = st.subscriptions ?? [];
  const want = opt(f, "subscription");
  const sub = want ? subs.find((x) => x.toLowerCase() === want.toLowerCase()) ?? E(`lab: subscription '${want}' was not found. Subscriptions here: ${subs.join(", ")}.`) : subs[0];
  st.groups![n] = { sub };
  return { id: `/subscriptions/${SUB}/resourceGroups/${n}`, location: opt(f, "location") ?? "eastus2", name: n, properties: { provisioningState: "Succeeded" }, subscription: sub };
});
def("group list", (st) => Object.entries(st.groups ?? { [RG]: { sub: "Lab subscription" } }).map(([n, g]) => ({ name: n, location: "eastus2", subscription: g.sub, properties: { provisioningState: "Succeeded" } })), true);
def("group delete", (st, f) => {
  sandboxOnly(st, "Deleting resource groups");
  const n = groupOf(f.name ? { "resource-group": f.name } : f);
  if (!st.groups![n]) E(`(ResourceGroupNotFound) Resource group '${n}' could not be found.`);
  if (Object.keys(st.groups!).length === 1) E("lab: this is the last resource group. Create another one before you delete it.");
  // Deleting a resource group deletes everything in it.
  const inGroup = (o: { rg?: string }) => (o.rg ?? RG) === n;
  const vnets = Object.keys(st.vnets).filter((v) => inGroup(st.vnets[v]));
  Object.values(st.hosts).filter((h) => inGroup(h) || vnets.includes(h.vnet)).forEach((h) => delete st.hosts[h.name]);
  vnets.forEach((v) => removeVnet(st, v));
  Object.keys(st.nsgs).filter((k) => inGroup(st.nsgs[k])).forEach((k) => { detachNsg(st, k); delete st.nsgs[k]; });
  Object.keys(st.rts).filter((k) => inGroup(st.rts[k])).forEach((k) => { detachRt(st, k); delete st.rts[k]; });
  delete st.groups![n];
  return { mut: true, text: `lab: deleted resource group ${n} and everything in it${vnets.length ? `, including ${vnets.join(", ")}` : ""}.` };
});
def("account list", (st) => (st.subscriptions ?? ["Lab subscription"]).map((n, k) => ({ name: n, id: `0000000${k}-0000-0000-0000-000000000000`, isDefault: k === 0, state: "Enabled" })), true);
def("account create", (st, f) => {
  sandboxOnly(st, "Creating subscriptions");
  const n = one(f, "display-name", "az account create --display-name Dev");
  if ((st.subscriptions ?? []).some((x) => x.toLowerCase() === n.toLowerCase())) E(`lab: subscription ${n} already exists.`);
  st.subscriptions = [...(st.subscriptions ?? []), n];
  return { mut: true, text: `${JSON.stringify({ displayName: n, state: "Enabled" }, null, 2)}\nlab: in real Azure, new subscriptions come from billing (an enrollment or billing account), not from networking. Here it's a label to group resource groups under. Put a group in it with az group create --name <rg> --subscription ${n}.` };
});

function detachNsg(st: State, n: string) {
  Object.values(st.vnets).forEach((v) => Object.values(v.subnets).forEach((s) => { if (s.nsg === n) s.nsg = null; }));
  Object.values(st.hosts).forEach((h) => { if (h.nicNsg === n) h.nicNsg = null; });
}
function detachRt(st: State, n: string) {
  Object.values(st.vnets).forEach((v) => Object.values(v.subnets).forEach((s) => { if (s.rt === n) s.rt = null; }));
}
function removeVnet(st: State, v: string) {
  Object.keys(st.peerings).filter((k) => st.peerings[k].vnet === v).forEach((k) => delete st.peerings[k]);
  Object.values(st.zones).forEach((z) => Object.keys(z.links).filter((k) => z.links[k].vnet === v).forEach((k) => delete z.links[k]));
  delete st.vnets[v];
  st.layout = st.layout.filter((x) => x !== v);
}

def("vnet delete", (st, f) => {
  rgCheck(f); const n = one(f, "name"); getVnet(st, n);
  const used = Object.values(st.hosts).filter((h) => h.vnet === n);
  if (used.length) E(`(InUseSubnetCannotBeDeleted) Subnet ${used[0].subnet} is in use by ${used[0].nic} and cannot be deleted. In order to delete the subnet, delete all the resources within the subnet.\nlab: delete ${used.map((h) => h.name).join(", ")} first, then the virtual network.`);
  const peers = Object.values(st.peerings).filter((p) => p.remote === n).map((p) => p.vnet);
  removeVnet(st, n);
  return { mut: true, text: `lab: deleted ${n}.${peers.length ? ` The peering link on ${peers.join(", ")} now shows Disconnected: its other side is gone. Delete it too.` : ""}` };
});
def("vnet subnet delete", (st, f) => {
  rgCheck(f); const v = one(f, "vnet-name"); const n = one(f, "name"); getSubnet(st, v, n);
  const used = Object.values(st.hosts).filter((h) => h.vnet === v && h.subnet === n);
  if (used.length) E(`(InUseSubnetCannotBeDeleted) Subnet ${n} is in use by ${used[0].nic} and cannot be deleted. In order to delete the subnet, delete all the resources within the subnet.\nlab: delete ${used.map((h) => h.name).join(", ")} first.`);
  delete st.vnets[v].subnets[n];
  return { mut: true, text: "" };
});
def("nsg delete", (st, f) => {
  rgCheck(f); const n = one(f, "name"); getNsg(st, n);
  const users = [
    ...Object.entries(st.vnets).flatMap(([v, vn]) => Object.entries(vn.subnets).filter(([, s]) => s.nsg === n).map(([sn]) => `subnet ${v}/${sn}`)),
    ...Object.values(st.hosts).filter((h) => h.nicNsg === n).map((h) => `network interface ${h.nic}`),
  ];
  if (users.length) E(`(InUseNetworkSecurityGroupCannotBeDeleted) Network security group ${n} cannot be deleted because it is in use by the following resources: ${users.join(", ")}. In order to delete the Network security group, remove the association with the resource(s).`);
  delete st.nsgs[n];
  return { mut: true, text: "" };
});
def("route-table delete", (st, f) => {
  rgCheck(f); const n = one(f, "name"); getRt(st, n);
  const users = Object.entries(st.vnets).flatMap(([v, vn]) => Object.entries(vn.subnets).filter(([, s]) => s.rt === n).map(([sn]) => `${v}/${sn}`));
  if (users.length) E(`(InUseRouteTableCannotBeDeleted) Route table ${n} is in use by subnet ${users.join(", ")} and cannot be deleted.\nlab: dissociate it first, for example az network vnet subnet update -g ${groupOf(f)} --vnet-name ${users[0].split("/")[0]} --name ${users[0].split("/")[1]} --route-table "".`);
  delete st.rts[n];
  return { mut: true, text: "" };
});

def("vm create", (st, f) => {
  sandboxOnly(st, "Creating VMs");
  rgCheck(f);
  const n = one(f, "name", "az vm create -g rg-lab -n vm-app --vnet-name vnet-spoke1 --subnet subnet-app --image Ubuntu2204");
  if (st.hosts[n]) E(`lab: a resource named ${n} already exists.`);
  const v = one(f, "vnet-name"); const sn = one(f, "subnet"); const s = getSubnet(st, v, sn);
  const image = (opt(f, "image") ?? "Ubuntu2204").toLowerCase();
  const os: "linux" | "windows" = /win/.test(image) ? "windows" : "linux";
  const c = mustCidr(s.prefixes[0]);
  const taken = new Set(Object.values(st.hosts).map((h) => h.ip));
  let ip = opt(f, "private-ip-address");
  if (ip) {
    const ipn = ip2n(ip);
    if (ipn === null || !within(mustCidr(`${ip}/32`), c)) E(`lab: ${ip} isn't inside ${sn} (${s.prefixes[0]}).`);
    if ((ipn! - c.net) < 4 || ipn === c.net + 2 ** (32 - c.len) - 1) E(`lab: ${ip} is one of the five addresses Azure reserves in ${sn}.`);
    if (taken.has(ip)) E(`lab: ${ip} is already used in ${sn}.`);
  } else {
    for (let k = 4; k < 2 ** (32 - c.len) - 1; k++) { const cand = n2ip(c.net + k); if (!taken.has(cand)) { ip = cand; break; } }
    if (!ip) E(`lab: ${sn} has no free addresses left.`);
  }
  const ports = os === "windows" ? [3389, 80, 443] : [22, 80, 443];
  st.hosts[n] = { name: n, kind: "vm", vnet: v, subnet: sn, ip: ip!, nic: `${n}VMNic`, nicNsg: null, ports, forwarding: false, rg: groupOf(f), os };
  return { mut: true, text: `${JSON.stringify({ fqdns: "", id: id("virtualMachines", n).replace("Microsoft.Network", "Microsoft.Compute"), location: "eastus2", privateIpAddress: ip, publicIpAddress: "", resourceGroup: groupOf(f) }, null, 2)}\nlab: ${n} (${os === "windows" ? "Windows" : "Linux"}) is in ${v}/${sn} at ${ip}. Lab VMs get no public IP and no NIC NSG, the same as passing --public-ip-address "" and --nsg "". It listens on ${ports.join(", ")}.` };
});
def("vm delete", (st, f) => {
  rgCheck(f); const n = one(f, "name"); const h = st.hosts[n];
  if (!h || h.kind !== "vm") E(`lab: virtual machine '${n}' was not found.`);
  delete st.hosts[n];
  return { mut: true, text: `lab: deleted ${n} and its network interface ${h!.nic}.` };
});

/** Sandbox: point out a build that won't carry traffic yet, the moment it's made. */
function buildWarnings(st: State, key: string, f: Flags): string[] {
  const out: string[] = [];
  if (key === "vnet peering create") {
    const v = opt(f, "vnet-name"), r = f["remote-vnet"] ? lastSeg(f["remote-vnet"][0]) : null;
    if (v && r && st.vnets[r] && !findLink(st, r, v)) out.push(`lab: note: this link shows Initiated until ${r} links back to ${v}. A peering needs a link on each side before traffic flows.`);
  }
  if (/^route-table route (create|update)$/.test(key) && /^virtualappliance$/i.test(opt(f, "next-hop-type") ?? "")) {
    const ip = opt(f, "next-hop-ip-address");
    const h = ip ? Object.values(st.hosts).find((x) => x.ip === ip) : null;
    if (ip && !h) out.push(`lab: note: nothing is at ${ip}, so traffic this route sends there is dropped.`);
    else if (h && !h.forwarding) out.push(`lab: note: ${h.name} at ${ip} doesn't have IP forwarding on, so it drops traffic that isn't addressed to it.`);
  }
  return out;
}

export function az(st: State, words: string[], f: Flags): AzResult & { notes: string[] } {
  CUR = st;
  // Most commands live under az network. Storage, DNS Private Resolver, VMs, resource groups and accounts have their own groups.
  const key = words[1] === "network" ? words.slice(2).join(" ") : ["storage", "dns-resolver", "vm", "group", "account"].includes(words[1]) ? words.slice(1).join(" ") : null;
  const h = key === null ? undefined : H[key];
  if (!h) {
    const typed = words.join(" ");
    const hint = suggestCommand(typed, SUPPORTED);
    return E(`lab: '${typed}' isn't part of this simulator.${hint ? `\n${hint}` : " Type help to see the supported commands."}`);
  }
  const notes: string[] = [];
  const out = h(st, f, notes);
  if (st.groups) notes.push(...buildWarnings(st, key!, f));
  if (out && typeof out === "object" && "mut" in (out as object) && "text" in (out as object)) return { ...(out as AzResult), notes };
  return { text: fmt(out, f), mut: !READ.has(key!), notes };
}

export const SUPPORTED = Object.keys(H).map((k) => (/^(storage|dns-resolver|vm|group|account) /.test(k) ? "az " : "az network ") + k);
