// Plain-language explainers for everything on the map. Each fact comes from the linked Microsoft Learn page.
import type { LearnLink } from "./types";

export type ExplainKind = "vnet" | "subnet" | "vm" | "nva" | "pe" | "peer" | "zone" | "nsg" | "udr" | "fw" | "dns" | "dnsin" | "gw" | "bastion" | "lb" | "storage";

export interface Explainer { name: string; what: string; why: string; learn: LearnLink[] }

const L = (title: string, url: string): LearnLink => ({ title, url });

export const EXPLAIN: Record<ExplainKind, Explainer> = {
  vnet: {
    name: "Virtual network (VNet)",
    what: "The fundamental building block for your private network in Azure. Resources in it can talk to each other, the internet, and on-premises networks. Each VNet is isolated from every other VNet unless you connect them.",
    why: "Its address space decides which IPs exist here, and Azure creates a system route for each range so traffic inside the VNet just works.",
    learn: [L("What is Azure Virtual Network?", "https://learn.microsoft.com/azure/virtual-network/virtual-networks-overview")],
  },
  subnet: {
    name: "Subnet",
    what: "A slice of the VNet's address space. Azure reserves five addresses in every subnet: the first four and the last. The usable count on the map already subtracts them.",
    why: "NSGs and route tables attach to subnets, so everything in the subnet is filtered and routed the same way.",
    learn: [L("Private IP addresses: reserved addresses", "https://learn.microsoft.com/azure/virtual-network/ip-services/private-ip-addresses")],
  },
  vm: {
    name: "Virtual machine and its NIC",
    what: "A VM connects to the VNet through a network interface (NIC). The private IP belongs to the NIC and comes from the subnet's range.",
    why: "The NIC is where effective routes and effective security rules are calculated, so it's the first place to look when this VM can't connect.",
    learn: [L("Virtual networks and virtual machines in Azure", "https://learn.microsoft.com/azure/virtual-network/network-overview")],
  },
  nva: {
    name: "Network virtual appliance (NVA)",
    what: "A virtual machine that runs a network application, such as a firewall, and forwards traffic that isn't addressed to it.",
    why: "Traffic only goes through it when a user-defined route sends it there with next hop Virtual appliance and the NVA's IP. A stateful firewall needs to see both directions of a session.",
    learn: [L("Virtual network traffic routing: custom routes", "https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview")],
  },
  fw: {
    name: "Azure Firewall",
    what: "A managed, stateful firewall that sits in its own subnet named AzureFirewallSubnet (at least /26). It denies all traffic until a rule allows it. Rule collections run by priority, 100 first and 65000 last, and the first matching rule wins. Network rules are checked before application rules.",
    why: "Spoke subnets send traffic to it with a user-defined route whose next hop is the firewall's private IP. Both spokes need that route, or the reply skips the firewall and the session breaks.",
    learn: [L("Azure Firewall rule processing logic", "https://learn.microsoft.com/azure/firewall/rule-processing"), L("Azure Firewall FAQ: spoke-to-spoke filtering", "https://learn.microsoft.com/azure/firewall/firewall-faq#can-azure-firewall-in-a-hub-virtual-network-forward-and-filter-network-traffic-between-multiple-spoke-virtual-network")],
  },
  dns: {
    name: "DNS server VM",
    what: "A virtual machine running DNS that virtual networks point at with their custom DNS servers setting. It answers zones it hosts, and forwards other names using conditional forwarders.",
    why: "For private endpoint names it must forward the privatelink zone to Azure DNS at 168.63.129.16, and its own virtual network must be linked to the private DNS zone. Otherwise the private zone is never consulted and clients get the public IP.",
    learn: [L("Troubleshoot private endpoint DNS resolution", "https://learn.microsoft.com/troubleshoot/azure/private-link/troubleshoot-private-endpoint-dns-resolution"), L("Name resolution that uses your own DNS server", "https://learn.microsoft.com/azure/virtual-network/virtual-networks-name-resolution-for-vms-and-role-instances#name-resolution-that-uses-your-own-dns-server")],
  },
  dnsin: {
    name: "DNS Private Resolver inbound endpoint",
    what: "A private IP for Azure DNS Private Resolver, in a dedicated subnet delegated to Microsoft.Network/dnsResolvers, sized /28 to /24. It answers with Azure DNS, using the private DNS zones linked to the virtual network it's in.",
    why: "Other virtual networks can use its IP as their custom DNS server, and on-premises DNS can forward to it. The private zones have to be linked to the resolver's virtual network, not just to the clients' networks.",
    learn: [L("Azure DNS Private Resolver endpoints and rulesets", "https://learn.microsoft.com/azure/dns/private-resolver-endpoints-rulesets"), L("What is Azure DNS Private Resolver?", "https://learn.microsoft.com/azure/dns/dns-private-resolver-overview")],
  },
  gw: {
    name: "VPN gateway",
    what: "A virtual network gateway in a subnet named GatewaySubnet (/27 or larger for most SKUs). It connects the virtual network to on-premises networks, and routes to them appear with next hop Virtual network gateway.",
    why: "Peered spokes can use the hub's gateway: the hub's peering allows gateway transit and the spoke's peering uses remote gateways. Then on-premises routes reach the spoke too.",
    learn: [L("Configure VPN gateway transit for virtual network peering", "https://learn.microsoft.com/azure/vpn-gateway/vpn-gateway-peering-gateway-transit"), L("VPN Gateway settings: gateway subnet", "https://learn.microsoft.com/azure/vpn-gateway/vpn-gateway-about-vpn-gateway-settings#gateway-subnet")],
  },
  bastion: {
    name: "Azure Bastion",
    what: "A managed service that opens RDP and SSH sessions to your VMs without public IPs on them. It lives in a subnet named AzureBastionSubnet, /26 or larger (except the Developer SKU).",
    why: "Bastion connects to the VM's private IP on 22 or 3389 from its own subnet, so the target VM's NSGs must allow that port from the AzureBastionSubnet range. Basic and higher SKUs also reach VMs in peered virtual networks.",
    learn: [L("Working with NSG access and Azure Bastion", "https://learn.microsoft.com/azure/bastion/bastion-nsg"), L("Azure Bastion configuration settings", "https://learn.microsoft.com/azure/bastion/configuration-settings")],
  },
  lb: {
    name: "Internal load balancer frontend",
    what: "A private frontend IP that spreads traffic across a backend pool. A health probe checks each backend, and only backends that answer get traffic.",
    why: "Health probes come from 168.63.129.16, identified by the AzureLoadBalancer service tag. If an NSG rule above AllowAzureLoadBalancerInBound blocks them, or nothing listens on the probe port, every backend is marked down.",
    learn: [L("Azure Load Balancer health probes: probe source IP", "https://learn.microsoft.com/azure/load-balancer/load-balancer-custom-probe-overview#probe-source-ip-address"), L("Troubleshoot health probe failures", "https://learn.microsoft.com/troubleshoot/azure/load-balancer/troubleshoot-load-balancer-health-probe-failures")],
  },
  pe: {
    name: "Private endpoint",
    what: "A network interface with a private IP from your VNet that connects privately to an Azure service such as Storage. It brings the service into your virtual network.",
    why: "Clients only use it if DNS resolves the service's name to this private IP. Otherwise they reach the public endpoint instead.",
    learn: [L("What is a private endpoint?", "https://learn.microsoft.com/azure/private-link/private-endpoint-overview"), L("Private endpoint DNS", "https://learn.microsoft.com/azure/private-link/private-endpoint-dns")],
  },
  peer: {
    name: "Virtual network peering",
    what: "Connects two VNets so resources talk privately over the Microsoft backbone. It's two links, one on each side: Initiated after the first, Connected after both.",
    why: "Traffic only flows when both links are Connected with VNet access allowed. Peering isn't transitive, and address spaces can't overlap.",
    learn: [L("Create, change, or delete a peering", "https://learn.microsoft.com/azure/virtual-network/virtual-network-manage-peering")],
  },
  zone: {
    name: "Private DNS zone",
    what: "A DNS zone that only virtual networks linked to it can query. Private endpoint zones use names like privatelink.blob.core.windows.net.",
    why: "If the VNet doing the lookup isn't linked, Azure DNS answers with the public IP instead of the private endpoint.",
    learn: [L("What is a virtual network link?", "https://learn.microsoft.com/azure/dns/private-dns-virtual-network-links"), L("Troubleshoot private endpoint DNS", "https://learn.microsoft.com/troubleshoot/azure/private-link/troubleshoot-private-endpoint-dns-resolution")],
  },
  storage: {
    name: "Storage account",
    what: "An Azure service, not something inside your virtual network. It always has a public endpoint, like stlogs01.blob.core.windows.net, with a public IP. A private endpoint gives it a second, private IP inside your network.",
    why: "Public network access decides who may use the public endpoint. When it's disabled, only traffic through a private endpoint gets in, and anything that reaches the public IP gets 403 Forbidden.",
    learn: [L("Use private endpoints for Azure Storage", "https://learn.microsoft.com/azure/storage/common/storage-private-endpoints"), L("Configure Azure Storage firewalls and virtual networks", "https://learn.microsoft.com/azure/storage/common/storage-network-security")],
  },
  nsg: {
    name: "Network security group (NSG)",
    what: "A set of allow and deny rules for inbound and outbound traffic. Rules run lowest priority number first and stop at the first match. Default rules at 65000 and above always run last.",
    why: "Inbound traffic is checked against the subnet NSG, then the NIC NSG. Both have to allow it.",
    learn: [L("Azure network security groups overview", "https://learn.microsoft.com/azure/virtual-network/network-security-groups-overview"), L("How NSG rule evaluation works", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-nsg-blocking-traffic")],
  },
  udr: {
    name: "Route table (UDR)",
    what: "User-defined routes that override Azure's default system routes. A route table attaches to zero or more subnets, and each subnet can have one.",
    why: "Azure picks the longest matching prefix. When a user-defined route and a system route have the same prefix, the user-defined route wins.",
    learn: [L("Virtual network traffic routing", "https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview")],
  },
};

/** The order the first-visit tour walks through. */
export const TOUR: { focus: "vnet" | "subnet" | "tag" | "host" | "flow"; title: string; text: string }[] = [
  { focus: "vnet", title: "Virtual networks", text: "The outer dashed frame is the resource group. Each dashed box inside it is a virtual network, with its address space at the top right. Lines between them are peerings: solid when Connected, dashed when only one side exists." },
  { focus: "subnet", title: "Subnets", text: "The solid boxes inside a virtual network are subnets. The usable count already subtracts the five addresses Azure reserves in every subnet." },
  { focus: "tag", title: "NSG and route table badges", text: "A shield badge in a subnet's header names the network security group that filters it. A route badge names the route table that overrides its routing. A small shield on a VM's NIC means the NIC has its own NSG." },
  { focus: "host", title: "Machines", text: "Monitors are VMs, with the NIC tab on the left. The purple wall is a network virtual appliance that forwards traffic. The green tile is a private endpoint." },
  { focus: "flow", title: "Goal connections", text: "Red dotted lines are connections that should work but don't, stopping at an X where the packet dies. Fix the network and they turn solid green. Tap anything on the map to inspect it and learn what it is." },
];
