// Advanced tier: stacked faults. Several things are wrong at once, the story gives less away,
// and change forms are off. Every fact comes from the Microsoft Learn pages linked in the level.
import { azfw, base, can, dnsVm, gateway, host, looksUp, onprem, peer, resolver, rule, storage, vnet } from "../build";
import { reach } from "@/sim/network";
import type { State } from "@/sim/types";
import type { Level } from "../types";

const L = (title: string, url: string) => ({ title, url });
const G = "-g rg-lab";
const noSpokePeering = (st: State) => !Object.values(st.peerings).some((p) => p.vnet.includes("spoke") && p.remote.includes("spoke"));
const through = (st: State, from: string, ip: string, port: number, via: string) => { const r = reach(st, from, ip, port); return r.ok && r.via.includes(via); };

const LEARN = {
  hubSpoke: L("Hub-and-spoke network topology: spoke-to-spoke traffic", "https://learn.microsoft.com/azure/networking/design-guide/hub-spoke#spoke-to-spoke-communication-patterns"),
  peering: L("Create, change, or delete a virtual network peering", "https://learn.microsoft.com/azure/virtual-network/virtual-network-manage-peering#create-a-virtual-network-peering"),
  routing: L("Virtual network traffic routing", "https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview"),
  asym: L("Troubleshoot peering: route table conflicts and asymmetric routing", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-peering-issues"),
  ipfwd: L("Network interface: enable or disable IP forwarding", "https://learn.microsoft.com/azure/virtual-network/virtual-network-network-interface#enable-or-disable-ip-forwarding"),
  transit: L("Configure VPN gateway transit for virtual network peering", "https://learn.microsoft.com/azure/vpn-gateway/vpn-gateway-peering-gateway-transit"),
  transitCli: L("az network vnet peering", "https://learn.microsoft.com/cli/azure/network/vnet/peering#az-network-vnet-peering-create"),
  sysRoutes: L("Virtual network traffic routing: system routes", "https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview#system-routes"),
  hybridTs: L("Troubleshoot hub-spoke connectivity to on-premises", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-peering-issues#troubleshoot-a-connectivity-issue-between-a-hub-spoke-virtual-network-and-an-on-premises-resource"),
  se: L("Virtual network service endpoints", "https://learn.microsoft.com/azure/virtual-network/virtual-network-service-endpoints-overview"),
  stFw: L("Azure Storage firewall: virtual network rules", "https://learn.microsoft.com/azure/storage/common/storage-network-security-virtual-networks#create-a-virtual-network-rule"),
  compare: L("Compare private endpoints and service endpoints", "https://learn.microsoft.com/azure/virtual-network/vnet-integration-for-azure-services#compare-private-endpoints-and-service-endpoints"),
  stPe: L("Use private endpoints for Azure Storage", "https://learn.microsoft.com/azure/storage/common/storage-private-endpoints#conceptual-overview"),
  peDns: L("Troubleshoot private endpoint DNS resolution", "https://learn.microsoft.com/troubleshoot/azure/private-link/troubleshoot-private-endpoint-dns-resolution"),
  dnsIntegration: L("Private endpoint DNS integration", "https://learn.microsoft.com/azure/private-link/private-endpoint-dns-integration"),
  vnetDns: L("Change DNS servers of a virtual network", "https://learn.microsoft.com/azure/virtual-network/manage-virtual-network#change-dns-servers-of-a-virtual-network-using-the-azure-cli"),
  resolver: L("Azure DNS Private Resolver endpoints and rulesets", "https://learn.microsoft.com/azure/dns/private-resolver-endpoints-rulesets"),
  resolverSubnets: L("DNS Private Resolver: subnet restrictions", "https://learn.microsoft.com/azure/dns/dns-private-resolver-overview#subnet-restrictions"),
  resolverCli: L("az dns-resolver", "https://learn.microsoft.com/cli/azure/dns-resolver"),
  fwRules: L("Azure Firewall rule processing logic", "https://learn.microsoft.com/azure/firewall/rule-processing"),
  fwFaq: L("Azure Firewall FAQ: filtering between spokes", "https://learn.microsoft.com/azure/firewall/firewall-faq#can-azure-firewall-in-a-hub-virtual-network-forward-and-filter-network-traffic-between-multiple-spoke-virtual-network"),
  fwCli: L("az network firewall network-rule", "https://learn.microsoft.com/cli/azure/network/firewall/network-rule#az-network-firewall-network-rule-create"),
  fwHybrid: L("Use Azure Firewall to route a hub-and-spoke topology", "https://learn.microsoft.com/azure/firewall/firewall-multi-hub-spoke#hub-virtual-network-workloads"),
  gwSubnet: L("VPN Gateway settings: gateway subnet", "https://learn.microsoft.com/azure/vpn-gateway/vpn-gateway-about-vpn-gateway-settings#gateway-subnet"),
  bastionCfg: L("Azure Bastion configuration settings", "https://learn.microsoft.com/azure/bastion/configuration-settings#azure-bastion-subnet"),
  bastionNsg: L("Working with NSG access and Azure Bastion", "https://learn.microsoft.com/azure/bastion/bastion-nsg#target-vm-subnet"),
  bastionSku: L("Azure Bastion SKU comparison", "https://learn.microsoft.com/azure/bastion/bastion-sku-comparison#feature-comparison"),
  bastionCli: L("az network bastion create", "https://learn.microsoft.com/cli/azure/network/bastion#az-network-bastion-create"),
};

/** Hub with an NVA and two spokes. Every option defaults to a working setup. */
export function nvaHub(o: { fwd1?: boolean; fwd2?: boolean; forwarding?: boolean; rt2?: { prefix: string; nhIp: string } | null } = {}): State {
  const st = base();
  vnet(st, "vnet-spoke1", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24", rt: "rt-spoke1" } });
  vnet(st, "vnet-hub", ["10.0.0.0/16"], { "subnet-fw": { p: "10.0.2.0/24" } });
  vnet(st, "vnet-spoke2", ["10.2.0.0/16"], { "subnet-app": { p: "10.2.1.0/24", rt: "rt-spoke2" } });
  host(st, "vm-spoke1", "vnet-spoke1", "subnet-app", "10.1.1.4");
  host(st, "fw-hub", "vnet-hub", "subnet-fw", "10.0.2.4", { kind: "nva", forwarding: o.forwarding !== false, label: "NVA" });
  host(st, "vm-spoke2", "vnet-spoke2", "subnet-app", "10.2.1.4", { ports: [22, 443] });
  peer(st, "vnet-hub", "vnet-spoke1"); peer(st, "vnet-spoke1", "vnet-hub", { fwd: o.fwd1 !== false });
  peer(st, "vnet-hub", "vnet-spoke2"); peer(st, "vnet-spoke2", "vnet-hub", { fwd: o.fwd2 !== false });
  st.rts["rt-spoke1"] = { routes: [{ name: "to-spoke2", prefix: "10.2.0.0/16", type: "VirtualAppliance", nhIp: "10.0.2.4" }] };
  const r2 = o.rt2 === undefined ? { prefix: "10.1.0.0/16", nhIp: "10.0.2.4" } : o.rt2;
  st.rts["rt-spoke2"] = { routes: r2 ? [{ name: "to-spoke1", prefix: r2.prefix, type: "VirtualAppliance", nhIp: r2.nhIp }] : [] };
  return st;
}

/** Spoke, hub with a VPN gateway, and an on-premises site. */
export function hybrid(o: { transit?: boolean; remote?: boolean } = {}): State {
  const st = base();
  vnet(st, "vnet-spoke1", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24" } });
  vnet(st, "vnet-hub", ["10.0.0.0/16"], { "subnet-shared": { p: "10.0.1.0/24" }, GatewaySubnet: { p: "10.0.255.0/27" } });
  onprem(st, "onprem-dc", ["192.168.0.0/16"], { "subnet-servers": { p: "192.168.10.0/24" } });
  host(st, "vm-spoke1", "vnet-spoke1", "subnet-app", "10.1.1.4", { ports: [22, 443] });
  host(st, "srv-onprem", "onprem-dc", "subnet-servers", "192.168.10.5", { ports: [22, 443] });
  gateway(st, "vnet-hub", "vgw-hub", "10.0.255.4", ["onprem-dc"]);
  peer(st, "vnet-hub", "vnet-spoke1"); peer(st, "vnet-spoke1", "vnet-hub");
  st.peerings["vnet-hub/hub-to-spoke1"].allowGatewayTransit = o.transit !== false;
  st.peerings["vnet-spoke1/spoke1-to-hub"].useRemoteGateways = o.remote !== false && o.transit !== false;
  return st;
}

/** Spoke and hub with a storage account private endpoint and the privatelink zone. */
export function privateBlob(st: State, account: string, peIp: string, publicIp: string, links: string[]) {
  host(st, `pe-${account}`, "vnet-hub", "subnet-pe", peIp, { kind: "pe", ports: [443], label: "private endpoint" });
  const z = (st.zones["privatelink.blob.core.windows.net"] ??= { records: {}, links: {} });
  z.records[account] = peIp;
  links.forEach((v) => { z.links[`link-${v.replace(/^vnet-/, "")}`] = { vnet: v, reg: false }; });
  storage(st, account, publicIp, { publicAccess: false, privatelink: true });
}

export const advanced: Level[] = [
  {
    id: "return-trip", tier: "advanced", stage: "Hub and spoke", title: "New spoke can't reach the other spoke",
    story: "A new spoke, vnet-spoke2, was built from a template and joined to the hub. Policy says spoke-to-spoke traffic goes through fw-hub, the hub's appliance at 10.0.2.4. vm-spoke1 can't reach vm-spoke2 on 443. Spoke1 was set up months ago and works with everything else, so it's a good reference.",
    fix: "vm-spoke1 can't reach vm-spoke2 on 443.",
    setup: () => nvaHub({ fwd2: false, rt2: null }),
    objectives: [
      { text: "Get vm-spoke1 reaching vm-spoke2 on 443 through fw-hub", test: ({ st }) => through(st, "vm-spoke1", "10.2.1.4", 443, "fw-hub") },
      { text: "Don't peer the spokes directly to each other", test: ({ st }) => noSpokePeering(st) },
    ],
    par: 2,
    hints: ["Explain the connection, fix what it shows, then explain it again. More than one thing is wrong.", "Spoke1 works and spoke2 is new. Whatever spoke1 has in its peering and its route table that spoke2 lacks is your gap. Think about both the request and the reply.", "Explain the connection and note the hop where it stops. Then compare vm-spoke2's effective routes with vm-spoke1's, and both spokes' peering settings with az network vnet peering show."],
    lesson: "Spoke-to-spoke through a hub appliance needs the same things in both directions: a route in each spoke pointing at the appliance, and each spoke's peering accepting forwarded traffic. A spoke built without them breaks the request and the reply.",
    why: "fw-hub forwards the packet into vnet-spoke2, so spoke2-to-hub has to allow forwarded traffic or the peering drops it. The to-spoke1 route in rt-spoke2 sends the reply back through 10.0.2.4, so both directions use the same path.",
    learn: [LEARN.hubSpoke, LEARN.peering, LEARN.asym],
    flows: [{ from: "vm-spoke1", to: "vm-spoke2", port: 443, want: "open" }],
    solution: [`az network vnet peering update ${G} --vnet-name vnet-spoke2 --name spoke2-to-hub --allow-forwarded-traffic true`, `az network route-table route create ${G} --route-table-name rt-spoke2 --name to-spoke1 --address-prefix 10.1.0.0/16 --next-hop-type VirtualAppliance --next-hop-ip-address 10.0.2.4`],
  },
  {
    id: "two-way-street", tier: "advanced", stage: "Hub and spoke", title: "Spoke-to-spoke down after a redeploy",
    story: "fw-hub, the hub's appliance at 10.0.2.4, was redeployed from a new image last night, and someone tidied rt-spoke2 at the same time. Spoke-to-spoke traffic through the hub is down. vm-spoke1 needs vm-spoke2 on 443, through fw-hub.",
    fix: "Spoke-to-spoke traffic through the hub has been down since last night.",
    setup: () => nvaHub({ forwarding: false, rt2: { prefix: "10.1.0.0/16", nhIp: "10.0.2.5" } }),
    objectives: [
      { text: "Get vm-spoke1 reaching vm-spoke2 on 443 through fw-hub", test: ({ st }) => through(st, "vm-spoke1", "10.2.1.4", 443, "fw-hub") },
      { text: "Don't peer the spokes directly to each other", test: ({ st }) => noSpokePeering(st) },
    ],
    par: 2,
    hints: ["Explain the connection and note the hop where it stops. Start with fw-hub, the hop in the middle.", "Two things changed: the appliance and rt-spoke2. A new image can come up with different NIC settings, and a route is only as good as its next hop.", "Look at fw-hub's NIC with az network nic show, and at the next hop address in rt-spoke2. Does something live at that address?"],
    lesson: "A fresh appliance image doesn't bring its Azure NIC settings with it. IP forwarding on the NIC is off by default. And a route whose next hop doesn't exist drops the reply, so a session can fail after the request arrived safely.",
    why: "With IP forwarding on fw-hub-nic, Azure lets fw-hub pass on packets that aren't addressed to it. The to-spoke1 route in rt-spoke2 points at 10.0.2.4 again, where fw-hub really lives, so the reply has somewhere to go.",
    learn: [LEARN.ipfwd, LEARN.routing, LEARN.hubSpoke],
    flows: [{ from: "vm-spoke1", to: "vm-spoke2", port: 443, want: "open" }],
    solution: [`az network nic update ${G} --name fw-hub-nic --ip-forwarding true`, `az network route-table route update ${G} --route-table-name rt-spoke2 --name to-spoke1 --next-hop-ip-address 10.0.2.4`],
  },
  {
    id: "gateway-transit", tier: "advanced", stage: "Hybrid", title: "Spoke can't reach on-premises",
    story: "The hub has a VPN gateway, vgw-hub, connected to the on-premises site. VMs in the hub reach srv-onprem fine. vm-spoke1 needs srv-onprem on 443 too, and nobody wants a second gateway. The spoke was rebuilt last month with a hardened NSG template.",
    fix: "vm-spoke1 can't reach srv-onprem on 443, though hub VMs can.",
    setup: () => {
      const st = hybrid({ transit: false });
      st.vnets["vnet-spoke1"].subnets["subnet-app"].nsg = "nsg-app";
      rule(st, "nsg-app", { name: "Deny-OnPrem-Out", priority: 200, direction: "Outbound", access: "Deny", protocol: "*", src: ["*"], dst: ["192.168.0.0/16"], ports: ["*"] });
      return st;
    },
    objectives: [
      { text: "Get vm-spoke1 reaching srv-onprem on 443", test: ({ st }) => can(st, "vm-spoke1", "192.168.10.5", 443) },
      { text: "Don't give vnet-spoke1 a gateway of its own", test: ({ st }) => !st.gateways?.["vnet-spoke1"] },
    ],
    par: 3,
    hints: ["Compare the routes: az network nic show-effective-route-table -g rg-lab --name vm-spoke1-nic -o table. Where are the on-premises routes?", "No on-premises routes in the spoke means the hub's gateway isn't shared with it yet. Once the routes show up, the packet still has to get out of the spoke's subnet.", "Compare vm-spoke1's effective routes with what on-premises needs, read the gateway settings on both sides of the peering, then nsg-app's outbound rules with az network nsg rule list."],
    lesson: "Gateway transit lets a spoke use the hub's gateway. The hub's peering allows gateway transit, and the spoke's peering uses remote gateways. Then on-premises routes appear in the spoke with next hop Virtual network gateway, and on-premises learns the spoke's range too.",
    why: "Allow gateway transit on hub-to-spoke1 and use remote gateways on spoke1-to-hub bring vgw-hub's on-premises routes into vnet-spoke1. Then nothing in nsg-app denies traffic to 192.168.0.0/16, so the packet can leave the subnet and ride the VPN.",
    learn: [LEARN.transit, LEARN.transitCli, LEARN.sysRoutes],
    flows: [{ from: "vm-spoke1", to: "srv-onprem", port: 443, want: "open" }],
    solution: [`az network vnet peering update ${G} --vnet-name vnet-hub --name hub-to-spoke1 --allow-gateway-transit true`, `az network vnet peering update ${G} --vnet-name vnet-spoke1 --name spoke1-to-hub --use-remote-gateways true`, `az network nsg rule delete ${G} --nsg-name nsg-app --name Deny-OnPrem-Out`],
  },
  {
    id: "left-behind", tier: "advanced", stage: "Hybrid", title: "On-premises users can't reach a spoke app",
    story: "Users on-premises open the app on vm-spoke1 at 443. Since the old on-premises appliance project was cancelled, it doesn't open for anyone. Gateway transit is set up, and vgw-hub is healthy. srv-onprem stands in for the users: get it to vm-spoke1 on 443 again, and keep SSH from on-premises blocked.",
    fix: "On-premises users can't open the app on vm-spoke1 at 443.",
    setup: () => {
      const st = hybrid();
      st.vnets["vnet-spoke1"].subnets["subnet-app"].rt = "rt-spoke1";
      st.vnets["vnet-spoke1"].subnets["subnet-app"].nsg = "nsg-app";
      st.rts["rt-spoke1"] = { routes: [{ name: "onprem-via-nva", prefix: "192.168.10.0/24", type: "VirtualAppliance", nhIp: "10.0.2.9" }] };
      rule(st, "nsg-app", { name: "Deny-OnPrem", priority: 300, direction: "Inbound", access: "Deny", protocol: "*", src: ["192.168.0.0/16"], dst: ["*"], ports: ["*"] });
      return st;
    },
    objectives: [
      { text: "Get srv-onprem reaching vm-spoke1 on 443", test: ({ st }) => can(st, "srv-onprem", "10.1.1.4", 443) },
      { text: "Keep SSH (22) from srv-onprem to vm-spoke1 blocked", test: ({ st }) => !can(st, "srv-onprem", "10.1.1.4", 22) },
    ],
    par: 2,
    hints: ["Explain the connection. Fix the first thing it shows, then explain it again.", "The request can arrive while the reply leaves by another road. Notice which route wins for 192.168.10.5 and whether anything lives at its next hop. Then look for rules older than the cancelled project.", "Run show-next-hop from vm-spoke1 to 192.168.10.5 and see which route wins. Then read nsg-app's inbound rules in order."],
    lesson: "Routes from the gateway, learned over BGP or from the local network gateway's prefixes, aren't user-defined routes, so a more specific user-defined route overrides them. Leftovers from abandoned projects, a route to an appliance that no longer exists or a deny rule nobody remembers, are classic causes of hybrid outages.",
    why: "With onprem-via-nva gone, vm-spoke1's replies to 192.168.10.5 follow vgw-hub's route instead of heading for 10.0.2.9, where nothing lives. And nsg-app no longer denies 443 from 192.168.0.0/16, while SSH from on-premises is still denied.",
    learn: [LEARN.sysRoutes, LEARN.hybridTs, L("Troubleshoot NSG misconfigurations", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-nsg-blocking-traffic")],
    flows: [{ from: "srv-onprem", to: "vm-spoke1", port: 443, want: "open" }, { from: "srv-onprem", to: "vm-spoke1", port: 22, want: "closed" }],
    solution: [`az network route-table route delete ${G} --route-table-name rt-spoke1 --name onprem-via-nva`, `az network nsg rule update ${G} --nsg-name nsg-app --name Deny-OnPrem --destination-port-ranges 22`],
  },
  {
    id: "selected-networks", tier: "advanced", stage: "PaaS access", title: "VM can't reach storage locked to selected networks",
    story: "Security switched the storage account stdata01 to allow access only from selected networks, and tightened nsg-app on subnet-app the same week. vm-app, in vnet-app/subnet-app, now can't get to stdata01.blob.core.windows.net on 443. The account must stay locked to selected networks.",
    fix: "vm-app can't reach stdata01 on 443.",
    setup: () => {
      const st = base();
      vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24", nsg: "nsg-app" }, "subnet-old": { p: "10.1.9.0/24" } });
      host(st, "vm-app", "vnet-app", "subnet-app", "10.1.1.4");
      rule(st, "nsg-app", { name: "Deny-Internet-Out", priority: 4000, direction: "Outbound", access: "Deny", protocol: "*", src: ["*"], dst: ["Internet"], ports: ["*"] });
      storage(st, "stdata01", "203.0.113.20", { defaultAction: "Deny", rules: [{ vnet: "vnet-app", subnet: "subnet-old" }] });
      st.vnets["vnet-app"].subnets["subnet-old"].serviceEndpoints = ["Microsoft.Storage"];
      return st;
    },
    objectives: [
      { text: "Get vm-app through to stdata01 on 443", test: ({ st }) => can(st, "vm-app", "203.0.113.20", 443) },
      { text: "Keep stdata01 denying by default", test: ({ st }) => st.publicEndpoints["203.0.113.20"].defaultAction === "Deny" && st.publicEndpoints["203.0.113.20"].publicAccess },
    ],
    par: 3,
    hints: ["Look at what the account allows: az storage account show --name stdata01 --query networkRuleSet. Then at what nsg-app lets out.", "Compare the subnet the account trusts with the subnet vm-app is in, and what that subnet has turned on. Then remember where the request goes: the account's public IP, past every outbound rule that covers it.", "Read the account's networkRuleSet with az storage account show, subnet-app's service endpoints with az network vnet subnet show, and nsg-app's outbound rules."],
    lesson: "Storage virtual network rules need two pieces: a service endpoint for Microsoft.Storage on the subnet, and a rule on the account for that subnet. And because the destination is still a public IP, an NSG that denies Internet outbound needs an allow for the Storage service tag above it.",
    why: "With the Microsoft.Storage service endpoint on subnet-app, its traffic reaches stdata01 from its private address, so a virtual network rule for subnet-app matches. An outbound allow for the Storage tag, ahead of Deny-Internet-Out, lets the request leave the subnet in the first place.",
    learn: [LEARN.se, LEARN.stFw, L("Restrict network access to PaaS resources: allow the Storage service tag", "https://learn.microsoft.com/azure/virtual-network/tutorial-restrict-network-access-to-resources#restrict-network-access-for-a-subnet"), L("Azure Storage network security: virtual network rules", "https://learn.microsoft.com/azure/storage/common/storage-network-security#virtual-network-rules")],
    flows: [{ from: "vm-app", dns: "stdata01.blob.core.windows.net", port: 443, want: "open" }],
    solution: [`az network vnet subnet update ${G} --vnet-name vnet-app --name subnet-app --service-endpoints Microsoft.Storage`, `az storage account network-rule add ${G} --account-name stdata01 --vnet-name vnet-app --subnet subnet-app`, `az network nsg rule create ${G} --nsg-name nsg-app --name Allow-Storage-Out --priority 200 --direction Outbound --access Allow --protocol '*' --destination-address-prefixes Storage --destination-port-ranges '*'`],
  },
  {
    id: "endpoint-choice", tier: "advanced", stage: "PaaS access", title: "Storage returns 403 after public access was disabled",
    story: "stlogs03 had public network access disabled this morning, as planned. vm-spoke1 used a service endpoint and a storage rule to reach it, and now gets 403. A private endpoint for stlogs03 already exists in the hub at 10.0.3.6. Make vm-spoke1 use it. Public access stays off.",
    fix: "vm-spoke1 gets 403 from stlogs03 since public access was turned off.",
    setup: () => {
      const st = base();
      vnet(st, "vnet-spoke1", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24" } });
      vnet(st, "vnet-hub", ["10.0.0.0/16"], { "subnet-pe": { p: "10.0.3.0/24" } });
      host(st, "vm-spoke1", "vnet-spoke1", "subnet-app", "10.1.1.4");
      peer(st, "vnet-hub", "vnet-spoke1"); peer(st, "vnet-spoke1", "vnet-hub", { access: false });
      privateBlob(st, "stlogs03", "10.0.3.6", "203.0.113.30", ["vnet-hub"]);
      st.vnets["vnet-spoke1"].subnets["subnet-app"].serviceEndpoints = ["Microsoft.Storage"];
      Object.assign(st.publicEndpoints["203.0.113.30"], { defaultAction: "Deny", vnetRules: [{ vnet: "vnet-spoke1", subnet: "subnet-app" }] });
      return st;
    },
    objectives: [
      { text: "Make stlogs03.blob.core.windows.net resolve to 10.0.3.6 from vm-spoke1", test: ({ st }) => looksUp(st, "vm-spoke1", "stlogs03.blob.core.windows.net") === "10.0.3.6" },
      { text: "Get vm-spoke1 reaching the private endpoint on 443", test: ({ st }) => can(st, "vm-spoke1", "10.0.3.6", 443) },
      { text: "Keep public network access disabled", test: ({ st }) => !st.publicEndpoints["203.0.113.30"].publicAccess },
    ],
    par: 2,
    hints: ["ssh vm-spoke1 and nslookup the name. Then check whether the spoke can reach the hub at all.", "Notice what the name resolves to from the spoke: the public IP or the private one. Then notice whether spoke1's side of the peering lets traffic through at all.", "Run nslookup from vm-spoke1, then check which VNets the privatelink zone is linked to and the peering settings on spoke1's side."],
    lesson: "Service endpoints reach the service's public endpoint, so they stop working when public network access is disabled. Private endpoints keep working: they need DNS that returns the private IP, and a network path to it.",
    why: "Linking privatelink.blob.core.windows.net to vnet-spoke1 makes stlogs03 resolve to its private endpoint, 10.0.3.6. Allowing VNet access on spoke1-to-hub lets the packet cross the peering to it, and a private endpoint doesn't care that public access is off.",
    learn: [LEARN.compare, LEARN.stPe, LEARN.peDns],
    flows: [{ from: "vm-spoke1", dns: "stlogs03.blob.core.windows.net", expect: "pe-stlogs03", port: 443, want: "open" }],
    solution: [`az network private-dns link vnet create ${G} --zone-name privatelink.blob.core.windows.net --name link-spoke1 --virtual-network vnet-spoke1 --registration-enabled false`, `az network vnet peering update ${G} --vnet-name vnet-spoke1 --name spoke1-to-hub --allow-vnet-access true`],
  },
  {
    id: "custom-dns", tier: "advanced", stage: "DNS", title: "Private endpoint resolves wrong with custom DNS",
    story: "vnet-spoke1 uses the company DNS server in the hub instead of Azure DNS. That server, dns-hub, was moved to 10.0.4.4 last week. It already forwards privatelink.blob.core.windows.net to Azure DNS. vm-spoke1 can't resolve stlogs01.blob.core.windows.net to its private endpoint at 10.0.3.4.",
    fix: "vm-spoke1 can't resolve stlogs01 to its private endpoint at 10.0.3.4.",
    setup: () => {
      const st = base();
      vnet(st, "vnet-spoke1", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24" } });
      vnet(st, "vnet-hub", ["10.0.0.0/16"], { "subnet-pe": { p: "10.0.3.0/24" }, "subnet-dns": { p: "10.0.4.0/24" } });
      host(st, "vm-spoke1", "vnet-spoke1", "subnet-app", "10.1.1.4");
      peer(st, "vnet-hub", "vnet-spoke1"); peer(st, "vnet-spoke1", "vnet-hub");
      dnsVm(st, "dns-hub", "vnet-hub", "subnet-dns", "10.0.4.4", { forwarders: { "privatelink.blob.core.windows.net": "168.63.129.16" } });
      privateBlob(st, "stlogs01", "10.0.3.4", "203.0.113.10", ["vnet-spoke1"]);
      st.vnets["vnet-spoke1"].dnsServers = ["10.0.4.9"];
      return st;
    },
    objectives: [
      { text: "Make stlogs01.blob.core.windows.net resolve to 10.0.3.4 from vm-spoke1", test: ({ st }) => looksUp(st, "vm-spoke1", "stlogs01.blob.core.windows.net") === "10.0.3.4" },
      { text: "Keep vnet-spoke1 using the company DNS server", test: ({ st }) => st.vnets["vnet-spoke1"].dnsServers?.[0] === "10.0.4.4" },
    ],
    par: 2,
    hints: ["ssh vm-spoke1 and nslookup the name. Then check which DNS server the VNet uses: az network vnet show -g rg-lab --name vnet-spoke1 --query dhcpOptions", "Notice who answers your lookup, if anyone. Then think about which network Azure DNS sees the question from once dns-hub forwards it.", "Run nslookup from vm-spoke1 and read the Server line. Compare it with where dns-hub really lives, then check which VNets the privatelink zone is linked to."],
    lesson: "With custom DNS, the private zone is consulted from the DNS server's virtual network. The server must forward privatelink names to 168.63.129.16, and the zone must be linked to the network the server lives in.",
    why: "vnet-spoke1 now sends queries to 10.0.4.4, where dns-hub really is. dns-hub forwards privatelink names to 168.63.129.16, which answers as vnet-hub, so with the zone linked to vnet-hub it returns 10.0.3.4.",
    learn: [LEARN.peDns, LEARN.dnsIntegration, LEARN.vnetDns],
    flows: [{ from: "vm-spoke1", dns: "stlogs01.blob.core.windows.net", expect: "pe-stlogs01", port: 443, want: "open" }],
    solution: [`az network vnet update ${G} --name vnet-spoke1 --dns-servers 10.0.4.4`, `az network private-dns link vnet create ${G} --zone-name privatelink.blob.core.windows.net --name link-hub --virtual-network vnet-hub --registration-enabled false`],
  },
  {
    id: "resolver-inbound", tier: "advanced", stage: "DNS", title: "Finish a DNS Private Resolver migration",
    story: "The DNS server VM in the hub was retired. Its replacement, the DNS Private Resolver dnspr-hub, was created in vnet-hub, but the migration stopped halfway. vm-spoke1 can't resolve anything. Finish it: spokes should send DNS to the resolver, and stlogs01 should resolve to its private endpoint at 10.0.3.4.",
    fix: "vm-spoke1 can't resolve any names.",
    setup: () => {
      const st = base();
      vnet(st, "vnet-spoke1", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24" } });
      vnet(st, "vnet-hub", ["10.0.0.0/16"], { "subnet-pe": { p: "10.0.3.0/24" }, "snet-dns-in": { p: "10.0.5.0/28" }, "subnet-shared": { p: "10.0.6.0/24" } });
      host(st, "vm-spoke1", "vnet-spoke1", "subnet-app", "10.1.1.4");
      host(st, "vm-tools", "vnet-hub", "subnet-shared", "10.0.6.4");
      peer(st, "vnet-hub", "vnet-spoke1"); peer(st, "vnet-spoke1", "vnet-hub");
      privateBlob(st, "stlogs01", "10.0.3.4", "203.0.113.10", ["vnet-hub"]);
      (st.resolvers ??= {})["dnspr-hub"] = { vnet: "vnet-hub", inbound: {}, outbound: {} };
      st.vnets["vnet-spoke1"].dnsServers = ["10.0.4.4"];
      return st;
    },
    objectives: [
      { text: "Make stlogs01.blob.core.windows.net resolve to 10.0.3.4 from vm-spoke1", test: ({ st }) => looksUp(st, "vm-spoke1", "stlogs01.blob.core.windows.net") === "10.0.3.4" },
      { text: "Send vnet-spoke1's DNS to the resolver's inbound endpoint", test: ({ st }) => { const ip = st.vnets["vnet-spoke1"].dnsServers?.[0]; return !!ip && Object.values(st.hosts).some((h) => h.kind === "dnsin" && h.ip === ip); } },
    ],
    par: 2,
    hints: ["Look at the resolver: az dns-resolver inbound-endpoint list -g rg-lab --dns-resolver-name dnspr-hub. Then at the hub's subnets.", "Notice whether the resolver has anything yet that other networks can send queries to, and where vnet-spoke1 sends them today. The hub already has an empty subnet sized for the job.", "List the resolver's inbound endpoints with az dns-resolver inbound-endpoint list, and compare vnet-spoke1's DNS servers with what's still running."],
    lesson: "A DNS Private Resolver answers other networks through an inbound endpoint, which lives in its own subnet and gets a private IP. Point the spokes' DNS servers at that IP, and link the private zones to the resolver's virtual network.",
    why: "The new inbound endpoint in snet-dns-in gives dnspr-hub an IP, 10.0.5.4, that other networks can query. vnet-spoke1 now sends DNS there instead of the retired 10.0.4.4, and the resolver answers from the privatelink zone linked to vnet-hub.",
    learn: [LEARN.resolver, LEARN.resolverSubnets, LEARN.resolverCli],
    flows: [{ from: "vm-spoke1", dns: "stlogs01.blob.core.windows.net", expect: "pe-stlogs01", port: 443, want: "open" }],
    solution: [`az dns-resolver inbound-endpoint create ${G} --dns-resolver-name dnspr-hub --name in-endpoint --ip-configurations "[{private-ip-allocation-method:Dynamic,id:/subscriptions/x/resourceGroups/rg-lab/providers/Microsoft.Network/virtualNetworks/vnet-hub/subnets/snet-dns-in}]"`, `az network vnet update ${G} --name vnet-spoke1 --dns-servers 10.0.5.4`],
  },
  {
    id: "resolver-rules", tier: "advanced", stage: "DNS", title: "Spoke can't resolve on-premises names",
    story: "The app on vm-spoke1 needs app.corp.contoso.com, which only the on-premises DNS server dns-onprem at 192.168.10.10 knows. The hub's resolver dnspr-hub has an outbound endpoint and a forwarding ruleset, rs-onprem, with a rule for corp.contoso.com, copied from the old design. Nobody can resolve the name yet, and vm-spoke1 is where it's needed.",
    fix: "vm-spoke1 can't resolve app.corp.contoso.com.",
    setup: () => {
      const st = hybrid();
      st.vnets["vnet-hub"].subnets["snet-dns-out"] = { prefixes: ["10.0.5.16/28"], nsg: null, rt: null };
      st.vnets["vnet-hub"].subnets["snet-dns-in"] = { prefixes: ["10.0.5.0/28"], nsg: null, rt: null };
      dnsVm(st, "dns-onprem", "onprem-dc", "subnet-servers", "192.168.10.10", { zones: { "corp.contoso.com": { app: "192.168.10.5" } } });
      host(st, "vm-hub", "vnet-hub", "subnet-shared", "10.0.1.4");
      resolver(st, "dnspr-hub", "vnet-hub", { subnet: "snet-dns-in", ip: "10.0.5.4" }, { subnet: "snet-dns-out", ruleset: "rs-onprem", rules: { corp: { domain: "corp.contoso.com.", targets: ["192.168.10.11:53"] } }, links: { "link-hub": "vnet-hub" } });
      st.hosts["dns-onprem-old"] = { ...st.hosts["dns-onprem"], name: "dns-onprem-old", ip: "192.168.10.11", nic: "dns-onprem-old-nic", dnsZones: { "corp.contoso.com": {} } };
      return st;
    },
    objectives: [
      { text: "Make app.corp.contoso.com resolve to 192.168.10.5 from vm-spoke1", test: ({ st }) => looksUp(st, "vm-spoke1", "app.corp.contoso.com") === "192.168.10.5" },
      { text: "Get vm-spoke1 reaching app.corp.contoso.com on 443", test: ({ st }) => can(st, "vm-spoke1", "192.168.10.5", 443) },
    ],
    par: 2,
    hints: ["Look at the ruleset's rules and links: az dns-resolver forwarding-rule list -g rg-lab --ruleset-name rs-onprem -o table, and az dns-resolver vnet-link list -g rg-lab --ruleset-name rs-onprem", "Two things decide whether this works: which VNets the ruleset applies to, and which server the rule hands the question to.", "List the ruleset's VNet links and its rules with az dns-resolver forwarding-rule list. Compare each rule's target with where dns-onprem lives."],
    lesson: "Forwarding rulesets send matching names to the DNS servers you choose, but only for virtual networks linked to the ruleset. Check the link and check the target: a stale target IP fails just as quietly as a missing link.",
    why: "Linking rs-onprem to vnet-spoke1 puts vm-spoke1's queries for corp.contoso.com through the rule. The rule now sends them to dns-onprem at 192.168.10.10, the server that hosts the zone, instead of the old 192.168.10.11.",
    learn: [LEARN.resolver, LEARN.resolverCli, L("Ruleset links", "https://learn.microsoft.com/azure/dns/private-resolver-endpoints-rulesets#ruleset-links")],
    flows: [{ from: "vm-spoke1", dns: "app.corp.contoso.com", expect: "srv-onprem", port: 443, want: "open" }],
    solution: [`az dns-resolver vnet-link create ${G} --ruleset-name rs-onprem --name link-spoke1 --id /subscriptions/x/resourceGroups/rg-lab/providers/Microsoft.Network/virtualNetworks/vnet-spoke1`, `az dns-resolver forwarding-rule update ${G} --ruleset-name rs-onprem --name corp --target-dns-servers "[{ip-address:192.168.10.10,port:53}]"`],
  },
  {
    id: "firewall-rules", tier: "advanced", stage: "Azure Firewall", title: "Azure Firewall blocks allowed HTTPS",
    story: "The NVA was replaced by Azure Firewall, azfw-hub, at 10.0.1.4. rt-spoke1 sends spoke2 traffic to it. The firewall team says they allowed spoke1 to spoke2 on HTTPS. vm-spoke1 still can't reach vm-spoke2 on 443. SSH between the spokes must stay blocked.",
    fix: "vm-spoke1 can't reach vm-spoke2 on 443, even though HTTPS was allowed.",
    setup: () => {
      const st = base();
      vnet(st, "vnet-spoke1", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24", rt: "rt-spoke1" } });
      vnet(st, "vnet-hub", ["10.0.0.0/16"], { AzureFirewallSubnet: { p: "10.0.1.0/26" } });
      vnet(st, "vnet-spoke2", ["10.2.0.0/16"], { "subnet-app": { p: "10.2.1.0/24", rt: "rt-spoke2" } });
      host(st, "vm-spoke1", "vnet-spoke1", "subnet-app", "10.1.1.4");
      host(st, "vm-spoke2", "vnet-spoke2", "subnet-app", "10.2.1.4", { ports: [22, 443] });
      azfw(st, "azfw-hub", "vnet-hub", "10.0.1.4", [
        { name: "Block-Spokes", priority: 200, action: "Deny", rules: [{ name: "spoke-to-spoke", protocols: ["Any"], src: ["10.1.0.0/16"], dst: ["10.2.0.0/16"], ports: ["*"] }] },
        { name: "Allow-App", priority: 300, action: "Allow", rules: [{ name: "https", protocols: ["TCP"], src: ["10.1.0.0/16"], dst: ["10.2.0.0/16"], ports: ["433"] }] },
      ]);
      peer(st, "vnet-hub", "vnet-spoke1", { fwd: true }); peer(st, "vnet-spoke1", "vnet-hub", { fwd: true });
      peer(st, "vnet-hub", "vnet-spoke2", { fwd: true }); peer(st, "vnet-spoke2", "vnet-hub", { fwd: true });
      st.rts["rt-spoke1"] = { routes: [{ name: "to-spoke2", prefix: "10.2.0.0/16", type: "VirtualAppliance", nhIp: "10.0.1.4" }] };
      st.rts["rt-spoke2"] = { routes: [] };
      return st;
    },
    objectives: [
      { text: "Get vm-spoke1 reaching vm-spoke2 on 443 through azfw-hub", test: ({ st }) => through(st, "vm-spoke1", "10.2.1.4", 443, "azfw-hub") },
      { text: "Keep SSH from vm-spoke1 to vm-spoke2 blocked", test: ({ st }) => !can(st, "vm-spoke1", "10.2.1.4", 22) },
    ],
    par: 2,
    hints: ["Read the rules in the order the firewall does: az network firewall network-rule collection list -g rg-lab --firewall-name azfw-hub -o table", "Read the collections in priority order and ask which one a packet to 443 matches first. Read every field of the allow rule. Then follow the reply.", "List the firewall's rule collections in priority order with az network firewall network-rule collection list, read each rule's ports, then compare rt-spoke2 with rt-spoke1."],
    lesson: "Azure Firewall denies everything until a rule allows it, runs rule collections from priority 100 upward, and stops at the first match. An allow below a broad deny never runs. And each spoke needs a route through the firewall, or the reply skips it.",
    why: "An allow for TCP 443 now runs at a lower priority number than Block-Spokes, so HTTPS matches it first, while SSH still falls to the deny. (Allow-App said port 433 and sat below the deny, so it never ran.) The to-spoke1 route in rt-spoke2 sends the reply back through 10.0.1.4, so azfw-hub sees both directions.",
    learn: [LEARN.fwRules, LEARN.fwFaq, LEARN.fwCli],
    flows: [{ from: "vm-spoke1", to: "vm-spoke2", port: 443, want: "open" }, { from: "vm-spoke1", to: "vm-spoke2", port: 22, want: "closed" }],
    solution: [`az network firewall network-rule create ${G} --firewall-name azfw-hub --collection-name Allow-HTTPS --name https --priority 150 --action Allow --protocols TCP --source-addresses 10.1.0.0/16 --destination-addresses 10.2.0.0/16 --destination-ports 443`, `az network route-table route create ${G} --route-table-name rt-spoke2 --name to-spoke1 --address-prefix 10.1.0.0/16 --next-hop-type VirtualAppliance --next-hop-ip-address 10.0.1.4`],
  },
  {
    id: "firewall-hybrid", tier: "advanced", stage: "Azure Firewall", title: "Inspect on-premises traffic with Azure Firewall",
    story: "Security wants all traffic between vm-spoke1 and on-premises inspected by azfw-hub at 10.0.1.4. rt-spoke1 already sends 192.168.0.0/16 to the firewall. Traffic from on-premises enters Azure at vgw-hub, in the hub's GatewaySubnet. srv-onprem needs to reach vm-spoke1 on 443, and nothing works yet. SSH from on-premises must stay blocked.",
    fix: "srv-onprem can't reach vm-spoke1 on 443.",
    setup: () => {
      const st = hybrid();
      st.vnets["vnet-hub"].subnets["AzureFirewallSubnet"] = { prefixes: ["10.0.1.0/26"], nsg: null, rt: null };
      delete st.vnets["vnet-hub"].subnets["subnet-shared"];
      st.vnets["vnet-spoke1"].subnets["subnet-app"].rt = "rt-spoke1";
      st.rts["rt-spoke1"] = { routes: [{ name: "onprem-via-fw", prefix: "192.168.0.0/16", type: "VirtualAppliance", nhIp: "10.0.1.4" }] };
      st.peerings["vnet-spoke1/spoke1-to-hub"].allowForwarded = true;
      azfw(st, "azfw-hub", "vnet-hub", "10.0.1.4", []);
      return st;
    },
    objectives: [
      { text: "Get srv-onprem reaching vm-spoke1 on 443 through azfw-hub", test: ({ st }) => through(st, "srv-onprem", "10.1.1.4", 443, "azfw-hub") },
      { text: "Keep SSH from on-premises to vm-spoke1 blocked", test: ({ st }) => !can(st, "srv-onprem", "10.1.1.4", 22) },
    ],
    par: 4,
    hints: ["Explain the connection. Then ask: what does the gateway subnet do with traffic coming in from on-premises?", "Traffic from on-premises follows GatewaySubnet's routes, not the spoke's. Notice whether the inbound path ever touches the firewall, compare it with the reply's path, and check what the firewall allows.", "Trace both directions. Which route tables send on-premises traffic to the firewall, and which rule collection would allow 192.168.0.0/16 to the spoke?"],
    lesson: "To inspect hybrid traffic, route it through the firewall from both ends: the spoke's route table, and a route table on GatewaySubnet for the spoke's range. Use the specific workload range, never 0.0.0.0/0 on GatewaySubnet. Then allow the traffic in the firewall.",
    why: "A route table on GatewaySubnet sends 10.1.0.0/16 to 10.0.1.4, so requests from on-premises pass azfw-hub on the way in, the same way rt-spoke1 sends the replies. A firewall allow for TCP 443 from 192.168.0.0/16 to the spoke lets HTTPS through, while SSH still meets the firewall's default deny.",
    learn: [LEARN.fwHybrid, LEARN.gwSubnet, LEARN.fwRules],
    flows: [{ from: "srv-onprem", to: "vm-spoke1", port: 443, want: "open" }, { from: "srv-onprem", to: "vm-spoke1", port: 22, want: "closed" }],
    solution: [
      `az network route-table create ${G} --name rt-gateway`,
      `az network route-table route create ${G} --route-table-name rt-gateway --name to-spoke1 --address-prefix 10.1.0.0/16 --next-hop-type VirtualAppliance --next-hop-ip-address 10.0.1.4`,
      `az network vnet subnet update ${G} --vnet-name vnet-hub --name GatewaySubnet --route-table rt-gateway`,
      `az network firewall network-rule create ${G} --firewall-name azfw-hub --collection-name Allow-OnPrem --name https --priority 200 --action Allow --protocols TCP --source-addresses 192.168.0.0/16 --destination-addresses 10.1.0.0/16 --destination-ports 443`,
    ],
  },
  {
    id: "bastion-build", tier: "advanced", stage: "Bastion", title: "Bastion deployment fails",
    story: "Security removed every public IP from the VMs. Admins need SSH to vm-app through Azure Bastion instead. Someone started: there's a subnet called BastionSubnet, and a Standard public IP called pip-bastion in westus. Deploy Bastion bas-hub in vnet-hub so it can reach vm-app on 22. vm-client, in subnet-client, must not reach vm-app on 22.",
    fix: "Bastion bas-hub won't deploy, so admins can't SSH to vm-app.",
    setup: () => {
      const st = base();
      vnet(st, "vnet-hub", ["10.0.0.0/16"], { "subnet-app": { p: "10.0.1.0/24", nsg: "nsg-app" }, BastionSubnet: { p: "10.0.6.0/27" }, "subnet-client": { p: "10.0.2.0/24" } });
      host(st, "vm-app", "vnet-hub", "subnet-app", "10.0.1.4", { ports: [22, 443] });
      host(st, "vm-client", "vnet-hub", "subnet-client", "10.0.2.4");
      rule(st, "nsg-app", { name: "Allow-SSH-Bastion", priority: 200, direction: "Inbound", access: "Allow", protocol: "Tcp", src: ["10.0.6.0/27"], dst: ["*"], ports: ["22"] });
      rule(st, "nsg-app", { name: "Deny-SSH", priority: 300, direction: "Inbound", access: "Deny", protocol: "Tcp", src: ["*"], dst: ["*"], ports: ["22"] });
      st.publicIps = { "pip-bastion": { sku: "Standard", ip: "198.51.100.5", region: "westus" } };
      return st;
    },
    objectives: [
      { text: "Get Bastion bas-hub reaching vm-app on 22", test: ({ st }) => { const b = st.bastions?.["bas-hub"]; return !!b?.host && can(st, b.host, "10.0.1.4", 22); } },
      { text: "Keep SSH (22) from vm-client to vm-app blocked", test: ({ st }) => !can(st, "vm-client", "10.0.1.4", 22) },
    ],
    par: 5,
    hints: ["Try the deployment and read the error: az network bastion create -g rg-lab --name bas-hub --vnet-name vnet-hub --public-ip-address pip-bastion --sku Basic", "Each failed attempt names one requirement. Bastion is strict about its subnet and its public IP. And nsg-app was written for the subnet you were given: if the subnet changes, the rule has to follow.", "Read the error each bastion create attempt gives you: the subnet name and size, the public IP's SKU and region. Then read nsg-app's SSH rule source."],
    lesson: "Azure Bastion (any SKU but Developer) needs a dedicated subnet named AzureBastionSubnet, /26 or larger, and a Standard SKU public IP in the same region. It connects from that subnet to the VM's private IP, so the target VM's NSG has to allow SSH or RDP from the AzureBastionSubnet range.",
    why: "bas-hub only deploys into a subnet named exactly AzureBastionSubnet, /26 or larger, with a Standard public IP in its own region, so the new subnet and IP let it deploy. Allow-SSH-Bastion now trusts the new subnet's range, so bas-hub gets to vm-app on 22 while Deny-SSH still stops vm-client.",
    learn: [LEARN.bastionCfg, LEARN.bastionNsg, LEARN.bastionCli, L("Troubleshoot Bastion deployment failures", "https://learn.microsoft.com/troubleshoot/azure/bastion/troubleshoot-host-deployment-failures#resolution-a")],
    solution: [
      `az network vnet subnet create ${G} --vnet-name vnet-hub --name AzureBastionSubnet --address-prefixes 10.0.7.0/26`,
      `az network public-ip create ${G} --name pip-bastion2 --sku Standard`,
      `az network bastion create ${G} --name bas-hub --vnet-name vnet-hub --public-ip-address pip-bastion2 --sku Basic`,
      `az network nsg rule update ${G} --nsg-name nsg-app --name Allow-SSH-Bastion --source-address-prefixes 10.0.7.0/26`,
    ],
  },
  {
    id: "bastion-peered", tier: "advanced", stage: "Bastion", title: "Bastion can't reach a VM in a spoke",
    story: "Bastion bas-hub (Basic SKU) in the hub works for hub VMs. Admins can't get to vm-spoke1 through it. vnet-spoke1 is peered to the hub, and its NSG, nsg-spoke1, was written to allow SSH from the hub's old jump box subnet. Admins should come in only through Bastion now, so vm-jump, the old jump box, must lose SSH to vm-spoke1.",
    fix: "Admins can't reach vm-spoke1 through Bastion bas-hub.",
    setup: () => {
      const st = base();
      vnet(st, "vnet-hub", ["10.0.0.0/16"], { AzureBastionSubnet: { p: "10.0.7.0/26" }, "subnet-jump": { p: "10.0.0.0/24" } });
      vnet(st, "vnet-spoke1", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24", nsg: "nsg-spoke1" } });
      host(st, "vm-spoke1", "vnet-spoke1", "subnet-app", "10.1.1.4", { ports: [22, 443] });
      host(st, "vm-jump", "vnet-hub", "subnet-jump", "10.0.0.4");
      host(st, "bas-hub", "vnet-hub", "AzureBastionSubnet", "10.0.7.4", { kind: "bastion", ports: [443], label: "Bastion" });
      st.bastions = { "bas-hub": { vnet: "vnet-hub", sku: "Basic", tunneling: false, host: "bas-hub" } };
      peer(st, "vnet-hub", "vnet-spoke1", { access: false }); peer(st, "vnet-spoke1", "vnet-hub");
      rule(st, "nsg-spoke1", { name: "Allow-SSH-Jump", priority: 200, direction: "Inbound", access: "Allow", protocol: "Tcp", src: ["10.0.0.0/24"], dst: ["*"], ports: ["22"] });
      rule(st, "nsg-spoke1", { name: "Deny-SSH", priority: 300, direction: "Inbound", access: "Deny", protocol: "Tcp", src: ["*"], dst: ["*"], ports: ["22"] });
      return st;
    },
    objectives: [
      { text: "Get bas-hub reaching vm-spoke1 on 22", test: ({ st }) => can(st, "bas-hub", "10.1.1.4", 22) },
      { text: "Stop vm-jump from reaching vm-spoke1 on 22", test: ({ st }) => !can(st, "vm-jump", "10.1.1.4", 22) },
    ],
    par: 2,
    hints: ["Check the path from the Bastion subnet: az network vnet peering list -g rg-lab --vnet-name vnet-hub -o table", "Bastion connects from AzureBastionSubnet, like any other source in the hub. Notice whether traffic from the hub can cross the peering at all, and which hub range nsg-spoke1 trusts.", "Check both sides of the hub-spoke peering with az network vnet peering show, then compare nsg-spoke1's SSH rule source with AzureBastionSubnet's range."],
    lesson: "Bastion reaches VMs in peered virtual networks on Basic and higher SKUs, not on Developer. The connection starts from AzureBastionSubnet, so peering has to carry traffic from the hub and the target's NSG must allow that subnet's range.",
    why: "With VNet access allowed on hub-to-spoke1, traffic from AzureBastionSubnet can cross the peering into the spoke. Allow-SSH-Jump now trusts 10.0.7.0/26 instead of the old jump box subnet, so bas-hub gets in on 22 and vm-jump falls through to Deny-SSH.",
    learn: [LEARN.bastionSku, LEARN.bastionNsg, LEARN.peering],
    flows: [{ from: "bas-hub", to: "vm-spoke1", port: 22, want: "open" }, { from: "vm-jump", to: "vm-spoke1", port: 22, want: "closed" }],
    solution: [`az network vnet peering update ${G} --vnet-name vnet-hub --name hub-to-spoke1 --allow-vnet-access true`, `az network nsg rule update ${G} --nsg-name nsg-spoke1 --name Allow-SSH-Jump --source-address-prefixes 10.0.7.0/26`],
  },
];
