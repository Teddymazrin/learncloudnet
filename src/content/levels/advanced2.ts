// Advanced, part two. Each topic opens with a guided intro level (concept card, steps, a question),
// then the stacked-fault levels in advanced.ts practice it. Facts come from the linked Microsoft Learn pages.
import { ask, azfw, base, can, did, dnsVm, host, lb, looksUp, peer, resolver, rule, site, storage, vnet } from "../build";
import { reach } from "@/sim/network";
import type { State } from "@/sim/types";
import type { Level } from "../types";
import { hybrid, nvaHub, privateBlob } from "./advanced";

const L = (title: string, url: string) => ({ title, url });
const G = "-g rg-lab";
const VID = "/subscriptions/x/resourceGroups/rg-lab/providers/Microsoft.Network/virtualNetworks/";
const through = (st: State, from: string, ip: string, port: number, via: string) => { const r = reach(st, from, ip, port); return r.ok && r.via.includes(via); };
const egressVia = (st: State, from: string, ip: string, nat: string) => { const r = reach(st, from, ip, 443); return r.ok && !!r.egress?.includes(nat); };

const LEARN = {
  transit: L("Configure VPN gateway transit for virtual network peering", "https://learn.microsoft.com/azure/vpn-gateway/vpn-gateway-peering-gateway-transit"),
  peeringSettings: L("Create, change, or delete a virtual network peering: settings", "https://learn.microsoft.com/azure/virtual-network/virtual-network-manage-peering#create-a-virtual-network-peering"),
  sysRoutes: L("Virtual network traffic routing: system routes", "https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview#system-routes"),
  se: L("Virtual network service endpoints", "https://learn.microsoft.com/azure/virtual-network/virtual-network-service-endpoints-overview"),
  stFw: L("Azure Storage firewall: virtual network rules", "https://learn.microsoft.com/azure/storage/common/storage-network-security-virtual-networks#create-a-virtual-network-rule"),
  compare: L("Compare private endpoints and service endpoints", "https://learn.microsoft.com/azure/virtual-network/vnet-integration-for-azure-services#compare-private-endpoints-and-service-endpoints"),
  peDns: L("Troubleshoot private endpoint DNS resolution", "https://learn.microsoft.com/troubleshoot/azure/private-link/troubleshoot-private-endpoint-dns-resolution"),
  dnsIntegration: L("Private endpoint DNS integration: on-premises workloads", "https://learn.microsoft.com/azure/private-link/private-endpoint-dns-integration#azure-private-resolver-for-on-premises-workloads"),
  ownDns: L("Name resolution that uses your own DNS server", "https://learn.microsoft.com/azure/virtual-network/virtual-networks-name-resolution-for-vms-and-role-instances#name-resolution-that-uses-your-own-dns-server"),
  resolver: L("Azure DNS Private Resolver endpoints and rulesets", "https://learn.microsoft.com/azure/dns/private-resolver-endpoints-rulesets"),
  resolverOverview: L("What is Azure DNS Private Resolver? How queries are processed", "https://learn.microsoft.com/azure/dns/dns-private-resolver-overview#how-azure-dns-private-resolver-works"),
  outbound: L("Default outbound access in Azure", "https://learn.microsoft.com/azure/virtual-network/ip-services/default-outbound-access"),
  nat: L("What is Azure NAT Gateway?", "https://learn.microsoft.com/azure/nat-gateway/nat-overview#azure-nat-gateway-basics"),
  natQs: L("Quickstart: Create a NAT gateway with the Azure CLI", "https://learn.microsoft.com/azure/nat-gateway/quickstart-create-nat-gateway#create-the-nat-gateway"),
  probe: L("Azure Load Balancer health probes: probe source IP", "https://learn.microsoft.com/azure/load-balancer/load-balancer-custom-probe-overview#probe-source-ip-address"),
  probeTs: L("Troubleshoot Azure Load Balancer health probe failures", "https://learn.microsoft.com/troubleshoot/azure/load-balancer/troubleshoot-load-balancer-health-probe-failures"),
  probeCli: L("az network lb probe", "https://learn.microsoft.com/cli/azure/network/lb/probe"),
  fwRules: L("Azure Firewall rule processing logic", "https://learn.microsoft.com/azure/firewall/rule-processing"),
  fwCli: L("az network firewall network-rule", "https://learn.microsoft.com/cli/azure/network/firewall/network-rule#az-network-firewall-network-rule-create"),
  bastionCfg: L("Azure Bastion configuration settings", "https://learn.microsoft.com/azure/bastion/configuration-settings"),
  bastionNsg: L("Working with NSG access and Azure Bastion", "https://learn.microsoft.com/azure/bastion/bastion-nsg#target-vm-subnet"),
  conn: L("Connection troubleshoot overview", "https://learn.microsoft.com/azure/network-watcher/connection-troubleshoot-overview#response"),
};

/** Hub with an Azure Firewall and two spokes routed through it in both directions. */
function fwHub(rules: Parameters<typeof azfw>[4]): State {
  const st = base();
  vnet(st, "vnet-spoke1", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24", rt: "rt-spoke1" } });
  vnet(st, "vnet-hub", ["10.0.0.0/16"], { AzureFirewallSubnet: { p: "10.0.1.0/26" } });
  vnet(st, "vnet-spoke2", ["10.2.0.0/16"], { "subnet-app": { p: "10.2.1.0/24", rt: "rt-spoke2" } });
  host(st, "vm-spoke1", "vnet-spoke1", "subnet-app", "10.1.1.4");
  host(st, "vm-spoke2", "vnet-spoke2", "subnet-app", "10.2.1.4", { ports: [22, 443] });
  azfw(st, "azfw-hub", "vnet-hub", "10.0.1.4", rules);
  for (const s of ["vnet-spoke1", "vnet-spoke2"]) { peer(st, "vnet-hub", s); peer(st, s, "vnet-hub", { fwd: true }); }
  st.rts["rt-spoke1"] = { routes: [{ name: "to-spoke2", prefix: "10.2.0.0/16", type: "VirtualAppliance", nhIp: "10.0.1.4" }] };
  st.rts["rt-spoke2"] = { routes: [{ name: "to-spoke1", prefix: "10.1.0.0/16", type: "VirtualAppliance", nhIp: "10.0.1.4" }] };
  return st;
}

/** One VNet with web backends behind an internal load balancer, and a client subnet. */
function lbLab(probePort: number): State {
  const st = base();
  vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-web": { p: "10.1.1.0/24", nsg: "nsg-web" }, "subnet-client": { p: "10.1.2.0/24" } });
  host(st, "vm-web1", "vnet-app", "subnet-web", "10.1.1.4", { ports: [22, 443] });
  host(st, "vm-web2", "vnet-app", "subnet-web", "10.1.1.5", { ports: [22, 443] });
  host(st, "vm-client", "vnet-app", "subnet-client", "10.1.2.4");
  lb(st, "lb-app", "vnet-app", "subnet-web", "10.1.1.10", { probePort, port: 443, backends: ["vm-web1", "vm-web2"] });
  rule(st, "nsg-web", { name: "Allow-HTTPS-Clients", priority: 200, direction: "Inbound", access: "Allow", protocol: "Tcp", src: ["10.1.2.0/24"], dst: ["*"], ports: ["443"] });
  rule(st, "nsg-web", { name: "Deny-All-Inbound", priority: 4000, direction: "Inbound", access: "Deny", protocol: "*", src: ["*"], dst: ["*"], ports: ["*"] });
  return st;
}

/** A private subnet with one VM and an update site on the internet. */
function outboundLab(): State {
  const st = base();
  vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24" }, "subnet-web": { p: "10.1.2.0/24" } });
  st.vnets["vnet-app"].subnets["subnet-app"].defaultOutbound = false;
  st.vnets["vnet-app"].subnets["subnet-web"].defaultOutbound = false;
  host(st, "vm-app", "vnet-app", "subnet-app", "10.1.1.4");
  site(st, "updates.example.org", "203.0.113.80");
  return st;
}

export const advancedIntros: Level[] = [
  {
    forms: { fix: "free", diagnose: true, only: ["peer-edit-"] },
    id: "intro-transit", tier: "advanced", stage: "Hybrid", title: "Use the hub's VPN gateway from a spoke",
    story: "The hub's VPN gateway, vgw-hub, connects Azure to the on-premises site. vm-spoke1 needs srv-onprem, a server on-premises, on 443. Let the spoke use the hub's gateway instead of building its own.",
    concept: {
      heading: "Gateway transit",
      paragraphs: [
        "A VPN gateway lives in a subnet named GatewaySubnet and connects a virtual network to on-premises. Routes to the on-premises prefixes show up with next hop type Virtual network gateway.",
        "A peered spoke can use the hub's gateway. Two settings do it: the hub's peering allows gateway transit, and the spoke's peering uses the remote gateway. The hub side has to be set first, and the spoke can't have a gateway of its own.",
        "Then routes to on-premises propagate to the spoke, and on-premises learns the spoke's address space too.",
      ],
      facts: ["Hub: allow gateway transit. Spoke: use remote gateways.", "On-premises routes show next hop Virtual network gateway.", "Only one of a VNet's peerings can use remote gateways."],
    },
    steps: [
      { say: "Look at vm-spoke1's routes. Nothing points on-premises yet.", cmd: `az network nic show-effective-route-table ${G} --name vm-spoke1-nic -o table` },
      { say: "Let the hub's gateway serve its peers.", cmd: `az network vnet peering update ${G} --vnet-name vnet-hub --name hub-to-spoke1 --allow-gateway-transit true`, flags: [["--allow-gateway-transit true", "on the hub's side of the peering"]] },
      { say: "Let the spoke use it.", cmd: `az network vnet peering update ${G} --vnet-name vnet-spoke1 --name spoke1-to-hub --use-remote-gateways true`, flags: [["--use-remote-gateways true", "on the spoke's side, after the hub allows transit"]] },
      { say: "Look at the routes again.", cmd: `az network nic show-effective-route-table ${G} --name vm-spoke1-nic -o table` },
      { say: "Connect to vm-spoke1.", cmd: "ssh vm-spoke1" },
      { say: "Test srv-onprem on 443. Type exit when done.", cmd: "nc -zv 192.168.10.5 443" },
      { say: "Answer the question below.", cmd: "answer 1 Virtual network gateway" },
    ],
    setup: () => hybrid({ transit: false }),
    objectives: [
      { text: "Get vm-spoke1 reaching srv-onprem on 443", test: ({ st }) => can(st, "vm-spoke1", "192.168.10.5", 443) },
      ask(1, "What next hop type do the on-premises routes show in vm-spoke1's effective routes?", ["Virtual network gateway", "VirtualNetworkGateway"]),
    ],
    par: 2,
    hints: ["Two peering updates: the hub's link first, then the spoke's.", "The spoke's update fails until the hub allows transit.", "Run steps 2 and 3, then answer 1 Virtual network gateway."],
    lesson: "Gateway transit is two settings on two sides: the hub allows it, the spoke uses it. Then on-premises routes reach the spoke with next hop Virtual network gateway, and no second gateway is needed.",
    why: "Allow gateway transit on hub-to-spoke1 shares vgw-hub with the spoke, and use remote gateways on spoke1-to-hub takes it up. vgw-hub's on-premises routes then land in vm-spoke1's route table, so traffic to 192.168.10.5 rides the VPN.",
    learn: [LEARN.transit, LEARN.peeringSettings, LEARN.sysRoutes],
    flows: [{ from: "vm-spoke1", to: "srv-onprem", port: 443, want: "open" }],
    solution: [`az network vnet peering update ${G} --vnet-name vnet-hub --name hub-to-spoke1 --allow-gateway-transit true`, `az network vnet peering update ${G} --vnet-name vnet-spoke1 --name spoke1-to-hub --use-remote-gateways true`, "answer 1 Virtual network gateway"],
  },
  {
    forms: { fix: "free", diagnose: true, only: ["sn-se-", "st-rule-"] },
    id: "intro-endpoints", tier: "advanced", stage: "PaaS access", title: "Allow a subnet through a storage firewall",
    story: "The storage account stdata02 only accepts selected networks, and vm-app's subnet, vnet-app/subnet-app, isn't one of them yet, so vm-app gets 403. Let subnet-app in with a service endpoint and a virtual network rule. The card also compares this with private endpoints, which come up in later levels.",
    concept: {
      heading: "Service endpoints and private endpoints",
      paragraphs: [
        "A service endpoint is turned on per subnet, per service. Traffic from that subnet to Azure Storage then uses the subnet's private address as its source, so a storage account can allow the subnet with a virtual network rule. DNS doesn't change: the name still resolves to the public IP.",
        "A storage account's network rules only matter when its default action is Deny. The subnet needs the Microsoft.Storage service endpoint before a virtual network rule for it works. Requests from anywhere else get 403.",
        "A private endpoint is different: it gives the service a private IP in your virtual network, works from peered networks and on-premises, keeps working when public network access is disabled, and needs DNS to return that private IP.",
      ],
      facts: ["Service endpoint: per subnet, DNS unchanged, public endpoint.", "Private endpoint: a private IP, needs DNS, works from on-premises.", "Network rules apply only with default action Deny."],
    },
    steps: [
      { say: "Connect to vm-app.", cmd: "ssh vm-app" },
      { say: "Try the account. Expect 403. Type exit when done.", cmd: "curl -sI https://stdata02.blob.core.windows.net" },
      { say: "Turn on the service endpoint for subnet-app.", cmd: `az network vnet subnet update ${G} --vnet-name vnet-app --name subnet-app --service-endpoints Microsoft.Storage` },
      { say: "Allow subnet-app on the account.", cmd: `az storage account network-rule add ${G} --account-name stdata02 --vnet-name vnet-app --subnet subnet-app` },
      { say: "Look for the new route type in vm-app's routes.", cmd: `az network nic show-effective-route-table ${G} --name vm-app-nic -o table` },
      { say: "Answer the question below.", cmd: "answer 1 no" },
    ],
    setup: () => {
      const st = base();
      vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24" } });
      host(st, "vm-app", "vnet-app", "subnet-app", "10.1.1.4");
      storage(st, "stdata02", "203.0.113.21", { defaultAction: "Deny" });
      return st;
    },
    objectives: [
      { text: "Get vm-app through to stdata02 on 443", test: ({ st }) => can(st, "vm-app", "203.0.113.21", 443) },
      { text: "Keep stdata02 allowing only selected networks", test: ({ st }) => st.publicEndpoints["203.0.113.21"].defaultAction === "Deny" },
      ask(1, "With a service endpoint, does stdata02's name resolve to a private IP? (yes or no)", ["no", "n"]),
    ],
    par: 2,
    hints: ["Service endpoint on the subnet, then the rule on the account.", "The rule only counts for traffic that arrives through the endpoint.", "Run steps 3 and 4, then answer 1 no."],
    lesson: "Service endpoints let a subnet through a storage firewall while the service keeps its public IP. Private endpoints bring the service into your network instead. Pick by where clients are and whether the public endpoint should stay open.",
    why: "The Microsoft.Storage service endpoint makes subnet-app's traffic reach stdata02 from its private address, and the virtual network rule tells the account to trust that subnet. The name still resolves to the public IP: the account just recognizes where the request came from.",
    learn: [LEARN.se, LEARN.stFw, LEARN.compare],
    flows: [{ from: "vm-app", dns: "stdata02.blob.core.windows.net", port: 443, want: "open" }],
    solution: [`az network vnet subnet update ${G} --vnet-name vnet-app --name subnet-app --service-endpoints Microsoft.Storage`, `az storage account network-rule add ${G} --account-name stdata02 --vnet-name vnet-app --subnet subnet-app`, "answer 1 no"],
  },
  {
    forms: { fix: "free", diagnose: true, only: ["vnet-dns-"] },
    id: "intro-custom-dns", tier: "advanced", stage: "DNS", title: "Resolve private endpoints with a custom DNS server",
    story: "The company runs its own DNS server, dns-hub at 10.0.4.4, which forwards privatelink names to Azure DNS. The privatelink zone is linked to the hub only. Point vnet-spoke1 at dns-hub and watch stlogs01 start resolving to its private endpoint.",
    concept: {
      heading: "Custom DNS servers",
      paragraphs: [
        "A virtual network can use Azure-provided DNS (168.63.129.16) or custom DNS servers you set with az network vnet update --dns-servers. With custom servers, VMs send every query there instead.",
        "168.63.129.16 is only reachable from inside Azure. A custom DNS server resolves private endpoint names by forwarding the privatelink zone to 168.63.129.16, and the query is then answered as seen from the DNS server's own virtual network.",
        "So the private DNS zone has to be linked to the network the DNS server lives in. If the server doesn't forward privatelink, the private zone is never consulted and the name resolves to the public IP.",
      ],
      facts: ["Custom DNS servers replace Azure DNS for the whole VNet.", "Forward privatelink zones to 168.63.129.16.", "Link the private zone to the DNS server's VNet."],
    },
    steps: [
      { say: "Connect to vm-spoke1.", cmd: "ssh vm-spoke1" },
      { say: "Look the name up with Azure DNS. The spoke isn't linked, so it's public. Type exit when done.", cmd: "nslookup stlogs01.blob.core.windows.net" },
      { say: "Point the spoke at the company DNS server.", cmd: `az network vnet update ${G} --name vnet-spoke1 --dns-servers 10.0.4.4`, flags: [["--dns-servers 10.0.4.4", "custom DNS for every VM in the VNet"]] },
      { say: "Connect again.", cmd: "ssh vm-spoke1" },
      { say: "Look it up through dns-hub. Type exit when done.", cmd: "nslookup stlogs01.blob.core.windows.net" },
      { say: "Answer the question below.", cmd: "answer 1 dns server" },
    ],
    setup: () => {
      const st = base();
      vnet(st, "vnet-spoke1", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24" } });
      vnet(st, "vnet-hub", ["10.0.0.0/16"], { "subnet-pe": { p: "10.0.3.0/24" }, "subnet-dns": { p: "10.0.4.0/24" } });
      host(st, "vm-spoke1", "vnet-spoke1", "subnet-app", "10.1.1.4");
      peer(st, "vnet-hub", "vnet-spoke1"); peer(st, "vnet-spoke1", "vnet-hub");
      dnsVm(st, "dns-hub", "vnet-hub", "subnet-dns", "10.0.4.4", { forwarders: { "privatelink.blob.core.windows.net": "168.63.129.16" } });
      privateBlob(st, "stlogs01", "10.0.3.4", "203.0.113.10", ["vnet-hub"]);
      return st;
    },
    objectives: [
      { text: "Make stlogs01.blob.core.windows.net resolve to 10.0.3.4 from vm-spoke1", test: ({ st }) => looksUp(st, "vm-spoke1", "stlogs01.blob.core.windows.net") === "10.0.3.4" },
      did("Look the name up from vm-spoke1", "nslookup", "vm-spoke1"),
      ask(1, "When a custom DNS server forwards to 168.63.129.16, whose network must be linked to the private zone: the client's or the DNS server's?", ["dns server", "the dns server's", "dns server's", "server", "the server's", "the dns server"]),
    ],
    par: 1,
    hints: ["One command: set the spoke's DNS servers.", "dns-hub already forwards privatelink, and the zone is linked to the hub where dns-hub lives.", "Run step 3, then answer 1 dns server."],
    lesson: "With custom DNS, what counts is the DNS server's network: its forwarders and its private zone links. The client's VNet only decides which server it asks.",
    why: "vnet-spoke1 now asks dns-hub, which forwards privatelink names to 168.63.129.16 from vnet-hub. The zone is linked to vnet-hub, so Azure DNS answers with stlogs01's private endpoint, 10.0.3.4.",
    learn: [LEARN.ownDns, LEARN.peDns, LEARN.dnsIntegration],
    flows: [{ from: "vm-spoke1", dns: "stlogs01.blob.core.windows.net", expect: "pe-stlogs01", port: 443, want: "open" }],
    solution: [`az network vnet update ${G} --name vnet-spoke1 --dns-servers 10.0.4.4`, "ssh vm-spoke1", "nslookup stlogs01.blob.core.windows.net", "exit", "answer 1 dns server"],
  },
  {
    forms: { fix: "free", diagnose: true, only: ["vnet-dns-", "rs-rule-"] },
    id: "intro-resolver", tier: "advanced", stage: "DNS", title: "Resolve names with DNS Private Resolver",
    story: "The hub has an Azure DNS Private Resolver, dnspr-hub, with an inbound endpoint at 10.0.5.4 and a ruleset, rs-onprem, linked to the hub. Use it for two things: private endpoint names for vm-spoke1, like stlogs01 at 10.0.3.4, and the on-premises zone corp.contoso.com, which lives on dns-onprem at 192.168.10.10. app.corp.contoso.com is srv-onprem.",
    concept: {
      heading: "Azure DNS Private Resolver",
      paragraphs: [
        "An inbound endpoint gets a private IP in a dedicated subnet, /28 to /24, delegated to Microsoft.Network/dnsResolvers. It answers with Azure DNS, using the private zones linked to its own virtual network, so spokes can use its IP as their DNS server.",
        "An outbound endpoint works with DNS forwarding rulesets. A rule names a domain, ending with a dot, and the DNS servers to send it to. A ruleset applies to the virtual networks linked to it, and the longest matching domain wins.",
        "With Azure-provided DNS, private zones linked to the network are checked first, then ruleset links. Queries sent to an inbound endpoint are processed by a ruleset linked to the endpoint's network. A network with custom DNS servers sends every query to those servers instead, so its zone and ruleset links aren't used.",
        "To add an inbound endpoint, use az dns-resolver inbound-endpoint create with --dns-resolver-name, a --name, and --ip-configurations naming the subnet's ID and an allocation method.",
      ],
      facts: ["Inbound endpoint: a DNS server IP for other networks.", "Rules: domain with a trailing dot, target ip:port.", "Linked private zones first, then rulesets.", "Custom DNS servers skip ruleset links."],
    },
    steps: [
      { say: "See the inbound endpoint and its IP.", cmd: `az dns-resolver inbound-endpoint list ${G} --dns-resolver-name dnspr-hub -o table` },
      { say: "Use it as vnet-spoke1's DNS server.", cmd: `az network vnet update ${G} --name vnet-spoke1 --dns-servers 10.0.5.4` },
      { say: "Add a rule that sends corp.contoso.com to the on-premises DNS server.", cmd: `az dns-resolver forwarding-rule create ${G} --ruleset-name rs-onprem --name corp --domain-name corp.contoso.com. --target-dns-servers "[{ip-address:192.168.10.10,port:53}]"`, flags: [["--domain-name corp.contoso.com.", "note the trailing dot"], ["--target-dns-servers", "where matching queries go"]] },
      { say: "Connect to vm-spoke1.", cmd: "ssh vm-spoke1" },
      { say: "Look up the private endpoint name.", cmd: "nslookup stlogs01.blob.core.windows.net" },
      { say: "Look up the on-premises name. Type exit when done.", cmd: "nslookup app.corp.contoso.com" },
      { say: "Answer the question below.", cmd: "answer 1 private zones" },
    ],
    setup: () => {
      const st = hybrid();
      st.vnets["vnet-hub"].subnets["subnet-pe"] = { prefixes: ["10.0.3.0/24"], nsg: null, rt: null };
      st.vnets["vnet-hub"].subnets["snet-dns-in"] = { prefixes: ["10.0.5.0/28"], nsg: null, rt: null };
      st.vnets["vnet-hub"].subnets["snet-dns-out"] = { prefixes: ["10.0.5.16/28"], nsg: null, rt: null };
      dnsVm(st, "dns-onprem", "onprem-dc", "subnet-servers", "192.168.10.10", { zones: { "corp.contoso.com": { app: "192.168.10.5" } } });
      privateBlob(st, "stlogs01", "10.0.3.4", "203.0.113.10", ["vnet-hub"]);
      resolver(st, "dnspr-hub", "vnet-hub", { subnet: "snet-dns-in", ip: "10.0.5.4" }, { subnet: "snet-dns-out", ruleset: "rs-onprem", links: { "link-hub": "vnet-hub" } });
      return st;
    },
    objectives: [
      { text: "Make stlogs01.blob.core.windows.net resolve to 10.0.3.4 from vm-spoke1", test: ({ st }) => looksUp(st, "vm-spoke1", "stlogs01.blob.core.windows.net") === "10.0.3.4" },
      { text: "Make app.corp.contoso.com resolve to 192.168.10.5 from vm-spoke1", test: ({ st }) => looksUp(st, "vm-spoke1", "app.corp.contoso.com") === "192.168.10.5" },
      ask(1, "With Azure-provided DNS, what's checked first: linked private DNS zones or forwarding ruleset links?", ["private zones", "private dns zones", "linked private dns zones", "private dns zone", "zones", "private zone"]),
    ],
    par: 2,
    hints: ["Point the spoke's DNS at the inbound endpoint, then add the rule.", "rs-onprem is linked to the hub, and queries to the inbound endpoint go through it.", "Run steps 2 and 3, then answer 1 private zones."],
    lesson: "The resolver gives you a DNS server IP for spokes and on-premises (the inbound endpoint), and a place to forward other domains (rulesets). Private zones still need to be linked to the resolver's network.",
    why: "vnet-spoke1 now uses the inbound endpoint, 10.0.5.4, as its DNS server. stlogs01 is answered from the privatelink zone linked to vnet-hub, and corp.contoso.com matches the new rule in rs-onprem, linked to the hub, so it's forwarded to dns-onprem.",
    learn: [LEARN.resolver, LEARN.resolverOverview],
    flows: [{ from: "vm-spoke1", dns: "app.corp.contoso.com", expect: "srv-onprem", port: 443, want: "open" }],
    solution: [`az network vnet update ${G} --name vnet-spoke1 --dns-servers 10.0.5.4`, `az dns-resolver forwarding-rule create ${G} --ruleset-name rs-onprem --name corp --domain-name corp.contoso.com. --target-dns-servers "[{ip-address:192.168.10.10,port:53}]"`, "answer 1 private zones"],
  },
  {
    forms: { fix: "free", diagnose: true, only: ["create-pip", "create-natgw", "sn-nat-"] },
    id: "intro-nat", tier: "advanced", stage: "Outbound access", title: "Give a private subnet internet access",
    story: "vm-app sits in subnet-app, a private subnet, and can't reach updates.example.org on 443 to download updates. It must not get a public IP of its own. Give subnet-app a NAT gateway.",
    concept: {
      heading: "Outbound access and NAT gateway",
      paragraphs: [
        "A VM with no explicit outbound method gets default outbound access: an IP Microsoft owns and can change. For API versions released after March 31, 2026, subnets in new virtual networks are private by default and don't get it.",
        "A VM in a private subnet needs an explicit method to reach the internet. Learn lists a NAT gateway on the subnet (recommended for most scenarios), a Standard load balancer with outbound rules, a Standard public IP on the NIC, or a firewall or appliance reached through a user-defined route.",
        "A Standard NAT gateway uses Standard public IPs (the StandardV2 SKU needs StandardV2 public IPs). VMs in its subnets reach the internet with the NAT gateway's public IP. A user-defined route to a virtual appliance or gateway takes precedence over the NAT gateway.",
      ],
      facts: ["Private subnets have no default outbound access.", "Standard NAT gateway: Standard public IP, associated per subnet.", "A UDR to an appliance beats the NAT gateway."],
    },
    steps: [
      { say: "Connect to vm-app.", cmd: "ssh vm-app" },
      { say: "Try the site. It fails. Type exit when done.", cmd: "curl -sI https://updates.example.org" },
      { say: "Create a Standard public IP.", cmd: `az network public-ip create ${G} --name pip-nat --sku Standard` },
      { say: "Create the NAT gateway with it.", cmd: `az network nat gateway create ${G} --name nat-gw --public-ip-addresses pip-nat --idle-timeout 10` },
      { say: "Associate it with subnet-app.", cmd: `az network vnet subnet update ${G} --vnet-name vnet-app --name subnet-app --nat-gateway nat-gw` },
      { say: "Answer the question below.", cmd: "answer 1 udr" },
    ],
    setup: outboundLab,
    objectives: [
      { text: "Get vm-app reaching updates.example.org through nat-gw", test: ({ st }) => egressVia(st, "vm-app", "203.0.113.80", "nat-gw") },
      { text: "Don't give vm-app a public IP of its own", test: ({ st }) => !st.hosts["vm-app"].publicIp },
      ask(1, "Which wins for internet traffic: a NAT gateway on the subnet, or a user-defined route 0.0.0.0/0 to a virtual appliance?", ["udr", "user-defined route", "the udr", "route", "the route", "user defined route"]),
    ],
    par: 3,
    hints: ["Public IP, then the NAT gateway, then associate it with the subnet.", "The NAT gateway does nothing until a subnet uses it.", "Run steps 3 to 5, then answer 1 udr."],
    lesson: "Private subnets need an explicit way out, and a NAT gateway is the usual one: a Standard public IP shared by every VM in the subnet. Remember the order: a route to an appliance or gateway wins over it.",
    why: "nat-gw, with the Standard public IP pip-nat, is now associated with subnet-app, which gives vm-app an explicit way out. Its traffic to updates.example.org leaves with pip-nat's address, so vm-app needs no public IP of its own.",
    learn: [LEARN.outbound, LEARN.nat, LEARN.natQs],
    solution: [`az network public-ip create ${G} --name pip-nat --sku Standard`, `az network nat gateway create ${G} --name nat-gw --public-ip-addresses pip-nat --idle-timeout 10`, `az network vnet subnet update ${G} --vnet-name vnet-app --name subnet-app --nat-gateway nat-gw`, "answer 1 udr"],
  },
  {
    forms: { fix: "free", diagnose: true, only: ["rule-add-"] },
    id: "intro-lb", tier: "advanced", stage: "Load balancing", title: "Load balancer backends marked down",
    story: "lb-app, at 10.1.1.10, spreads HTTPS from clients across vm-web1 and vm-web2. Clients like vm-client time out. nsg-web allows clients on 443 and denies everything else. Find out what the load balancer thinks of its backends, and fix it.",
    fix: "Clients time out on lb-app at 10.1.1.10.",
    concept: {
      heading: "Health probes",
      paragraphs: [
        "A load balancer sends traffic only to backends that pass its health probe. If no backend answers, Load Balancer marks them all down, and clients see timeouts or refused connections.",
        "All IPv4 probes come from 168.63.129.16. The AzureLoadBalancer service tag identifies that source, and the default rule AllowAzureLoadBalancerInBound lets it in.",
        "A custom deny with a higher priority than AllowAzureLoadBalancerInBound blocks the probe. So does an app that isn't listening on the probe port.",
      ],
      facts: ["Probes come from 168.63.129.16.", "AzureLoadBalancer tag, allowed by a default rule.", "A custom deny above it marks every backend down."],
    },
    steps: [
      { say: "Connect to vm-client.", cmd: "ssh vm-client" },
      { say: "Try the frontend. Type exit when done.", cmd: "nc -zv 10.1.1.10 443" },
      { say: "Look at the probe.", cmd: `az network lb probe list ${G} --lb-name lb-app -o table` },
      { say: "Look at what filters the backends.", cmd: `az network nic list-effective-nsg ${G} --name vm-web1-nic` },
      { say: "Let the probe in, ahead of Deny-All-Inbound.", cmd: `az network nsg rule create ${G} --nsg-name nsg-web --name Allow-LB-Probe --priority 300 --direction Inbound --access Allow --protocol Tcp --source-address-prefixes AzureLoadBalancer --destination-port-ranges 443`, flags: [["--source-address-prefixes AzureLoadBalancer", "the service tag for 168.63.129.16"]] },
      { say: "Answer the question below.", cmd: "answer 1 168.63.129.16" },
    ],
    setup: () => lbLab(443),
    objectives: [
      { text: "Get vm-client reaching lb-app on 443", test: ({ st }) => can(st, "vm-client", "10.1.1.10", 443) },
      { text: "Keep SSH from vm-client to the backends blocked", test: ({ st }) => !can(st, "vm-client", "10.1.1.4", 22) },
      ask(1, "Which IP address do the health probes come from?", ["168.63.129.16"]),
    ],
    par: 1,
    hints: ["Deny-All-Inbound at 4000 runs before AllowAzureLoadBalancerInBound at 65001.", "Allow the AzureLoadBalancer tag on 443 with a priority number lower than 4000.", "Run step 5, then answer 1 168.63.129.16."],
    lesson: "When every backend is down at once, look at the probe before the app. A broad deny in the backends' NSG catches the probe from 168.63.129.16, so allow the AzureLoadBalancer tag above it.",
    why: "Allow-LB-Probe at priority 300 lets the AzureLoadBalancer tag (168.63.129.16) in on 443 before Deny-All-Inbound at 4000 catches it. The probe passes, lb-app marks vm-web1 and vm-web2 healthy, and sends client traffic to them again.",
    learn: [LEARN.probe, LEARN.probeTs],
    flows: [{ from: "vm-client", to: "lb-app-fe", port: 443, want: "open" }],
    solution: [`az network nsg rule create ${G} --nsg-name nsg-web --name Allow-LB-Probe --priority 300 --direction Inbound --access Allow --protocol Tcp --source-address-prefixes AzureLoadBalancer --destination-port-ranges 443`, "answer 1 168.63.129.16"],
  },
  {
    forms: { fix: "free", diagnose: true, only: ["fw-rule-"] },
    id: "intro-firewall", tier: "advanced", stage: "Azure Firewall", title: "Allow traffic through Azure Firewall",
    story: "Azure Firewall azfw-hub, at 10.0.1.4 in the hub, is in place, and both spokes route to it. It has no rules yet. Allow HTTPS from spoke1 (10.1.0.0/16) to spoke2 (10.2.0.0/16), and nothing else.",
    concept: {
      heading: "Azure Firewall rules",
      paragraphs: [
        "Azure Firewall lives in its own subnet named AzureFirewallSubnet, at least /26. Spokes send traffic to its private IP with user-defined routes. It denies all traffic until a rule allows it.",
        "Rules sit in rule collections. Each collection has a priority from 100 to 65000 and an action, Allow or Deny. Collections run lowest priority number first, and the first matching rule wins. Network rules match on source, destination, port and protocol.",
        "The firewall is stateful: once a connection is allowed, its replies come back without another rule. Each spoke still needs a route through the firewall, so the reply passes it too.",
      ],
      facts: ["Denies everything until a rule allows it.", "Priority 100 to 65000, lowest first, first match wins.", "Stateful: replies to allowed connections are allowed.", "Network rules don't SNAT traffic to private ranges, so the target sees the caller's own IP.", "Traffic from on-premises reaches the firewall through a route table on GatewaySubnet."],
    },
    steps: [
      { say: "See the rules. There are none.", cmd: `az network firewall network-rule collection list ${G} --firewall-name azfw-hub -o table` },
      { say: "Add an allow collection with one HTTPS rule.", cmd: `az network firewall network-rule create ${G} --firewall-name azfw-hub --collection-name Allow-Spoke1-HTTPS --name https --priority 200 --action Allow --protocols TCP --source-addresses 10.1.0.0/16 --destination-addresses 10.2.0.0/16 --destination-ports 443`, flags: [["--priority 200 --action Allow", "only when the collection is new"], ["--protocols TCP", "TCP, UDP, ICMP or Any"]] },
      { say: "Connect to vm-spoke1.", cmd: "ssh vm-spoke1" },
      { say: "Test HTTPS to vm-spoke2. Type exit when done.", cmd: "nc -zv 10.2.1.4 443" },
      { say: "Answer the question below.", cmd: "answer 1 deny" },
    ],
    setup: () => fwHub([]),
    objectives: [
      { text: "Get vm-spoke1 reaching vm-spoke2 on 443 through azfw-hub", test: ({ st }) => through(st, "vm-spoke1", "10.2.1.4", 443, "azfw-hub") },
      { text: "Keep SSH between the spokes blocked", test: ({ st }) => !can(st, "vm-spoke1", "10.2.1.4", 22) },
      ask(1, "Two network rule collections both match: a Deny at priority 200 and an Allow at 300. Which wins?", ["deny", "the deny", "deny at 200"]),
    ],
    par: 1,
    hints: ["One rule in a new collection.", "Source 10.1.0.0/16, destination 10.2.0.0/16, port 443, TCP.", "Run step 2, then answer 1 deny."],
    lesson: "Azure Firewall starts closed. Add allow rules for exactly what should pass, and remember that collections run by priority and the first match wins.",
    why: "The new Allow collection matches TCP 443 from 10.1.0.0/16 to 10.2.0.0/16, so HTTPS gets through azfw-hub. SSH matches no rule, so the firewall still denies it. The reply gets back because the firewall is stateful and rt-spoke2 routes it through 10.0.1.4.",
    learn: [LEARN.fwRules, LEARN.fwCli],
    flows: [{ from: "vm-spoke1", to: "vm-spoke2", port: 443, want: "open" }, { from: "vm-spoke1", to: "vm-spoke2", port: 22, want: "closed" }],
    solution: [`az network firewall network-rule create ${G} --firewall-name azfw-hub --collection-name Allow-Spoke1-HTTPS --name https --priority 200 --action Allow --protocols TCP --source-addresses 10.1.0.0/16 --destination-addresses 10.2.0.0/16 --destination-ports 443`, "answer 1 deny"],
  },
  {
    forms: { fix: "free", diagnose: true, only: ["create-bastion"] },
    id: "intro-bastion", tier: "advanced", stage: "Bastion", title: "Deploy Azure Bastion",
    story: "Admins should SSH to vm-app in vnet-hub without it having a public IP. AzureBastionSubnet (10.0.7.0/26) and a Standard public IP, pip-bastion, are ready, and nsg-app already allows 22 from the Bastion subnet. Deploy Bastion bas-hub.",
    concept: {
      heading: "Azure Bastion",
      paragraphs: [
        "Azure Bastion opens RDP and SSH sessions to VMs over their private IPs, so the VMs need no public IP. Basic, Standard and Premium need a dedicated subnet named exactly AzureBastionSubnet, /26 or larger, with nothing else in it. They also need a Standard static public IP, unless Premium is deployed as private-only.",
        "Bastion connects from its own subnet to the VM's private IP. The target VM's NSGs must allow 22 or 3389 from the AzureBastionSubnet range.",
        "Basic and higher SKUs also reach VMs in peered virtual networks. The Developer SKU doesn't.",
      ],
      facts: ["AzureBastionSubnet, /26 or larger.", "Standard public IP, in the same region as Bastion.", "Target NSG allows 22 or 3389 from the Bastion subnet."],
    },
    steps: [
      { say: "Deploy Bastion.", cmd: `az network bastion create ${G} --name bas-hub --vnet-name vnet-hub --public-ip-address pip-bastion --sku Basic`, flags: [["--vnet-name vnet-hub", "the VNet that has AzureBastionSubnet"], ["--sku Basic", "Basic, Standard, Premium or Developer"]] },
      { say: "Check that vm-app lets Bastion in on 22.", cmd: `az network watcher test-ip-flow ${G} --vm vm-app --direction Inbound --protocol TCP --local 10.0.1.4:22 --remote 10.0.7.4:*` },
      { say: "Answer the question below.", cmd: "answer 1 /26" },
    ],
    setup: () => {
      const st = base();
      vnet(st, "vnet-hub", ["10.0.0.0/16"], { "subnet-app": { p: "10.0.1.0/24", nsg: "nsg-app" }, AzureBastionSubnet: { p: "10.0.7.0/26" } });
      host(st, "vm-app", "vnet-hub", "subnet-app", "10.0.1.4", { ports: [22, 443] });
      rule(st, "nsg-app", { name: "Allow-SSH-Bastion", priority: 200, direction: "Inbound", access: "Allow", protocol: "Tcp", src: ["10.0.7.0/26"], dst: ["*"], ports: ["22"] });
      rule(st, "nsg-app", { name: "Deny-SSH", priority: 300, direction: "Inbound", access: "Deny", protocol: "Tcp", src: ["*"], dst: ["*"], ports: ["22"] });
      st.publicIps = { "pip-bastion": { sku: "Standard", ip: "198.51.100.6", region: "eastus2" } };
      return st;
    },
    objectives: [
      { text: "Get Bastion bas-hub reaching vm-app on 22", test: ({ st }) => { const b = st.bastions?.["bas-hub"]; return !!b?.host && can(st, b.host, "10.0.1.4", 22); } },
      ask(1, "What's the smallest size AzureBastionSubnet can be?", ["/26", "26"]),
    ],
    par: 1,
    hints: ["One command deploys it.", "The subnet and public IP are already right.", "Run step 1, then answer 1 /26."],
    lesson: "Bastion needs its own subnet with an exact name, a Standard public IP, and an NSG rule on the target for the Bastion subnet's range. Then admins reach private VMs without exposing them.",
    why: "bas-hub deploys into AzureBastionSubnet with the Standard public IP pip-bastion. It connects to vm-app's private IP from 10.0.7.0/26, which Allow-SSH-Bastion in nsg-app already lets in on 22.",
    learn: [LEARN.bastionCfg, LEARN.bastionNsg],
    solution: [`az network bastion create ${G} --name bas-hub --vnet-name vnet-hub --public-ip-address pip-bastion --sku Basic`, "answer 1 /26"],
  },
];

export const advancedMore: Level[] = [
  {
    id: "two-spokes", tier: "advanced", stage: "Hybrid", title: "New spoke can't reach on-premises",
    story: "vnet-spoke2 was just peered to the hub. vm-spoke2 needs srv-onprem on 443 over the hub's VPN gateway, vgw-hub, the way vm-spoke1 already does. Spoke2 was built from an old security template. Spoke1 must keep working.",
    fix: "vm-spoke2 can't reach srv-onprem on 443.",
    setup: () => {
      const st = hybrid();
      vnet(st, "vnet-spoke2", ["10.2.0.0/16"], { "subnet-app": { p: "10.2.1.0/24", rt: "rt-spoke2" } });
      host(st, "vm-spoke2", "vnet-spoke2", "subnet-app", "10.2.1.4");
      peer(st, "vnet-hub", "vnet-spoke2"); peer(st, "vnet-spoke2", "vnet-hub");
      st.rts["rt-spoke2"] = { routes: [{ name: "block-onprem", prefix: "192.168.0.0/16", type: "None" }] };
      return st;
    },
    objectives: [
      { text: "Get vm-spoke2 reaching srv-onprem on 443", test: ({ st }) => can(st, "vm-spoke2", "192.168.10.5", 443) },
      { text: "Keep vm-spoke1 reaching srv-onprem on 443", test: ({ st }) => can(st, "vm-spoke1", "192.168.10.5", 443) },
      ask(1, "When a user-defined route and a route from the gateway have the same prefix, which one wins?", ["user-defined route", "udr", "user defined route", "the udr", "user-defined"]),
    ],
    par: 3,
    hints: ["Compare the peerings of the two spokes: az network vnet peering list -g rg-lab --vnet-name vnet-hub -o table", "Whatever spoke1's peering has that spoke2's lacks is one gap. The old template may also have left something in rt-spoke2.", "Run az network vnet peering show on hub-to-spoke2 and spoke2-to-hub, and compare allowGatewayTransit and useRemoteGateways with spoke1's peerings. Then list rt-spoke2's routes for one whose next hop is None."],
    lesson: "Every new spoke needs gateway transit on both sides of its peering, and its route table can still override the gateway's routes. Compare a new spoke with one that works.",
    why: "Gateway transit on both sides of the spoke2 peering brings vgw-hub's on-premises routes into vnet-spoke2. Removing block-onprem matters too: a user-defined route with the same prefix beats the gateway's route, and its next hop None dropped the traffic.",
    learn: [LEARN.transit, L("How Azure selects a route", "https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview#how-azure-selects-routes-for-traffic-routing")],
    flows: [{ from: "vm-spoke2", to: "srv-onprem", port: 443, want: "open" }],
    solution: [`az network vnet peering update ${G} --vnet-name vnet-hub --name hub-to-spoke2 --allow-gateway-transit true`, `az network vnet peering update ${G} --vnet-name vnet-spoke2 --name spoke2-to-hub --use-remote-gateways true`, `az network route-table route delete ${G} --route-table-name rt-spoke2 --name block-onprem`, "answer 1 udr"],
  },
  {
    id: "onprem-to-private", tier: "advanced", stage: "DNS", title: "On-premises can't reach a private endpoint",
    story: "On-premises servers like srv-onprem use dns-onprem at 192.168.10.10, which forwards blob.core.windows.net to 10.0.5.4, the planned inbound endpoint of the hub's resolver dnspr-hub. srv-onprem needs stlogs01 over its private endpoint at 10.0.3.4. The resolver exists, but the rollout isn't finished.",
    fix: "srv-onprem can't reach stlogs01 over its private endpoint.",
    setup: () => {
      const st = hybrid();
      st.vnets["vnet-hub"].subnets["subnet-pe"] = { prefixes: ["10.0.3.0/24"], nsg: null, rt: null };
      st.vnets["vnet-hub"].subnets["snet-dns-in"] = { prefixes: ["10.0.5.0/28"], nsg: null, rt: null };
      dnsVm(st, "dns-onprem", "onprem-dc", "subnet-servers", "192.168.10.10", { forwarders: { "blob.core.windows.net": "10.0.5.4" } });
      st.vnets["onprem-dc"].dnsServers = ["192.168.10.10"];
      privateBlob(st, "stlogs01", "10.0.3.4", "203.0.113.10", []);
      (st.resolvers ??= {})["dnspr-hub"] = { vnet: "vnet-hub", inbound: {}, outbound: {} };
      return st;
    },
    objectives: [
      { text: "Make stlogs01.blob.core.windows.net resolve to 10.0.3.4 from srv-onprem", test: ({ st }) => looksUp(st, "srv-onprem", "stlogs01.blob.core.windows.net") === "10.0.3.4" },
      { text: "Get srv-onprem reaching the private endpoint on 443", test: ({ st }) => can(st, "srv-onprem", "10.0.3.4", 443) },
      ask(1, "Can 168.63.129.16 be reached from on-premises? (yes or no)", ["no", "n"]),
    ],
    par: 2,
    hints: ["Follow the query: dns-onprem forwards to 10.0.5.4. Does anything answer there?", "Notice whether anything answers at 10.0.5.4 yet. Then remember which private zones an inbound endpoint can see.", "Follow the query from on-premises: where does dns-onprem forward it, does anything answer there, and is the privatelink zone linked to the VNet that answers?"],
    lesson: "On-premises can't reach 168.63.129.16, so its DNS forwards Azure names to a resolver inbound endpoint. That endpoint answers with the private zones linked to its own virtual network, so both the endpoint and the zone link have to exist.",
    why: "The new inbound endpoint gives dnspr-hub the IP 10.0.5.4 that dns-onprem already forwards to. With privatelink.blob.core.windows.net linked to vnet-hub, it answers stlogs01 with 10.0.3.4, and srv-onprem reaches that over the VPN.",
    learn: [LEARN.dnsIntegration, LEARN.resolver, LEARN.peDns],
    flows: [{ from: "srv-onprem", dns: "stlogs01.blob.core.windows.net", expect: "pe-stlogs01", port: 443, want: "open" }],
    solution: [`az dns-resolver inbound-endpoint create ${G} --dns-resolver-name dnspr-hub --name in-endpoint --ip-configurations "[{private-ip-allocation-method:Dynamic,id:${VID}vnet-hub/subnets/snet-dns-in}]"`, `az network private-dns link vnet create ${G} --zone-name privatelink.blob.core.windows.net --name link-hub --virtual-network vnet-hub --registration-enabled false`, "answer 1 no"],
  },
  {
    id: "nat-overridden", tier: "advanced", stage: "Outbound access", title: "Private subnet still can't reach the internet",
    story: "vm-app in the private subnet-app still can't reach updates.example.org on 443, even though nat-gw exists and has a public IP, pip-nat. A month ago traffic went through an appliance in the hub that has since been removed. vm-app must not get a public IP.",
    fix: "vm-app can't reach updates.example.org, even though nat-gw exists.",
    setup: () => {
      const st = outboundLab();
      st.publicIps = { "pip-nat": { sku: "Standard", ip: "198.51.100.20", region: "eastus2" } };
      st.natGateways = { "nat-gw": { pips: ["pip-nat"] } };
      st.vnets["vnet-app"].subnets["subnet-web"].natGateway = "nat-gw";
      st.vnets["vnet-app"].subnets["subnet-app"].rt = "rt-app";
      st.rts["rt-app"] = { routes: [{ name: "default-via-nva", prefix: "0.0.0.0/0", type: "VirtualAppliance", nhIp: "10.0.2.4" }] };
      return st;
    },
    objectives: [
      { text: "Get vm-app reaching updates.example.org through nat-gw", test: ({ st }) => egressVia(st, "vm-app", "203.0.113.80", "nat-gw") },
      { text: "Don't give vm-app a public IP of its own", test: ({ st }) => !st.hosts["vm-app"].publicIp },
    ],
    par: 2,
    hints: ["Check what subnet-app uses for outbound: az network vnet subnet show -g rg-lab --vnet-name vnet-app --name subnet-app", "Notice which subnet nat-gw actually serves. Then notice whether any route sends vm-app's internet traffic somewhere else first.", "Check which subnet nat-gw is associated with using az network vnet subnet show, then read vm-app's effective routes for anything that beats a NAT gateway."],
    lesson: "Outbound has an order: a route to an appliance or gateway, then the NAT gateway, then a public IP on the NIC. A leftover 0.0.0.0/0 route quietly beats a perfectly good NAT gateway, and a NAT gateway on the wrong subnet helps nobody.",
    why: "nat-gw is now associated with subnet-app, not just subnet-web. With the leftover 0.0.0.0/0 route to the removed appliance gone, nothing outranks the NAT gateway, so vm-app's traffic leaves with pip-nat's address.",
    learn: [LEARN.nat, LEARN.outbound],
    solution: [`az network vnet subnet update ${G} --vnet-name vnet-app --name subnet-app --nat-gateway nat-gw`, `az network route-table route delete ${G} --route-table-name rt-app --name default-via-nva`],
  },
  {
    id: "probed-down", tier: "advanced", stage: "Load balancing", title: "Load balancer down after a port change",
    story: "The web app on vm-web1 and vm-web2 moved to port 443, and nsg-web was reworked in the same change window. Since then every request from vm-client to lb-app at 10.1.1.10 times out. Both web servers are running and serving HTTPS locally. nsg-web filters the web subnet, and SSH from the client subnet must stay blocked.",
    fix: "Every request to lb-app at 10.1.1.10 times out since the port change.",
    setup: () => lbLab(8080),
    objectives: [
      { text: "Get vm-client reaching lb-app on 443", test: ({ st }) => can(st, "vm-client", "10.1.1.10", 443) },
      { text: "Keep SSH from vm-client to the backends blocked", test: ({ st }) => !can(st, "vm-client", "10.1.1.4", 22) },
      ask(1, "Which service tag identifies the health probe's source in an NSG rule?", ["AzureLoadBalancer"]),
    ],
    par: 2,
    hints: ["Check the probe against what the apps listen on: az network lb probe list -g rg-lab --lb-name lb-app -o table", "A probe fails in two ways: it can't get in, or it gets in and nothing answers. Check for both.", "Compare the probe port from az network lb probe list with what the backends listen on, then read nsg-web's inbound rules for anything above AllowAzureLoadBalancerInBound."],
    lesson: "Probe failures come in two flavors: the probe can't get in (an NSG above AllowAzureLoadBalancerInBound), or it gets in and nothing answers (wrong port). When every backend is down, check both.",
    why: "probe-app now checks 443, where the web servers actually listen. Allow-LB-Probe lets the AzureLoadBalancer tag in ahead of Deny-All-Inbound, so the probe gets an answer, both backends turn healthy, and lb-app forwards to them.",
    learn: [LEARN.probeTs, LEARN.probe, LEARN.probeCli],
    flows: [{ from: "vm-client", to: "lb-app-fe", port: 443, want: "open" }],
    solution: [`az network lb probe update ${G} --lb-name lb-app --name probe-app --port 443`, `az network nsg rule create ${G} --nsg-name nsg-web --name Allow-LB-Probe --priority 300 --direction Inbound --access Allow --protocol Tcp --source-address-prefixes AzureLoadBalancer --destination-port-ranges 443`, "answer 1 AzureLoadBalancer"],
  },
  {
    id: "review-advanced", tier: "advanced", stage: "Review", title: "Review: firewall, DNS and Bastion",
    story: "Three complaints arrived at once, all about vnet-spoke1. vm-spoke1 can't reach the API on vm-spoke2 through azfw-hub. It can't resolve stlogs01 to its private endpoint through the company DNS server dns-hub. And admins can't get to vm-spoke1 through Bastion bas-hub. SSH between the spokes stays blocked.",
    fix: "vm-spoke1 can't reach vm-spoke2, can't resolve stlogs01 privately, and Bastion can't reach it.",
    setup: () => {
      const st = fwHub([]);
      st.vnets["vnet-hub"].subnets["subnet-pe"] = { prefixes: ["10.0.3.0/24"], nsg: null, rt: null };
      st.vnets["vnet-hub"].subnets["subnet-dns"] = { prefixes: ["10.0.4.0/24"], nsg: null, rt: null };
      st.vnets["vnet-hub"].subnets["AzureBastionSubnet"] = { prefixes: ["10.0.7.0/26"], nsg: null, rt: null };
      st.vnets["vnet-hub"].prefixes = ["10.0.0.0/16"];
      dnsVm(st, "dns-hub", "vnet-hub", "subnet-dns", "10.0.4.4", { forwarders: { "privatelink.blob.core.windows.net": "168.63.129.16" } });
      privateBlob(st, "stlogs01", "10.0.3.4", "203.0.113.10", ["vnet-spoke1"]);
      st.vnets["vnet-spoke1"].dnsServers = ["10.0.4.4"];
      host(st, "bas-hub", "vnet-hub", "AzureBastionSubnet", "10.0.7.4", { kind: "bastion", ports: [443], label: "Bastion" });
      st.bastions = { "bas-hub": { vnet: "vnet-hub", sku: "Standard", tunneling: false, host: "bas-hub" } };
      st.hosts["vm-spoke1"].ports = [22, 443];
      st.vnets["vnet-spoke1"].subnets["subnet-app"].nsg = "nsg-spoke1";
      rule(st, "nsg-spoke1", { name: "Allow-SSH-Admins", priority: 200, direction: "Inbound", access: "Allow", protocol: "Tcp", src: ["10.0.0.0/24"], dst: ["*"], ports: ["22"] });
      rule(st, "nsg-spoke1", { name: "Deny-SSH", priority: 300, direction: "Inbound", access: "Deny", protocol: "Tcp", src: ["*"], dst: ["*"], ports: ["22"] });
      return st;
    },
    objectives: [
      { text: "Get vm-spoke1 reaching vm-spoke2 on 443 through azfw-hub", test: ({ st }) => through(st, "vm-spoke1", "10.2.1.4", 443, "azfw-hub") },
      { text: "Make stlogs01.blob.core.windows.net resolve to 10.0.3.4 from vm-spoke1", test: ({ st }) => looksUp(st, "vm-spoke1", "stlogs01.blob.core.windows.net") === "10.0.3.4" },
      { text: "Get bas-hub reaching vm-spoke1 on 22", test: ({ st }) => can(st, "bas-hub", "10.1.1.4", 22) },
      { text: "Keep SSH between the spokes blocked", test: ({ st }) => !can(st, "vm-spoke1", "10.2.1.4", 22) },
    ],
    par: 3,
    hints: ["Take the complaints one at a time: firewall, DNS, Bastion.", "For each one, find the layer: what azfw-hub allows, which network Azure DNS sees dns-hub's question from, and which address Bastion connects from.", "Take each complaint alone: the firewall's rule collections, the zone's VNet links compared with where dns-hub lives, and nsg-spoke1's SSH rule source compared with AzureBastionSubnet."],
    lesson: "Three complaints, three layers: a firewall that denies by default, a private zone linked to the wrong side of a custom DNS server, and an NSG written for an old jump box subnet. Work them one at a time, and test after each.",
    why: "An allow for TCP 443 from spoke1 to spoke2 lets HTTPS through azfw-hub, which still denies everything else, SSH included. Linking the privatelink zone to vnet-hub lets dns-hub's forwarded query find stlogs01's record. And nsg-spoke1 now trusts 10.0.7.0/26, the range Bastion connects from.",
    learn: [LEARN.fwRules, LEARN.peDns, LEARN.bastionNsg],
    flows: [{ from: "vm-spoke1", to: "vm-spoke2", port: 443, want: "open" }, { from: "vm-spoke1", dns: "stlogs01.blob.core.windows.net", expect: "pe-stlogs01", port: 443, want: "open" }, { from: "bas-hub", to: "vm-spoke1", port: 22, want: "open" }],
    solution: [
      `az network firewall network-rule create ${G} --firewall-name azfw-hub --collection-name Allow-API --name https --priority 200 --action Allow --protocols TCP --source-addresses 10.1.0.0/16 --destination-addresses 10.2.0.0/16 --destination-ports 443`,
      `az network private-dns link vnet create ${G} --zone-name privatelink.blob.core.windows.net --name link-hub --virtual-network vnet-hub --registration-enabled false`,
      `az network nsg rule update ${G} --nsg-name nsg-spoke1 --name Allow-SSH-Admins --source-address-prefixes 10.0.7.0/26`,
    ],
  },
];

/** Why questions added to the stacked-fault levels in advanced.ts, so each one checks understanding too. */
export const ADVANCED_WHY: Record<string, { q: string; accept: string[] }> = {
  "return-trip": { q: "Which peering setting lets a spoke accept traffic that an appliance in the hub forwarded?", accept: ["allow forwarded traffic", "forwarded traffic", "allowforwardedtraffic", "allow-forwarded-traffic"] },
  "two-way-street": { q: "Is IP forwarding on a NIC enabled or disabled by default?", accept: ["disabled", "off"] },
  "gateway-transit": { q: "Which side's peering sets use remote gateways: the hub's or the spoke's?", accept: ["spoke", "the spoke", "spoke's", "the spoke's"] },
  "left-behind": { q: "Can a more specific user-defined route override a route learned from the gateway? (yes or no)", accept: ["yes", "y"] },
  "selected-networks": { q: "Which NSG service tag allows outbound traffic to Azure Storage?", accept: ["Storage"] },
  "endpoint-choice": { q: "With public network access disabled, can a service endpoint still reach the account? (yes or no)", accept: ["no", "n"] },
  "custom-dns": { q: "Which IP does a custom DNS server forward privatelink zones to?", accept: ["168.63.129.16"] },
  "resolver-inbound": { q: "What's the smallest subnet a DNS resolver endpoint can use?", accept: ["/28", "28"] },
  "resolver-rules": { q: "What must a forwarding rule's domain name end with?", accept: ["a dot", "dot", ".", "a period", "period"] },
  "firewall-rules": { q: "What does Azure Firewall do with traffic that no rule allows?", accept: ["deny", "denies it", "denies", "deny it", "blocks it", "block"] },
  "firewall-hybrid": { q: "Which subnet needs a route table so traffic from on-premises goes through the firewall?", accept: ["GatewaySubnet"] },
  "bastion-build": { q: "Which SKU must Bastion's public IP be?", accept: ["Standard"] },
  "bastion-peered": { q: "Which Bastion SKU can't reach VMs in peered virtual networks?", accept: ["Developer"] },
  "guest-probe": { q: "Which source IP must a backend's own firewall allow so the health probe gets in?", accept: ["168.63.129.16"] },
  "guest-or-network": { q: "Can IP flow verify see a rule in the VM's own firewall? (yes or no)", accept: ["no", "n"] },
};
