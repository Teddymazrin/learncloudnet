// Intermediate tier: you get the symptom and the tools, not the command.
import { base, can, host, peer, rule, vnet } from "../build";
import { findLink, reach, resolve } from "@/sim/network";
import { cidr, overlap } from "@/sim/ip";
import type { State } from "@/sim/types";
import type { Level } from "../types";

const L = (title: string, url: string) => ({ title, url });
const G = "-g rg-lab";

function hubSpoke(rt1: string | null, rt2: string | null): State {
  const st = base();
  vnet(st, "vnet-spoke1", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24", rt: rt1 ?? undefined } });
  vnet(st, "vnet-hub", ["10.0.0.0/16"], { "subnet-fw": { p: "10.0.2.0/24" } });
  vnet(st, "vnet-spoke2", ["10.2.0.0/16"], { "subnet-app": { p: "10.2.1.0/24", rt: rt2 ?? undefined } });
  host(st, "vm-spoke1", "vnet-spoke1", "subnet-app", "10.1.1.4");
  host(st, "fw-hub", "vnet-hub", "subnet-fw", "10.0.2.4", { kind: "nva", forwarding: true, label: "NVA" });
  host(st, "vm-spoke2", "vnet-spoke2", "subnet-app", "10.2.1.4", { ports: [22, 443] });
  peer(st, "vnet-hub", "vnet-spoke1", { fwd: true }); peer(st, "vnet-spoke1", "vnet-hub", { fwd: true });
  peer(st, "vnet-hub", "vnet-spoke2", { fwd: true }); peer(st, "vnet-spoke2", "vnet-hub", { fwd: true });
  return st;
}
export { hubSpoke };
const viaFw = (st: State) => { const r = reach(st, "vm-spoke1", "10.2.1.4", 443); return r.ok && r.via.includes("fw-hub"); };

const ROUTES_SPOKE1 = [
  `az network route-table create ${G} --name rt-spoke1`,
  `az network route-table route create ${G} --route-table-name rt-spoke1 --name to-spoke2 --address-prefix 10.2.0.0/16 --next-hop-type VirtualAppliance --next-hop-ip-address 10.0.2.4`,
  `az network vnet subnet update ${G} --vnet-name vnet-spoke1 --name subnet-app --route-table rt-spoke1`,
];
const ROUTES_SPOKE2 = [
  `az network route-table create ${G} --name rt-spoke2`,
  `az network route-table route create ${G} --route-table-name rt-spoke2 --name to-spoke1 --address-prefix 10.1.0.0/16 --next-hop-type VirtualAppliance --next-hop-ip-address 10.0.2.4`,
  `az network vnet subnet update ${G} --vnet-name vnet-spoke2 --name subnet-app --route-table rt-spoke2`,
];

export const intermediate: Level[] = [
  {
    id: "first-match-wins", tier: "intermediate", stage: "Traffic filtering", title: "HTTPS blocked despite an allow rule",
    story: "vm-web (10.1.1.4) hosts the web app, and vm-client (10.1.2.4) in subnet-client uses it over HTTPS on 443. After a security lockdown on nsg-web, vm-client can't reach it anymore. The security team says they added an allow rule for 443 from subnet-client, and it still fails. Working means vm-client gets in on 443 while SSH (22) from vm-client stays blocked. Find out why, and fix it without opening anything extra.",
    fix: "vm-client times out connecting to vm-web on 443.",
    setup: () => {
      const st = base();
      vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-web": { p: "10.1.1.0/24", nsg: "nsg-web" }, "subnet-client": { p: "10.1.2.0/24" } });
      host(st, "vm-web", "vnet-app", "subnet-web", "10.1.1.4", { ports: [22, 443] });
      host(st, "vm-client", "vnet-app", "subnet-client", "10.1.2.4");
      rule(st, "nsg-web", { name: "Deny-All-Inbound", priority: 200, direction: "Inbound", access: "Deny", protocol: "*", src: ["*"], dst: ["*"], ports: ["*"], description: "security lockdown" });
      rule(st, "nsg-web", { name: "Allow-HTTPS-Client", priority: 300, direction: "Inbound", access: "Allow", protocol: "Tcp", src: ["10.1.2.0/24"], dst: ["*"], ports: ["443"] });
      return st;
    },
    objectives: [
      { text: "Get vm-client reaching vm-web on 443", test: ({ st }) => can(st, "vm-client", "10.1.1.4", 443) },
      { text: "Keep SSH (22) from vm-client to vm-web blocked", test: ({ st }) => !can(st, "vm-client", "10.1.1.4", 22) },
    ],
    par: 1,
    hints: [
      `Ask Network Watcher which rule decides: az network watcher test-ip-flow ${G} --vm vm-web --direction Inbound --protocol TCP --local 10.1.1.4:443 --remote 10.1.2.4:*`,
      "It names a rule, and it isn't the allow. Compare the priority numbers of the two rules in nsg-web. Lower numbers run first, and the first match ends it.",
      "Deny-All-Inbound at 200 matches 443 before Allow-HTTPS-Client at 300 is ever read. Give the allow a priority number below 200.",
    ],
    lesson: "NSG rules run in priority order, lowest number first, and evaluation stops at the first match. A deny at 200 hides an allow at 300 completely.",
    why: "NSGs stop at the first rule that matches. Deny-All-Inbound at 200 caught 443 before Allow-HTTPS-Client at 300 was read. With the allow below 200, HTTPS from subnet-client matches it first, and 22 still falls to the deny.",
    learn: [L("Azure network security groups overview", "https://learn.microsoft.com/azure/virtual-network/network-security-groups-overview"), L("Troubleshoot NSG misconfigurations blocking traffic", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-nsg-blocking-traffic")],
    flows: [{ from: "vm-client", to: "vm-web", port: 443, want: "open" }, { from: "vm-client", to: "vm-web", port: 22, want: "closed" }],
    solution: [`az network nsg rule update ${G} --nsg-name nsg-web --name Allow-HTTPS-Client --priority 150`],
  },
  {
    id: "two-locks", tier: "intermediate", stage: "Traffic filtering", title: "API blocked despite a subnet allow rule",
    story: "vm-api (10.1.3.4) in subnet-api serves an API on port 8443, and vm-client (10.1.2.4) in subnet-client calls it. nsg-subnet-api on subnet-api already allows 8443 from subnet-client, yet vm-client times out. Working means vm-client gets through on 8443 while SSH (22) to vm-api stays blocked.",
    fix: "vm-client times out connecting to vm-api on 8443.",
    setup: () => {
      const st = base();
      vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-api": { p: "10.1.3.0/24", nsg: "nsg-subnet-api" }, "subnet-client": { p: "10.1.2.0/24" } });
      host(st, "vm-api", "vnet-app", "subnet-api", "10.1.3.4", { ports: [22, 8443], nicNsg: "nsg-vm-api-nic" });
      host(st, "vm-client", "vnet-app", "subnet-client", "10.1.2.4");
      rule(st, "nsg-subnet-api", { name: "Allow-API-Client", priority: 300, direction: "Inbound", access: "Allow", protocol: "Tcp", src: ["10.1.2.0/24"], dst: ["*"], ports: ["8443"] });
      rule(st, "nsg-subnet-api", { name: "Deny-Vnet-Inbound", priority: 4000, direction: "Inbound", access: "Deny", protocol: "*", src: ["VirtualNetwork"], dst: ["*"], ports: ["*"] });
      rule(st, "nsg-vm-api-nic", { name: "Deny-Vnet-Inbound", priority: 4000, direction: "Inbound", access: "Deny", protocol: "*", src: ["VirtualNetwork"], dst: ["*"], ports: ["*"] });
      return st;
    },
    objectives: [
      { text: "Get vm-client reaching vm-api on 8443", test: ({ st }) => can(st, "vm-client", "10.1.3.4", 8443) },
      { text: "Keep SSH (22) from vm-client to vm-api blocked", test: ({ st }) => !can(st, "vm-client", "10.1.3.4", 22) },
    ],
    par: 1,
    hints: [
      `List what applies to the VM end to end: az network nic list-effective-nsg ${G} --name vm-api-nic`,
      "The output lists every NSG on the path, not just the subnet's. Inbound traffic passes the subnet NSG first, then the NIC's. Find the one with no allow for 8443.",
      "nsg-vm-api-nic on vm-api's NIC has no allow for 8443, so its Deny-Vnet-Inbound at 4000 drops what the subnet NSG let through. Add an inbound allow for 8443 from subnet-client to that NSG, below 4000.",
    ],
    lesson: "When a subnet NSG and a NIC NSG both exist, traffic must pass both. Inbound hits the subnet NSG first, then the NIC NSG. Outbound runs the other way. A deny at either level blocks the connection.",
    why: "8443 passed nsg-subnet-api, then hit nsg-vm-api-nic on the NIC, where Deny-Vnet-Inbound at 4000 dropped it. Inbound traffic needs an allow in both NSGs, so letting 8443 from subnet-client through the NIC's NSG opens the path. Nothing allows 22, so it stays blocked.",
    learn: [L("Troubleshoot NSG misconfigurations: subnet and NIC interaction", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-nsg-blocking-traffic"), L("Troubleshoot connectivity between Azure VMs", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-connectivity-problem-between-vms")],
    flows: [{ from: "vm-client", to: "vm-api", port: 8443, want: "open" }, { from: "vm-client", to: "vm-api", port: 22, want: "closed" }],
    solution: [`az network nsg rule create ${G} --nsg-name nsg-vm-api-nic --name Allow-API-Client --priority 300 --direction Inbound --access Allow --protocol Tcp --source-address-prefixes 10.1.2.0/24 --destination-port-ranges 8443`],
  },
  {
    id: "half-a-handshake", tier: "intermediate", stage: "Peering", title: "Spoke can't reach the hub after peering",
    story: "The app on vm-spoke1 (10.1.1.4, in vnet-spoke1) needs the shared service on vm-hub (10.0.1.4, in vnet-hub) on port 443. Yesterday a colleague set up peering between the two networks and said it was done before going home. vm-spoke1 still can't connect. Working means vm-spoke1 reaches vm-hub on 443.",
    fix: "vm-spoke1 can't connect to vm-hub on 443.",
    setup: () => {
      const st = base();
      vnet(st, "vnet-spoke1", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24" } });
      vnet(st, "vnet-hub", ["10.0.0.0/16"], { "subnet-shared": { p: "10.0.1.0/24" } });
      host(st, "vm-spoke1", "vnet-spoke1", "subnet-app", "10.1.1.4");
      host(st, "vm-hub", "vnet-hub", "subnet-shared", "10.0.1.4", { ports: [22, 443] });
      peer(st, "vnet-hub", "vnet-spoke1");
      return st;
    },
    objectives: [
      { text: "Get the peering Connected on both sides", test: ({ st }) => !!findLink(st, "vnet-hub", "vnet-spoke1") && !!findLink(st, "vnet-spoke1", "vnet-hub") },
      { text: "Get vm-spoke1 reaching vm-hub on 443", test: ({ st }) => can(st, "vm-spoke1", "10.0.1.4", 443) },
    ],
    par: 1,
    hints: [`Check the state from the hub side: az network vnet peering list ${G} --vnet-name vnet-hub -o table`, "The hub's link says Initiated, not Connected. Now run the same list on vnet-spoke1 and see what's there.", "vnet-spoke1 has no link back to vnet-hub, and a peering needs one on each side. Create it from vnet-spoke1, and pass --allow-vnet-access."],
    lesson: "Peering is two links. If you created the second link without --allow-vnet-access, fix it in place with az network vnet peering update --allow-vnet-access true.",
    why: "A peering carries traffic only when both networks have a link to each other. The link from vnet-spoke1 to vnet-hub was missing, so the hub's side sat at Initiated. Adding it, with VNet access allowed, turns both sides Connected and 443 crosses.",
    learn: [L("Create, change, or delete a virtual network peering", "https://learn.microsoft.com/azure/virtual-network/virtual-network-manage-peering"), L("az network vnet peering", "https://learn.microsoft.com/cli/azure/network/vnet/peering?view=azure-cli-latest")],
    flows: [{ from: "vm-spoke1", to: "vm-hub", port: 443, want: "open" }],
    solution: [`az network vnet peering create ${G} --name spoke1-to-hub --vnet-name vnet-spoke1 --remote-vnet vnet-hub --allow-vnet-access`],
  },
  {
    id: "overlap", tier: "intermediate", stage: "Peering", title: "Peer a spoke built from an old template",
    story: "vnet-spoke2 was built from an old template. Its only subnet, subnet-app, holds vm-spoke2 at 10.20.1.4. It isn't peered to anything yet. Peer it with vnet-hub so vm-spoke2 can reach the shared service on vm-hub (10.0.1.4) on port 443.",
    fix: "vnet-spoke2 won't peer with vnet-hub, so vm-spoke2 can't reach vm-hub on 443.",
    setup: () => {
      const st = base();
      vnet(st, "vnet-hub", ["10.0.0.0/16"], { "subnet-shared": { p: "10.0.1.0/24" } });
      vnet(st, "vnet-spoke2", ["10.0.0.0/16", "10.20.0.0/16"], { "subnet-app": { p: "10.20.1.0/24" } });
      host(st, "vm-hub", "vnet-hub", "subnet-shared", "10.0.1.4", { ports: [22, 443] });
      host(st, "vm-spoke2", "vnet-spoke2", "subnet-app", "10.20.1.4");
      return st;
    },
    objectives: [
      { text: "Clear whatever stops vnet-spoke2 peering with vnet-hub", test: ({ st }) => !st.vnets["vnet-spoke2"].prefixes.some((a) => st.vnets["vnet-hub"].prefixes.some((b) => overlap(cidr(a)!, cidr(b)!))) },
      { text: "Get the peering Connected on both sides", test: ({ st }) => !!findLink(st, "vnet-hub", "vnet-spoke2") && !!findLink(st, "vnet-spoke2", "vnet-hub") },
      { text: "Get vm-spoke2 reaching vm-hub on 443", test: ({ st }) => can(st, "vm-spoke2", "10.0.1.4", 443) },
    ],
    par: 3,
    hints: [`Try the peering first and read the error. Then compare both address spaces: az network vnet show ${G} --name vnet-spoke2 --query addressSpace.addressPrefixes, and the same for vnet-hub.`, "vnet-spoke2 has two ranges. One of them sits right on top of vnet-hub's, and no subnet uses it.", "vnet-spoke2's 10.0.0.0/16 is the same as vnet-hub's. Remove it, keeping 10.20.0.0/16 for subnet-app. --address-prefixes replaces the whole list. Then create both peering links with --allow-vnet-access."],
    lesson: "Azure won't peer virtual networks whose address spaces overlap. Resize one of them, which you can only do for ranges no subnet is using. Plan non-overlapping ranges up front.",
    why: "Azure won't peer networks whose address spaces overlap, and vnet-spoke2's unused 10.0.0.0/16 was the same range as vnet-hub. With only 10.20.0.0/16 left, both peering links could be created, and 443 crosses to vm-hub.",
    learn: [L("Troubleshoot overlapping address spaces in peered VNets", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-peering-issues"), L("Add or remove an address range", "https://learn.microsoft.com/azure/virtual-network/manage-virtual-network")],
    flows: [{ from: "vm-spoke2", to: "vm-hub", port: 443, want: "open" }],
    solution: [`az network vnet update ${G} --name vnet-spoke2 --address-prefixes 10.20.0.0/16`, `az network vnet peering create ${G} --name spoke2-to-hub --vnet-name vnet-spoke2 --remote-vnet vnet-hub --allow-vnet-access`, `az network vnet peering create ${G} --name hub-to-spoke2 --vnet-name vnet-hub --remote-vnet vnet-spoke2 --allow-vnet-access`],
  },
  {
    id: "spokes-dont-talk", tier: "intermediate", stage: "Routing", title: "Route spoke-to-spoke traffic through the hub",
    story: "This is a hub-and-spoke network: vnet-spoke1 and vnet-spoke2 are each peered to vnet-hub, and every peering is Connected with forwarded traffic allowed (so a spoke accepts traffic the hub passes on). vnet-hub holds fw-hub at 10.0.2.4, a network virtual appliance: a VM that inspects traffic and passes it on. vm-spoke1 (10.1.1.4) can't reach vm-spoke2 (10.2.1.4) on 443. Policy says spoke-to-spoke traffic must go through fw-hub, and no new peerings.",
    fix: "vm-spoke1 can't reach vm-spoke2 on 443.",
    concept: {
      heading: "Hub-and-spoke routing",
      paragraphs: [
        "In hub-and-spoke, each spoke network peers with the hub, and shared parts live in the hub, like a network virtual appliance (NVA): a VM that inspects traffic and passes it on.",
        "A peering adds routes for the other network's own ranges, and nothing more. A spoke learns the hub's range, not the ranges of other networks peered to the hub, so spoke to spoke needs a path of its own.",
        "A user-defined route can send a range to the NVA: next hop type VirtualAppliance, with the NVA's private IP. Peering lets that IP be in the hub.",
        "Two switches carry it the rest of the way: IP forwarding on the NVA's NIC, so Azure hands it packets addressed to someone else, and allow forwarded traffic on each spoke's peering, so the spoke accepts what the hub passes on.",
      ],
      facts: ["Peering isn't transitive: spokes don't see each other.", "VirtualAppliance routes point at the NVA's private IP.", "The NVA's NIC needs IP forwarding on.", "Spoke peerings need allow forwarded traffic."],
    },
    setup: () => hubSpoke(null, null),
    objectives: [
      { text: "Get vm-spoke1 reaching vm-spoke2 on 443", test: ({ st }) => can(st, "vm-spoke1", "10.2.1.4", 443) },
      { text: "Send that traffic through fw-hub", test: ({ st }) => viaFw(st) },
      { text: "Don't peer the spokes directly", test: ({ st }) => !findLink(st, "vnet-spoke1", "vnet-spoke2") && !findLink(st, "vnet-spoke2", "vnet-spoke1") },
    ],
    par: 6,
    hints: [`Look at where vm-spoke1 can send traffic: az network nic show-effective-route-table ${G} --name vm-spoke1-nic -o table`, "There are routes for vnet-spoke1 and for vnet-hub, but none covers 10.2.0.0/16. Peering doesn't pass routes on from one peered network to the next.", "Each spoke subnet needs a route table with a route to the other spoke's range, next hop type VirtualAppliance with --next-hop-ip-address 10.0.2.4. Do both spokes, so the reply comes back through fw-hub too."],
    lesson: "Peering is non-transitive: spokes reach the hub but not each other through it. User-defined routes in each spoke steer traffic to the hub appliance, the peering must allow forwarded traffic, and both directions need a route so a stateful firewall sees the whole session.",
    why: "Peering isn't transitive, so vm-spoke1 had no route to 10.2.0.0/16 at all. A route in each spoke with next hop VirtualAppliance 10.0.2.4 hands the traffic to fw-hub, which passes it over its other peering. The mirror route in vnet-spoke2 brings the reply back the same way.",
    learn: [L("Hub-and-spoke network topology", "https://learn.microsoft.com/azure/networking/design-guide/hub-spoke"), L("Tutorial: Route network traffic with a route table", "https://learn.microsoft.com/azure/virtual-network/tutorial-create-route-table"), L("Troubleshoot peering route conflicts and asymmetric routing", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-peering-issues")],
    flows: [{ from: "vm-spoke1", to: "vm-spoke2", port: 443, want: "open" }],
    solution: [...ROUTES_SPOKE1, ...ROUTES_SPOKE2],
  },
  {
    id: "ghost-next-hop", tier: "intermediate", stage: "Routing", title: "Spoke-to-spoke down after an overnight rebuild",
    story: "Spoke-to-spoke traffic in this hub-and-spoke network goes through the appliance fw-hub in vnet-hub, using route tables rt-spoke1 and rt-spoke2. It worked yesterday. Overnight the appliance was rebuilt, and it's back up as fw-hub at 10.0.2.4. Now vm-spoke1 (10.1.1.4) times out reaching vm-spoke2 (10.2.1.4) on 443. Nothing else changed. Working means 443 flows again, through fw-hub.",
    fix: "vm-spoke1 times out reaching vm-spoke2 on 443.",
    setup: () => {
      const st = hubSpoke("rt-spoke1", "rt-spoke2");
      st.rts["rt-spoke1"] = { routes: [{ name: "to-spoke2", prefix: "10.2.0.0/16", type: "VirtualAppliance", nhIp: "10.0.2.5" }] };
      st.rts["rt-spoke2"] = { routes: [{ name: "to-spoke1", prefix: "10.1.0.0/16", type: "VirtualAppliance", nhIp: "10.0.2.4" }] };
      return st;
    },
    objectives: [
      { text: "Get vm-spoke1 reaching vm-spoke2 on 443", test: ({ st }) => can(st, "vm-spoke1", "10.2.1.4", 443) },
      { text: "Send that traffic through fw-hub", test: ({ st }) => viaFw(st) },
    ],
    par: 1,
    hints: [`Ask Network Watcher where the packet goes next: az network watcher show-next-hop ${G} --vm vm-spoke1 --source-ip 10.1.1.4 --dest-ip 10.2.1.4`, "It reports a next hop type, an IP and the route table that chose it. Compare that IP with fw-hub's address.", "The to-spoke2 route in rt-spoke1 still sends traffic to 10.0.2.5, where nothing lives now. Point that route's next hop IP at fw-hub."],
    lesson: "Next hop returns the next hop type, IP and the route table that sent the packet there. When a route points at an appliance address that no longer exists, traffic is dropped. A rebuild that changes an appliance IP needs every UDR updated.",
    why: "rt-spoke1's to-spoke2 route still sent traffic to 10.0.2.5, the old appliance address, where nothing answers, so it was dropped. With the next hop at 10.0.2.4, packets reach fw-hub and go on to vm-spoke2. rt-spoke2 already pointed at 10.0.2.4, so replies come back.",
    learn: [L("Next hop overview (Network Watcher)", "https://learn.microsoft.com/azure/network-watcher/next-hop-overview"), L("Virtual network traffic routing", "https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview")],
    flows: [{ from: "vm-spoke1", to: "vm-spoke2", port: 443, want: "open" }],
    solution: [`az network route-table route update ${G} --route-table-name rt-spoke1 --name to-spoke2 --next-hop-ip-address 10.0.2.4`],
  },
  {
    id: "wrong-side-of-the-glass", tier: "intermediate", stage: "Name resolution", title: "Storage returns 403 from a spoke",
    story: "The storage account stlogs01 has a private endpoint, pe-stlogs01, in vnet-hub at 10.0.3.4. A private endpoint gives the service a private IP inside your network, and its public name is meant to resolve to that IP. Public network access on stlogs01 is disabled, so anything that reaches it any other way is refused. VMs in the hub work fine. vm-spoke1 in the peered vnet-spoke1 gets 403 Forbidden from stlogs01.blob.core.windows.net. SSH to the VMs to look around, then fix it so vm-spoke1 uses the private endpoint.",
    fix: "vm-spoke1 gets 403 Forbidden from stlogs01.blob.core.windows.net.",
    concept: {
      heading: "Private endpoints and DNS",
      paragraphs: [
        "A private endpoint gives a service, like a storage account, a private IP inside your network, so traffic to it never leaves the private path.",
        "The name stays the same. stlogs01.blob.core.windows.net is a CNAME to stlogs01.privatelink.blob.core.windows.net, and a private DNS zone named privatelink.blob.core.windows.net holds the A record with the private IP.",
        "Asked from a network that can't see that zone, the same name resolves to the public endpoint. With public network access disabled, the service refuses that request.",
      ],
      facts: ["Same name, private IP, through a privatelink CNAME.", "The privatelink zone holds the A record.", "A public IP answer means the private zone wasn't used."],
    },
    setup: () => {
      const st = base();
      vnet(st, "vnet-spoke1", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24" } });
      vnet(st, "vnet-hub", ["10.0.0.0/16"], { "subnet-shared": { p: "10.0.1.0/24" }, "subnet-pe": { p: "10.0.3.0/24" } });
      host(st, "vm-spoke1", "vnet-spoke1", "subnet-app", "10.1.1.4");
      host(st, "vm-hub", "vnet-hub", "subnet-shared", "10.0.1.4");
      host(st, "pe-stlogs01", "vnet-hub", "subnet-pe", "10.0.3.4", { kind: "pe", ports: [443], label: "private endpoint" });
      peer(st, "vnet-hub", "vnet-spoke1"); peer(st, "vnet-spoke1", "vnet-hub");
      st.zones["privatelink.blob.core.windows.net"] = { records: { stlogs01: "10.0.3.4" }, links: { "link-hub": { vnet: "vnet-hub", reg: false } } };
      st.publicDns.cname["stlogs01.blob.core.windows.net"] = "stlogs01.privatelink.blob.core.windows.net";
      st.publicDns.a["stlogs01.privatelink.blob.core.windows.net"] = "203.0.113.10";
      st.publicEndpoints["203.0.113.10"] = { name: "stlogs01", publicAccess: false };
      return st;
    },
    objectives: [
      { text: "Make stlogs01.blob.core.windows.net resolve to 10.0.3.4 from vm-spoke1", test: ({ st }) => resolve(st, "vnet-spoke1", "stlogs01.blob.core.windows.net").ip === "10.0.3.4" },
      { text: "Get vm-spoke1 reaching the private endpoint on 443", test: ({ st }) => can(st, "vm-spoke1", "10.0.3.4", 443) },
      { text: "Turn auto-registration off on every link to the zone", test: ({ st }) => Object.values(st.zones["privatelink.blob.core.windows.net"].links).every((l) => !l.reg) },
    ],
    par: 1,
    hints: ["ssh vm-spoke1, then nslookup stlogs01.blob.core.windows.net. Type exit, then do the same from vm-hub and compare.", `Both lookups follow a CNAME to stlogs01.privatelink.blob.core.windows.net, but only vm-hub gets 10.0.3.4. Check which networks that private zone answers for: az network private-dns link vnet list ${G} --zone-name privatelink.blob.core.windows.net`, "The privatelink zone is linked to vnet-hub only, and peering doesn't share zone links. Link the zone to vnet-spoke1 too, with auto-registration off."],
    lesson: "A private endpoint name resolves through a public CNAME to the privatelink zone. If the private DNS zone isn't linked to the VNet doing the lookup, Azure DNS returns the public IP, and a service with public access disabled rejects the call. Peering moves packets but doesn't share DNS zones.",
    why: "vm-spoke1 followed the CNAME to the privatelink name, but the zone wasn't linked to vnet-spoke1, so it got stlogs01's public IP, which refuses calls. Linking the zone to vnet-spoke1 makes the name resolve to 10.0.3.4, and the traffic crosses the peering to pe-stlogs01.",
    learn: [L("Troubleshoot private endpoint DNS resolution failure", "https://learn.microsoft.com/troubleshoot/azure/private-link/troubleshoot-private-endpoint-dns-resolution"), L("Azure Private Endpoint DNS configuration", "https://learn.microsoft.com/azure/private-link/private-endpoint-dns"), L("az network private-dns link vnet create", "https://learn.microsoft.com/cli/azure/network/private-dns/link/vnet?view=azure-cli-latest")],
    flows: [{ from: "vm-spoke1", dns: "stlogs01.blob.core.windows.net", port: 443, expect: "pe-stlogs01", want: "open" }],
    solution: [`az network private-dns link vnet create ${G} --name link-spoke1 --zone-name privatelink.blob.core.windows.net --virtual-network vnet-spoke1 --registration-enabled false`],
  },
  {
    // Review: two stacked faults from earlier levels, a peering with access off (Spoke can't reach the hub after peering) and a NIC NSG (API blocked despite a subnet allow rule).
    id: "review-intermediate", tier: "intermediate", stage: "Review", title: "Review: spoke can't reach a hub API",
    story: "vm-spoke1 (10.1.1.4, in vnet-spoke1) needs the reporting API on vm-hub (10.0.1.4, in vnet-hub) on port 443. The peering between the two networks shows Connected, and nsg-shared on vm-hub's subnet already allows 443 from vnet-spoke1. It still fails. More than one thing is wrong. Working means 443 gets through while SSH (22) from vm-spoke1 stays closed.",
    fix: "vm-spoke1 can't reach the reporting API on vm-hub at 443.",
    setup: () => {
      const st = base();
      vnet(st, "vnet-spoke1", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24" } });
      vnet(st, "vnet-hub", ["10.0.0.0/16"], { "subnet-shared": { p: "10.0.1.0/24", nsg: "nsg-shared" } });
      host(st, "vm-spoke1", "vnet-spoke1", "subnet-app", "10.1.1.4");
      host(st, "vm-hub", "vnet-hub", "subnet-shared", "10.0.1.4", { ports: [22, 443], nicNsg: "nsg-vm-hub-nic" });
      peer(st, "vnet-hub", "vnet-spoke1"); peer(st, "vnet-spoke1", "vnet-hub", { access: false });
      rule(st, "nsg-shared", { name: "Allow-Reports-Spoke1", priority: 300, direction: "Inbound", access: "Allow", protocol: "Tcp", src: ["10.1.0.0/16"], dst: ["*"], ports: ["443"] });
      rule(st, "nsg-shared", { name: "Deny-Vnet-Inbound", priority: 4000, direction: "Inbound", access: "Deny", protocol: "*", src: ["VirtualNetwork"], dst: ["*"], ports: ["*"] });
      rule(st, "nsg-vm-hub-nic", { name: "Deny-Vnet-Inbound", priority: 4000, direction: "Inbound", access: "Deny", protocol: "*", src: ["VirtualNetwork"], dst: ["*"], ports: ["*"] });
      return st;
    },
    objectives: [
      { text: "Get vm-spoke1 reaching vm-hub on 443", test: ({ st }) => can(st, "vm-spoke1", "10.0.1.4", 443) },
      { text: "Keep SSH (22) from vm-spoke1 to vm-hub blocked", test: ({ st }) => !can(st, "vm-spoke1", "10.0.1.4", 22) },
    ],
    par: 2,
    hints: [
      `Start with the peering, from both sides: az network vnet peering list ${G} --vnet-name vnet-spoke1 -o table`,
      `Connected only means both links exist. Read every column of spoke1's link, not just the state. Then check everything that filters vm-hub: az network nic list-effective-nsg ${G} --name vm-hub-nic`,
      "spoke1-to-hub has VNet access turned off, so the peering carries nothing. And nsg-vm-hub-nic on vm-hub's NIC has no allow for 443 ahead of its deny at 4000. Fix both.",
    ],
    lesson: "Faults stack. A Connected peering carries no traffic while virtual network access is off, and inbound traffic has to pass the subnet NSG and then the NIC NSG. Fix one layer, test again, then look at the next.",
    why: "spoke1-to-hub had VNet access off, so the Connected peering carried nothing. Once it was on, 443 passed nsg-shared but hit Deny-Vnet-Inbound in nsg-vm-hub-nic. An allow for 443 from vnet-spoke1 in the NIC's NSG gets it through both, and 22 still has no allow.",
    learn: [
      L("Create, change, or delete a virtual network peering", "https://learn.microsoft.com/azure/virtual-network/virtual-network-manage-peering"),
      L("Troubleshoot NSG misconfigurations: subnet and NIC interaction", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-nsg-blocking-traffic"),
      L("Troubleshoot virtual network peering problems", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-peering-issues"),
    ],
    flows: [{ from: "vm-spoke1", to: "vm-hub", port: 443, want: "open" }, { from: "vm-spoke1", to: "vm-hub", port: 22, want: "closed" }],
    solution: [
      `az network vnet peering update ${G} --name spoke1-to-hub --vnet-name vnet-spoke1 --allow-vnet-access true`,
      `az network nsg rule create ${G} --nsg-name nsg-vm-hub-nic --name Allow-Reports-Spoke1 --priority 300 --direction Inbound --access Allow --protocol Tcp --source-address-prefixes 10.1.0.0/16 --destination-port-ranges 443`,
    ],
  },
];
