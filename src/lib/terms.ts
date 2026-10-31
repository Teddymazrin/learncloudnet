// One-line definitions for the terms an Explain question uses, shown under the question.
// Each says what the thing is, never the answer to a question about it.

const TERMS: [RegExp, string, string][] = [
  [/service tag|\bVirtualNetwork tag\b/i, "Service tag", "A name for a group of IP addresses that Azure keeps up to date, used in rules instead of typing ranges, like VirtualNetwork or Internet."],
  [/\bNSG\b/, "NSG", "Network security group: a list of allow and deny rules on a subnet or a network interface."],
  [/\bNIC\b/, "NIC", "Network interface: a VM's network card in Azure. It holds the VM's private IP."],
  [/\bpriority\b/i, "Priority", "A number on each rule that sets the order Azure checks the rules in."],
  [/default rule|DenyAllInBound/i, "Default rule", "A rule Azure puts in every NSG. You can't delete it."],
  [/next hop/i, "Next hop", "Where Azure sends a packet next, such as a virtual appliance, the local network, or the internet."],
  [/user-defined route/i, "User-defined route", "A route you add in a route table: traffic for this range goes to this next hop."],
  [/\bsystem\b.*route|system 10\./i, "System route", "A route Azure adds for you, such as one for the network's own address space."],
  [/\/\d+\b|\bprefix\b/i, "Prefix", "An address range written as start/bits, like 10.1.0.0/16. The number after the slash is how many leading bits are fixed."],
  [/\bpeer(ing|ed)?\b/i, "Peering", "A direct link between two virtual networks so their VMs can talk to each other."],
  [/transitive/i, "Transitive", "Passing through: if A links to B and B links to C, can A reach C by way of B?"],
  [/overlapping/i, "Overlapping", "Two address ranges that share some addresses."],
  [/address space/i, "Address space", "The IP ranges a virtual network can use."],
  [/--address-prefixes/, "--address-prefixes", "The flag that sets a virtual network's address ranges."],
  [/privatelink zone|private DNS zone/i, "Private DNS zone", "A DNS zone for private names, which you link to virtual networks. A privatelink zone holds the private IPs of private endpoints."],
  [/\blinked\b|\blink\b/i, "Zone link", "Connects a private DNS zone to a virtual network, so VMs there can look up its names."],
  [/IP forwarding/i, "IP forwarding", "A setting that lets a VM pass on traffic that isn't addressed to it."],
  [/allow forwarded traffic|appliance in the hub forwarded/i, "Forwarded traffic", "Traffic an appliance passed on, rather than traffic that started in the other network."],
  [/\bappliance\b/i, "Appliance", "A VM, such as a firewall, that traffic is routed through."],
  [/remote gateways/i, "Use remote gateways", "A peering setting about sharing a VPN gateway across the peering."],
  [/\bgateway\b(?! on the subnet)/i, "VPN gateway", "Connects Azure networks to on-premises networks through an encrypted tunnel."],
  [/effective routes/i, "Effective routes", "Every route that applies to a network interface, after Azure combines its own routes and yours."],
  [/on-premises/i, "On-premises", "Your own network outside Azure, such as an office or a datacenter."],
  [/service endpoint/i, "Service endpoint", "A subnet setting that sends traffic for an Azure service, like Storage, over Azure's network with the subnet's identity."],
  [/public network access/i, "Public network access", "Whether a service's public endpoint accepts traffic at all."],
  [/custom DNS server/i, "Custom DNS server", "A DNS server you run and set on the virtual network, instead of Azure-provided DNS."],
  [/Azure-provided DNS/i, "Azure-provided DNS", "The DNS Azure gives every virtual network unless you set your own servers."],
  [/168\.63\.129\.16/, "168.63.129.16", "A special Azure virtual IP address, used by Azure-provided DNS and by health probes."],
  [/forwarding (rule|ruleset)/i, "Forwarding rule", "Sends DNS queries for one domain to DNS servers you choose. A ruleset is a group of them."],
  [/DNS resolver endpoint/i, "DNS Private Resolver", "Azure's managed DNS service. Its endpoints are IP addresses in your network that answer or send queries."],
  [/NAT gateway/i, "NAT gateway", "Gives a subnet outbound internet access through the gateway's public IP."],
  [/health probe/i, "Health probe", "A load balancer's regular check on each backend. Only backends that pass get new connections."],
  [/\bUFW\b/, "UFW", "Uncomplicated Firewall: the firewall inside an Ubuntu VM."],
  [/IP flow verify/i, "IP flow verify", "A Network Watcher tool that tests whether one packet would be allowed to or from a VM."],
  [/\bcollections?\b/i, "Rule collection", "A group of Azure Firewall rules that share one priority and one action."],
  [/Azure Firewall/i, "Azure Firewall", "A managed firewall service that filters traffic using rules."],
  [/Bastion/i, "Azure Bastion", "Lets you reach VMs over SSH or RDP from the portal, without opening them to the internet. It lives in a subnet named AzureBastionSubnet."],
  [/\bSKU\b/, "SKU", "A product tier. Higher SKUs add features."],
  [/\bVNets?\b/, "VNet", "Virtual network: a private network in Azure."],
];

/** The terms a question uses, in the order they appear, at most four. */
export function termsIn(text: string): [string, string][] {
  const hits = TERMS.map(([re, name, def]) => ({ at: text.search(re), name, def })).filter((h) => h.at >= 0);
  hits.sort((a, b) => a.at - b.at);
  const seen = new Set<string>();
  return hits.filter((h) => !seen.has(h.name) && seen.add(h.name)).slice(0, 4).map((h) => [h.name, h.def]);
}
