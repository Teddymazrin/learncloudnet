// Every resource in the lab, grouped by type the way the Azure portal lists them, so nothing on the map is a mystery.
import type { Selection } from "@/components/NetworkMap";
import type { State } from "@/sim/types";

export interface ResourceItem { name: string; detail: string; sel?: Selection }
export interface ResourceGroup { type: string; items: ResourceItem[] }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The private endpoint that belongs to a storage account. Labs name it pe-<account>. */
export const endpointFor = (st: State, account: string) => Object.values(st.hosts).find((h) => h.kind === "pe" && h.name === `pe-${account}`) ?? null;

export function resourcesOf(st: State): ResourceGroup[] {
  const hosts = Object.values(st.hosts);
  const subnetUsers = (pred: (s: { nsg: string | null; rt: string | null }) => boolean) =>
    Object.entries(st.vnets).flatMap(([vn, v]) => Object.entries(v.subnets).filter(([, s]) => pred(s)).map(([sn]) => `${vn}/${sn}`));
  const of = (kind: string) => hosts.filter((h) => h.kind === kind);
  const host = (h: (typeof hosts)[number], extra = "") => ({ name: h.name, detail: `${h.ip} in ${h.vnet}/${h.subnet}${extra}`, sel: { kind: "host", id: h.name } as Selection });

  const groups: ResourceGroup[] = [
    { type: "Resource group", items: st.groups ? Object.entries(st.groups).map(([g, x]) => ({ name: g, detail: `subscription ${x.sub}` })) : [{ name: "rg-lab", detail: "eastus2. Everything below lives in it" }] },
    { type: "Virtual network", items: Object.entries(st.vnets).map(([vn, v]) => ({ name: vn, detail: `${v.onprem ? "on-premises network, " : ""}${v.prefixes.join(", ")}, ${plural(Object.keys(v.subnets).length, "subnet")}${v.dnsServers?.length ? `, DNS ${v.dnsServers.join(" ")}` : ""}`, sel: { kind: "vnet", id: vn } as Selection })) },
    { type: "Subnet", items: Object.entries(st.vnets).flatMap(([vn, v]) => Object.entries(v.subnets).map(([sn, s]) => ({
      name: `${vn}/${sn}`,
      detail: [s.prefixes.join(", "), s.nsg && `NSG ${s.nsg}`, s.rt && `route table ${s.rt}`, s.natGateway && `NAT ${s.natGateway}`, s.serviceEndpoints?.length && `service endpoint ${s.serviceEndpoints.join(", ")}`].filter(Boolean).join(", "),
      sel: { kind: "subnet", vnet: vn, subnet: sn } as Selection,
    }))) },
    { type: "Virtual machine", items: [...of("vm"), ...of("dns")].map((h) => host(h, h.kind === "dns" ? ", DNS server" : "")) },
    { type: "Network virtual appliance", items: of("nva").map((h) => host(h, h.forwarding ? ", IP forwarding on" : ", IP forwarding off")) },
    { type: "Network interface", items: hosts.filter((h) => ["vm", "dns", "nva"].includes(h.kind)).map((h) => ({ name: h.nic, detail: `on ${h.name}, ${h.ip}${h.nicNsg ? `, NSG ${h.nicNsg}` : ""}${h.publicIp ? `, public IP ${h.publicIp}` : ""}`, sel: { kind: "host", id: h.name } as Selection })) },
    { type: "Network security group", items: Object.entries(st.nsgs).map(([n, g]) => {
      const on = [...subnetUsers((s) => s.nsg === n), ...hosts.filter((h) => h.nicNsg === n).map((h) => h.nic)];
      return { name: n, detail: `${plural(g.rules.filter((r) => !r.def).length, "custom rule")}, ${on.length ? `on ${on.join(", ")}` : "not associated"}` };
    }) },
    { type: "Route table", items: Object.entries(st.rts).map(([n, t]) => {
      const on = subnetUsers((s) => s.rt === n);
      return { name: n, detail: `${plural(t.routes.length, "route")}, ${on.length ? `on ${on.join(", ")}` : "not associated"}` };
    }) },
    { type: "Virtual network peering", items: Object.values(st.peerings).map((p) => ({ name: p.name, detail: `${p.vnet} → ${p.remote}, VNet access ${p.allowVnetAccess ? "on" : "off"}, forwarded traffic ${p.allowForwarded ? "on" : "off"}`, sel: { kind: "peer", a: p.vnet, b: p.remote } as Selection })) },
    { type: "Storage account", items: Object.entries(st.publicEndpoints).map(([ip, ep]) => ({
      name: ep.name,
      detail: `${ep.name}.blob.core.windows.net, public IP ${ip}, public network access ${!ep.publicAccess ? "disabled" : ep.defaultAction === "Deny" ? "from selected networks" : "from all networks"}${endpointFor(st, ep.name) ? `, private endpoint ${endpointFor(st, ep.name)!.name}` : ""}`,
      sel: { kind: "service", id: ep.name } as Selection,
    })) },
    { type: "Private endpoint", items: of("pe").map((h) => host(h, Object.values(st.publicEndpoints).some((e) => `pe-${e.name}` === h.name) ? `, for storage account ${h.name.replace(/^pe-/, "")}` : "")) },
    { type: "Private DNS zone", items: Object.entries(st.zones).map(([z, d]) => ({ name: z, detail: `${plural(Object.keys(d.records).length, "record")}, linked to ${Object.values(d.links).map((l) => l.vnet).join(", ") || "no networks"}`, sel: { kind: "zone", id: z } as Selection })) },
    { type: "Azure Firewall", items: of("fw").map((h) => host(h)) },
    { type: "Load balancer", items: Object.entries(st.lbs ?? {}).map(([n, lb]) => ({ name: n, detail: `frontend ${st.hosts[lb.host]?.ip ?? lb.host}, ${plural(lb.backends.length, "backend")}, probe on port ${lb.probe.port}`, sel: { kind: "host", id: lb.host } as Selection })) },
    { type: "VPN gateway", items: Object.entries(st.gateways ?? {}).map(([vn, g]) => ({ name: g.name, detail: `in ${vn}, connected to ${g.connections.join(", ") || "nothing"}`, sel: { kind: "host", id: g.host } as Selection })) },
    { type: "Azure Bastion", items: Object.entries(st.bastions ?? {}).map(([n, b]) => ({ name: n, detail: `in ${b.vnet}, ${b.sku} SKU${b.tunneling ? ", native client on" : ""}`, sel: { kind: "host", id: b.host } as Selection })) },
    { type: "DNS Private Resolver", items: Object.entries(st.resolvers ?? {}).map(([n, r]) => ({ name: n, detail: `in ${r.vnet}, ${plural(Object.keys(r.inbound).length, "inbound endpoint")}, ${plural(Object.keys(r.outbound).length, "outbound endpoint")}` })) },
    { type: "DNS forwarding ruleset", items: Object.entries(st.rulesets ?? {}).map(([n, r]) => ({ name: n, detail: `${plural(Object.keys(r.rules).length, "rule")}, linked to ${Object.values(r.links).join(", ") || "no networks"}` })) },
    { type: "NAT gateway", items: Object.entries(st.natGateways ?? {}).map(([n, g]) => ({ name: n, detail: `public IP ${g.pips.join(", ") || "none"}` })) },
    { type: "Public IP address", items: Object.entries(st.publicIps ?? {}).map(([n, p]) => ({ name: n, detail: `${p.sku} SKU${p.ip ? `, ${p.ip}` : ""}` })) },
  ];
  return groups.filter((g) => g.items.length);
}
