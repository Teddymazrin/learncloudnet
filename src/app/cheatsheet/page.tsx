import type { Metadata } from "next";
export const metadata: Metadata = { title: "Cheat sheet", description: "The Azure CLI networking commands used in Learn Cloud Net, with links to the Microsoft Learn reference." };

const CLI = "https://learn.microsoft.com/cli/azure/network";
const GROUPS: { title: string; ref: string; rows: [string, string][] }[] = [
  { title: "Virtual networks and subnets", ref: `${CLI}/vnet?view=azure-cli-latest`, rows: [
    ["az network vnet list -g <rg> -o table", "List virtual networks in a resource group."],
    ["az network vnet show -g <rg> -n <vnet> --query addressSpace.addressPrefixes", "Show a VNet, or one field of it with --query."],
    ["az network vnet create -g <rg> -n <vnet> --address-prefixes 10.1.0.0/16 --subnet-name <subnet> --subnet-prefixes 10.1.1.0/24", "Create a VNet, optionally with its first subnet."],
    ["az network vnet update -g <rg> -n <vnet> --address-prefixes <cidr> [<cidr> ...]", "Replace the VNet's address space. The list you pass overrides the old one."],
    ["az network vnet subnet create -g <rg> --vnet-name <vnet> -n <subnet> --address-prefixes <cidr>", "Add a subnet inside the VNet's address space."],
    ["az network vnet subnet update -g <rg> --vnet-name <vnet> -n <subnet> --network-security-group <nsg> --route-table <rt>", "Attach an NSG or route table to a subnet."],
  ] },
  { title: "Network interfaces", ref: `${CLI}/nic?view=azure-cli-latest`, rows: [
    ["az network nic ip-config list -g <rg> --nic-name <nic> -o table", "Private IP and subnet of a NIC."],
    ["az network nic show-effective-route-table -g <rg> -n <nic> -o table", "Every route that applies to the NIC, with the winner marked Active."],
    ["az network nic list-effective-nsg -g <rg> -n <nic>", "Combined subnet and NIC NSG rules for the NIC."],
    ["az network nic update -g <rg> -n <nic> --network-security-group <nsg>", "Attach an NSG to one network interface."],
    ["az network nic update -g <rg> -n <nic> --ip-forwarding true", "Let an appliance's NIC accept packets addressed to someone else. Off by default."],
  ] },
  { title: "Network security groups", ref: `${CLI}/nsg/rule?view=azure-cli-latest`, rows: [
    ["az network nsg create -g <rg> -n <nsg>", "Create an NSG. It starts with the six default rules."],
    ["az network nsg rule list -g <rg> --nsg-name <nsg> --include-default -o table", "List rules, including the defaults."],
    ["az network nsg rule create -g <rg> --nsg-name <nsg> -n <rule> --priority 300 --direction Inbound --access Allow --protocol Tcp --source-address-prefixes <cidr> --destination-port-ranges 443", "Add a rule. Priority 100 to 4096, lowest runs first."],
    ["az network nsg rule update -g <rg> --nsg-name <nsg> -n <rule> --priority 150", "Change one property of an existing rule."],
  ] },
  { title: "Route tables", ref: `${CLI}/route-table/route?view=azure-cli-latest`, rows: [
    ["az network route-table create -g <rg> -n <rt>", "Create an empty route table."],
    ["az network route-table route create -g <rg> --route-table-name <rt> -n <route> --address-prefix <cidr> --next-hop-type VirtualAppliance --next-hop-ip-address <ip>", "Add a user-defined route. Next hop types: Internet, None, VirtualAppliance, VirtualNetworkGateway, VnetLocal."],
    ["az network route-table route update -g <rg> --route-table-name <rt> -n <route> --next-hop-ip-address <ip>", "Change a route in place."],
  ] },
  { title: "Peering", ref: `${CLI}/vnet/peering?view=azure-cli-latest`, rows: [
    ["az network vnet peering create -g <rg> -n <name> --vnet-name <local> --remote-vnet <remote> --allow-vnet-access", "Create one side of a peering. Run it again with the VNets swapped."],
    ["az network vnet peering list -g <rg> --vnet-name <vnet> -o table", "Peering state: Initiated, Connected or Disconnected."],
    ["az network vnet peering update -g <rg> -n <name> --vnet-name <vnet> --allow-vnet-access true", "Fix a link's settings without re-creating it."],
    ["az network vnet peering update -g <rg> -n <hub-link> --vnet-name <hub> --allow-gateway-transit true", "Let peered spokes use the hub's gateway. Set this before the spoke side."],
    ["az network vnet peering update -g <rg> -n <spoke-link> --vnet-name <spoke> --use-remote-gateways true", "Use the hub's gateway from the spoke."],
    ["az network vnet peering sync -g <rg> -n <name> --vnet-name <vnet>", "Pick up address space the remote VNet added since the peering was made."],
  ] },
  { title: "Private DNS", ref: `${CLI}/private-dns/link/vnet?view=azure-cli-latest`, rows: [
    ["az network private-dns link vnet list -g <rg> --zone-name <zone>", "Which VNets can resolve the zone."],
    ["az network private-dns link vnet create -g <rg> -n <link> --zone-name <zone> --virtual-network <vnet> --registration-enabled false", "Link a VNet to a private DNS zone. Leave auto-registration off for private endpoint zones."],
    ["az network private-dns zone create -g <rg> -n <zone>", "Create a private DNS zone."],
    ["az network private-dns record-set a add-record -g <rg> -z <zone> -n <name> -a <ip>", "Add an A record. Creates the record set if it doesn't exist."],
    ["az network vnet update -g <rg> -n <vnet> --dns-servers <ip>", "Send the VNet's DNS to a custom server. 168.63.129.16 means Azure-provided DNS."],
  ] },
  { title: "DNS Private Resolver", ref: "https://learn.microsoft.com/cli/azure/dns-resolver?view=azure-cli-latest", rows: [
    ["az dns-resolver inbound-endpoint create -g <rg> --dns-resolver-name <r> -n <ep> --ip-configurations \"[{private-ip-allocation-method:Dynamic,id:<subnet-id>}]\"", "An inbound endpoint in a dedicated /28 to /24 subnet. Its IP can be a VNet's DNS server."],
    ["az dns-resolver forwarding-rule create -g <rg> --ruleset-name <rs> -n <rule> --domain-name corp.contoso.com. --target-dns-servers \"[{ip-address:<ip>,port:53}]\"", "Forward a domain (ending in a dot) to the DNS servers that own it."],
    ["az dns-resolver vnet-link create -g <rg> --ruleset-name <rs> -n <link> --id <vnet-id>", "Apply a ruleset to a VNet."],
  ] },
  { title: "Storage network access", ref: "https://learn.microsoft.com/cli/azure/storage/account/network-rule?view=azure-cli-latest", rows: [
    ["az network vnet subnet update -g <rg> --vnet-name <vnet> -n <subnet> --service-endpoints Microsoft.Storage", "Enable a service endpoint on a subnet."],
    ["az storage account network-rule add -g <rg> --account-name <account> --vnet-name <vnet> --subnet <subnet>", "Allow a subnet through the storage firewall. The subnet needs the service endpoint."],
    ["az storage account update -g <rg> -n <account> --default-action Deny", "Allow only selected networks."],
  ] },
  { title: "Azure Firewall", ref: "https://learn.microsoft.com/cli/azure/network/firewall/network-rule?view=azure-cli-latest", rows: [
    ["az network firewall network-rule collection list -g <rg> --firewall-name <fw> -o table", "Network rule collections, in priority order."],
    ["az network firewall network-rule create -g <rg> --firewall-name <fw> --collection-name <c> -n <rule> --priority 200 --action Allow --protocols TCP --source-addresses <cidr> --destination-addresses <cidr> --destination-ports 443", "Add a rule. Priority and action only when the collection is new. Lowest priority runs first, first match wins."],
  ] },
  { title: "Azure Bastion", ref: "https://learn.microsoft.com/cli/azure/network/bastion?view=azure-cli-latest", rows: [
    ["az network public-ip create -g <rg> -n <pip> --sku Standard", "Bastion needs a Standard public IP."],
    ["az network bastion create -g <rg> -n <bastion> --vnet-name <vnet> --public-ip-address <pip> --sku Basic", "Needs a subnet named AzureBastionSubnet, /26 or larger."],
  ] },
  { title: "Network Watcher", ref: `${CLI}/watcher?view=azure-cli-latest`, rows: [
    ["az network watcher test-ip-flow -g <rg> --vm <vm> --direction Inbound --protocol TCP --local <vm-ip>:443 --remote <ip>:*", "Is this packet allowed, and which rule decided?"],
    ["az network watcher show-next-hop -g <rg> --vm <vm> --source-ip <vm-ip> --dest-ip <ip>", "Next hop type, IP and the route table that sent it there."],
    ["az network watcher test-connectivity -g <rg> --source-resource <vm> --dest-address <ip> --dest-port 443", "Hop by hop, with the issue that stops it: an NSG rule, a route, DNS, the VM's own firewall, or no listener."],
  ] },
  { title: "Inside the VM (Run Command)", ref: "https://learn.microsoft.com/cli/azure/vm/run-command?view=azure-cli-latest#az-vm-run-command-invoke", rows: [
    ["az vm run-command invoke -g <rg> -n <vm> --command-id RunShellScript --scripts \"ufw status numbered\"", "The VM's own firewall rules, in the order UFW checks them. Works even when SSH is blocked."],
    ["az vm run-command invoke -g <rg> -n <vm> --command-id RunShellScript --scripts \"ss -tlnp\"", "Which ports something is listening on."],
    ["az vm run-command invoke -g <rg> -n <vm> --command-id RunShellScript --scripts \"ufw allow from <cidr> to any port <port> proto tcp\"", "Allow one port from one range. Don't turn the firewall off."],
    ["az vm run-command invoke -g <rg> -n <vm> --command-id RunShellScript --scripts \"systemctl start <service>\"", "Start a stopped service."],
  ] },
];

export default function Cheatsheet() {
  return (
    <div className="wrap prose">
      <h1>Cheat sheet</h1>
      <p className="muted">The Azure CLI networking commands Learn Cloud Net uses. Each group links its Microsoft Learn reference page.</p>
      {GROUPS.map((g) => (
        <section key={g.title}>
          <h2>{g.title}</h2>
          <div className="table-wrap"><table className="cmd-table"><tbody>{g.rows.map(([c, d]) => <tr key={c}><td>{c}</td><td>{d}</td></tr>)}</tbody></table></div>
          <p className="note"><a href={g.ref} target="_blank" rel="noopener noreferrer">Microsoft Learn reference</a></p>
        </section>
      ))}
    </div>
  );
}
