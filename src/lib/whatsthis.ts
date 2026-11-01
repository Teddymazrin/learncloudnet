// "What's this?" under a command: what it does, and what each part means, so nothing has to come from memory.
import { ACTIONS_ABOUT } from "./forms";

export interface CmdNote { what: string; parts: [string, string][] }

const AZ: [RegExp, string][] = [
  // Before the plain vnet entries: "private-dns link vnet create" isn't creating a virtual network.
  [/private-dns link vnet/, "Links a private DNS zone to a virtual network, so VMs there can resolve names in the zone."],
  [/private-dns record-set a/, "Adds or changes an A record: a name in the zone that points to an IP address."],
  [/watcher test-ip-flow/, ACTIONS_ABOUT.ipflow],
  [/watcher show-next-hop/, ACTIONS_ABOUT.nexthop],
  [/watcher test-connectivity/, ACTIONS_ABOUT.conn],
  [/show-effective-route-table/, ACTIONS_ABOUT.routes],
  [/list-effective-nsg/, ACTIONS_ABOUT.nsg],
  [/vnet peering sync/, "Updates a peering with the latest address space of the network on the other side. Run it after every change to a peered network's address ranges."],
  [/vnet peering delete/, "Removes one side of a peering. A peering needs a link from each side, so the other side shows Disconnected. To peer again, delete that side too, then re-create both."],
  [/vnet subnet create/, "Adds a subnet: a range carved out of the virtual network's address space."],
  [/vnet create/, "Creates a virtual network with its address space."],
  [/vnet update/, "Changes a virtual network, such as its address space or the DNS servers its VMs use."],
  [/nic ip-config/, "Shows a network interface's IP configuration: its private IP and subnet."],
  [/nsg create/, "Creates a network security group. It filters nothing until you attach it to a subnet or a network interface."],
  [/nsg rule delete/, "Removes one rule from a network security group. The next matching rule in priority order decides instead."],
  [/route-table create/, "Creates a route table. Its routes only apply to subnets you attach it to."],
  [/route-table route delete/, "Removes one route from a route table. Traffic falls back to the next best matching route."],
  [/storage account network-rule/, "Adds a rule to a storage account's firewall: an IP range or a subnet that's allowed in. Network rules only take effect when the default action is Deny."],
  [/storage account show/, "Shows a storage account's settings, including its firewall's default action and network rules."],
  [/dns-resolver inbound-endpoint create/, "Creates an inbound endpoint: a private IP in your network that answers DNS queries from on-premises or other networks, using Azure DNS and the private zones linked to that network."],
  [/dns-resolver inbound-endpoint/, "Shows a DNS Private Resolver's inbound endpoints and their IP addresses."],
  [/dns-resolver forwarding-rule/, "Works with a forwarding rule: queries for one domain go to the DNS servers you name. It applies in networks linked to the rule's ruleset. If two rules match, the longer domain wins."],
  [/dns-resolver vnet-link/, "Links a forwarding ruleset to a virtual network, so VMs there use its forwarding rules."],
  [/public-ip create/, "Creates a public IP address that you can attach to things like Azure Bastion or a NAT gateway."],
  [/nat gateway/, "A NAT gateway gives a subnet explicit outbound internet access through the gateway's public IP."],
  [/lb probe/, "Works with a load balancer health probe. It checks each backend on a port, and only backends that pass get new connections."],
  [/firewall network-rule/, "Works with Azure Firewall network rules: allow or deny by source IP, destination IP, port and protocol. Collections are checked by priority, lowest number first, and the first match decides."],
  [/bastion create/, "Creates Azure Bastion, which lets you reach VMs over SSH or RDP without exposing them to the internet. It needs its own subnet named AzureBastionSubnet."],
  [/nsg rule (create|update)/,"Adds or changes one rule in a network security group (NSG). Rules are checked from the lowest priority number up, and the first match decides."],
  [/nsg rule (list|show)/, "Lists the rules in a network security group, so you can read them in priority order."],
  [/route-table route (create|update)/, "Adds or changes one route in a route table: traffic for this address range goes to this next hop."],
  [/route-table route (list|show)/, "Lists the routes in a route table."],
  [/vnet peering (create|update)/, "Connects two virtual networks, or changes what the connection allows. A peering needs a link from each side."],
  [/vnet peering (list|show)/, "Shows the peerings on a virtual network and their state."],
  [/vnet subnet update/, "Changes a subnet's settings, such as which NSG or route table is attached to it."],
  [/vnet subnet (list|show)/, "Shows a subnet: its address range and what is attached to it."],
  [/vnet (list|show)/, "Shows virtual networks: their address space and subnets."],
  [/private-dns/, "Works with a private DNS zone: the names it holds, or which virtual networks can use it."],
  [/nic update/, "Changes a VM's network interface, such as its NSG or IP forwarding."],
  [/nic (show|list)/, "Shows a VM's network interface: its IP address and what is attached to it."],
  [/vm run-command/, "Runs a script inside a VM through the VM agent, without logging in to it."],
];

export const FLAG: Record<string, string> = {
  "-g": "the resource group the resources live in", "--resource-group": "the resource group the resources live in",
  "--vm": "the virtual machine to test from", "--direction": "Inbound for traffic coming in to the VM, Outbound for traffic leaving it",
  "--protocol": "TCP or UDP", "--local": "the VM's own IP and port", "--remote": "the other side's IP and port (* means any port)",
  "--source-ip": "the VM's own IP", "--dest-ip": "where the packet is going", "--source-resource": "the VM the test starts from",
  "--dest-address": "the IP or name to reach", "--dest-port": "the port to reach", "--name": "the name of the thing to look at or change",
  "-n": "the name of the thing to look at or change", "--nsg-name": "the network security group the rule is in",
  "--priority": "where the rule sits in the order. Lower numbers are checked first",
  "--source-address-prefixes": "which source addresses the rule matches", "--destination-port-ranges": "which ports the rule matches",
  "--access": "Allow or Deny", "--route-table-name": "the route table the route is in", "--address-prefix": "the address range this route is for",
  "--next-hop-type": "where matching traffic goes, such as VirtualAppliance", "--next-hop-ip-address": "the appliance's IP, for a VirtualAppliance next hop",
  "--vnet-name": "the virtual network", "--remote-vnet": "the virtual network on the other side", "--zone-name": "the private DNS zone",
};

/** The note for one command line, or null when there's nothing useful to say. */
export function whatsThis(cmd: string): CmdNote | null {
  const c = cmd.trim();
  const w = c.split(/\s+/);
  const head = w[0].toLowerCase();
  if (head === "ssh") return { what: `Opens a shell on ${w[1]}, so the next commands run on that VM. In this lab it's a shortcut. In real Azure you'd connect through something like Azure Bastion, or SSH to an address you can reach.`, parts: [] };
  if (head === "exit") return { what: "Leaves the VM and goes back to Cloud Shell, where az commands work.", parts: [] };
  if (head === "nc") return { what: "netcat, a standard Linux tool. Tries to open a TCP connection and reports whether it worked.", parts: [["-z", "only check whether the port answers. Send no data"], ["-v", "print the result in words"], [w[w.length - 2] ?? "host", "where to connect"], [w[w.length - 1] ?? "port", "the port to try"]] };
  if (head === "curl") return { what: "Fetches a web address and shows the reply. Tells you whether the web service itself answers, not just the port.", parts: [["-s", "quiet: no progress bar"], ["-I", "ask only for the headers, not the whole page"]] };
  if (head === "nslookup") return { what: "Asks the VM's DNS server what IP address a name points to. Run it on the VM that has the problem, because each VM can get a different answer.", parts: [] };
  if (head === "test-netconnection") return { what: "The Windows PowerShell way to test a connection. Tries to open a TCP connection and shows TcpTestSucceeded True or False.", parts: [[w[1] ?? "host", "where to connect"], ["-Port", "the port to try"]] };
  if (head === "resolve-dnsname") return { what: "The Windows PowerShell way to look up a name. Shows the IP address the name points to, and any aliases on the way.", parts: [] };
  if (head === "invoke-webrequest") return { what: "The Windows PowerShell way to fetch a web address. Shows the status code the web service replies with.", parts: [["-Method Head", "ask only for the headers, not the whole page"]] };
  if (head === "ipconfig") return { what: "Shows the VM's own IP address and subnet mask.", parts: [] };
  if (head === "az") {
    const what = AZ.find(([re]) => re.test(c))?.[1];
    if (!what) return null;
    const parts = w.filter((x) => x.startsWith("-") && FLAG[x]).map((x) => [x, FLAG[x]] as [string, string]);
    return { what, parts: parts.filter((p, i) => parts.findIndex((q) => q[0] === p[0]) === i) };
  }
  return null;
}
