// Expert tier: incident mode. A complaint in the words users use, several faults, no hints,
// no Explain, no forms, and a clock. Every behavior here is one the earlier tiers taught and sourced.
import { azfw, base, can, dnsVm, gateway, host, looksUp, onprem, peer, resolver, rule, vnet } from "../build";
import { reach } from "@/sim/network";
import type { State } from "@/sim/types";
import type { Level } from "../types";
import { hybrid, nvaHub, privateBlob } from "./advanced";

const L = (title: string, url: string) => ({ title, url });
const G = "-g rg-lab";
const through = (st: State, from: string, ip: string, port: number, via: string) => { const r = reach(st, from, ip, port); return r.ok && r.via.includes(via); };
const noSpokePeering = (st: State) => !Object.values(st.peerings).some((p) => p.vnet.includes("spoke") && p.remote.includes("spoke"));

const LEARN = {
  nsg: L("Troubleshoot NSG misconfigurations", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-nsg-blocking-traffic"),
  conn: L("Troubleshoot connectivity between Azure VMs", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-connectivity-problem-between-vms"),
  routing: L("Diagnose a VM routing problem", "https://learn.microsoft.com/azure/virtual-network/diagnose-network-routing-problem"),
  peering: L("Troubleshoot virtual network peering problems", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-peering-issues"),
  peDns: L("Troubleshoot private endpoint DNS resolution", "https://learn.microsoft.com/troubleshoot/azure/private-link/troubleshoot-private-endpoint-dns-resolution"),
  transit: L("Configure VPN gateway transit for virtual network peering", "https://learn.microsoft.com/azure/vpn-gateway/vpn-gateway-peering-gateway-transit"),
  fw: L("Azure Firewall rule processing logic", "https://learn.microsoft.com/azure/firewall/rule-processing"),
  bastion: L("Working with NSG access and Azure Bastion", "https://learn.microsoft.com/azure/bastion/bastion-nsg#target-vm-subnet"),
  resolver: L("Azure DNS Private Resolver endpoints and rulesets", "https://learn.microsoft.com/azure/dns/private-resolver-endpoints-rulesets"),
  watcher: L("Network Watcher overview", "https://learn.microsoft.com/azure/network-watcher/network-watcher-overview"),
};

export const expert: Level[] = [
  {
    id: "reports-down", tier: "expert", stage: "Incident", title: "The reports site is down",
    story: "\"Finance can't open the reports site since this morning. It worked yesterday, and nobody here touched anything.\" The reports site runs on vm-reports (10.1.1.4) over HTTPS. Finance works from subnet-users, like vm-finance. SSH to the reports server must stay locked down for users.",
    fix: "Finance can't open the reports site.",
    clock: 10,
    setup: () => {
      const st = base();
      vnet(st, "vnet-corp", ["10.1.0.0/16"], { "subnet-web": { p: "10.1.1.0/24", nsg: "nsg-web" }, "subnet-users": { p: "10.1.2.0/24" } });
      host(st, "vm-reports", "vnet-corp", "subnet-web", "10.1.1.4", { ports: [22, 443], nicNsg: "nsg-reports-nic" });
      host(st, "vm-finance", "vnet-corp", "subnet-users", "10.1.2.4");
      rule(st, "nsg-web", { name: "Deny-All-Inbound", priority: 200, direction: "Inbound", access: "Deny", protocol: "*", src: ["*"], dst: ["*"], ports: ["*"] });
      rule(st, "nsg-web", { name: "Allow-HTTPS-Users", priority: 300, direction: "Inbound", access: "Allow", protocol: "Tcp", src: ["10.1.2.0/24"], dst: ["*"], ports: ["443"] });
      rule(st, "nsg-reports-nic", { name: "Deny-Vnet-Inbound", priority: 4000, direction: "Inbound", access: "Deny", protocol: "*", src: ["VirtualNetwork"], dst: ["*"], ports: ["*"] });
      return st;
    },
    objectives: [
      { text: "Let Finance open the reports site (vm-finance to vm-reports on 443)", test: ({ st }) => can(st, "vm-finance", "10.1.1.4", 443) },
      { text: "Keep SSH to vm-reports blocked from the users subnet", test: ({ st }) => !can(st, "vm-finance", "10.1.1.4", 22) },
    ],
    par: 2,
    hints: [],
    lesson: "Two layers, two faults: a subnet NSG where a deny runs before the allow, and a NIC NSG that denies everything from the VNet. Effective security rules and IP flow verify show both without guessing.",
    why: "NSG rules run in priority order and the first match wins, so the allow for Finance had to come before the deny in nsg-web. Inbound traffic then passes the NIC's own NSG too, which needed its own allow for 443. SSH still hits a deny in both, so it stays blocked.",
    learn: [LEARN.nsg, LEARN.watcher],
    flows: [{ from: "vm-finance", to: "vm-reports", port: 443, want: "open" }, { from: "vm-finance", to: "vm-reports", port: 22, want: "closed" }],
    solution: [
      `az network nsg rule update ${G} --nsg-name nsg-web --name Allow-HTTPS-Users --priority 150`,
      `az network nsg rule create ${G} --nsg-name nsg-reports-nic --name Allow-HTTPS-Users --priority 300 --direction Inbound --access Allow --protocol Tcp --source-address-prefixes 10.1.2.0/24 --destination-port-ranges 443`,
    ],
  },
  {
    id: "spoke-silence", tier: "expert", stage: "Incident", title: "Spoke 2 can't reach Spoke 1",
    story: "\"Since the weekend maintenance, nothing in Spoke 2 can reach the app in Spoke 1.\" The app runs on vm-spoke1 (10.1.1.4) on 443, and vm-spoke2 calls it. By design, traffic between spokes goes through fw-hub, the hub's network appliance at 10.0.2.4, and the spokes are never peered to each other.",
    fix: "Nothing in Spoke 2 can reach the app in Spoke 1.",
    clock: 20,
    setup: () => {
      const st = nvaHub({ forwarding: false, fwd1: false, rt2: { prefix: "10.1.0.0/16", nhIp: "10.0.2.40" } });
      st.hosts["vm-spoke1"].ports = [22, 443];
      return st;
    },
    objectives: [
      { text: "Get vm-spoke2 reaching the app on vm-spoke1 (443) through fw-hub", test: ({ st }) => through(st, "vm-spoke2", "10.1.1.4", 443, "fw-hub") },
      { text: "Don't peer the spokes to each other", test: ({ st }) => noSpokePeering(st) },
    ],
    par: 3,
    hints: [],
    lesson: "A maintenance window can break three layers at once: a route pointing at a mistyped address, an appliance NIC without IP forwarding, and a peering that won't accept forwarded traffic. Work the path hop by hop and the faults line up.",
    why: "The packet goes Spoke 2, fw-hub, Spoke 1, and back. The route had to name fw-hub's real address, fw-hub's NIC had to be allowed to pass on traffic not addressed to it, and Spoke 1's peering had to accept traffic the hub forwarded. With all three, every hop passes it along.",
    learn: [LEARN.routing, LEARN.peering, L("Network interface: enable or disable IP forwarding", "https://learn.microsoft.com/azure/virtual-network/virtual-network-network-interface#enable-or-disable-ip-forwarding")],
    flows: [{ from: "vm-spoke2", to: "vm-spoke1", port: 443, want: "open" }],
    solution: [
      `az network route-table route update ${G} --route-table-name rt-spoke2 --name to-spoke1 --next-hop-ip-address 10.0.2.4`,
      `az network nic update ${G} --name fw-hub-nic --ip-forwarding true`,
      `az network vnet peering update ${G} --vnet-name vnet-spoke1 --name spoke1-to-hub --allow-forwarded-traffic true`,
    ],
  },
  {
    id: "uploads-failing", tier: "expert", stage: "Incident", title: "Uploads keep failing",
    story: "\"Since security locked down storage last week, the app in Spoke 1 can't upload to stuploads01.\" The app runs on vm-app. stuploads01 is a blob storage account reached through a private endpoint in the hub, and its public network access stays off. Spoke 1 uses the company DNS server, dns-hub at 10.0.4.4 in the hub, and keeps using it.",
    fix: "The app in Spoke 1 can't upload to stuploads01.",
    clock: 15,
    setup: () => {
      const st = base();
      vnet(st, "vnet-spoke1", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24" } });
      vnet(st, "vnet-hub", ["10.0.0.0/16"], { "subnet-pe": { p: "10.0.3.0/24" }, "subnet-dns": { p: "10.0.4.0/24" } });
      host(st, "vm-app", "vnet-spoke1", "subnet-app", "10.1.1.4");
      peer(st, "vnet-hub", "vnet-spoke1"); peer(st, "vnet-spoke1", "vnet-hub", { access: false });
      dnsVm(st, "dns-hub", "vnet-hub", "subnet-dns", "10.0.4.4", { forwarders: { "privatelink.blob.core.windows.net": "168.63.129.16" } });
      privateBlob(st, "stuploads01", "10.0.3.8", "203.0.113.40", ["vnet-spoke1"]);
      st.vnets["vnet-spoke1"].dnsServers = ["10.0.4.4"];
      return st;
    },
    objectives: [
      { text: "Get the app reaching stuploads01 on 443 over its private endpoint", test: ({ st }) => looksUp(st, "vm-app", "stuploads01.blob.core.windows.net") === "10.0.3.8" && can(st, "vm-app", "10.0.3.8", 443) },
      { text: "Keep public network access on stuploads01 off", test: ({ st }) => !st.publicEndpoints["203.0.113.40"].publicAccess },
      { text: "Keep Spoke 1 using the company DNS server", test: ({ st }) => st.vnets["vnet-spoke1"].dnsServers?.[0] === "10.0.4.4" },
    ],
    par: 2,
    hints: [],
    lesson: "With custom DNS, the private zone has to be linked to the DNS server's network, and the spoke still needs a working path to both the DNS server and the private endpoint. Check DNS first, then the path.",
    why: "dns-hub asks Azure DNS from the hub's network, so the private zone only answers once it's linked to vnet-hub. Then the name returns the private endpoint's 10.0.3.8. Spoke 1 also needed VNet access on its peering to reach both dns-hub and the endpoint.",
    learn: [LEARN.peDns, L("Private endpoint DNS integration", "https://learn.microsoft.com/azure/private-link/private-endpoint-dns-integration"), LEARN.peering],
    flows: [{ from: "vm-app", dns: "stuploads01.blob.core.windows.net", expect: "pe-stuploads01", port: 443, want: "open" }],
    solution: [
      `az network vnet peering update ${G} --vnet-name vnet-spoke1 --name spoke1-to-hub --allow-vnet-access true`,
      `az network private-dns link vnet create ${G} --zone-name privatelink.blob.core.windows.net --name link-hub --virtual-network vnet-hub --registration-enabled false`,
    ],
  },
  {
    id: "office-blocked", tier: "expert", stage: "Incident", title: "The office can't get in",
    story: "\"Since the spoke was rebuilt on Tuesday, nobody in the office can open the app.\" The app runs on vm-spoke1 in Spoke 1, on 443. The office reaches Azure over the hub's VPN gateway, and srv-onprem is an office server you can test from. SSH from the office stays blocked.",
    fix: "Nobody in the office can open the app.",
    clock: 15,
    setup: () => {
      const st = hybrid({ remote: false });
      st.vnets["vnet-spoke1"].subnets["subnet-app"].nsg = "nsg-app";
      rule(st, "nsg-app", { name: "Deny-OnPrem", priority: 200, direction: "Inbound", access: "Deny", protocol: "*", src: ["192.168.0.0/16"], dst: ["*"], ports: ["*"] });
      return st;
    },
    objectives: [
      { text: "Get srv-onprem opening the app on vm-spoke1 (443)", test: ({ st }) => can(st, "srv-onprem", "10.1.1.4", 443) },
      { text: "Keep SSH from the office blocked", test: ({ st }) => !can(st, "srv-onprem", "10.1.1.4", 22) },
    ],
    par: 2,
    hints: [],
    lesson: "A rebuilt spoke loses settings that lived on its side: use remote gateways on its peering, and the NSG rules it used to have. Here a new deny covered all office traffic. The gateway can be perfectly healthy while the spoke stays invisible to on-premises.",
    why: "The office only learns Spoke 1's range when the spoke's peering uses the hub's VPN gateway, so that gave traffic a path both ways. Then the NSG had to stop denying all office traffic. Once the deny no longer covers 443, the app opens while SSH stays blocked.",
    learn: [LEARN.transit, LEARN.nsg, L("Troubleshoot hub-spoke connectivity to on-premises", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-peering-issues#troubleshoot-a-connectivity-problem-between-a-hub-spoke-virtual-network-and-an-on-premises-resource")],
    flows: [{ from: "srv-onprem", to: "vm-spoke1", port: 443, want: "open" }, { from: "srv-onprem", to: "vm-spoke1", port: 22, want: "closed" }],
    solution: [
      `az network vnet peering update ${G} --vnet-name vnet-spoke1 --name spoke1-to-hub --use-remote-gateways true`,
      `az network nsg rule update ${G} --nsg-name nsg-app --name Deny-OnPrem --destination-port-ranges 22`,
    ],
  },
  {
    id: "firewall-cutover", tier: "expert", stage: "Incident", title: "The firewall broke everything",
    story: "\"Since the new firewall went in last night, Spoke 1 can't reach the API in Spoke 2.\" The API runs on vm-api on 443, and vm-spoke1 calls it. The plan: all spoke-to-spoke traffic goes through azfw-hub, an Azure Firewall at 10.0.1.4. HTTPS from Spoke 1 to Spoke 2 is allowed, everything else between the spokes is blocked, and the spokes are never peered to each other.",
    fix: "Spoke 1 can't reach the API in Spoke 2.",
    clock: 20,
    setup: () => {
      const st = base();
      vnet(st, "vnet-spoke1", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24", rt: "rt-spoke1" } });
      vnet(st, "vnet-hub", ["10.0.0.0/16"], { AzureFirewallSubnet: { p: "10.0.1.0/26" } });
      vnet(st, "vnet-spoke2", ["10.2.0.0/16"], { "subnet-api": { p: "10.2.1.0/24", rt: "rt-spoke2" } });
      host(st, "vm-spoke1", "vnet-spoke1", "subnet-app", "10.1.1.4");
      host(st, "vm-api", "vnet-spoke2", "subnet-api", "10.2.1.4", { ports: [22, 443] });
      azfw(st, "azfw-hub", "vnet-hub", "10.0.1.4", []);
      peer(st, "vnet-hub", "vnet-spoke1"); peer(st, "vnet-spoke1", "vnet-hub", { fwd: true });
      peer(st, "vnet-hub", "vnet-spoke2"); peer(st, "vnet-spoke2", "vnet-hub");
      st.rts["rt-spoke1"] = { routes: [{ name: "to-spoke2", prefix: "10.2.0.0/16", type: "VirtualAppliance", nhIp: "10.0.1.4" }] };
      st.rts["rt-spoke2"] = { routes: [] };
      return st;
    },
    objectives: [
      { text: "Get Spoke 1 reaching the API on vm-api (443) through azfw-hub", test: ({ st }) => through(st, "vm-spoke1", "10.2.1.4", 443, "azfw-hub") },
      { text: "Keep SSH from Spoke 1 to vm-api blocked", test: ({ st }) => !can(st, "vm-spoke1", "10.2.1.4", 22) },
      { text: "Don't peer the spokes to each other", test: ({ st }) => noSpokePeering(st) },
    ],
    par: 3,
    hints: [],
    lesson: "A firewall cutover needs three things: an allow rule, because Azure Firewall denies by default; a route back through the firewall from the other spoke; and peerings that accept forwarded traffic. Miss one and the whole path stays dark.",
    why: "Azure Firewall drops anything no rule allows, so 443 from Spoke 1 to Spoke 2 needed a rule. Spoke 2's peering had to accept traffic the hub forwards, or the request never arrived, and the reply needed a route in Spoke 2 to come back through the firewall. SSH matches no allow rule, so the firewall still drops it.",
    learn: [LEARN.fw, L("Azure Firewall FAQ: filtering between spokes", "https://learn.microsoft.com/azure/firewall/firewall-faq#can-azure-firewall-in-a-hub-virtual-network-forward-and-filter-network-traffic-between-multiple-spoke-virtual-networks"), LEARN.peering],
    flows: [{ from: "vm-spoke1", to: "vm-api", port: 443, want: "open" }, { from: "vm-spoke1", to: "vm-api", port: 22, want: "closed" }],
    solution: [
      `az network firewall network-rule create ${G} --firewall-name azfw-hub --collection-name Allow-Spoke1-API --name https --priority 200 --action Allow --protocols TCP --source-addresses 10.1.0.0/16 --destination-addresses 10.2.0.0/16 --destination-ports 443`,
      `az network route-table route create ${G} --route-table-name rt-spoke2 --name to-spoke1 --address-prefix 10.1.0.0/16 --next-hop-type VirtualAppliance --next-hop-ip-address 10.0.1.4`,
      `az network vnet peering update ${G} --vnet-name vnet-spoke2 --name spoke2-to-hub --allow-forwarded-traffic true`,
    ],
  },
  {
    id: "bastion-lockout", tier: "expert", stage: "Incident", title: "Locked out of the app server",
    story: "\"I can't get into the app server through Bastion anymore. It worked before last week's network cleanup.\" Admins connect with bas-hub, the Azure Bastion host in the hub. The app server is vm-app in Spoke 1. Only Bastion may reach it on SSH. Other hub machines, like vm-tools, must not.",
    fix: "Admins can't get into the app server through Bastion.",
    clock: 15,
    setup: () => {
      const st = base();
      vnet(st, "vnet-hub", ["10.0.0.0/16"], { AzureBastionSubnet: { p: "10.0.7.0/26" }, "subnet-tools": { p: "10.0.2.0/24" } });
      vnet(st, "vnet-spoke1", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24", nsg: "nsg-app" } });
      host(st, "vm-app", "vnet-spoke1", "subnet-app", "10.1.1.4", { ports: [22, 443] });
      host(st, "vm-tools", "vnet-hub", "subnet-tools", "10.0.2.4");
      host(st, "bas-hub", "vnet-hub", "AzureBastionSubnet", "10.0.7.4", { kind: "bastion", ports: [443], label: "Bastion" });
      st.bastions = { "bas-hub": { vnet: "vnet-hub", sku: "Standard", tunneling: false, host: "bas-hub" } };
      peer(st, "vnet-spoke1", "vnet-hub");
      rule(st, "nsg-app", { name: "Allow-SSH-Bastion", priority: 200, direction: "Inbound", access: "Allow", protocol: "Tcp", src: ["10.0.6.0/26"], dst: ["*"], ports: ["22"] });
      rule(st, "nsg-app", { name: "Deny-SSH", priority: 300, direction: "Inbound", access: "Deny", protocol: "Tcp", src: ["*"], dst: ["*"], ports: ["22"] });
      return st;
    },
    objectives: [
      { text: "Let Bastion reach vm-app on 22", test: ({ st }) => can(st, "bas-hub", "10.1.1.4", 22) },
      { text: "Keep everything else in the hub blocked from vm-app on 22", test: ({ st }) => !can(st, "vm-tools", "10.1.1.4", 22) },
    ],
    par: 2,
    hints: [],
    lesson: "Bastion connects from AzureBastionSubnet, so it needs a working peering into the spoke and an NSG rule for its subnet's actual range. A cleanup that deletes half a peering, or a rule pointing at an old range, locks admins out.",
    why: "A peering carries traffic only when both links exist, so the hub's side had to be there for Bastion to reach Spoke 1. Bastion connects from AzureBastionSubnet, 10.0.7.0/26, so the NSG allow had to name that range. Everything else in the hub still hits Deny-SSH.",
    learn: [LEARN.bastion, L("Azure Bastion SKU comparison", "https://learn.microsoft.com/azure/bastion/bastion-sku-comparison#feature-comparison"), LEARN.peering],
    flows: [{ from: "bas-hub", to: "vm-app", port: 22, want: "open" }, { from: "vm-tools", to: "vm-app", port: 22, want: "closed" }],
    solution: [
      `az network vnet peering create ${G} --name hub-to-spoke1 --vnet-name vnet-hub --remote-vnet vnet-spoke1 --allow-vnet-access`,
      `az network nsg rule update ${G} --nsg-name nsg-app --name Allow-SSH-Bastion --source-address-prefixes 10.0.7.0/26`,
    ],
  },
  {
    id: "corp-names", tier: "expert", stage: "Incident", title: "Corp names stopped resolving",
    story: "\"The new Spoke 2 can't find any corp.contoso.com servers. Spoke 1 is fine.\" vm-spoke2 needs app.corp.contoso.com, an on-premises server, on 443. Spoke 1 gets corp.contoso.com names from dns-onprem through the hub's DNS Private Resolver, dnspr-hub, and its ruleset, rs-onprem. Spoke 2 was built last week from a network template.",
    fix: "Spoke 2 can't find any corp.contoso.com servers.",
    clock: 15,
    setup: () => {
      const st = base();
      vnet(st, "vnet-spoke1", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24" } });
      vnet(st, "vnet-hub", ["10.0.0.0/16"], { GatewaySubnet: { p: "10.0.255.0/27" }, "snet-dns-in": { p: "10.0.5.0/28" }, "snet-dns-out": { p: "10.0.5.16/28" } });
      onprem(st, "onprem-dc", ["192.168.0.0/16"], { "subnet-servers": { p: "192.168.10.0/24" } });
      vnet(st, "vnet-spoke2", ["10.2.0.0/16"], { "subnet-app": { p: "10.2.1.0/24" } });
      host(st, "vm-spoke1", "vnet-spoke1", "subnet-app", "10.1.1.4");
      host(st, "vm-spoke2", "vnet-spoke2", "subnet-app", "10.2.1.4");
      host(st, "srv-app", "onprem-dc", "subnet-servers", "192.168.10.5", { ports: [443] });
      dnsVm(st, "dns-onprem", "onprem-dc", "subnet-servers", "192.168.10.10", { zones: { "corp.contoso.com": { app: "192.168.10.5" } } });
      gateway(st, "vnet-hub", "vgw-hub", "10.0.255.4", ["onprem-dc"]);
      for (const s of ["vnet-spoke1", "vnet-spoke2"]) {
        peer(st, "vnet-hub", s); peer(st, s, "vnet-hub");
        st.peerings[`vnet-hub/hub-to-${s.replace("vnet-", "")}`].allowGatewayTransit = true;
        st.peerings[`${s}/${s.replace("vnet-", "")}-to-hub`].useRemoteGateways = true;
      }
      resolver(st, "dnspr-hub", "vnet-hub", { subnet: "snet-dns-in", ip: "10.0.5.4" }, { subnet: "snet-dns-out", ruleset: "rs-onprem", rules: { corp: { domain: "corp.contoso.com.", targets: ["192.168.10.10:53"] } }, links: { "link-spoke1": "vnet-spoke1" } });
      st.vnets["vnet-spoke2"].dnsServers = ["10.0.4.4"];
      return st;
    },
    objectives: [
      { text: "Get vm-spoke2 resolving app.corp.contoso.com and reaching it on 443", test: ({ st }) => looksUp(st, "vm-spoke2", "app.corp.contoso.com") === "192.168.10.5" && can(st, "vm-spoke2", "192.168.10.5", 443) },
      { text: "Keep Spoke 1 resolving it", test: ({ st }) => looksUp(st, "vm-spoke1", "app.corp.contoso.com") === "192.168.10.5" },
    ],
    par: 2,
    hints: [],
    lesson: "A VNet with custom DNS servers forwards every query to them. Only a VNet on Azure-provided DNS goes on to consult its linked private zones and then its forwarding ruleset links. Put the spoke back on Azure DNS, then link it to the ruleset.",
    why: "A VNet with custom DNS servers sends every query to them, and nothing answers at 10.0.4.4. Back on Azure-provided DNS, the spoke's queries can use a forwarding ruleset, and linking rs-onprem to Spoke 2 sends corp.contoso.com to dns-onprem.",
    learn: [L("What is Azure DNS Private Resolver? How queries are processed", "https://learn.microsoft.com/azure/dns/dns-private-resolver-overview"), LEARN.resolver, L("Change DNS servers of a virtual network", "https://learn.microsoft.com/azure/virtual-network/manage-virtual-network#change-dns-servers-of-a-virtual-network-using-the-azure-cli"), L("Troubleshoot private endpoint DNS resolution: custom DNS", "https://learn.microsoft.com/troubleshoot/azure/private-link/troubleshoot-private-endpoint-dns-resolution#step-5")],
    flows: [{ from: "vm-spoke2", dns: "app.corp.contoso.com", expect: "srv-app", port: 443, want: "open" }],
    solution: [
      `az network vnet update ${G} --name vnet-spoke2 --dns-servers ""`,
      `az dns-resolver vnet-link create ${G} --ruleset-name rs-onprem --name link-spoke2 --id /subscriptions/x/resourceGroups/rg-lab/providers/Microsoft.Network/virtualNetworks/vnet-spoke2`,
    ],
  },
  {
    id: "monday-morning", tier: "expert", stage: "Incident", title: "Order app can't reach its database or storage",
    story: "\"The order app is broken. It can't read from the on-premises database, and it can't write to blob storage either. We moved it to Spoke 1 on Friday.\" vm-orders needs srv-db, the on-premises SQL server, on 1433, reached over the hub's VPN gateway. It also writes to stlogs01, a blob storage account, through a private endpoint in the hub. Public access on stlogs01 stays off, and vm-orders may only use the ports it needs.",
    fix: "The order app can't reach its database or its storage.",
    clock: 25,
    setup: () => {
      const st = hybrid({ transit: false });
      st.vnets["vnet-hub"].subnets["subnet-pe"] = { prefixes: ["10.0.3.0/24"], nsg: null, rt: null };
      delete st.hosts["vm-spoke1"];
      host(st, "vm-orders", "vnet-spoke1", "subnet-app", "10.1.1.4", { nicNsg: "nsg-orders-nic" });
      delete st.hosts["srv-onprem"];
      host(st, "srv-db", "onprem-dc", "subnet-servers", "192.168.10.5", { ports: [1433] });
      privateBlob(st, "stlogs01", "10.0.3.4", "203.0.113.10", ["vnet-hub"]);
      rule(st, "nsg-orders-nic", { name: "Allow-HTTPS-Out", priority: 200, direction: "Outbound", access: "Allow", protocol: "Tcp", src: ["*"], dst: ["*"], ports: ["443"] });
      rule(st, "nsg-orders-nic", { name: "Deny-All-Out", priority: 4000, direction: "Outbound", access: "Deny", protocol: "*", src: ["*"], dst: ["*"], ports: ["*"] });
      return st;
    },
    objectives: [
      { text: "Get vm-orders reaching srv-db on 1433", test: ({ st }) => can(st, "vm-orders", "192.168.10.5", 1433) },
      { text: "Get vm-orders reaching stlogs01 on 443 over its private endpoint", test: ({ st }) => looksUp(st, "vm-orders", "stlogs01.blob.core.windows.net") === "10.0.3.4" && can(st, "vm-orders", "10.0.3.4", 443) },
      { text: "Keep vm-orders blocked on other outbound ports, like SSH to srv-db", test: ({ st }) => !can(st, "vm-orders", "192.168.10.5", 22) },
      { text: "Keep public access on stlogs01 off", test: ({ st }) => !st.publicEndpoints["203.0.113.10"].publicAccess },
    ],
    par: 4,
    hints: [],
    lesson: "Moving a workload carries over its own restrictions and leaves behind what its old network gave it for free. Here: gateway transit for the new spoke, a private DNS link, and an outbound rule on the VM's own NIC. Separate the problems by destination and take them one at a time.",
    why: "Each destination failed for its own reason. Gateway transit, set on both sides of the peering, gave the spoke a route to on-premises. The zone link made the storage name resolve to its private endpoint. An outbound allow for 1433 let database traffic past the NIC's deny-all, which still blocks every port no rule allows.",
    learn: [LEARN.transit, LEARN.peDns, L("How network security groups filter network traffic: outbound", "https://learn.microsoft.com/azure/virtual-network/network-security-group-how-it-works#outbound-traffic")],
    flows: [{ from: "vm-orders", to: "srv-db", port: 1433, want: "open" }, { from: "vm-orders", dns: "stlogs01.blob.core.windows.net", expect: "pe-stlogs01", port: 443, want: "open" }],
    solution: [
      `az network vnet peering update ${G} --vnet-name vnet-hub --name hub-to-spoke1 --allow-gateway-transit true`,
      `az network vnet peering update ${G} --vnet-name vnet-spoke1 --name spoke1-to-hub --use-remote-gateways true`,
      `az network private-dns link vnet create ${G} --zone-name privatelink.blob.core.windows.net --name link-spoke1 --virtual-network vnet-spoke1 --registration-enabled false`,
      `az network nsg rule create ${G} --nsg-name nsg-orders-nic --name Allow-SQL-Out --priority 300 --direction Outbound --access Allow --protocol Tcp --destination-address-prefixes 192.168.10.5 --destination-port-ranges 1433`,
    ],
  },
];
