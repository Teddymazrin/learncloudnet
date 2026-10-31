// Beginner tier: one concept per level, every command shown and explained.
// Every fact below comes from the Microsoft Learn page linked in the same level.
import { ask, base, can, did, host, peer, rule, sub, vnet } from "../build";
import type { Level } from "../types";
import { findLink } from "@/sim/network";

const L = (title: string, url: string) => ({ title, url });
const G = "-g rg-lab";

export const beginner: Level[] = [
  {
    forms: { fix: "off", diagnose: false },
    id: "meet-the-vnet", tier: "beginner", stage: "Foundations", title: "Explore a virtual network",
    story: "You've just joined the cloud team and inherited a virtual network called vnet-app. It lives in rg-lab, a resource group (a folder that holds related Azure resources). Before you change anything, get to know it: list the virtual networks, look at vnet-app's address space, and count its subnets (the smaller sections a VNet is split into).",
    concept: {
      heading: "What a virtual network is",
      paragraphs: [
        "Azure Virtual Network is the fundamental building block for your private network in Azure. It lets resources like virtual machines securely talk to each other, the internet, and on-premises networks.",
        "Each virtual network is isolated from other virtual networks. Its address space is a set of IP ranges written in CIDR notation, and those ranges are reachable only from inside the virtual network, from connected virtual networks, and from connected on-premises networks.",
        "Throughout Learn Cloud Net you work in a simulated Cloud Shell. The commands are real Azure CLI syntax, so what you learn here works against a real subscription.",
      ],
      facts: [
        "A VNet is isolated from other VNets by default.",
        "Address ranges are written in CIDR notation, like 10.1.0.0/16.",
        "A VNet can hold more than one address range.",
      ],
    },
    steps: [
      { say: "List every virtual network in the resource group as a table.", cmd: `az network vnet list ${G} -o table`, flags: [["-g rg-lab", "the resource group to look in (short for --resource-group)"], ["-o table", "print a table instead of JSON (short for --output)"]] },
      { say: "Show just the address space of vnet-app. --query picks one field out of the JSON.", cmd: `az network vnet show ${G} --name vnet-app --query addressSpace.addressPrefixes`, flags: [["--name vnet-app", "which virtual network"], ["--query", "a JMESPath expression that filters the output"]] },
      { say: "List the names of vnet-app's subnets.", cmd: `az network vnet show ${G} --name vnet-app --query "subnets[].name"` },
      { say: "Count the subnet names from step 3, then answer below.", cmd: "answer 1 2" },
    ],
    setup: () => {
      const st = base();
      vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-web": { p: "10.1.1.0/24" }, "subnet-db": { p: "10.1.2.0/24" } });
      host(st, "vm-web", "vnet-app", "subnet-web", "10.1.1.4", { ports: [22, 443] });
      return st;
    },
    objectives: [
      did("List the virtual networks in rg-lab", "az network vnet list"),
      did("Show vnet-app's settings", "az network vnet show"),
      ask(1, "How many subnets does vnet-app have?", ["2", "two"]),
    ],
    par: 0,
    hints: ["The steps panel has every command. Start with az network vnet list, then az network vnet show.", "The subnets query prints a list of names. Count them.", "answer 1 2"],
    lesson: "A virtual network is your private network in Azure, isolated from every other VNet. az network vnet list and az network vnet show are the two commands you'll use most to find out what exists before you change anything.",
    why: "vnet list showed that vnet-app exists in rg-lab, and vnet show read its settings: one address range, 10.1.0.0/16, split into subnet-web and subnet-db. Reading before changing is how every later level starts.",
    learn: [
      L("What is Azure Virtual Network?", "https://learn.microsoft.com/azure/virtual-network/virtual-networks-overview"),
      L("Azure network security overview: VNet isolation", "https://learn.microsoft.com/azure/security/fundamentals/network-overview"),
      L("Create, change, or delete a virtual network", "https://learn.microsoft.com/azure/virtual-network/manage-virtual-network"),
    ],
    solution: [`az network vnet list ${G} -o table`, `az network vnet show ${G} --name vnet-app --query addressSpace.addressPrefixes`, "answer 1 2"],
  },
  {
    forms: { fix: "free", diagnose: false , only: ["create-vnet"] },
    id: "reading-cidr", tier: "beginner", stage: "Foundations", title: "Read CIDR and create a VNet",
    story: "The network plan your team uses is written entirely in CIDR blocks. Learn to read them, then build a new virtual network called vnet-lab with the address space 10.50.0.0/16.",
    concept: {
      heading: "How CIDR notation works",
      paragraphs: [
        "An IPv4 address is 32 bits. In 10.1.0.0/16, the /16 says the first 16 bits are the network part. The remaining 16 bits can vary, so the block holds 2^16 = 65,536 addresses, from 10.1.0.0 to 10.1.255.255.",
        "Each step up in the prefix length halves the block: a /17 is 32,768 addresses, a /24 is 256. The smaller the number after the slash, the bigger the block.",
        "Azure won't let some ranges be used as virtual network address space: multicast 224.0.0.0/4, broadcast 255.255.255.255/32, loopback 127.0.0.0/8, link-local 169.254.0.0/16, and 168.63.129.16/32, which Azure uses for internal DNS, DHCP and load balancer health probes.",
      ],
      facts: [
        "Addresses in a block = 2^(32 - prefix length).",
        "A /16 holds 65,536 addresses. A /24 holds 256.",
        "168.63.129.16 is reserved by Azure and can't be in your address space.",
      ],
    },
    steps: [
      { say: "Use the lab's cidr tool to see a block's first and last address and its size.", cmd: "cidr 10.1.0.0/16" },
      { say: "Compare a /20.", cmd: "cidr 10.1.0.0/20" },
      { say: "Answer question 1 with the size from step 1. Answer questions 2 and 3 the same way: answer <number> <value>.", cmd: "answer 1 65536" },
      { say: "Create the new virtual network. --address-prefixes sets its address space.", cmd: `az network vnet create ${G} --name vnet-lab --address-prefixes 10.50.0.0/16`, flags: [["--name vnet-lab", "the new VNet's name"], ["--address-prefixes 10.50.0.0/16", "one or more CIDR ranges, separated by spaces"]] },
    ],
    setup: () => base(),
    objectives: [
      ask(1, "How many addresses are in 10.1.0.0/16?", ["65536", "65,536"]),
      ask(2, "Is 10.1.200.7 inside 10.1.0.0/16? (yes or no)", ["yes", "y"]),
      ask(3, "How many addresses are in a /20?", ["4096", "4,096"]),
      { text: "Create vnet-lab with address space 10.50.0.0/16", test: ({ st }) => st.vnets["vnet-lab"]?.prefixes.includes("10.50.0.0/16") ?? false },
    ],
    par: 1,
    hints: ["Use the cidr tool from steps 1 and 2. It prints the first address, the last address and the size.", "10.1.0.0/16 runs from 10.1.0.0 to 10.1.255.255, so check where 10.1.200.7 falls. For a /20, work out 2^(32-20).", "answer 2 yes, answer 3 4096, then the vnet create command from step 4."],
    lesson: "The number after the slash is how many leading bits are fixed. Addresses = 2^(32 - prefix). You'll size every virtual network and subnet with that one formula.",
    why: "In 10.50.0.0/16 the first 16 bits are fixed and 16 can vary, so vnet-lab now owns 2^16 = 65,536 addresses, from 10.50.0.0 to 10.50.255.255. Every subnet you add to it later has to fit inside that range.",
    learn: [
      L("Create, change, or delete a virtual network: address ranges", "https://learn.microsoft.com/azure/virtual-network/manage-virtual-network"),
      L("IP address planning for Azure virtual networks", "https://learn.microsoft.com/azure/networking/design-guide/ip-planning"),
    ],
    solution: ["answer 1 65536", "answer 2 yes", "answer 3 4096", `az network vnet create ${G} --name vnet-lab --address-prefixes 10.50.0.0/16`],
  },
  {
    forms: { fix: "free", diagnose: false , only: ["subnet-add-"] },
    id: "carving-subnets", tier: "beginner", stage: "Foundations", title: "Carve subnets from an address space",
    story: "The API team needs a subnet inside vnet-app. Create subnet-api on 10.1.3.0/26 and work out how many VMs it can actually hold.",
    concept: {
      heading: "Subnets and the five reserved addresses",
      paragraphs: [
        "A subnet takes a slice of the virtual network's address space so you can segment it. A subnet's range has to sit inside the VNet's address space and can't overlap another subnet.",
        "Azure reserves five addresses in every subnet: the first address (network ID), the second (default gateway), the third and fourth (Azure DNS mapping), and the last (broadcast). A /24 has 256 addresses but only 251 you can use.",
        "The smallest IPv4 subnet Azure supports is /29, which is 8 addresses minus 5 reserved, leaving 3.",
      ],
      facts: ["Usable addresses = block size - 5.", "Reserved: .0, .1, .2, .3 and the last address.", "Smallest subnet: /29 (3 usable)."],
    },
    steps: [
      { say: "Check the size of a /26 first.", cmd: "cidr 10.1.3.0/26" },
      { say: "Create the subnet inside vnet-app.", cmd: `az network vnet subnet create ${G} --vnet-name vnet-app --name subnet-api --address-prefixes 10.1.3.0/26`, flags: [["--vnet-name vnet-app", "the VNet the subnet belongs to"], ["--name subnet-api", "the subnet's name"], ["--address-prefixes 10.1.3.0/26", "the subnet's range, inside the VNet's space"]] },
      { say: "Answer below. Remember which addresses Azure keeps.", cmd: "answer 1 59" },
    ],
    setup: () => { const st = base(); vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-web": { p: "10.1.1.0/24" } }); return st; },
    objectives: [
      { text: "Add subnet-api to vnet-app on 10.1.3.0/26", test: ({ st }) => sub(st, "vnet-app", "subnet-api")?.prefixes[0] === "10.1.3.0/26" },
      ask(1, "How many addresses in subnet-api can you assign to resources?", ["59"]),
      ask(2, "What's the first address Azure can assign in subnet-api?", ["10.1.3.4"]),
    ],
    par: 1,
    hints: ["Run cidr 10.1.3.0/26 to see the subnet's size and range.", "A /26 is 64 addresses. Azure keeps five: .0 to .3 and the last one.", "answer 1 59, answer 2 10.1.3.4"],
    lesson: "Every subnet loses five addresses to Azure. Size subnets for the hosts you need plus those five, and remember the first address you can hand out is always .4 of the subnet.",
    why: "subnet-api fits inside vnet-app's 10.1.0.0/16 and doesn't overlap subnet-web, so Azure accepted it. Its 64 addresses minus the five Azure keeps (10.1.3.0 to 10.1.3.3 and 10.1.3.63) leave 59 for VMs, starting at 10.1.3.4.",
    learn: [
      L("Private IP addresses: reserved addresses", "https://learn.microsoft.com/azure/virtual-network/ip-services/private-ip-addresses"),
      L("IP address planning: Azure-reserved addresses", "https://learn.microsoft.com/azure/networking/design-guide/ip-planning"),
    ],
    solution: [`az network vnet subnet create ${G} --vnet-name vnet-app --name subnet-api --address-prefixes 10.1.3.0/26`, "answer 1 59", "answer 2 10.1.3.4"],
  },
  {
    forms: { fix: "off", diagnose: false },
    id: "nics-and-ips", tier: "beginner", stage: "Foundations", title: "Find a VM's NIC and private IP",
    story: "A developer asks what private IP address vm-web2 has and which subnet of vnet-app it lives in. VMs don't hold IPs directly. Their network interface (NIC) does, and vm-web2's is called vm-web2-nic. Find both answers from the NIC.",
    concept: {
      heading: "Network interfaces",
      paragraphs: [
        "A network interface (NIC) is the interconnection between a virtual machine and a virtual network. A VM must have at least one NIC.",
        "Private IP addresses are assigned to the NIC, from the address range of the subnet the NIC is in. Dynamic allocation is the default: Azure hands out the next available address, which is usually the next one in sequence but isn't guaranteed. Static allocation lets you pick an unused address yourself.",
        "In this lab every NIC is named after its VM with -nic on the end, so vm-web2's NIC is vm-web2-nic.",
      ],
      facts: ["IPs belong to the NIC, not the VM.", "Dynamic allocation is the default.", "A VM needs at least one NIC."],
    },
    steps: [
      { say: "List the IP configurations on vm-web2's NIC.", cmd: `az network nic ip-config list ${G} --nic-name vm-web2-nic -o table`, flags: [["--nic-name vm-web2-nic", "the network interface to inspect"]] },
      { say: "Or pull one field out of the full NIC with --query.", cmd: `az network nic show ${G} --name vm-web2-nic --query "ipConfigurations[0].privateIPAddress"` },
      { say: "Answer the questions below.", cmd: "answer 1 10.1.1.5" },
    ],
    setup: () => {
      const st = base();
      vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-web": { p: "10.1.1.0/24" }, "subnet-db": { p: "10.1.2.0/24" } });
      host(st, "vm-web", "vnet-app", "subnet-web", "10.1.1.4");
      host(st, "vm-web2", "vnet-app", "subnet-web", "10.1.1.5");
      host(st, "vm-db", "vnet-app", "subnet-db", "10.1.2.4");
      return st;
    },
    objectives: [
      did("Inspect vm-web2's network interface", "az network nic"),
      ask(1, "What is vm-web2's private IP address?", ["10.1.1.5"]),
      ask(2, "Which subnet is vm-web2 in?", ["subnet-web"]),
    ],
    par: 0,
    hints: ["Look at the NIC, vm-web2-nic, with the ip-config list command in step 1.", "The table has a private IP column and a subnet column. Those are your two answers.", "answer 1 10.1.1.5, answer 2 subnet-web"],
    lesson: "When you're asked for a VM's IP, look at its NIC. The NIC's IP configuration tells you the private IP and the subnet, and that subnet decides which security rules and routes apply. You'll meet both soon.",
    why: "vm-web2-nic's IP configuration holds the address 10.1.1.5, handed out from subnet-web's range 10.1.1.0/24. The VM itself has no IP of its own, so the NIC is always where you look.",
    learn: [
      L("Virtual networks and virtual machines in Azure: network interfaces", "https://learn.microsoft.com/azure/virtual-network/network-overview"),
      L("Configure IP addresses for an Azure network interface", "https://learn.microsoft.com/azure/virtual-network/ip-services/virtual-network-network-interface-addresses"),
      L("az network nic ip-config list", "https://learn.microsoft.com/cli/azure/network/nic/ip-config?view=azure-cli-latest"),
    ],
    solution: [`az network nic ip-config list ${G} --nic-name vm-web2-nic -o table`, "answer 1 10.1.1.5", "answer 2 subnet-web"],
  },
  {
    forms: { fix: "free", diagnose: false , only: ["create-nsg", "sn-nsg-"] },
    id: "first-nsg", tier: "beginner", stage: "Security", title: "Create and attach an NSG",
    story: "Security wants a network security group (NSG, a set of allow and deny rules) in front of subnet-web, where vm-web serves HTTPS. Create nsg-web, attach it to subnet-web, and look at the rules it starts with. vm-client in subnet-client, in the same VNet, should still reach vm-web afterward. Find out which rule allows it.",
    concept: {
      heading: "Network security groups",
      paragraphs: [
        "A network security group (NSG) holds rules that allow or deny inbound and outbound traffic. You can attach one to a subnet or to a NIC.",
        "Each rule has a priority between 100 and 4096. Azure processes rules lowest number first and stops at the first match.",
        "Every NSG starts with default rules you can't delete. Inbound: AllowVnetInBound (65000), AllowAzureLoadBalancerInBound (65001), DenyAllInBound (65500). Outbound: AllowVnetOutBound (65000), AllowInternetOutBound (65001), DenyAllOutBound (65500). Your custom rules always run before them.",
      ],
      facts: ["Custom priority range: 100 to 4096.", "Lowest number wins, first match stops.", "Defaults allow traffic within the VNet and deny everything else inbound."],
    },
    steps: [
      { say: "Create the NSG.", cmd: `az network nsg create ${G} --name nsg-web` },
      { say: "List its rules including the defaults.", cmd: `az network nsg rule list ${G} --nsg-name nsg-web --include-default -o table`, flags: [["--include-default", "also show the built-in default rules"]] },
      { say: "Attach it to subnet-web.", cmd: `az network vnet subnet update ${G} --vnet-name vnet-app --name subnet-web --network-security-group nsg-web` },
      { say: "Answer question 1 from the table in step 2. For question 2, find the default rule that matches traffic from inside the VNet.", cmd: "answer 1 65500" },
    ],
    setup: () => {
      const st = base();
      vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-web": { p: "10.1.1.0/24" }, "subnet-client": { p: "10.1.2.0/24" } });
      host(st, "vm-web", "vnet-app", "subnet-web", "10.1.1.4", { ports: [22, 443] });
      host(st, "vm-client", "vnet-app", "subnet-client", "10.1.2.4");
      return st;
    },
    objectives: [
      { text: "Create the NSG nsg-web", test: ({ st }) => !!st.nsgs["nsg-web"] },
      { text: "Attach nsg-web to subnet-web", test: ({ st }) => sub(st, "vnet-app", "subnet-web")?.nsg === "nsg-web" },
      ask(1, "What priority does DenyAllInBound have?", ["65500"]),
      ask(2, "Which default rule lets vm-client reach vm-web?", ["AllowVnetInBound"]),
    ],
    par: 2,
    hints: ["Run the nsg rule list command from step 2. --include-default shows the built-in rules with their priorities.", "vm-client and vm-web are in the same VNet. Look for the inbound default rule that allows traffic from inside the VNet.", "answer 1 65500, answer 2 AllowVnetInBound"],
    lesson: "A new NSG isn't a wall. Its defaults allow traffic inside the virtual network and block other inbound traffic. To lock things down further you add your own rules, which always run before the defaults.",
    why: "nsg-web now filters everything coming into subnet-web, but it has no custom rules yet. vm-client's traffic comes from inside vnet-app, so it matches AllowVnetInBound (65000) long before DenyAllInBound (65500) is reached.",
    learn: [
      L("Azure network security groups overview", "https://learn.microsoft.com/azure/virtual-network/network-security-groups-overview"),
      L("Troubleshoot NSG misconfigurations: default rules", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-nsg-blocking-traffic"),
      L("az network nsg rule list", "https://learn.microsoft.com/cli/azure/network/nsg/rule?view=azure-cli-latest"),
    ],
    flows: [{ from: "vm-client", to: "vm-web", port: 443, want: "open" }],
    solution: [`az network nsg create ${G} --name nsg-web`, `az network vnet subnet update ${G} --vnet-name vnet-app --name subnet-web --network-security-group nsg-web`, "answer 1 65500", "answer 2 AllowVnetInBound"],
  },
  {
    forms: { fix: "off", diagnose: true },
    id: "where-packets-go", tier: "beginner", stage: "Routing", title: "Read effective routes",
    story: "Before you touch routing, learn to read it. vm-web sits in subnet-web of vnet-app (10.1.0.0/16). Pull the effective routes for its NIC, vm-web-nic, and work out where traffic would go for three destinations: 203.0.113.50 on the internet, 10.1.2.5 inside vnet-app, and 10.9.9.9, which is in no network you own.",
    concept: {
      heading: "System routes",
      paragraphs: [
        "A route is an address prefix plus a next hop: where Azure sends traffic headed for that prefix. Azure creates system routes for every subnet automatically. There's a route for each address range in the VNet with next hop Virtual network, a default 0.0.0.0/0 route to the Internet, and routes with next hop None for private ranges like 10.0.0.0/8, 172.16.0.0/12 and 192.168.0.0/16, which drop traffic.",
        "When traffic leaves a subnet, Azure picks the route with the longest prefix that matches the destination. 10.1.2.5 matches both 10.1.0.0/16 and 10.0.0.0/8, and the /16 wins because it's more specific.",
        "Effective routes on a NIC show every route that applies to it, which makes them the first thing to check when traffic goes the wrong way.",
      ],
      facts: ["Longest prefix match picks the route.", "0.0.0.0/0 goes to the Internet by default.", "Unused private ranges default to next hop None."],
    },
    steps: [
      { say: "Show the effective routes for vm-web's NIC.", cmd: `az network nic show-effective-route-table ${G} --name vm-web-nic -o table` },
      { say: "Answer all three questions with the next hop type exactly as the table shows it.", cmd: "answer 1 Internet" },
    ],
    setup: () => {
      const st = base();
      vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-web": { p: "10.1.1.0/24" } });
      host(st, "vm-web", "vnet-app", "subnet-web", "10.1.1.4");
      return st;
    },
    objectives: [
      did("Show vm-web's effective routes", "az network nic show-effective-route-table"),
      ask(1, "Next hop type for traffic to 203.0.113.50?", ["Internet"]),
      ask(2, "Next hop type for traffic to 10.1.2.5?", ["Virtual network", "VirtualNetwork", "VnetLocal"]),
      ask(3, "Next hop type for traffic to 10.9.9.9?", ["None"]),
    ],
    par: 0,
    hints: ["Run the command in step 1 and read the Address Prefix and Next Hop Type columns.", "For each address, find every prefix that contains it and pick the longest one. 10.9.9.9 isn't in 10.1.0.0/16, but it is in 10.0.0.0/8.", "answer 1 Internet, answer 2 Virtual network, answer 3 None"],
    lesson: "Routing is longest prefix match over the effective routes. Reading that table first will save you hours: most can't-connect issues come down to which route won.",
    why: "Each address went to the longest prefix that contains it. 203.0.113.50 matches only 0.0.0.0/0 (Internet), 10.1.2.5 matches vnet-app's 10.1.0.0/16 (Virtual network), and 10.9.9.9 falls through to the 10.0.0.0/8 system route with next hop None, so it's dropped.",
    learn: [
      L("Azure virtual network traffic routing", "https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview"),
      L("Diagnose a VM routing problem with the Azure CLI", "https://learn.microsoft.com/azure/network-watcher/diagnose-vm-network-routing-problem-cli"),
    ],
    solution: [`az network nic show-effective-route-table ${G} --name vm-web-nic -o table`, "answer 1 Internet", "answer 2 Virtual network", "answer 3 None"],
  },
  {
    forms: { fix: "free", diagnose: true , only: ["rule-add-"] },
    id: "ip-flow-verify", tier: "beginner", stage: "Security", title: "Find the blocking rule with IP flow verify",
    story: "vm-client (10.1.2.4, in subnet-client) can't reach the HTTPS site on vm-web (10.1.1.4, in subnet-web). subnet-web has nsg-web attached. Instead of guessing, ask Network Watcher which rule is blocking it, then add a rule to nsg-web that allows only HTTPS (port 443) from subnet-client. SSH (port 22) must stay blocked.",
    fix: "vm-client can't open the HTTPS site on vm-web.",
    concept: {
      heading: "IP flow verify",
      paragraphs: [
        "Network Watcher is Azure's set of network troubleshooting tools. IP flow verify is one of them: it checks whether a packet is allowed or denied to or from a VM, and tells you which security rule made the decision.",
        "For inbound traffic Azure checks the subnet's NSG first, then the NIC's NSG. Both have to allow the traffic.",
        "To let traffic through a deny, add an allow rule with a lower priority number than the deny, so it's processed first.",
      ],
      facts: ["IP flow verify names the deciding rule.", "Inbound: subnet NSG, then NIC NSG.", "Allow rule must have a lower number than the deny."],
    },
    steps: [
      { say: "Test an inbound TCP packet to vm-web on 443 from vm-client.", cmd: `az network watcher test-ip-flow ${G} --vm vm-web --direction Inbound --protocol TCP --local 10.1.1.4:443 --remote 10.1.2.4:*`, flags: [["--vm vm-web", "the VM to test"], ["--direction Inbound", "traffic coming into the VM"], ["--local 10.1.1.4:443", "the VM's own IP and port"], ["--remote 10.1.2.4:*", "the other side, any source port"]] },
      { say: "Answer below with the rule name that comes after securityRules/.", cmd: "answer 1 Deny-Vnet-Inbound" },
      { say: "Add an allow rule for HTTPS from subnet-client at a lower priority number than the deny.", cmd: `az network nsg rule create ${G} --nsg-name nsg-web --name Allow-HTTPS-Client --priority 300 --direction Inbound --access Allow --protocol Tcp --source-address-prefixes 10.1.2.0/24 --destination-port-ranges 443`, flags: [["--priority 300", "runs before the deny at 4000"], ["--source-address-prefixes 10.1.2.0/24", "only subnet-client"], ["--destination-port-ranges 443", "only HTTPS"]] },
      { say: "Run the same test again and see the new verdict.", cmd: `az network watcher test-ip-flow ${G} --vm vm-web --direction Inbound --protocol TCP --local 10.1.1.4:443 --remote 10.1.2.4:*` },
    ],
    setup: () => {
      const st = base();
      vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-web": { p: "10.1.1.0/24", nsg: "nsg-web" }, "subnet-client": { p: "10.1.2.0/24" } });
      host(st, "vm-web", "vnet-app", "subnet-web", "10.1.1.4", { ports: [22, 443] });
      host(st, "vm-client", "vnet-app", "subnet-client", "10.1.2.4");
      rule(st, "nsg-web", { name: "Deny-Vnet-Inbound", priority: 4000, direction: "Inbound", access: "Deny", protocol: "*", src: ["VirtualNetwork"], dst: ["*"], ports: ["*"] });
      return st;
    },
    objectives: [
      did("Run IP flow verify against vm-web", "az network watcher test-ip-flow"),
      ask(1, "Which rule denied the traffic?", ["Deny-Vnet-Inbound", "securityRules/Deny-Vnet-Inbound"]),
      { text: "Let vm-client reach vm-web on 443", test: ({ st }) => can(st, "vm-client", "10.1.1.4", 443) },
      { text: "Keep SSH (22) from vm-client to vm-web blocked", test: ({ st }) => !can(st, "vm-client", "10.1.1.4", 22) },
    ],
    par: 1,
    hints: ["Run the test-ip-flow command in step 1. Its ruleName field is securityRules/<name>.", "Deny-Vnet-Inbound has priority 4000. Your allow needs a lower number, and only port 443 from 10.1.2.0/24, so SSH stays blocked.", "answer 1 Deny-Vnet-Inbound, then the nsg rule create command in step 3."],
    lesson: "IP flow verify turns 'is the NSG blocking it?' into a one-command answer that names the rule. Fix by adding the narrowest allow you need at a lower priority number.",
    why: "Allow-HTTPS-Client has priority 300, so nsg-web checks it before Deny-Vnet-Inbound at 4000. It matches only TCP 443 from 10.1.2.0/24, so HTTPS from vm-client stops at the allow while SSH still falls through to the deny.",
    learn: [
      L("What is Azure Network Watcher? IP flow verify", "https://learn.microsoft.com/azure/network-watcher/network-watcher-overview"),
      L("az network watcher test-ip-flow", "https://learn.microsoft.com/cli/azure/network/watcher?view=azure-cli-latest"),
      L("Troubleshoot NSG misconfigurations blocking traffic", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-nsg-blocking-traffic"),
    ],
    flows: [{ from: "vm-client", to: "vm-web", port: 443, want: "open" }, { from: "vm-client", to: "vm-web", port: 22, want: "closed" }],
    solution: [`az network watcher test-ip-flow ${G} --vm vm-web --direction Inbound --protocol TCP --local 10.1.1.4:443 --remote 10.1.2.4:*`, "answer 1 Deny-Vnet-Inbound", `az network nsg rule create ${G} --nsg-name nsg-web --name Allow-HTTPS-Client --priority 300 --direction Inbound --access Allow --protocol Tcp --source-address-prefixes 10.1.2.0/24 --destination-port-ranges 443`],
  },
  {
    forms: { fix: "free", diagnose: false , only: ["peer-"] },
    id: "first-peering", tier: "beginner", stage: "Connectivity", title: "Peer two VNets",
    story: "vnet-a (10.10.0.0/16) and vnet-b (10.20.0.0/16) are separate networks, so vm-a can't reach the HTTPS service on vm-b (10.20.1.4, port 443). Peer the two VNets, watch the peering state change, then test the connection from vm-a.",
    concept: {
      heading: "Virtual network peering",
      paragraphs: [
        "Peering connects two virtual networks so their resources can talk over the Microsoft backbone, privately, with the same latency as within one VNet in the same region.",
        "A peering is two links, one from each side. After the first link it shows Initiated. When the second link exists, both show Connected, and only then can traffic flow.",
        "With the Azure CLI, pass --allow-vnet-access on each link. If you leave it out, the link is created but no traffic flows through it.",
        "Address spaces of peered VNets can't overlap, and peering isn't transitive. You'll meet both of those rules in the Intermediate tier.",
      ],
      facts: ["Two links: Initiated, then Connected.", "Use --allow-vnet-access with the CLI.", "Peered address spaces can't overlap."],
    },
    steps: [
      { say: "Create the link from vnet-a to vnet-b.", cmd: `az network vnet peering create ${G} --name a-to-b --vnet-name vnet-a --remote-vnet vnet-b --allow-vnet-access`, flags: [["--vnet-name vnet-a", "the local side of this link"], ["--remote-vnet vnet-b", "the other VNet, by name or resource ID"], ["--allow-vnet-access", "let traffic flow through this link"]] },
      { say: "Check the state from vnet-a. It should say Initiated.", cmd: `az network vnet peering list ${G} --vnet-name vnet-a -o table` },
      { say: "Create the reverse link.", cmd: `az network vnet peering create ${G} --name b-to-a --vnet-name vnet-b --remote-vnet vnet-a --allow-vnet-access` },
      { say: "Check the state again. Both links should now say Connected.", cmd: `az network vnet peering list ${G} --vnet-name vnet-a -o table` },
      { say: "Connect to vm-a so the next command runs from there.", cmd: "ssh vm-a" },
      { say: "From vm-a, test vm-b's port 443. Then type exit.", cmd: "nc -zv 10.20.1.4 443" },
    ],
    setup: () => {
      const st = base();
      vnet(st, "vnet-a", ["10.10.0.0/16"], { "subnet-app": { p: "10.10.1.0/24" } });
      vnet(st, "vnet-b", ["10.20.0.0/16"], { "subnet-app": { p: "10.20.1.0/24" } });
      host(st, "vm-a", "vnet-a", "subnet-app", "10.10.1.4");
      host(st, "vm-b", "vnet-b", "subnet-app", "10.20.1.4", { ports: [22, 443] });
      return st;
    },
    objectives: [
      { text: "Peer vnet-a and vnet-b both ways with VNet access allowed", test: ({ st }) => !!findLink(st, "vnet-a", "vnet-b")?.allowVnetAccess && !!findLink(st, "vnet-b", "vnet-a")?.allowVnetAccess },
      { text: "Get vm-a reaching vm-b on 443", test: ({ st }) => can(st, "vm-a", "10.20.1.4", 443) },
      did("Test the connection from vm-a with nc", "nc", "vm-a"),
    ],
    par: 2,
    hints: ["Check the peering with az network vnet peering list on each VNet. Both peering create commands are in the steps panel.", "One link shows Initiated and carries nothing. You need a link on vnet-a and one on vnet-b, each with --allow-vnet-access. nc only runs on a VM, so ssh vm-a first.", "Run steps 1 and 3, then ssh vm-a, nc -zv 10.20.1.4 443, and exit."],
    lesson: "Peering always takes two links. Create both, pass --allow-vnet-access on each, and confirm both sides show Connected before you go looking for other problems.",
    why: "a-to-b alone left the peering Initiated, so nothing flowed. Adding b-to-a made both links Connected, and with --allow-vnet-access on each, vm-a's traffic to 10.20.1.4 now crosses into vnet-b and the reply comes back the same way.",
    learn: [
      L("Azure virtual network peering", "https://learn.microsoft.com/azure/virtual-network/virtual-network-peering-overview"),
      L("Create, change, or delete a virtual network peering", "https://learn.microsoft.com/azure/virtual-network/virtual-network-manage-peering"),
      L("Tutorial: Connect virtual networks with peering (CLI)", "https://learn.microsoft.com/azure/virtual-network/tutorial-connect-virtual-networks"),
    ],
    flows: [{ from: "vm-a", to: "vm-b", port: 443, want: "open" }],
    solution: [`az network vnet peering create ${G} --name a-to-b --vnet-name vnet-a --remote-vnet vnet-b --allow-vnet-access`, `az network vnet peering create ${G} --name b-to-a --vnet-name vnet-b --remote-vnet vnet-a --allow-vnet-access`, "ssh vm-a", "nc -zv 10.20.1.4 443"],
  },
  {
    // Review: no steps. Mixes peering (Peer two VNets) with NSGs and their default rules (Create and attach an NSG).
    forms: { fix: "free", diagnose: true },
    id: "review-beginner", tier: "beginner", stage: "Review", title: "Review: peer two VNets and add an NSG",
    story: "A new team built vnet-shop (10.30.0.0/16) and vnet-pay (10.40.0.0/16). vm-shop needs the API on vm-pay (10.40.1.4) at port 443, and security wants an NSG named nsg-api on vm-pay's subnet, subnet-api, before anything goes live. Someone started the peering from vnet-shop and stopped there. No steps this time, just what you've learned.",
    setup: () => {
      const st = base();
      vnet(st, "vnet-shop", ["10.30.0.0/16"], { "subnet-web": { p: "10.30.1.0/24" } });
      vnet(st, "vnet-pay", ["10.40.0.0/16"], { "subnet-api": { p: "10.40.1.0/24" } });
      host(st, "vm-shop", "vnet-shop", "subnet-web", "10.30.1.4");
      host(st, "vm-pay", "vnet-pay", "subnet-api", "10.40.1.4", { ports: [22, 443] });
      peer(st, "vnet-shop", "vnet-pay");
      return st;
    },
    objectives: [
      { text: "Connect the vnet-shop and vnet-pay peering on both sides", test: ({ st }) => !!findLink(st, "vnet-shop", "vnet-pay") && !!findLink(st, "vnet-pay", "vnet-shop") },
      { text: "Create nsg-api and attach it to subnet-api", test: ({ st }) => !!st.nsgs["nsg-api"] && sub(st, "vnet-pay", "subnet-api")?.nsg === "nsg-api" },
      { text: "Get vm-shop reaching vm-pay on 443", test: ({ st }) => can(st, "vm-shop", "10.40.1.4", 443) },
      ask(1, "Which default rule lets vm-shop through nsg-api?", ["AllowVnetInBound"]),
    ],
    par: 3,
    hints: [
      `Look at the peering from the side that hasn't done anything yet: az network vnet peering list ${G} --vnet-name vnet-pay -o table`,
      "A peering is two links, one on each network. Then create the NSG and attach it to the subnet, the same way you did in Create and attach an NSG.",
      `az network vnet peering create ${G} --name pay-to-shop --vnet-name vnet-pay --remote-vnet vnet-shop --allow-vnet-access, then az network nsg create ${G} --name nsg-api, then az network vnet subnet update ${G} --vnet-name vnet-pay --name subnet-api --network-security-group nsg-api`,
    ],
    lesson: "A peering carries traffic only when both links exist. A brand new NSG doesn't block a peered network, because the VirtualNetwork service tag in the default AllowVnetInBound rule includes peered virtual networks.",
    why: "The pay-to-shop link completed the peering, so vm-shop's traffic can reach 10.40.1.4. nsg-api has only its default rules, and vnet-shop counts as VirtualNetwork once it's peered, so AllowVnetInBound lets port 443 through.",
    learn: [
      L("Create, change, or delete a virtual network peering", "https://learn.microsoft.com/azure/virtual-network/virtual-network-manage-peering"),
      L("Network security groups overview", "https://learn.microsoft.com/azure/virtual-network/network-security-groups-overview"),
      L("Virtual network service tags", "https://learn.microsoft.com/azure/virtual-network/service-tags-overview"),
    ],
    flows: [{ from: "vm-shop", to: "vm-pay", port: 443, want: "open" }],
    solution: [
      `az network vnet peering create ${G} --name pay-to-shop --vnet-name vnet-pay --remote-vnet vnet-shop --allow-vnet-access`,
      `az network nsg create ${G} --name nsg-api`,
      `az network vnet subnet update ${G} --vnet-name vnet-pay --name subnet-api --network-security-group nsg-api`,
      "answer 1 AllowVnetInBound",
    ],
  },
];
