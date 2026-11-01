// Point-and-click actions. Each form builds the real az network command(s) it stands for,
// so the terminal shows exactly what ran, plus a plain explanation of what changed.
// Field names follow the Azure portal's own labels where the portal has an equivalent.
import { findLink, nsgRules } from "@/sim/network";
import { overlapNote } from "@/sim/overlap";
import type { Direction, State } from "@/sim/types";
import type { Selection } from "@/components/NetworkMap";

export type Values = Record<string, string>;

export interface Field {
  key: string;
  label: string;
  type: "text" | "select" | "check";
  options?: [string, string][];
  def?: string;
  placeholder?: string;
  help?: string;
  /** Only show the field when this returns true. */
  show?: (v: Values) => boolean;
}

export interface Built { cmds: string[]; why: string; /** Shown on the form before you apply, like an address space that overlaps another network. */ warn?: string }

export interface Action {
  id: string;
  title: string;
  kind: "fix" | "diagnose";
  fields: Field[];
  /** Recompute other fields when this key changes (for edit forms that pick an existing item). */
  prefillOn?: string;
  /** The command(s) this form builds, by their leading words. */
  verb?: string[];
  /** One line on what this tool checks, shown on the form and in the list. */
  about?: string;
  /** Where to read more on Microsoft Learn. */
  learnUrl?: string;
  prefill?: (v: Values) => Values;
  build: (v: Values) => Built | { error: string; warn?: string };
}

/** What each diagnose tool checks, in Microsoft Learn's words. Shared by the forms and the "What's this?" notes. */
export const ACTIONS_ABOUT = {
  ipflow: "Checks whether one packet is allowed or denied to or from a VM, and names the security rule that decided. Use it for security rule problems.",
  nexthop: "Shows where Azure sends a packet from a VM to an address: the next hop type, its IP, and which route table decided. Use it for routing problems.",
  routes: "Lists every route that applies to a VM's network interface: system routes, gateway routes and your route tables, and which are active.",
  conn: "Tests a real connection from a VM to a destination and reports whether it works, each hop on the way, and the issue that stops it.",
  nsg: "Shows every security rule applied to a VM's network interface, from the subnet's NSG and the NIC's NSG, in the order they're checked.",
};

const G = "-g rg-lab";
const q = (s: string) => (/[\s*]/.test(s) ? `'${s}'` : s);
const yes = (v: string) => v === "true";
const list = (s: string) => s.split(/[\s,]+/).filter(Boolean);
const opts = (names: string[]): [string, string][] => names.map((n) => [n, n]);
const hosts = (st: State, kinds = ["vm"]) => Object.values(st.hosts).filter((h) => kinds.includes(h.kind));
const err = (error: string) => ({ error });

const PROTO: [string, string][] = [["Any", "Any"], ["TCP", "TCP"], ["UDP", "UDP"]];
const PROTO_CLI: Record<string, string> = { Any: "'*'", TCP: "Tcp", UDP: "Udp" };
const SRC: [string, string][] = [["Any", "Any"], ["IP", "IP Addresses"], ["Tag", "Service Tag"]];
const TAGS = opts(["VirtualNetwork", "Internet", "AzureLoadBalancer", "Storage"]);
const HOP_TYPES: [string, string][] = [["VirtualAppliance", "Virtual appliance"], ["VnetLocal", "Virtual network"], ["Internet", "Internet"], ["None", "None"], ["VirtualNetworkGateway", "Virtual network gateway"]];
const hopLabel = (t: string) => HOP_TYPES.find((h) => h[0] === t)?.[1] ?? t;

/** Where a new rule lands relative to the custom rules already in that NSG and direction. */
function placement(st: State, nsg: string, dir: Direction, prio: number, except?: string) {
  const rules = nsgRules(st, nsg, dir).filter((r) => !r.def && r.name !== except);
  const after = rules.filter((r) => r.priority > prio).sort((a, b) => a.priority - b.priority)[0];
  const before = rules.filter((r) => r.priority < prio).sort((a, b) => b.priority - a.priority)[0];
  const parts: string[] = [];
  if (before) parts.push(`after ${before.name} (${before.priority})`);
  if (after) parts.push(`before ${after.name} (${after.priority})`);
  return parts.length ? ` Azure checks it ${parts.join(" and ")}, and the first rule that matches decides.` : " The first rule that matches decides, lowest priority number first.";
}

function srcValue(v: Values): string | null {
  if (v.source === "Any") return "*";
  if (v.source === "Tag") return v.tag;
  const ips = list(v.sourceIps ?? "");
  return ips.length ? ips.join(" ") : null;
}

const ruleFields = (dir: Direction): Field[] => [
  { key: "source", label: "Source", type: "select", options: SRC, def: "Any" },
  { key: "sourceIps", label: "Source IP addresses/CIDR ranges", type: "text", placeholder: "10.1.2.0/24", show: (v) => v.source === "IP" },
  { key: "tag", label: "Source service tag", type: "select", options: TAGS, def: "VirtualNetwork", show: (v) => v.source === "Tag" },
  { key: "dest", label: "Destination", type: "select", options: SRC, def: "Any" },
  { key: "destIps", label: "Destination IP addresses/CIDR ranges", type: "text", placeholder: "10.1.3.0/24", show: (v) => v.dest === "IP" },
  { key: "destTag", label: "Destination service tag", type: "select", options: TAGS, def: "VirtualNetwork", show: (v) => v.dest === "Tag" },
  { key: "ports", label: "Destination port ranges", type: "text", def: dir === "Inbound" ? "443" : "*", placeholder: "443 or 8000-8100" },
  { key: "protocol", label: "Protocol", type: "select", options: PROTO, def: "TCP" },
  { key: "access", label: "Action", type: "select", options: [["Allow", "Allow"], ["Deny", "Deny"]], def: "Allow" },
  { key: "priority", label: "Priority", type: "text", def: "300", help: "100 to 4096. Lower numbers are checked first." },
];

function addRule(st: State, nsg: string, dir: Direction): Action {
  return {
    id: `rule-add-${nsg}-${dir}`, title: `Add ${dir.toLowerCase()} security rule to ${nsg}`, kind: "fix",
    verb: ["az network nsg rule create"],
    fields: [...ruleFields(dir), { key: "name", label: "Name", type: "text", placeholder: "Allow-HTTPS-Client" }],
    build: (v) => {
      const src = srcValue(v);
      if (!src) return err("Enter at least one source IP address or CIDR range.");
      const dst = v.dest === "Tag" ? v.destTag : v.dest === "IP" ? list(v.destIps ?? "").join(" ") : "*";
      if (!dst) return err("Enter at least one destination IP address or CIDR range.");
      if (!v.name?.trim()) return err("Give the rule a name.");
      const p = Number(v.priority);
      const cmd = `az network nsg rule create ${G} --nsg-name ${nsg} --name ${v.name.trim()} --priority ${v.priority} --direction ${dir} --access ${v.access} --protocol ${PROTO_CLI[v.protocol]} --source-address-prefixes ${list(src).map(q).join(" ")}${dst !== "*" ? ` --destination-address-prefixes ${list(dst).map(q).join(" ")}` : ""} --destination-port-ranges ${list(v.ports).map(q).join(" ")}`;
      return { cmds: [cmd], why: `Adds an ${v.access} rule to ${nsg} for ${dir.toLowerCase()} ${v.protocol} traffic to ${dst === "*" ? "any destination" : dst} on port ${v.ports} from ${src === "*" ? "any source" : src}, at priority ${v.priority}.${Number.isFinite(p) ? placement(st, nsg, dir, p) : ""}` };
    },
  };
}

function editRule(st: State, nsg: string): Action | null {
  const rules = st.nsgs[nsg]?.rules ?? [];
  if (!rules.length) return null;
  const pre = (name: string): Values => {
    const r = rules.find((x) => x.name === name) ?? rules[0];
    const tagged = r.src.length === 1 && TAGS.some((t) => t[0] === r.src[0]);
    const dTagged = r.dst.length === 1 && TAGS.some((t) => t[0] === r.dst[0]);
    return {
      rule: r.name, priority: String(r.priority), access: r.access, ports: r.ports.join(" "),
      protocol: r.protocol === "*" ? "Any" : r.protocol.toUpperCase(),
      source: r.src[0] === "*" ? "Any" : tagged ? "Tag" : "IP", sourceIps: tagged || r.src[0] === "*" ? "" : r.src.join(" "), tag: tagged ? r.src[0] : "VirtualNetwork",
      dest: r.dst[0] === "*" ? "Any" : dTagged ? "Tag" : "IP", destIps: dTagged || r.dst[0] === "*" ? "" : r.dst.join(" "), destTag: dTagged ? r.dst[0] : "VirtualNetwork",
    };
  };
  return {
    id: `rule-edit-${nsg}`, title: `Edit a security rule in ${nsg}`, kind: "fix",
    verb: ["az network nsg rule update"],
    fields: [{ key: "rule", label: "Rule", type: "select", options: opts(rules.map((r) => r.name)), def: rules[0].name }, ...ruleFields("Inbound").map((f) => ({ ...f, def: undefined }))],
    prefillOn: "rule", prefill: (v) => pre(v.rule),
    build: (v) => {
      const r = rules.find((x) => x.name === v.rule);
      if (!r) return err("Pick a rule.");
      const src = srcValue(v);
      if (!src) return err("Enter at least one source IP address or CIDR range.");
      const parts: string[] = [];
      const said: string[] = [];
      if (v.priority !== String(r.priority)) { parts.push(`--priority ${v.priority}`); said.push(`priority ${r.priority} → ${v.priority}`); }
      if (v.access !== r.access) { parts.push(`--access ${v.access}`); said.push(`action ${r.access} → ${v.access}`); }
      if (list(v.ports).join(" ") !== r.ports.join(" ")) { parts.push(`--destination-port-ranges ${list(v.ports).map(q).join(" ")}`); said.push(`ports → ${v.ports}`); }
      const proto = PROTO_CLI[v.protocol].replace(/'/g, "");
      if (proto.toLowerCase() !== r.protocol.toLowerCase()) { parts.push(`--protocol ${PROTO_CLI[v.protocol]}`); said.push(`protocol → ${v.protocol}`); }
      if (list(src).join(" ") !== r.src.join(" ")) { parts.push(`--source-address-prefixes ${list(src).map(q).join(" ")}`); said.push(`source → ${src === "*" ? "any" : src}`); }
      const dst = v.dest === "Tag" ? v.destTag : v.dest === "IP" ? list(v.destIps ?? "").join(" ") : "*";
      if (!dst) return err("Enter at least one destination IP address or CIDR range.");
      if (list(dst).join(" ") !== r.dst.join(" ")) { parts.push(`--destination-address-prefixes ${list(dst).map(q).join(" ")}`); said.push(`destination → ${dst === "*" ? "any" : dst}`); }
      if (!parts.length) return err(`These are ${r.name}'s current settings. Change one to apply.`);
      const p = Number(v.priority);
      return { cmds: [`az network nsg rule update ${G} --nsg-name ${nsg} --name ${r.name} ${parts.join(" ")}`], why: `Changes ${r.name} in ${nsg}: ${said.join(", ")}.${Number.isFinite(p) ? placement(st, nsg, r.direction, p, r.name) : ""}` };
    },
  };
}

function deleteRule(st: State, nsg: string): Action | null {
  const rules = st.nsgs[nsg]?.rules ?? [];
  if (!rules.length) return null;
  return {
    id: `rule-del-${nsg}`, title: `Delete a security rule from ${nsg}`, kind: "fix",
    verb: ["az network nsg rule delete"],
    fields: [{ key: "rule", label: "Rule", type: "select", options: opts(rules.map((r) => r.name)), def: rules[0].name }],
    build: (v) => ({ cmds: [`az network nsg rule delete ${G} --nsg-name ${nsg} --name ${v.rule}`], why: `Removes ${v.rule} from ${nsg}. Traffic it matched now falls through to the next rule by priority, ending at the default rules.` }),
  };
}

function routeFields(): Field[] {
  return [
    { key: "prefix", label: "Destination IP addresses/CIDR ranges", type: "text", placeholder: "10.2.0.0/16" },
    { key: "type", label: "Next hop type", type: "select", options: HOP_TYPES, def: "VirtualAppliance" },
    { key: "nh", label: "Next hop address", type: "text", placeholder: "10.0.2.4", show: (v) => v.type === "VirtualAppliance" },
  ];
}

function addRoute(st: State, rt: string): Action {
  return {
    id: `route-add-${rt}`, title: `Add a route to ${rt}`, kind: "fix",
    verb: ["az network route-table route create"],
    fields: [{ key: "name", label: "Route name", type: "text", placeholder: "to-spoke2" }, ...routeFields()],
    build: (v) => {
      if (!v.name?.trim()) return err("Give the route a name.");
      if (!v.prefix?.trim()) return err("Enter the destination range in CIDR, like 10.2.0.0/16.");
      if (v.type === "VirtualAppliance" && !v.nh?.trim()) return err("A Virtual appliance route needs the appliance's private IP as the next hop address.");
      const nh = v.type === "VirtualAppliance" ? ` --next-hop-ip-address ${v.nh.trim()}` : "";
      return { cmds: [`az network route-table route create ${G} --route-table-name ${rt} --name ${v.name.trim()} --address-prefix ${v.prefix.trim()} --next-hop-type ${v.type}${nh}`], why: `Sends traffic for ${v.prefix} from every subnet using ${rt} to ${hopLabel(v.type)}${nh ? ` at ${v.nh}` : ""}. Azure uses the longest matching prefix, and a route you add beats a system route with the same prefix.` };
    },
  };
}

function editRoute(st: State, rt: string): Action | null {
  const routes = st.rts[rt]?.routes ?? [];
  if (!routes.length) return null;
  const pre = (n: string): Values => { const r = routes.find((x) => x.name === n) ?? routes[0]; return { route: r.name, prefix: r.prefix, type: r.type, nh: r.nhIp ?? "" }; };
  return {
    id: `route-edit-${rt}`, title: `Edit a route in ${rt}`, kind: "fix",
    verb: ["az network route-table route update"],
    fields: [{ key: "route", label: "Route", type: "select", options: opts(routes.map((r) => r.name)), def: routes[0].name }, ...routeFields()],
    prefillOn: "route", prefill: (v) => pre(v.route),
    build: (v) => {
      const r = routes.find((x) => x.name === v.route);
      if (!r) return err("Pick a route.");
      const parts: string[] = [];
      if (v.prefix.trim() !== r.prefix) parts.push(`--address-prefix ${v.prefix.trim()}`);
      if (v.type !== r.type) parts.push(`--next-hop-type ${v.type}`);
      if (v.type === "VirtualAppliance" && v.nh.trim() !== (r.nhIp ?? "")) parts.push(`--next-hop-ip-address ${v.nh.trim()}`);
      if (!parts.length) return err("These are the current settings. Change one to apply.");
      return { cmds: [`az network route-table route update ${G} --route-table-name ${rt} --name ${r.name} ${parts.join(" ")}`], why: `Updates ${r.name} so traffic for ${v.prefix} goes to ${hopLabel(v.type)}${v.type === "VirtualAppliance" ? ` at ${v.nh}` : ""}.` };
    },
  };
}

function subnetActions(st: State, vn: string, sn: string): Action[] {
  const s = st.vnets[vn].subnets[sn];
  const out: Action[] = [];
  const nsgs = Object.keys(st.nsgs), rts = Object.keys(st.rts);
  out.push({
    id: `sn-nsg-${vn}-${sn}`, title: `Associate a network security group with ${sn}`, kind: "fix",
    verb: ["az network vnet subnet update"],
    fields: [{ key: "nsg", label: "Network security group", type: "select", options: opts(nsgs), def: s.nsg ?? nsgs[0], help: nsgs.length ? undefined : "No NSGs exist yet. Create one first from the Create menu." }],
    build: (v) => (v.nsg ? { cmds: [`az network vnet subnet update ${G} --vnet-name ${vn} --name ${sn} --network-security-group ${v.nsg}`], why: `Every NIC in ${sn} is now filtered by ${v.nsg}. For inbound traffic Azure checks the subnet NSG first, then the NIC's NSG if it has one.` } : err("Create a network security group first.")),
  });
  out.push({
    id: `sn-rt-${vn}-${sn}`, title: `Associate a route table with ${sn}`, kind: "fix",
    verb: ["az network vnet subnet update"],
    fields: [{ key: "rt", label: "Route table", type: "select", options: opts(rts), def: s.rt ?? rts[0], help: rts.length ? undefined : "No route tables exist yet. Create one first from the Create menu." }],
    build: (v) => (v.rt ? { cmds: [`az network vnet subnet update ${G} --vnet-name ${vn} --name ${sn} --route-table ${v.rt}`], why: `Traffic leaving ${sn} now follows the routes in ${v.rt} on top of the system routes.` } : err("Create a route table first.")),
  });
  const nats = Object.keys(st.natGateways ?? {});
  if (nats.length) out.push({
    id: `sn-nat-${vn}-${sn}`, title: `Associate a NAT gateway with ${sn}`, kind: "fix",
    verb: ["az network vnet subnet update"],
    fields: [{ key: "nat", label: "NAT gateway", type: "select", options: opts(nats), def: s.natGateway ?? nats[0] }],
    build: (x) => ({ cmds: [`az network vnet subnet update ${G} --vnet-name ${vn} --name ${sn} --nat-gateway ${x.nat}`], why: `VMs in ${sn} reach the internet through ${x.nat} and its public IP. A user-defined route to an appliance or gateway still wins over it.` }),
  });
  out.push({
    id: `sn-private-${vn}-${sn}`, title: `Private subnet setting for ${sn}`, kind: "fix",
    verb: ["az network vnet subnet update"],
    fields: [{ key: "priv", label: "Enable private subnet (no default outbound access)", type: "check", def: String(s.defaultOutbound === false) }],
    build: (x) => ({ cmds: [`az network vnet subnet update ${G} --vnet-name ${vn} --name ${sn} --default-outbound ${x.priv === "true" ? "false" : "true"}`], why: x.priv === "true" ? `${sn} is private: VMs need an explicit outbound method, like a NAT gateway, to reach the internet. Existing VMs pick up the change only after they're stopped and deallocated.` : `${sn} gives VMs default outbound access again, through an IP Microsoft owns and can change.` }),
  });
  out.push({
    id: `sn-se-${vn}-${sn}`, title: `Service endpoints on ${sn}`, kind: "fix",
    verb: ["az network vnet subnet update"],
    fields: [{ key: "se", label: "Services", type: "select", options: [["Microsoft.Storage", "Microsoft.Storage (same region)"], ["Microsoft.Storage.Global", "Microsoft.Storage.Global (any region)"]], def: s.serviceEndpoints?.[0] ?? "Microsoft.Storage" }],
    build: (x) => ({ cmds: [`az network vnet subnet update ${G} --vnet-name ${vn} --name ${sn} --service-endpoints ${x.se}`], why: `Traffic from ${sn} to Azure Storage now uses the subnet's private address as its source, so storage accounts can allow ${sn} with a virtual network rule. DNS doesn't change: names still resolve to the public IP.` }),
  });
  if (s.nsg) out.push(addRule(st, s.nsg, "Inbound"), addRule(st, s.nsg, "Outbound"), ...[editRule(st, s.nsg), deleteRule(st, s.nsg)].filter((a): a is Action => !!a));
  if (s.rt && st.rts[s.rt]) out.push(addRoute(st, s.rt), ...[editRoute(st, s.rt), deleteRoute(st, s.rt)].filter((a): a is Action => !!a));
  return out;
}

function peeringAction(st: State, vn: string): Action | null {
  const others = Object.keys(st.vnets).filter((x) => x !== vn && !findLink(st, vn, x));
  if (!others.length) return null;
  const short = (n: string) => n.replace(/^vnet-/, "");
  return {
    id: `peer-${vn}`, title: `Add a peering from ${vn}`, kind: "fix",
    verb: ["az network vnet peering create"],
    fields: [
      { key: "remote", label: "Remote virtual network", type: "select", options: opts(others), def: others[0] },
      { key: "remoteName", label: "Remote peering link name (on the remote network)", type: "text", placeholder: "remote-to-local", show: (v) => !findLink(st, v.remote, vn) },
      { key: "remoteAccess", label: "Allow the remote network to access this one", type: "check", def: "true", show: (v) => !findLink(st, v.remote, vn) },
      { key: "remoteFwd", label: "Allow the remote network to receive forwarded traffic from this one", type: "check", def: "false", show: (v) => !findLink(st, v.remote, vn) },
      { key: "localName", label: "Local peering link name (on this network)", type: "text", placeholder: "local-to-remote" },
      { key: "localAccess", label: `Allow ${vn} to access the remote network`, type: "check", def: "true" },
      { key: "localFwd", label: `Allow ${vn} to receive forwarded traffic from the remote network`, type: "check", def: "false" },
    ],
    prefillOn: "remote",
    prefill: (v) => ({ remote: v.remote, localName: `${short(vn)}-to-${short(v.remote)}`, remoteName: `${short(v.remote)}-to-${short(vn)}` }),
    build: (v) => {
      if (!v.localName?.trim()) return err("Name the local peering link.");
      const cmds = [`az network vnet peering create ${G} --name ${v.localName.trim()} --vnet-name ${vn} --remote-vnet ${v.remote} --allow-vnet-access ${yes(v.localAccess)}${yes(v.localFwd) ? " --allow-forwarded-traffic true" : ""}`];
      const remoteExists = !!findLink(st, v.remote, vn);
      if (!remoteExists) {
        if (!v.remoteName?.trim()) return err("Name the remote peering link.");
        cmds.push(`az network vnet peering create ${G} --name ${v.remoteName.trim()} --vnet-name ${v.remote} --remote-vnet ${vn} --allow-vnet-access ${yes(v.remoteAccess)}${yes(v.remoteFwd) ? " --allow-forwarded-traffic true" : ""}`);
      }
      return { cmds, why: remoteExists
        ? `Creates the missing link on ${vn}. ${v.remote} already has its side, so the peering moves from Initiated to Connected.`
        : `The portal form creates both links at once. In the CLI that's two commands, one per network, and the peering is Connected only when both sides exist.${!yes(v.localAccess) || !yes(v.remoteAccess) ? " One side has access turned off, so that direction carries no traffic." : ""}` };
    },
  };
}

function vnetActions(st: State, vn: string): Action[] {
  const v = st.vnets[vn];
  const out: Action[] = [
    {
      id: `vnet-space-${vn}`, title: `Edit the address space of ${vn}`, kind: "fix",
    verb: ["az network vnet update"],
      fields: [{ key: "space", label: "Address space", type: "text", def: v.prefixes.join(" "), help: "Space-separated CIDR ranges. This replaces the whole list." }],
      build: (x) => (list(x.space).length ? { cmds: [`az network vnet update ${G} --name ${vn} --address-prefixes ${list(x.space).join(" ")}`], why: `${vn} now owns ${list(x.space).join(", ")}. Every subnet must stay inside it, and peered networks can't overlap it.` } : err("Enter at least one CIDR range.")),
    },
    {
      id: `subnet-add-${vn}`, title: `Add a subnet to ${vn}`, kind: "fix",
    verb: ["az network vnet subnet create"],
      fields: [{ key: "name", label: "Name", type: "text", placeholder: "subnet-api" }, { key: "range", label: "Subnet address range (CIDR)", type: "text", placeholder: "10.1.3.0/26" }],
      build: (x) => (x.name?.trim() && x.range?.trim() ? { cmds: [`az network vnet subnet create ${G} --vnet-name ${vn} --name ${x.name.trim()} --address-prefixes ${x.range.trim()}`], why: `Carves ${x.range} out of ${vn}'s address space. Azure reserves 5 addresses in every subnet, so the usable count is the range size minus 5.` } : err("Enter a name and a CIDR range.")),
    },
  ];
  if (!v.onprem) out.push({
    id: `vnet-dns-${vn}`, title: `DNS servers for ${vn}`, kind: "fix",
    verb: ["az network vnet update"],
    fields: [
      { key: "mode", label: "DNS servers", type: "select", options: [["default", "Default (Azure-provided)"], ["custom", "Custom"]], def: v.dnsServers?.length && v.dnsServers[0] !== "168.63.129.16" ? "custom" : "default" },
      { key: "ips", label: "IP address", type: "text", def: (v.dnsServers ?? []).filter((x) => x !== "168.63.129.16").join(" "), placeholder: "10.0.4.4", show: (x) => x.mode === "custom" },
    ],
    build: (x) => {
      if (x.mode !== "custom") return { cmds: [`az network vnet update ${G} --name ${vn} --dns-servers ""`], why: `${vn} uses Azure-provided DNS again: an empty list means the default, 168.63.129.16, so linked private zones and forwarding ruleset links apply.` };
      const ips = list(x.ips ?? "");
      return ips.length ? { cmds: [`az network vnet update ${G} --name ${vn} --dns-servers ${ips.join(" ")}`], why: `VMs in ${vn} send DNS to ${ips.join(", ")} instead of Azure DNS. That server decides how names resolve.` } : err("Enter at least one DNS server IP.");
    },
  });
  const p = peeringAction(st, vn);
  if (p) out.push(p);
  return out;
}

function peerActions(st: State, a: string, b: string): Action[] {
  const sides = [[a, b], [b, a]].map(([x, y]) => findLink(st, x, y)).filter((l): l is NonNullable<typeof l> => !!l);
  const out: Action[] = sides.map((l) => ({
    id: `peer-edit-${l.vnet}-${l.name}`, title: `Edit peering link ${l.name} on ${l.vnet}`, kind: "fix" as const,
    verb: ["az network vnet peering update"],
    fields: [
      { key: "access", label: `Allow ${l.vnet} to access ${l.remote}`, type: "check" as const, def: String(l.allowVnetAccess) },
      { key: "fwd", label: `Allow ${l.vnet} to receive forwarded traffic from ${l.remote}`, type: "check" as const, def: String(l.allowForwarded) },
      { key: "gwt", label: `Allow gateway or route server in '${l.vnet}' to forward traffic to the peered virtual network`, type: "check" as const, def: String(!!l.allowGatewayTransit), show: () => !!st.gateways?.[l.vnet] },
      { key: "urg", label: `Enable '${l.vnet}' to use the peered virtual networks' remote gateway or route server`, type: "check" as const, def: String(!!l.useRemoteGateways), show: () => !!st.gateways?.[l.remote] },
    ],
    build: (v: Values) => {
      const parts: string[] = [];
      if (yes(v.access) !== l.allowVnetAccess) parts.push(`--allow-vnet-access ${yes(v.access)}`);
      if (yes(v.fwd) !== l.allowForwarded) parts.push(`--allow-forwarded-traffic ${yes(v.fwd)}`);
      if (st.gateways?.[l.vnet] && yes(v.gwt) !== !!l.allowGatewayTransit) parts.push(`--allow-gateway-transit ${yes(v.gwt)}`);
      if (st.gateways?.[l.remote] && yes(v.urg) !== !!l.useRemoteGateways) parts.push(`--use-remote-gateways ${yes(v.urg)}`);
      if (!parts.length) return err("These are the current settings. Change one to apply.");
      return { cmds: [`az network vnet peering update ${G} --name ${l.name} --vnet-name ${l.vnet} ${parts.join(" ")}`], why: `Updates ${l.vnet}'s side of the peering. Access controls whether traffic from ${l.vnet} can reach ${l.remote} over this peering. Forwarded traffic controls whether traffic that an appliance forwarded, not traffic that started in ${l.remote}, is accepted.${v.gwt !== undefined || v.urg !== undefined ? " Gateway transit lets a spoke use the hub's VPN gateway: the hub allows it, then the spoke uses the remote gateway." : ""}` };
    },
  }));
  sides.forEach((l) => out.push({
    id: `peer-sync-${l.vnet}-${l.name}`, title: `Sync peering link ${l.name} on ${l.vnet}`, kind: "fix" as const, fields: [],
    verb: ["az network vnet peering sync"],
    build: () => ({ cmds: [`az network vnet peering sync ${G} --vnet-name ${l.vnet} --name ${l.name}`], why: `${l.vnet} now knows ${l.remote}'s current address space, so routes cover any range ${l.remote} added since the peering was made.` }),
  }));
  const missing = [[a, b], [b, a]].find(([x, y]) => !findLink(st, x, y));
  if (missing) { const p = peeringAction(st, missing[0]); if (p) out.unshift({ ...p, title: `Create the missing link on ${missing[0]}` }); }
  return out;
}

function zoneActions(st: State, z: string): Action[] {
  const linked = new Set(Object.values(st.zones[z].links).map((l) => l.vnet));
  const free = Object.keys(st.vnets).filter((v) => !linked.has(v) && !st.vnets[v].onprem);
  const record: Action = {
    id: `zone-record-${z}`, title: `Add an A record to ${z}`, kind: "fix",
    verb: ["az network private-dns record-set a add-record"],
    fields: [{ key: "name", label: "Name", type: "text", placeholder: "db" }, { key: "ip", label: "IP address", type: "text", placeholder: "10.1.3.4" }],
    build: (v) => (v.name?.trim() && v.ip?.trim() ? { cmds: [`az network private-dns record-set a add-record ${G} --zone-name ${z} --record-set-name ${v.name.trim()} --ipv4-address ${v.ip.trim()}`], why: `${v.name.trim()}.${z} now answers ${v.ip.trim()} for every virtual network linked to the zone.` } : err("Enter a name and an IP address.")),
  };
  if (!free.length) return [record];
  return [record, {
    id: `zone-link-${z}`, title: `Add a virtual network link to ${z}`, kind: "fix",
    verb: ["az network private-dns link vnet create"],
    fields: [
      { key: "vnet", label: "Virtual network", type: "select", options: opts(free), def: free[0] },
      { key: "name", label: "Link name", type: "text", placeholder: "link-spoke1" },
      { key: "reg", label: "Enable auto registration", type: "check", def: "false" },
    ],
    prefillOn: "vnet", prefill: (v) => ({ vnet: v.vnet, name: `link-${v.vnet.replace(/^vnet-/, "")}` }),
    build: (v) => (v.name?.trim() ? { cmds: [`az network private-dns link vnet create ${G} --name ${v.name.trim()} --zone-name ${z} --virtual-network ${v.vnet} --registration-enabled ${yes(v.reg)}`], why: `VMs in ${v.vnet} can now resolve names in ${z}. Without a link, the private zone is invisible to that network and the name resolves to the public address.` } : err("Name the link.")),
  }];
}

function firewallRule(h: import("@/sim/types").Host): Action {
  const cols = (h.fwRules ?? []).map((c) => c.name);
  return {
    id: `fw-rule-${h.name}`, title: `Add a network rule to ${h.name}`, kind: "fix",
    verb: ["az network firewall network-rule create"],
    fields: [
      { key: "col", label: "Rule collection", type: "select", options: [...opts(cols), ["__new", "New collection"]], def: cols[0] ?? "__new" },
      { key: "colName", label: "Collection name", type: "text", placeholder: "Allow-App", show: (v) => v.col === "__new" },
      { key: "priority", label: "Priority", type: "text", def: "200", help: "100 (checked first) to 65000. Only for a new collection.", show: (v) => v.col === "__new" },
      { key: "action", label: "Action", type: "select", options: [["Allow", "Allow"], ["Deny", "Deny"]], def: "Allow", show: (v) => v.col === "__new" },
      { key: "name", label: "Rule name", type: "text", placeholder: "https" },
      { key: "proto", label: "Protocol", type: "select", options: [["TCP", "TCP"], ["UDP", "UDP"], ["Any", "Any"], ["ICMP", "ICMP"]], def: "TCP" },
      { key: "src", label: "Source", type: "text", placeholder: "10.1.0.0/16" },
      { key: "dst", label: "Destination Address", type: "text", placeholder: "10.2.0.0/16" },
      { key: "ports", label: "Destination ports", type: "text", def: "443" },
    ],
    build: (v) => {
      const isNew = v.col === "__new";
      const col = isNew ? v.colName?.trim() : v.col;
      if (!col) return err("Name the new collection.");
      if (!v.name?.trim() || !list(v.src ?? "").length || !list(v.dst ?? "").length || !list(v.ports ?? "").length) return err("Fill in the rule name, source, destination and ports.");
      const extra = isNew ? ` --priority ${v.priority} --action ${v.action}` : "";
      return { cmds: [`az network firewall network-rule create ${G} --firewall-name ${h.name} --collection-name ${col} --name ${v.name.trim()}${extra} --protocols ${v.proto} --source-addresses ${list(v.src).join(" ")} --destination-addresses ${list(v.dst).join(" ")} --destination-ports ${list(v.ports).join(" ")}`], why: `Azure Firewall checks collections by priority, lowest first, and the first matching rule decides. Anything no rule allows is denied.` };
    },
  };
}

/** Resources that aren't drawn as their own box on the map: unassociated route tables, storage accounts and DNS Private Resolver. */
export function serviceActions(st: State): Action[] {
  const out: Action[] = [];
  const subnets = Object.entries(st.vnets).filter(([, v]) => !v.onprem).flatMap(([vn, v]) => Object.keys(v.subnets).map((sn) => `${vn}/${sn}`));
  // Route tables are resources of their own: add routes before the table is on any subnet.
  const used = new Set(Object.values(st.vnets).flatMap((v) => Object.values(v.subnets).map((x) => x.rt)));
  Object.keys(st.rts).filter((rt) => !used.has(rt)).forEach((rt) => out.push(addRoute(st, rt)));
  for (const ep of Object.values(st.publicEndpoints)) {
    out.push({
      id: `st-net-${ep.name}`, title: `Networking for storage account ${ep.name}`, kind: "fix",
      verb: ["az storage account update"],
      fields: [
        { key: "pna", label: "Public network access", type: "select", options: [["Enabled", "Enabled"], ["Disabled", "Disabled"]], def: ep.publicAccess ? "Enabled" : "Disabled" },
        { key: "def", label: "Public network access scope", type: "select", options: [["Allow", "Enabled from all networks"], ["Deny", "Enabled from selected networks"]], def: ep.defaultAction ?? "Allow", show: (v) => v.pna === "Enabled" },
      ],
      build: (v) => {
        const parts: string[] = [];
        if ((v.pna === "Enabled") !== ep.publicAccess) parts.push(`--public-network-access ${v.pna}`);
        if (v.pna === "Enabled" && v.def !== (ep.defaultAction ?? "Allow")) parts.push(`--default-action ${v.def}`);
        if (!parts.length) return err("These are the current settings. Change one to apply.");
        return { cmds: [`az storage account update --name ${ep.name} ${parts.join(" ")}`], why: v.pna === "Disabled" ? `Only private endpoints reach ${ep.name} now. Service endpoints stop working too.` : v.def === "Deny" ? `${ep.name} now accepts only the networks in its rules, plus private endpoints.` : `${ep.name} accepts requests on its public endpoint from any network.` };
      },
    });
    out.push({
      id: `st-rule-${ep.name}`, title: `Allow a subnet on storage account ${ep.name}`, kind: "fix",
      verb: ["az storage account network-rule add"],
      fields: [{ key: "sub", label: "Virtual network / subnet", type: "select", options: opts(subnets), def: subnets[0] }],
      build: (v) => { const [vn, sn] = (v.sub ?? "").split("/"); return vn && sn ? { cmds: [`az storage account network-rule add ${G} --account-name ${ep.name} --vnet-name ${vn} --subnet ${sn}`], why: `${ep.name} lets requests from ${sn} in. They have to arrive through the subnet's Microsoft.Storage service endpoint for the rule to match.` } : err("Pick a subnet."); },
    });
  }
  for (const [rn, r] of Object.entries(st.resolvers ?? {})) {
    const free = Object.keys(st.vnets[r.vnet].subnets).map((sn) => `${r.vnet}/${sn}`);
    out.push({
      id: `dnspr-in-${rn}`, title: `Add an inbound endpoint to ${rn}`, kind: "fix",
      verb: ["az dns-resolver inbound-endpoint create"],
      fields: [{ key: "name", label: "Endpoint name", type: "text", def: "in-endpoint" }, { key: "sub", label: "Subnet", type: "select", options: opts(free), def: free[0], help: "A dedicated subnet, /28 to /24, with nothing else in it." }],
      build: (v) => { const [vn, sn] = (v.sub ?? "").split("/"); return v.name?.trim() && sn ? { cmds: [`az dns-resolver inbound-endpoint create ${G} --dns-resolver-name ${rn} --name ${v.name.trim()} --ip-configurations "[{private-ip-allocation-method:Dynamic,id:/subscriptions/x/resourceGroups/rg-lab/providers/Microsoft.Network/virtualNetworks/${vn}/subnets/${sn}}]"`], why: `The endpoint gets a private IP in ${sn}. Other networks can use it as their DNS server, and it answers with the private zones linked to ${vn}.` } : err("Name the endpoint and pick a subnet."); },
    });
  }
  for (const [rsn, rs] of Object.entries(st.rulesets ?? {})) {
    const rules = Object.keys(rs.rules);
    out.push({
      id: `rs-rule-${rsn}`, title: `Forwarding rule in ${rsn}`, kind: "fix",
      verb: ["az dns-resolver forwarding-rule create", "az dns-resolver forwarding-rule update"],
      fields: [
        { key: "rule", label: "Rule", type: "select", options: [...opts(rules), ["__new", "New rule"]], def: rules[0] ?? "__new" },
        { key: "name", label: "Rule name", type: "text", placeholder: "corp", show: (v) => v.rule === "__new" },
        { key: "domain", label: "Domain name", type: "text", placeholder: "corp.contoso.com.", help: "Ends with a dot.", show: (v) => v.rule === "__new" },
        { key: "target", label: "Destination IP address", type: "text", def: rules[0] ? rs.rules[rules[0]].targets[0]?.split(":")[0] : "", placeholder: "192.168.10.10" },
      ],
      prefillOn: "rule", prefill: (v) => ({ ...v, target: v.rule !== "__new" && rs.rules[v.rule] ? rs.rules[v.rule].targets[0]?.split(":")[0] ?? "" : "" }),
      build: (v) => {
        const t = v.target?.trim();
        if (!t) return err("Enter the destination DNS server IP.");
        const targets = `"[{ip-address:${t},port:53}]"`;
        if (v.rule === "__new") return v.name?.trim() && v.domain?.trim() ? { cmds: [`az dns-resolver forwarding-rule create ${G} --ruleset-name ${rsn} --name ${v.name.trim()} --domain-name ${v.domain.trim()} --target-dns-servers ${targets}`], why: `Queries for ${v.domain.trim()} from linked networks go to ${t}.` } : err("Name the rule and its domain.");
        return { cmds: [`az dns-resolver forwarding-rule update ${G} --ruleset-name ${rsn} --name ${v.rule} --target-dns-servers ${targets}`], why: `Queries matching ${rs.rules[v.rule].domain} from linked networks now go to ${t}.` };
      },
    });
    const unlinked = Object.keys(st.vnets).filter((vn) => !st.vnets[vn].onprem && !Object.values(rs.links).includes(vn));
    if (unlinked.length) out.push({
      id: `rs-link-${rsn}`, title: `Link ${rsn} to a virtual network`, kind: "fix",
      verb: ["az dns-resolver vnet-link create"],
      fields: [{ key: "vnet", label: "Virtual network", type: "select", options: opts(unlinked), def: unlinked[0] }, { key: "name", label: "Link name", type: "text", placeholder: "link-spoke1" }],
      prefillOn: "vnet", prefill: (v) => ({ ...v, name: `link-${v.vnet.replace(/^vnet-/, "")}` }),
      build: (v) => (v.name?.trim() ? { cmds: [`az dns-resolver vnet-link create ${G} --ruleset-name ${rsn} --name ${v.name.trim()} --id /subscriptions/x/resourceGroups/rg-lab/providers/Microsoft.Network/virtualNetworks/${v.vnet}`], why: `${v.vnet} now uses ${rsn}'s rules, as long as it uses Azure-provided DNS.` } : err("Name the link.")),
    });
  }
  return out;
}

function deleteRoute(st: State, rt: string): Action | null {
  const routes = st.rts[rt]?.routes ?? [];
  if (!routes.length) return null;
  return {
    id: `route-del-${rt}`, title: `Delete a route from ${rt}`, kind: "fix",
    verb: ["az network route-table route delete"],
    fields: [{ key: "route", label: "Route", type: "select", options: opts(routes.map((r) => r.name)), def: routes[0].name }],
    build: (v) => ({ cmds: [`az network route-table route delete ${G} --route-table-name ${rt} --name ${v.route}`], why: `Removes ${v.route}. Traffic it covered now follows the next longest matching route, often a system or gateway route.` }),
  };
}

/** Fix actions for whatever is selected on the map. */
export function actionsFor(st: State, sel: Selection | null): Action[] {
  return withGroups(st, [...actionsFor0(st, sel), ...sandboxActions(st, sel)]);
}
function actionsFor0(st: State, sel: Selection | null): Action[] {
  if (!sel) return [];
  if (sel.kind === "subnet" && st.vnets[sel.vnet]?.subnets[sel.subnet]) return subnetActions(st, sel.vnet, sel.subnet);
  if (sel.kind === "vnet" && st.vnets[sel.id]) return vnetActions(st, sel.id);
  if (sel.kind === "peer") return peerActions(st, sel.a, sel.b);
  if (sel.kind === "zone" && st.zones[sel.id]) return zoneActions(st, sel.id);
  if (sel.kind === "service") return serviceActions(st).filter((a) => a.id.endsWith(`-${sel.id}`) && a.id.startsWith("st-"));
  if (sel.kind === "host" && st.hosts[sel.id]) {
    const h = st.hosts[sel.id];
    const out = subnetActions(st, h.vnet, h.subnet).filter((a) => !a.id.startsWith("sn-"));
    const nsgs = Object.keys(st.nsgs);
    if (h.kind === "vm" || h.kind === "dns" || h.kind === "nva") out.unshift({
      id: `nic-nsg-${h.name}`, title: `Associate a network security group with ${h.nic}`, kind: "fix",
    verb: ["az network nic update"],
      fields: [{ key: "nsg", label: "Network security group", type: "select", options: opts(nsgs), def: h.nicNsg ?? nsgs[0], help: nsgs.length ? undefined : "No NSGs exist yet. Create one first from the Create menu." }],
      build: (v) => (v.nsg ? { cmds: [`az network nic update ${G} --name ${h.nic} --network-security-group ${v.nsg}`], why: `${v.nsg} now filters ${h.nic} only. Inbound traffic passes the subnet's NSG first, if there is one, then this one. Both must allow it.` } : err("Create a network security group first.")),
    });
    if (h.kind === "fw") out.push(firewallRule(h));
    const lbName = Object.keys(st.lbs ?? {}).find((n) => st.lbs![n].host === h.name);
    if (lbName) {
      const lb = st.lbs![lbName];
      out.push({
        id: `lb-probe-${lbName}`, title: `Health probe ${lb.probe.name} on ${lbName}`, kind: "fix",
        verb: ["az network lb probe update"],
        fields: [{ key: "port", label: "Port", type: "text", def: String(lb.probe.port) }],
        build: (v) => (Number(v.port) > 0 ? { cmds: [`az network lb probe update ${G} --lb-name ${lbName} --name ${lb.probe.name} --port ${v.port}`], why: `The probe now checks port ${v.port} on every backend, from 168.63.129.16. Only backends that answer get traffic.` } : err("Enter a port.")),
      });
    }
    if (h.kind === "vm" || h.kind === "nva") out.push({
      id: `nic-fwd-${h.name}`, title: `IP forwarding on ${h.nic}`, kind: "fix",
    verb: ["az network nic update"],
      fields: [{ key: "fwd", label: "Enable IP forwarding", type: "check", def: String(h.forwarding) }],
      build: (v) => ({ cmds: [`az network nic update ${G} --name ${h.nic} --ip-forwarding ${v.fwd}`], why: v.fwd === "true" ? `Azure now delivers packets to ${h.nic} even when they're addressed to someone else, so ${h.name} can forward them. The operating system has to forward them too.` : `Azure now drops packets sent to ${h.nic} that aren't addressed to ${h.ip}.` }),
    });
    if (h.nicNsg) out.push(addRule(st, h.nicNsg, "Inbound"), addRule(st, h.nicNsg, "Outbound"), ...[editRule(st, h.nicNsg), deleteRule(st, h.nicNsg)].filter((a): a is Action => !!a));
    // Portal: the VM's Operations > Run command > RunShellScript.
    if (h.kind === "vm" || h.kind === "dns") out.push({
      id: `vm-run-${h.name}`, title: `Run command on ${h.name} (RunShellScript)`, kind: "fix",
      verb: ["az vm run-command invoke"],
      fields: [{ key: "script", label: "Script (RunShellScript)", type: "text", def: "ss -tlnp", placeholder: "ufw status numbered", help: "Runs as root through the VM agent, even when SSH is blocked. Try ss -tlnp, systemctl status <service>, ufw status numbered." }],
      build: (v) => {
        const script = (v.script ?? "").trim();
        if (!script) return err("Enter a script.");
        const quoted = script.includes('"') ? `'${script}'` : `"${script}"`;
        return { cmds: [`az vm run-command invoke ${G} -n ${h.name} --command-id RunShellScript --scripts ${quoted}`], why: `Runs the script inside ${h.name}'s operating system through the VM agent. Azure's network tools can't see in there: the VM's own firewall and which apps are listening only show up from inside.` };
      },
    });
    return out;
  }
  return [];
}

/** Things you can create from scratch. */
export function createActions(st: State): Action[] {
  return withGroups(st, [...createActions0(st), ...(st.groups ? sandboxCreates(st) : [])]);
}
function createActions0(st: State): Action[] {
  const name = (key: string, label: string, ph: string): Field => ({ key, label, type: "text", placeholder: ph });
  return [
    {
      id: "create-vnet", title: "Create a virtual network", kind: "fix",
      verb: ["az network vnet create"],
      fields: [...pickGroup(st), name("name", "Virtual network name", "vnet-lab"), { key: "space", label: "Address space", type: "text", placeholder: "10.50.0.0/16" }],
      build: (v) => {
        // Warn as soon as the address space is typed, before anything is created.
        const warn = v.space?.trim() ? overlapNote(st, list(v.space)) : "";
        if (!(v.name?.trim() && v.space?.trim())) return warn ? { ...err("Enter a name and an address space."), warn } : err("Enter a name and an address space.");
        return { cmds: [`az network vnet create ${G} --name ${v.name.trim()} --address-prefixes ${list(v.space).join(" ")}`], why: `Creates ${v.name} owning ${v.space}. Nothing is inside it yet. Subnets carve that space up.${warn ? ` Note: ${warn}` : ""}`, warn: warn || undefined };
      },
    },
    {
      id: "create-nsg", title: "Create a network security group", kind: "fix",
      verb: ["az network nsg create"],
      fields: [...pickGroup(st), name("name", "Name", "nsg-web")],
      build: (v) => (v.name?.trim() ? { cmds: [`az network nsg create ${G} --name ${v.name.trim()}`], why: `Creates ${v.name} with only the six default rules. It filters nothing until you associate it with a subnet or NIC.` } : err("Name the NSG.")),
    },
    {
      id: "create-zone", title: "Create a private DNS zone", kind: "fix",
      verb: ["az network private-dns zone create"],
      fields: [name("name", "Name", "lab.internal")],
      build: (v) => (v.name?.trim() ? { cmds: [`az network private-dns zone create ${G} --name ${v.name.trim()}`], why: `Creates ${v.name}. It answers nothing for anyone until you link a virtual network to it.` } : err("Name the zone.")),
    },
    {
      id: "create-pip", title: "Create a public IP address", kind: "fix",
      verb: ["az network public-ip create"],
      fields: [name("name", "Name", "pip-bastion"), { key: "sku", label: "SKU", type: "select", options: [["Standard", "Standard"]], def: "Standard", help: "Basic SKU public IPs were retired on September 30, 2025." }],
      build: (v) => (v.name?.trim() ? { cmds: [`az network public-ip create ${G} --name ${v.name.trim()} --sku ${v.sku}`], why: `Creates ${v.name.trim()}, a Standard static public IP in eastus2. Bastion and NAT gateway both need Standard.` } : err("Name the public IP.")),
    },
    {
      id: "create-natgw", title: "Create a NAT gateway", kind: "fix",
      verb: ["az network nat gateway create"],
      fields: [name("name", "NAT gateway name", "nat-gw"), { key: "timeout", label: "TCP idle timeout (minutes)", type: "text", def: "4" }, { key: "pip", label: "Public IP addresses", type: "select", options: opts(Object.keys(st.publicIps ?? {})), def: Object.keys(st.publicIps ?? {})[0], help: Object.keys(st.publicIps ?? {}).length ? "Standard SKU." : "Create a Standard public IP first." }],
      build: (v) => (v.name?.trim() && v.pip ? { cmds: [`az network nat gateway create ${G} --name ${v.name.trim()} --public-ip-addresses ${v.pip} --idle-timeout ${v.timeout || "4"}`], why: `Creates ${v.name.trim()}. It does nothing until you associate it with a subnet.` } : err("Name the NAT gateway and pick a public IP.")),
    },
    {
      id: "create-bastion", title: "Create a Bastion", kind: "fix",
      verb: ["az network bastion create"],
      fields: [
        name("name", "Name", "bas-hub"),
        { key: "vnet", label: "Virtual network", type: "select", options: opts(Object.keys(st.vnets).filter((v) => !st.vnets[v].onprem)), def: Object.keys(st.vnets)[0] },
        { key: "pip", label: "Public IP address", type: "select", options: opts(Object.keys(st.publicIps ?? {})), def: Object.keys(st.publicIps ?? {})[0], help: Object.keys(st.publicIps ?? {}).length ? "Must be the Standard SKU." : "Create a Standard public IP first." },
        { key: "sku", label: "Tier", type: "select", options: [["Basic", "Basic"], ["Standard", "Standard"], ["Premium", "Premium"], ["Developer", "Developer"]], def: "Basic" },
      ],
      build: (v) => (v.name?.trim() && (v.pip || v.sku === "Developer") ? { cmds: [`az network bastion create ${G} --name ${v.name.trim()} --vnet-name ${v.vnet}${v.sku === "Developer" ? "" : ` --public-ip-address ${v.pip}`} --sku ${v.sku}`], why: v.sku === "Developer" ? "Developer uses shared infrastructure: no AzureBastionSubnet or public IP, and it can't reach VMs in peered networks." : `Bastion goes in the subnet named AzureBastionSubnet, /26 or larger. It connects to VMs from that subnet, so their NSGs must allow it.` } : err("Name the Bastion and pick a public IP.")),
    },
    {
      id: "create-rt", title: "Create a route table", kind: "fix",
      verb: ["az network route-table create"],
      fields: [...pickGroup(st), name("name", "Name", "rt-spoke1")],
      build: (v) => (v.name?.trim() ? { cmds: [`az network route-table create ${G} --name ${v.name.trim()}`], why: `Creates an empty route table. It changes nothing until it has routes and is associated with a subnet.` } : err("Name the route table.")),
    },
  ];
}

/** Network Watcher and NIC diagnostics. */
export function diagnoseActions(st: State, vm?: string): Action[] {
  const vms = hosts(st).map((h) => h.name);
  if (!vms.length) return [];
  const pick: Field = { key: "vm", label: "Virtual machine", type: "select", options: opts(vms), def: vm && vms.includes(vm) ? vm : vms[0] };
  const H = (v: Values) => st.hosts[v.vm];
  return [
    {
      id: "diag-ipflow", title: "IP flow verify", kind: "diagnose",
      about: ACTIONS_ABOUT.ipflow,
      learnUrl: "https://learn.microsoft.com/azure/network-watcher/ip-flow-verify-overview",
      fields: [pick,
        { key: "protocol", label: "Protocol", type: "select", options: [["TCP", "TCP"], ["UDP", "UDP"]], def: "TCP" },
        { key: "direction", label: "Direction", type: "select", options: [["Inbound", "Inbound"], ["Outbound", "Outbound"]], def: "Inbound" },
        { key: "lport", label: "Local port", type: "text", def: "443" },
        { key: "rip", label: "Remote IP address", type: "text", placeholder: "10.1.2.4" },
        { key: "rport", label: "Remote port", type: "text", def: "*" }],
      build: (v) => (v.rip?.trim() ? { cmds: [`az network watcher test-ip-flow ${G} --vm ${v.vm} --direction ${v.direction} --protocol ${v.protocol} --local ${H(v).ip}:${v.lport} --remote ${v.rip.trim()}:${v.rport}`], why: `Checks the NSG rules on ${v.vm}'s subnet and NIC for this one packet and names the rule that decides. It doesn't send traffic or look at routes.` } : err("Enter the remote IP address.")),
    },
    {
      id: "diag-nexthop", title: "Next hop", kind: "diagnose",
      about: ACTIONS_ABOUT.nexthop,
      learnUrl: "https://learn.microsoft.com/azure/network-watcher/next-hop-overview",
      fields: [pick, { key: "dest", label: "Destination IP address", type: "text", placeholder: "10.2.1.4" }],
      build: (v) => (v.dest?.trim() ? { cmds: [`az network watcher show-next-hop ${G} --vm ${v.vm} --source-ip ${H(v).ip} --dest-ip ${v.dest.trim()}`], why: `Shows where Azure sends a packet from ${v.vm} to ${v.dest}, and whether a system route or one of your route tables decided it. It doesn't check NSGs.` } : err("Enter the destination IP address.")),
    },
    {
      id: "diag-routes", title: "Effective routes", kind: "diagnose",
      about: ACTIONS_ABOUT.routes,
      learnUrl: "https://learn.microsoft.com/azure/virtual-network/diagnose-network-routing-problem",
      fields: [pick],
      build: (v) => ({ cmds: [`az network nic show-effective-route-table ${G} --name ${H(v).nic} -o table`], why: `Lists every route that applies to ${H(v).nic}, system and user-defined. Invalid rows are system routes that one of your routes overrode.` }),
    },
    {
      id: "diag-conn", title: "Connection troubleshoot", kind: "diagnose",
      about: ACTIONS_ABOUT.conn,
      learnUrl: "https://learn.microsoft.com/azure/network-watcher/connection-troubleshoot-overview",
      fields: [pick, { key: "dest", label: "URI, FQDN, or IP address", type: "text", placeholder: "10.2.1.4" }, { key: "port", label: "Destination port", type: "text", def: "443" }],
      build: (v) => (v.dest?.trim() ? { cmds: [`az network watcher test-connectivity ${G} --source-resource ${H(v).name} --dest-address ${v.dest.trim()} --dest-port ${v.port} --protocol Tcp`], why: `Tests a connection from ${H(v).name} and reports each hop, with the issue that stops it, such as a security rule, a route, DNS, or the VM's own firewall.` } : err("Enter a destination.")),
    },
    {
      id: "diag-nsg", title: "Effective security rules", kind: "diagnose",
      about: ACTIONS_ABOUT.nsg,
      learnUrl: "https://learn.microsoft.com/azure/network-watcher/effective-security-rules-overview",
      fields: [pick],
      build: (v) => ({ cmds: [`az network nic list-effective-nsg ${G} --name ${H(v).nic}`], why: `Lists the rules from both NSGs that apply to ${H(v).nic}, the subnet's and the NIC's, in the order Azure checks them.` }),
    },
  ];
}

/** Apply a level's form policy to a list of change actions. */
export function allowed(actions: Action[], policy: { fix: string; only?: string[] }): Action[] {
  if (policy.fix === "off") return [];
  return policy.only ? actions.filter((a) => policy.only!.some((p) => a.id.startsWith(p))) : actions;
}

export function initialValues(a: Action): Values {
  const v: Values = {};
  for (const f of a.fields) v[f.key] = f.def ?? (f.type === "check" ? "false" : f.options?.[0]?.[0] ?? "");
  return a.prefill ? { ...v, ...a.prefill(v) } : v;
}


// ---------- Sandbox: delete anything, create VMs, resource groups and subscriptions ----------
const pickGroup = (st: State): Field[] => (st.groups ? [{ key: "rg", label: "Resource group", type: "select", options: opts(Object.keys(st.groups)), def: Object.keys(st.groups)[0] }] : []);

/** The resource group a command's resource lives in, read from its flags, so sandbox forms never point at the wrong group. */
function groupFor(st: State, cmd: string): string | null {
  const flag = (n: string) => cmd.match(new RegExp(`--${n} (\\S+)`))?.[1];
  const vn = flag("vnet-name"), nsg = flag("nsg-name"), rt = flag("route-table-name"), name = flag("name") ?? cmd.match(/ -n (\S+)/)?.[1];
  if (vn && st.vnets[vn]) return st.vnets[vn].rg ?? "rg-lab";
  if (nsg && st.nsgs[nsg]) return st.nsgs[nsg].rg ?? "rg-lab";
  if (rt && st.rts[rt]) return st.rts[rt].rg ?? "rg-lab";
  if (name) {
    if (/ vnet (update|show|delete)/.test(cmd) && st.vnets[name]) return st.vnets[name].rg ?? "rg-lab";
    if (/ nsg (show|delete)/.test(cmd) && st.nsgs[name]) return st.nsgs[name].rg ?? "rg-lab";
    if (/ route-table (show|delete)/.test(cmd) && st.rts[name]) return st.rts[name].rg ?? "rg-lab";
    const h = Object.values(st.hosts).find((x) => x.name === name || x.nic === name);
    if (h) return h.rg ?? st.vnets[h.vnet]?.rg ?? "rg-lab";
  }
  return null;
}
/** In the sandbox, rewrite each form's "-g rg-lab" to the group the resource is really in. Levels are untouched. */
function withGroups(st: State, actions: Action[]): Action[] {
  if (!st.groups) return actions;
  return actions.map((a) => ({
    ...a,
    build: (v) => {
      const b = a.build(v);
      if (!("cmds" in b)) return b;
      return { ...b, cmds: b.cmds.map((c) => { const g = v.rg || groupFor(st, c); return g && c.includes(G) ? c.replace(G, `-g ${g}`) : c; }) };
    },
  }));
}

function sandboxActions(st: State, sel: Selection | null): Action[] {
  if (!st.groups || !sel) return [];
  const del = (id: string, title: string, cmd: string, why: string): Action => ({ id, title, kind: "fix", verb: [cmd.split(" ").slice(0, 4).join(" ")], fields: [], build: () => ({ cmds: [cmd], why }) });
  if (sel.kind === "vnet" && st.vnets[sel.id]) return [del(`del-vnet-${sel.id}`, `Delete virtual network ${sel.id}`, `az network vnet delete ${G} --name ${sel.id}`, `Deletes ${sel.id}. Azure refuses while a VM or other resource is still in one of its subnets, and any peering pointing at it shows Disconnected afterward.`)];
  if (sel.kind === "subnet" && st.vnets[sel.vnet]?.subnets[sel.subnet]) {
    const s = st.vnets[sel.vnet].subnets[sel.subnet];
    const out: Action[] = [vmCreate(st, sel.vnet, sel.subnet), del(`del-sn-${sel.vnet}-${sel.subnet}`, `Delete subnet ${sel.subnet}`, `az network vnet subnet delete ${G} --vnet-name ${sel.vnet} --name ${sel.subnet}`, `Deletes ${sel.subnet}. Azure refuses while a VM or other resource is still in it.`)];
    if (s.nsg) out.push(del(`del-nsg-${s.nsg}`, `Delete network security group ${s.nsg}`, `az network nsg delete ${G} --name ${s.nsg}`, `Deletes ${s.nsg}. Azure refuses while it's still associated with a subnet or a network interface, so dissociate it first.`));
    if (s.rt) out.push(del(`del-rt-${s.rt}`, `Delete route table ${s.rt}`, `az network route-table delete ${G} --name ${s.rt}`, `Deletes ${s.rt}. Azure refuses while it's still associated with a subnet, so dissociate it first.`));
    return out;
  }
  if (sel.kind === "host" && st.hosts[sel.id]?.kind === "vm") return [del(`del-vm-${sel.id}`, `Delete VM ${sel.id}`, `az vm delete ${G} --name ${sel.id} --yes`, `Deletes ${sel.id} and its network interface. Its subnet can be deleted once nothing else is in it.`)];
  return [];
}

function vmCreate(st: State, vn?: string, sn?: string): Action {
  const subnets = Object.entries(st.vnets).flatMap(([v, x]) => Object.keys(x.subnets).map((s) => `${v}/${s}`));
  return {
    id: `create-vm${vn ? `-${vn}-${sn}` : ""}`, title: vn ? `Create a VM in ${sn}` : "Create a virtual machine", kind: "fix",
    verb: ["az vm create"],
    fields: [
      ...pickGroup(st),
      { key: "name", label: "Virtual machine name", type: "text", placeholder: "vm-app" },
      ...(vn ? [] : [{ key: "where", label: "Virtual network / subnet", type: "select" as const, options: opts(subnets), def: subnets[0], help: subnets.length ? undefined : "Create a virtual network with a subnet first." }]),
      { key: "image", label: "Image", type: "select", options: [["Ubuntu2204", "Ubuntu Server 22.04 (Linux)"], ["Win2022Datacenter", "Windows Server 2022"]], def: "Ubuntu2204" },
      { key: "ip", label: "Private IP address", type: "text", placeholder: "Leave empty for the next free address" },
    ],
    build: (v) => {
      const [vnet, subnet] = vn ? [vn, sn!] : (v.where ?? "").split("/");
      if (!vnet || !subnet) return err("Create a virtual network with a subnet first.");
      if (!v.name?.trim()) return err("Name the VM.");
      return { cmds: [`az vm create ${G} --name ${v.name.trim()} --vnet-name ${vnet} --subnet ${subnet} --image ${v.image}${v.ip?.trim() ? ` --private-ip-address ${v.ip.trim()}` : ""} --public-ip-address "" --nsg ""`], why: `Creates ${v.name} in ${vnet}/${subnet} with its own network interface and a private IP. No public IP and no NIC NSG, so only the subnet's NSG, if any, filters it.` };
    },
  };
}

function sandboxCreates(st: State): Action[] {
  const groups = Object.keys(st.groups ?? {}), subs = st.subscriptions ?? [];
  return [
    vmCreate(st),
    {
      id: "create-rg", title: "Create a resource group", kind: "fix", verb: ["az group create"],
      fields: [{ key: "name", label: "Resource group name", type: "text", placeholder: "rg-app" }, { key: "sub", label: "Subscription", type: "select", options: opts(subs), def: subs[0] }],
      build: (v) => (v.name?.trim() ? { cmds: [`az group create --name ${v.name.trim()} --location eastus2${v.sub && v.sub !== subs[0] ? ` --subscription ${v.sub}` : ""}`], why: `Creates ${v.name}, a folder for resources. Pick it when you create networks, NSGs, route tables or VMs.` } : err("Name the resource group.")),
    },
    {
      id: "create-sub", title: "Create a subscription", kind: "fix", verb: ["az account create"],
      fields: [{ key: "name", label: "Subscription name", type: "text", placeholder: "Dev" }],
      build: (v) => (v.name?.trim() ? { cmds: [`az account create --display-name ${v.name.trim()}`], why: `Adds the subscription ${v.name}. In real Azure, subscriptions come from billing, not networking. Here it groups resource groups.` } : err("Name the subscription.")),
    },
    {
      id: "delete-rg", title: "Delete a resource group", kind: "fix", verb: ["az group delete"],
      fields: [{ key: "name", label: "Resource group name", type: "select", options: opts(groups), def: groups[groups.length - 1] }],
      build: (v) => ({ cmds: [`az group delete --name ${v.name} --yes`], why: `Deletes ${v.name} and everything in it: networks, VMs, NSGs and route tables.` }),
    },
  ];
}
