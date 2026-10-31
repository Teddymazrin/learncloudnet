// More Beginner levels: one concept each, every command shown and explained.
// Every fact below comes from the Microsoft Learn page linked in the same level.
import { ask, base, can, did, host, looksUp, peer, rule, sub, vnet } from "../build";
import type { Level } from "../types";

const L = (title: string, url: string) => ({ title, url });
const G = "-g rg-lab";

export const beginnerMore: Level[] = [
  {
    forms: { fix: "free", diagnose: false, only: ["vnet-space-", "subnet-add-"] },
    id: "room-to-grow", tier: "beginner", stage: "Foundations", title: "Add address space to a VNet",
    story: "vnet-app was sized tightly: its 10.1.0.0/24 is already split between subnet-web and subnet-app. The data team needs a new /24 called subnet-data. Give vnet-app a second address range, 10.1.1.0/24, and carve subnet-data from it.",
    concept: {
      heading: "More than one address range",
      paragraphs: [
        "A virtual network can own more than one address range. You add one with az network vnet update --address-prefixes.",
        "That flag replaces the whole list. To add a range, pass the ranges the VNet already has plus the new one. Leave one out and Azure tries to remove it.",
        "Ranges in a VNet can't overlap, and a range can't be removed while a subnet still uses it.",
      ],
      facts: ["--address-prefixes replaces the list, so include the existing ranges.", "A range in use by a subnet can't be removed.", "If the VNet is peered (joined to another VNet, a later level), the peering has to be synced after the change."],
    },
    steps: [
      { say: "Look at the address space and the subnets that fill it.", cmd: `az network vnet show ${G} --name vnet-app --query addressSpace.addressPrefixes` },
      { say: "Give the VNet both ranges: the one it has, and the new one.", cmd: `az network vnet update ${G} --name vnet-app --address-prefixes 10.1.0.0/24 10.1.1.0/24`, flags: [["--address-prefixes", "the full list of ranges, existing and new, separated by spaces"]] },
      { say: "Create subnet-data in the new range.", cmd: `az network vnet subnet create ${G} --vnet-name vnet-app --name subnet-data --address-prefixes 10.1.1.0/24` },
      { say: "Answer the question below: does --address-prefixes add to the list or replace it?", cmd: "answer 1 replaces" },
    ],
    setup: () => {
      const st = base();
      vnet(st, "vnet-app", ["10.1.0.0/24"], { "subnet-web": { p: "10.1.0.0/25" }, "subnet-app": { p: "10.1.0.128/25" } });
      host(st, "vm-web", "vnet-app", "subnet-web", "10.1.0.4", { ports: [22, 443] });
      return st;
    },
    objectives: [
      { text: "Add 10.1.1.0/24 to vnet-app, keeping 10.1.0.0/24", test: ({ st }) => ["10.1.0.0/24", "10.1.1.0/24"].every((p) => st.vnets["vnet-app"].prefixes.includes(p)) },
      { text: "Create subnet-data on 10.1.1.0/24", test: ({ st }) => sub(st, "vnet-app", "subnet-data")?.prefixes[0] === "10.1.1.0/24" },
      ask(1, "Does --address-prefixes add to the list or replace it?", ["replace", "replaces", "it replaces", "replaces it", "replace it"]),
    ],
    par: 2,
    hints: ["Start with az network vnet show to see vnet-app's current range, then use az network vnet update.", "If you pass only 10.1.1.0/24, Azure refuses because subnet-web and subnet-app still use 10.1.0.0/24. Put both ranges in one --address-prefixes list.", `az network vnet update ${G} --name vnet-app --address-prefixes 10.1.0.0/24 10.1.1.0/24, then the subnet create in step 3, then answer 1 replaces`],
    lesson: "Growing a VNet means sending the full list of ranges, old and new, because --address-prefixes replaces what's there. Azure won't drop a range a subnet still uses, and a peered VNet needs its peering synced after the change.",
    why: "You sent both 10.1.0.0/24 and 10.1.1.0/24, so vnet-app kept the range subnet-web and subnet-app sit in and gained a new one. subnet-data fits in 10.1.1.0/24 because nothing else uses it yet.",
    learn: [
      L("Create, change, or delete a virtual network: add or remove an address range", "https://learn.microsoft.com/azure/virtual-network/manage-virtual-network#add-or-remove-an-address-range"),
      L("Add, change, or delete a virtual network subnet", "https://learn.microsoft.com/azure/virtual-network/virtual-network-manage-subnet#add-a-subnet"),
    ],
    solution: [`az network vnet update ${G} --name vnet-app --address-prefixes 10.1.0.0/24 10.1.1.0/24`, `az network vnet subnet create ${G} --vnet-name vnet-app --name subnet-data --address-prefixes 10.1.1.0/24`, "answer 1 replaces"],
  },
  {
    forms: { fix: "free", diagnose: true, only: ["rule-add-"] },
    id: "service-tags", tier: "beginner", stage: "Security", title: "Allow HTTPS with a service tag",
    story: "nsg-web on subnet-web blocks everything inbound to vm-web (10.1.1.4). HTTPS (443) on vm-web should be open to vm-client in vnet-app and to vm-partner in vnet-partner, with one rule. vnet-partner is already peered to vnet-app, which means the two VNets are joined so their VMs can talk. You'll build a peering yourself later. SSH (22) stays closed.",
    concept: {
      heading: "Service tags",
      paragraphs: [
        "A service tag stands for a group of address prefixes, so a rule can name a tag instead of listing ranges.",
        "VirtualNetwork covers the VNet's address space, peered virtual networks, connected on-premises address spaces, virtual networks connected to a gateway, and the address prefixes used on user-defined routes.",
        "Internet covers the address space outside the virtual network that's reachable by the public internet. A common mistake is using Internet as the source when you mean other Azure resources. Use VirtualNetwork or a specific range instead.",
      ],
      facts: ["VirtualNetwork includes peered virtual networks.", "Internet means outside the VNet, reachable from the public internet.", "Use VirtualNetwork, not Internet, for traffic from your own networks."],
    },
    steps: [
      { say: "See the rule that blocks everything.", cmd: `az network nsg rule list ${G} --nsg-name nsg-web -o table` },
      { say: "Allow HTTPS from the VirtualNetwork tag, at a priority that runs before the deny.", cmd: `az network nsg rule create ${G} --nsg-name nsg-web --name Allow-HTTPS-VNet --priority 300 --direction Inbound --access Allow --protocol Tcp --source-address-prefixes VirtualNetwork --destination-port-ranges 443`, flags: [["--source-address-prefixes VirtualNetwork", "the service tag, instead of a list of ranges"], ["--priority 300", "lower than the deny's 4000, so it's processed first"]] },
      { say: "Answer the question below.", cmd: "answer 1 yes" },
    ],
    setup: () => {
      const st = base();
      vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-web": { p: "10.1.1.0/24", nsg: "nsg-web" }, "subnet-client": { p: "10.1.2.0/24" } });
      vnet(st, "vnet-partner", ["10.5.0.0/16"], { "subnet-app": { p: "10.5.1.0/24" } });
      host(st, "vm-web", "vnet-app", "subnet-web", "10.1.1.4", { ports: [22, 443] });
      host(st, "vm-client", "vnet-app", "subnet-client", "10.1.2.4");
      host(st, "vm-partner", "vnet-partner", "subnet-app", "10.5.1.4");
      peer(st, "vnet-app", "vnet-partner"); peer(st, "vnet-partner", "vnet-app");
      rule(st, "nsg-web", { name: "Deny-All-Inbound", priority: 4000, direction: "Inbound", access: "Deny", protocol: "*", src: ["*"], dst: ["*"], ports: ["*"] });
      return st;
    },
    objectives: [
      { text: "Let vm-client reach vm-web on 443", test: ({ st }) => can(st, "vm-client", "10.1.1.4", 443) },
      { text: "Let vm-partner reach vm-web on 443", test: ({ st }) => can(st, "vm-partner", "10.1.1.4", 443) },
      { text: "Keep SSH (22) from vm-partner to vm-web blocked", test: ({ st }) => !can(st, "vm-partner", "10.1.1.4", 22) },
      ask(1, "Does the VirtualNetwork tag include peered virtual networks? (yes or no)", ["yes", "y"]),
    ],
    par: 1,
    hints: ["List nsg-web's rules with the command in step 1 to see what blocks everything.", "Deny-All-Inbound is at 4000. One allow for TCP 443 at a lower number, with the VirtualNetwork tag as the source, covers both clients and leaves 22 blocked.", "Use the command in step 2, then answer 1 yes."],
    lesson: "VirtualNetwork is more than your own VNet: it includes peered networks, connected on-premises ranges and user-defined route prefixes. That makes it the right tag for your own traffic, and Internet the wrong one.",
    why: "Allow-HTTPS-VNet at priority 300 runs before Deny-All-Inbound at 4000. Its source, the VirtualNetwork tag, covers vnet-app and the peered vnet-partner, so vm-client and vm-partner both match it on 443, while SSH still hits the deny.",
    learn: [
      L("Virtual network service tags", "https://learn.microsoft.com/azure/virtual-network/service-tags-overview#available-service-tags"),
      L("Troubleshoot NSG misconfigurations: common mistakes", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-nsg-blocking-traffic#common-nsg-misconfigurations"),
    ],
    flows: [{ from: "vm-partner", to: "vm-web", port: 443, want: "open" }, { from: "vm-partner", to: "vm-web", port: 22, want: "closed" }],
    solution: [`az network nsg rule create ${G} --nsg-name nsg-web --name Allow-HTTPS-VNet --priority 300 --direction Inbound --access Allow --protocol Tcp --source-address-prefixes VirtualNetwork --destination-port-ranges 443`, "answer 1 yes"],
  },
  {
    forms: { fix: "free", diagnose: true, only: ["rule-add-"] },
    id: "outbound-rules", tier: "beginner", stage: "Security", title: "Block outbound SSH with an NSG rule",
    story: "Security wants vm-web (in subnet-web) stopped from opening SSH sessions (port 22) to anything in subnet-db (10.1.3.0/24). The app on vm-web still needs SQL on vm-db (10.1.3.4) at port 1433. nsg-web is already on subnet-web, with no rules yet. Add an outbound rule to it, then log in to vm-web and test both ports.",
    concept: {
      heading: "Outbound rules",
      paragraphs: [
        "NSG rules have a direction. Outbound rules filter traffic leaving the NIC or subnet they're attached to.",
        "Every NSG starts with three outbound defaults: AllowVnetOutBound (65000), AllowInternetOutBound (65001) and DenyAllOutBound (65500). Your rules run before them.",
        "For outbound traffic Azure checks the NIC's NSG first, then the subnet's NSG. If the first one denies, the second never sees the packet.",
      ],
      facts: ["Outbound: NIC NSG first, then subnet NSG.", "AllowVnetOutBound (65000) lets traffic to the VNet out by default.", "A deny with a lower priority number wins over the default allow."],
    },
    steps: [
      { say: "Add an outbound deny for SSH to subnet-db.", cmd: `az network nsg rule create ${G} --nsg-name nsg-web --name Deny-SSH-To-DB --priority 200 --direction Outbound --access Deny --protocol Tcp --destination-address-prefixes 10.1.3.0/24 --destination-port-ranges 22`, flags: [["--direction Outbound", "filter traffic leaving subnet-web"], ["--destination-address-prefixes 10.1.3.0/24", "only traffic headed to subnet-db"]] },
      { say: "Connect to vm-web. ssh opens a shell on the VM, so the next commands run from vm-web, not from Cloud Shell.", cmd: "ssh vm-web" },
      { say: "Test SSH to vm-db. nc tries to open a TCP connection and tells you if the port answers. It should fail now.", cmd: "nc -zv 10.1.3.4 22", flags: [["-z", "only check the port, send no data"], ["-v", "print whether it worked"], ["10.1.3.4 22", "the IP and port to try"]] },
      { say: "Test SQL to vm-db. It should still work. Type exit when done to go back to Cloud Shell.", cmd: "nc -zv 10.1.3.4 1433" },
      { say: "Answer the question below.", cmd: "answer 1 NIC" },
    ],
    setup: () => {
      const st = base();
      vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-web": { p: "10.1.1.0/24", nsg: "nsg-web" }, "subnet-db": { p: "10.1.3.0/24" } });
      st.nsgs["nsg-web"] = { rules: [] };
      host(st, "vm-web", "vnet-app", "subnet-web", "10.1.1.4", { ports: [22, 443] });
      host(st, "vm-db", "vnet-app", "subnet-db", "10.1.3.4", { ports: [22, 1433] });
      return st;
    },
    objectives: [
      { text: "Block SSH (22) from vm-web to vm-db", test: ({ st }) => !can(st, "vm-web", "10.1.3.4", 22) },
      { text: "Keep vm-web reaching vm-db on 1433", test: ({ st }) => can(st, "vm-web", "10.1.3.4", 1433) },
      did("Test a port from vm-web with nc", "nc -zv", "vm-web"),
      ask(1, "For outbound traffic, which NSG does Azure check first: the NIC's or the subnet's?", ["nic", "the nic", "nic nsg", "network interface"]),
    ],
    par: 1,
    hints: ["The rule goes on nsg-web, the NSG on vm-web's side, with --direction Outbound.", "Limit it to destination 10.1.3.0/24 and port 22 so 1433 still matches AllowVnetOutBound. nc only runs on a VM, so ssh vm-web first.", "Use the command in step 1, then ssh vm-web, nc -zv 10.1.3.4 1433, exit, and answer 1 NIC."],
    lesson: "NSGs filter both directions. An outbound rule on the source's NSG can stop a connection before it leaves, and for outbound traffic the NIC's NSG is checked before the subnet's.",
    why: "Deny-SSH-To-DB at priority 200 matches traffic leaving subnet-web for 10.1.3.0/24 on port 22, so SSH to vm-db is stopped before it leaves. SQL on 1433 doesn't match it, so it falls through to AllowVnetOutBound (65000) and still works.",
    learn: [
      L("How network security groups filter network traffic: outbound", "https://learn.microsoft.com/azure/virtual-network/network-security-group-how-it-works#outbound-traffic"),
      L("Network security groups: default security rules", "https://learn.microsoft.com/azure/virtual-network/network-security-groups-overview#default-security-rules"),
    ],
    flows: [{ from: "vm-web", to: "vm-db", port: 22, want: "closed" }, { from: "vm-web", to: "vm-db", port: 1433, want: "open" }],
    solution: [`az network nsg rule create ${G} --nsg-name nsg-web --name Deny-SSH-To-DB --priority 200 --direction Outbound --access Deny --protocol Tcp --destination-address-prefixes 10.1.3.0/24 --destination-port-ranges 22`, "ssh vm-web", "nc -zv 10.1.3.4 1433", "exit", "answer 1 NIC"],
  },
  {
    forms: { fix: "free", diagnose: true, only: ["nic-nsg-"] },
    id: "nic-nsg", tier: "beginner", stage: "Security", title: "Attach an NSG to a single NIC",
    story: "vm-admin (10.1.1.5) shares subnet-app with vm-app (10.1.1.4), which serves HTTPS to everyone in the VNet. Only subnet-ops, where vm-ops lives, should reach vm-admin, and only on SSH (22). nsg-admin already has those rules. Attach it to vm-admin's NIC, vm-admin-nic, not the subnet, so vm-app isn't affected.",
    concept: {
      heading: "NSGs on a network interface",
      paragraphs: [
        "You can associate an NSG with a subnet, with a network interface, or both. On a NIC it filters only that NIC.",
        "Inbound traffic is checked by the subnet's NSG first, then the NIC's NSG. When both exist, both have to allow the traffic.",
        "In the CLI you attach an NSG to a NIC with az network nic update --network-security-group.",
      ],
      facts: ["A NIC NSG filters only that NIC.", "Inbound: subnet NSG first, then NIC NSG.", "Both must allow the traffic."],
    },
    steps: [
      { say: "Attach nsg-admin to vm-admin's NIC.", cmd: `az network nic update ${G} --name vm-admin-nic --network-security-group nsg-admin`, flags: [["--name vm-admin-nic", "the network interface, not the VM"], ["--network-security-group nsg-admin", "the NSG to associate"]] },
      { say: "List everything that now filters vm-admin.", cmd: `az network nic list-effective-nsg ${G} --name vm-admin-nic` },
      { say: "Answer the question below.", cmd: "answer 1 subnet" },
    ],
    setup: () => {
      const st = base();
      vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24" }, "subnet-ops": { p: "10.1.2.0/24" } });
      host(st, "vm-app", "vnet-app", "subnet-app", "10.1.1.4", { ports: [22, 443] });
      host(st, "vm-admin", "vnet-app", "subnet-app", "10.1.1.5", { ports: [22, 443] });
      host(st, "vm-ops", "vnet-app", "subnet-ops", "10.1.2.4");
      rule(st, "nsg-admin", { name: "Allow-SSH-Ops", priority: 200, direction: "Inbound", access: "Allow", protocol: "Tcp", src: ["10.1.2.0/24"], dst: ["*"], ports: ["22"] });
      rule(st, "nsg-admin", { name: "Deny-All-Inbound", priority: 4000, direction: "Inbound", access: "Deny", protocol: "*", src: ["*"], dst: ["*"], ports: ["*"] });
      return st;
    },
    objectives: [
      { text: "Attach nsg-admin to vm-admin's NIC, not to subnet-app", test: ({ st }) => st.hosts["vm-admin"].nicNsg === "nsg-admin" && !sub(st, "vnet-app", "subnet-app")?.nsg },
      { text: "Let vm-ops reach vm-admin on 22", test: ({ st }) => can(st, "vm-ops", "10.1.1.5", 22) },
      { text: "Block vm-app from reaching vm-admin on 443", test: ({ st }) => !can(st, "vm-app", "10.1.1.5", 443) },
      { text: "Keep vm-ops reaching vm-app on 443", test: ({ st }) => can(st, "vm-ops", "10.1.1.4", 443) },
      ask(1, "For inbound traffic, which NSG does Azure check first: the subnet's or the NIC's?", ["subnet", "the subnet", "subnet nsg"]),
    ],
    par: 1,
    hints: ["This change goes on the network interface, so use az network nic update. The NIC is named vm-admin-nic.", "Attaching nsg-admin to subnet-app would lock vm-app down too. For the question, inbound traffic reaches the subnet before the NIC.", `az network nic update ${G} --name vm-admin-nic --network-security-group nsg-admin, then answer 1 subnet`],
    lesson: "Put an NSG on a NIC when one machine needs different rules from its neighbors. Inbound traffic still passes the subnet's NSG first, if there is one, and both have to allow it.",
    why: "nsg-admin now filters only vm-admin-nic. Allow-SSH-Ops lets 10.1.2.0/24 in on 22 and Deny-All-Inbound stops the rest, so vm-app can't reach vm-admin. subnet-app has no NSG, so vm-app itself still serves HTTPS to vm-ops.",
    learn: [
      L("Network interface: associate or dissociate a network security group", "https://learn.microsoft.com/azure/virtual-network/virtual-network-network-interface#associate-or-dissociate-a-network-security-group"),
      L("How network security groups filter network traffic", "https://learn.microsoft.com/azure/virtual-network/network-security-group-how-it-works#inbound-traffic"),
      L("az network nic update", "https://learn.microsoft.com/cli/azure/network/nic#az-network-nic-update"),
    ],
    flows: [{ from: "vm-ops", to: "vm-admin", port: 22, want: "open" }, { from: "vm-app", to: "vm-admin", port: 443, want: "closed" }],
    solution: [`az network nic update ${G} --name vm-admin-nic --network-security-group nsg-admin`, "answer 1 subnet"],
  },
  {
    forms: { fix: "free", diagnose: true, only: ["create-rt", "route-add-", "sn-rt-"] },
    id: "first-route", tier: "beginner", stage: "Routing", title: "Drop traffic with a route table",
    story: "subnet-old (10.1.9.0/24, home of vm-old at 10.1.9.4) is being retired, and nothing in subnet-web should send it traffic anymore. Instead of touching every NSG, drop the traffic with a route: create the route table rt-web, add a route for 10.1.9.0/24 with next hop None, and associate it with subnet-web, where vm-web lives.",
    concept: {
      heading: "User-defined routes",
      paragraphs: [
        "A route table holds user-defined routes. It does nothing until you associate it with a subnet, and then it applies to traffic leaving that subnet.",
        "Next hop None drops the traffic. Other next hop types include VirtualAppliance, VirtualNetworkGateway, VnetLocal and Internet.",
        "Azure picks the route with the longest matching prefix. A /24 route beats the VNet's /16 system route for addresses inside it. On an exact tie, a user-defined route wins over a system route.",
      ],
      facts: ["Next hop None drops traffic.", "Longest prefix match picks the route.", "A route table only applies once it's associated with a subnet."],
    },
    steps: [
      { say: "Create the route table.", cmd: `az network route-table create ${G} --name rt-web` },
      { say: "Add a route that drops traffic to subnet-old.", cmd: `az network route-table route create ${G} --route-table-name rt-web --name drop-old --address-prefix 10.1.9.0/24 --next-hop-type None`, flags: [["--address-prefix 10.1.9.0/24", "the destination this route covers"], ["--next-hop-type None", "drop the traffic"]] },
      { say: "Associate the route table with subnet-web.", cmd: `az network vnet subnet update ${G} --vnet-name vnet-app --name subnet-web --route-table rt-web` },
      { say: "Look at vm-web's effective routes. Find both routes that contain 10.1.9.4.", cmd: `az network nic show-effective-route-table ${G} --name vm-web-nic -o table` },
      { say: "Answer the question below.", cmd: "answer 1 10.1.9.0/24" },
    ],
    setup: () => {
      const st = base();
      vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-web": { p: "10.1.1.0/24" }, "subnet-old": { p: "10.1.9.0/24" } });
      host(st, "vm-web", "vnet-app", "subnet-web", "10.1.1.4");
      host(st, "vm-old", "vnet-app", "subnet-old", "10.1.9.4", { ports: [22, 443] });
      return st;
    },
    objectives: [
      { text: "Give subnet-web a route table with a None route for 10.1.9.0/24", test: ({ st }) => { const rt = sub(st, "vnet-app", "subnet-web")?.rt; return !!rt && !!st.rts[rt]?.routes.some((r) => r.prefix === "10.1.9.0/24" && r.type === "None"); } },
      { text: "Stop vm-web from reaching vm-old", test: ({ st }) => !can(st, "vm-web", "10.1.9.4", 443) },
      ask(1, "Which route wins for 10.1.9.4: the system 10.1.0.0/16 or your 10.1.9.0/24?", ["10.1.9.0/24", "/24", "mine", "the /24"]),
    ],
    par: 3,
    hints: ["Three commands: create the table, add the route, associate it with subnet-web. Then read vm-web-nic's effective routes.", "--next-hop-type None needs no next hop IP. Both 10.1.0.0/16 and 10.1.9.0/24 contain 10.1.9.4, and the longer prefix wins.", "Run the commands in steps 1 to 3, then answer 1 10.1.9.0/24."],
    lesson: "A route table changes nothing until it's on a subnet. Once it is, the longest matching prefix wins, so a /24 route with next hop None quietly drops traffic the /16 system route would have delivered.",
    why: "rt-web now applies to traffic leaving subnet-web. For 10.1.9.4, your drop-old route (/24) is more specific than the 10.1.0.0/16 system route, so it wins and its next hop None drops vm-web's traffic to vm-old.",
    learn: [
      L("Virtual network traffic routing: custom routes and route selection", "https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview#how-azure-selects-routes-for-traffic-routing"),
      L("az network route-table route create", "https://learn.microsoft.com/cli/azure/network/route-table/route#az-network-route-table-route-create"),
    ],
    flows: [{ from: "vm-web", to: "vm-old", port: 443, want: "closed" }],
    solution: [`az network route-table create ${G} --name rt-web`, `az network route-table route create ${G} --route-table-name rt-web --name drop-old --address-prefix 10.1.9.0/24 --next-hop-type None`, `az network vnet subnet update ${G} --vnet-name vnet-app --name subnet-web --route-table rt-web`, "answer 1 10.1.9.0/24"],
  },
  {
    forms: { fix: "free", diagnose: false, only: ["create-zone", "zone-"] },
    id: "private-dns", tier: "beginner", stage: "Name resolution", title: "Create a private DNS zone",
    story: "The app on vm-app connects to its database, vm-db, by its IP 10.1.3.4, and that IP is about to change. Give vm-db a name instead. DNS is what turns a name into an IP. Create the private DNS zone lab.internal, add a record db pointing at 10.1.3.4, so db.lab.internal means vm-db, link the zone to vnet-app, and check the name from vm-app.",
    concept: {
      heading: "Private DNS zones",
      paragraphs: [
        "A private DNS zone holds records that only virtual networks linked to it can resolve. Resolution works only from linked virtual networks.",
        "An A record maps a name to an IPv4 address. az network private-dns record-set a add-record adds one, and creates the record set if it doesn't exist yet.",
        "A link can also turn on auto-registration, which creates a record for each VM in the linked VNet. A VNet can have only one zone with auto-registration, so a link that's just for resolving names leaves it off.",
      ],
      facts: ["Only linked VNets can resolve a private zone.", "add-record creates the record set if needed.", "One auto-registration zone per VNet."],
    },
    steps: [
      { say: "Create the zone.", cmd: `az network private-dns zone create ${G} --name lab.internal` },
      { say: "Add the db record.", cmd: `az network private-dns record-set a add-record ${G} --zone-name lab.internal --record-set-name db --ipv4-address 10.1.3.4`, flags: [["--record-set-name db", "the name inside the zone, so db.lab.internal"], ["--ipv4-address", "the address it answers with"]] },
      { say: "Link the zone to vnet-app, without auto-registration.", cmd: `az network private-dns link vnet create ${G} --zone-name lab.internal --name link-app --virtual-network vnet-app --registration-enabled false` },
      { say: "Connect to vm-app.", cmd: "ssh vm-app" },
      { say: "Look the name up. nslookup asks DNS for a name's IP. It should answer 10.1.3.4. Type exit when done.", cmd: "nslookup db.lab.internal" },
    ],
    setup: () => {
      const st = base();
      vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24" }, "subnet-db": { p: "10.1.3.0/24" } });
      host(st, "vm-app", "vnet-app", "subnet-app", "10.1.1.4");
      host(st, "vm-db", "vnet-app", "subnet-db", "10.1.3.4", { ports: [22, 1433] });
      return st;
    },
    objectives: [
      { text: "Add a db record pointing at 10.1.3.4 to lab.internal", test: ({ st }) => st.zones["lab.internal"]?.records["db"] === "10.1.3.4" },
      { text: "Link the zone so vm-app resolves db.lab.internal to 10.1.3.4", test: ({ st }) => looksUp(st, "vm-app", "db.lab.internal") === "10.1.3.4" },
      did("Look the name up from vm-app with nslookup", "nslookup", "vm-app"),
    ],
    par: 3,
    hints: ["Zone, record, link. Three az network private-dns commands, in steps 1 to 3.", "The record name is just db; the zone adds .lab.internal. Without the link to vnet-app, vm-app can't see the zone at all.", "Run the commands in steps 1 to 3, then ssh vm-app, nslookup db.lab.internal, and exit."],
    lesson: "A private DNS zone answers only for the virtual networks linked to it. Create the zone, add the record, link the VNet, and names replace hard-coded IPs.",
    why: "The db record in lab.internal answers 10.1.3.4, and link-app makes vnet-app one of the networks that can see the zone. So when vm-app asks for db.lab.internal, it gets vm-db's IP and reaches it on 1433.",
    learn: [
      L("What is a private Azure DNS zone?", "https://learn.microsoft.com/azure/dns/private-dns-privatednszone"),
      L("az network private-dns record-set a add-record", "https://learn.microsoft.com/cli/azure/network/private-dns/record-set/a#az-network-private-dns-record-set-a-add-record"),
      L("Private DNS zone virtual network links", "https://learn.microsoft.com/azure/dns/private-dns-virtual-network-links"),
    ],
    flows: [{ from: "vm-app", dns: "db.lab.internal", expect: "vm-db", port: 1433, want: "open" }],
    solution: [`az network private-dns zone create ${G} --name lab.internal`, `az network private-dns record-set a add-record ${G} --zone-name lab.internal --record-set-name db --ipv4-address 10.1.3.4`, `az network private-dns link vnet create ${G} --zone-name lab.internal --name link-app --virtual-network vnet-app --registration-enabled false`, "ssh vm-app", "nslookup db.lab.internal", "exit"],
  },
];
