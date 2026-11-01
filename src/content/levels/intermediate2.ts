// More Intermediate levels: one real break/fix issue each. You get the symptom and the tools, not the command.
import { base, can, host, looksUp, peer, rule, vnet } from "../build";
import { reach } from "@/sim/network";
import type { State } from "@/sim/types";
import type { Level } from "../types";

const L = (title: string, url: string) => ({ title, url });
const G = "-g rg-lab";

/** Hub and two spokes, routed through fw-hub. Callers break one thing. */
function hubSpoke(o: { fwd?: boolean; forwarding?: boolean; extraSpoke1?: { name: string; prefix: string; type: "None" | "VirtualAppliance"; nhIp?: string } } = {}): State {
  const st = base();
  vnet(st, "vnet-spoke1", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24", rt: "rt-spoke1" } });
  vnet(st, "vnet-hub", ["10.0.0.0/16"], { "subnet-fw": { p: "10.0.2.0/24" } });
  vnet(st, "vnet-spoke2", ["10.2.0.0/16"], { "subnet-app": { p: "10.2.1.0/24", rt: "rt-spoke2" } });
  host(st, "vm-spoke1", "vnet-spoke1", "subnet-app", "10.1.1.4");
  host(st, "fw-hub", "vnet-hub", "subnet-fw", "10.0.2.4", { kind: "nva", forwarding: o.forwarding !== false, label: "NVA" });
  host(st, "vm-spoke2", "vnet-spoke2", "subnet-app", "10.2.1.4", { ports: [22, 443] });
  const fwd = o.fwd !== false;
  peer(st, "vnet-hub", "vnet-spoke1", { fwd }); peer(st, "vnet-spoke1", "vnet-hub", { fwd });
  peer(st, "vnet-hub", "vnet-spoke2", { fwd }); peer(st, "vnet-spoke2", "vnet-hub", { fwd });
  st.rts["rt-spoke1"] = { routes: [{ name: "to-spoke2", prefix: "10.2.0.0/16", type: "VirtualAppliance", nhIp: "10.0.2.4" }] };
  if (o.extraSpoke1) st.rts["rt-spoke1"].routes.push({ name: o.extraSpoke1.name, prefix: o.extraSpoke1.prefix, type: o.extraSpoke1.type, nhIp: o.extraSpoke1.nhIp });
  st.rts["rt-spoke2"] = { routes: [{ name: "to-spoke1", prefix: "10.1.0.0/16", type: "VirtualAppliance", nhIp: "10.0.2.4" }] };
  return st;
}
const viaFw = (st: State) => { const r = reach(st, "vm-spoke1", "10.2.1.4", 443); return r.ok && r.via.includes("fw-hub"); };
const HUB_LEARN = [
  L("Hub-and-spoke network topology: spoke-to-spoke traffic", "https://learn.microsoft.com/azure/networking/design-guide/hub-spoke#spoke-to-spoke-communication-patterns"),
  L("Virtual network traffic routing", "https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview"),
];

export const intermediateMore: Level[] = [
  {
    id: "outbound-surprise", tier: "intermediate", stage: "Traffic filtering", title: "App can't reach its database",
    story: "The app on vm-api (10.1.2.4, in subnet-api) stores its data in SQL Server on vm-db (10.1.3.4, in subnet-db), port 1433. Today it can't connect. The DBA swears nothing changed on the database side, and subnet-db has no NSG at all. Someone did tighten security on vm-api last week. Working means 1433 connects while vm-api still can't SSH (22) to vm-db.",
    fix: "vm-api can't reach the database on vm-db at 1433.",
    setup: () => {
      const st = base();
      vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-api": { p: "10.1.2.0/24" }, "subnet-db": { p: "10.1.3.0/24" } });
      host(st, "vm-api", "vnet-app", "subnet-api", "10.1.2.4", { nicNsg: "nsg-vm-api-nic" });
      host(st, "vm-db", "vnet-app", "subnet-db", "10.1.3.4", { ports: [22, 1433] });
      rule(st, "nsg-vm-api-nic", { name: "Allow-HTTPS-Out", priority: 200, direction: "Outbound", access: "Allow", protocol: "Tcp", src: ["*"], dst: ["*"], ports: ["443"] });
      rule(st, "nsg-vm-api-nic", { name: "Deny-All-Outbound", priority: 4000, direction: "Outbound", access: "Deny", protocol: "*", src: ["*"], dst: ["*"], ports: ["*"] });
      return st;
    },
    objectives: [
      { text: "Get vm-api reaching vm-db on 1433", test: ({ st }) => can(st, "vm-api", "10.1.3.4", 1433) },
      { text: "Keep SSH (22) from vm-api to vm-db blocked", test: ({ st }) => !can(st, "vm-api", "10.1.3.4", 22) },
    ],
    par: 1,
    hints: [`Inbound looks clean, so look at what leaves vm-api: az network nic list-effective-nsg ${G} --name vm-api-nic`, "Read the Outbound rules in order, lowest number first. Which one is the first to match TCP 1433 going to 10.1.3.4?", "nsg-vm-api-nic only allows 443 out, so Deny-All-Outbound at 4000 catches 1433 before it leaves vm-api. Add an outbound allow for 1433 to subnet-db in that NSG, below 4000."],
    lesson: "When the destination looks open, check the source. Outbound rules on the source's NIC are checked first, and a broad deny there blocks traffic no matter what the other side allows.",
    why: "Outbound traffic is checked against the sender's NSGs before it leaves. nsg-vm-api-nic allowed only 443, so Deny-All-Outbound at 4000 dropped 1433 at vm-api. An outbound allow for 1433 to subnet-db, at a lower number, matches first. Nothing allows 22 out.",
    learn: [L("How network security groups filter network traffic: outbound", "https://learn.microsoft.com/azure/virtual-network/network-security-group-how-it-works#outbound-traffic"), L("Troubleshoot NSG misconfigurations", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-nsg-blocking-traffic")],
    flows: [{ from: "vm-api", to: "vm-db", port: 1433, want: "open" }, { from: "vm-api", to: "vm-db", port: 22, want: "closed" }],
    solution: [`az network nsg rule create ${G} --nsg-name nsg-vm-api-nic --name Allow-SQL-Out --priority 300 --direction Outbound --access Allow --protocol Tcp --destination-address-prefixes 10.1.3.0/24 --destination-port-ranges 1433`],
  },
  {
    id: "wrong-tag", tier: "intermediate", stage: "Traffic filtering", title: "Peered partner can't reach the web app",
    story: "vm-web (10.1.1.4) in vnet-app hosts an HTTPS site for a partner team. Their vm-partner (10.5.1.4) sits in vnet-partner, which is peered with vnet-app. They still can't load the site. There's an allow rule for them in nsg-web, so it should work. Working means vm-partner gets in on 443 while SSH (22) stays closed.",
    fix: "vm-partner can't load the HTTPS site on vm-web.",
    setup: () => {
      const st = base();
      vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-web": { p: "10.1.1.0/24", nsg: "nsg-web" } });
      vnet(st, "vnet-partner", ["10.5.0.0/16"], { "subnet-app": { p: "10.5.1.0/24" } });
      host(st, "vm-web", "vnet-app", "subnet-web", "10.1.1.4", { ports: [22, 443] });
      host(st, "vm-partner", "vnet-partner", "subnet-app", "10.5.1.4");
      peer(st, "vnet-app", "vnet-partner"); peer(st, "vnet-partner", "vnet-app");
      rule(st, "nsg-web", { name: "Allow-Partner-HTTPS", priority: 200, direction: "Inbound", access: "Allow", protocol: "Tcp", src: ["Internet"], dst: ["*"], ports: ["443"] });
      rule(st, "nsg-web", { name: "Deny-All-Inbound", priority: 4000, direction: "Inbound", access: "Deny", protocol: "*", src: ["*"], dst: ["*"], ports: ["*"] });
      return st;
    },
    objectives: [
      { text: "Get vm-partner reaching vm-web on 443", test: ({ st }) => can(st, "vm-partner", "10.1.1.4", 443) },
      { text: "Keep SSH (22) from vm-partner to vm-web blocked", test: ({ st }) => !can(st, "vm-partner", "10.1.1.4", 22) },
    ],
    par: 1,
    hints: [`Ask Network Watcher which rule decides: az network watcher test-ip-flow ${G} --vm vm-web --direction Inbound --protocol TCP --local 10.1.1.4:443 --remote 10.5.1.4:*`, "It names Deny-All-Inbound, so the partner allow didn't match. Read Allow-Partner-HTTPS closely, especially its source, and ask whether 10.5.1.4 is in it.", "Allow-Partner-HTTPS has the source Internet. Traffic from a peered network counts as VirtualNetwork, never Internet. Change the rule's source to vnet-partner's range."],
    lesson: "Internet means addresses outside your virtual network that are reachable from the public internet. Traffic from a peered network matches VirtualNetwork or its own range, never Internet, so a rule using the wrong tag silently never matches.",
    why: "Allow-Partner-HTTPS had the source Internet, and traffic from the peered vnet-partner never matches that tag, so it fell through to Deny-All-Inbound. Two fixes work: a source of just the partner, like 10.5.1.4 or 10.5.0.0/16, or the VirtualNetwork service tag. The partner's range is tighter, because VirtualNetwork also covers every other peered network. Either way the allow matches 443, and port 22 still hits the deny.",
    learn: [L("Troubleshoot NSG misconfigurations: common mistakes", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-nsg-blocking-traffic#common-nsg-misconfigurations"), L("Virtual network service tags", "https://learn.microsoft.com/azure/virtual-network/service-tags-overview#available-service-tags")],
    flows: [{ from: "vm-partner", to: "vm-web", port: 443, want: "open" }, { from: "vm-partner", to: "vm-web", port: 22, want: "closed" }],
    solution: [`az network nsg rule update ${G} --nsg-name nsg-web --name Allow-Partner-HTTPS --source-address-prefixes 10.5.0.0/16`],
  },
  {
    id: "grew-apart", tier: "intermediate", stage: "Peering", title: "Hub can't reach a new subnet in a spoke",
    story: "vnet-spoke1 is peered with vnet-hub. It ran out of room, so last week someone added the range 10.11.0.0/16 to it and built subnet-new, with vm-new (10.11.1.4) running a new service on 443. vm-hub (10.0.1.4) calls that service, but can't reach vm-new at all. vm-spoke1 (10.1.1.4) in the old range still works with the hub, and the peering shows Connected on both sides. Working means vm-hub reaches both VMs on 443.",
    fix: "vm-hub can't reach vm-new on 443, though vm-spoke1 still works.",
    setup: () => {
      const st = base();
      vnet(st, "vnet-hub", ["10.0.0.0/16"], { "subnet-shared": { p: "10.0.1.0/24" } });
      vnet(st, "vnet-spoke1", ["10.1.0.0/16", "10.11.0.0/16"], { "subnet-app": { p: "10.1.1.0/24" }, "subnet-new": { p: "10.11.1.0/24" } });
      host(st, "vm-hub", "vnet-hub", "subnet-shared", "10.0.1.4");
      host(st, "vm-spoke1", "vnet-spoke1", "subnet-app", "10.1.1.4", { ports: [22, 443] });
      host(st, "vm-new", "vnet-spoke1", "subnet-new", "10.11.1.4", { ports: [22, 443] });
      peer(st, "vnet-hub", "vnet-spoke1"); peer(st, "vnet-spoke1", "vnet-hub");
      st.peerings["vnet-hub/hub-to-spoke1"].remotePrefixes = ["10.1.0.0/16"];
      return st;
    },
    objectives: [
      { text: "Get vm-hub reaching vm-new on 443", test: ({ st }) => can(st, "vm-hub", "10.11.1.4", 443) },
      { text: "Keep vm-hub reaching vm-spoke1 on 443", test: ({ st }) => can(st, "vm-hub", "10.1.1.4", 443) },
    ],
    par: 1,
    hints: [`Compare what each side thinks the other owns: az network vnet peering show ${G} --vnet-name vnet-hub --name hub-to-spoke1 --query remoteAddressSpace`, `The hub's link lists only 10.1.0.0/16. Compare it with what vnet-spoke1 really has: az network vnet show ${G} --name vnet-spoke1 --query addressSpace.addressPrefixes`, "The hub's peering hasn't picked up the new 10.11.0.0/16 range. After a peered network grows, the link on the other side has to be synced. Sync hub-to-spoke1."],
    lesson: "Adding address space to a peered VNet isn't finished until the peering is synced on the other side. Until then the remote VNet still routes only to the old ranges, so the new subnet is unreachable from it.",
    why: "hub-to-spoke1 still listed only 10.1.0.0/16 for vnet-spoke1, so vnet-hub had no route to the new 10.11.0.0/16. Syncing the hub's link pulls in the new range, the route appears, and vm-hub reaches vm-new.",
    learn: [L("Update the address space for a peered virtual network: add a range", "https://learn.microsoft.com/azure/virtual-network/update-virtual-network-peering-address-space#add-an-address-range"), L("Troubleshoot peering sync failures", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-peering-issues#troubleshoot-peering-sync-failures"), L("az network vnet peering sync", "https://learn.microsoft.com/cli/azure/network/vnet/peering#az-network-vnet-peering-sync")],
    flows: [{ from: "vm-hub", to: "vm-new", port: 443, want: "open" }],
    solution: [`az network vnet peering sync ${G} --vnet-name vnet-hub --name hub-to-spoke1`],
  },
  {
    id: "more-specific", tier: "intermediate", stage: "Routing", title: "Spoke-to-spoke down after maintenance",
    story: "Spoke-to-spoke traffic goes through the appliance fw-hub (10.0.2.4) in vnet-hub, and it worked until a maintenance window last night. Now vm-spoke1 (10.1.1.4) can't reach vm-spoke2 (10.2.1.4) on 443, even though rt-spoke1 still has its route to spoke2 through fw-hub. Working means 443 flows again, through fw-hub.",
    fix: "vm-spoke1 can't reach vm-spoke2 on 443 since last night's maintenance.",
    setup: () => hubSpoke({ extraSpoke1: { name: "maint-block", prefix: "10.2.1.0/24", type: "None" } }),
    objectives: [
      { text: "Get vm-spoke1 reaching vm-spoke2 on 443", test: ({ st }) => can(st, "vm-spoke1", "10.2.1.4", 443) },
      { text: "Send that traffic through fw-hub", test: ({ st }) => viaFw(st) },
    ],
    par: 1,
    hints: [`Look at every route that could match 10.2.1.4: az network nic show-effective-route-table ${G} --name vm-spoke1-nic -o table`, "More than one route contains 10.2.1.4. Note each one's prefix length and next hop. Azure picks the longest prefix, not the oldest route.", "maint-block in rt-spoke1 is a /24 with next hop None, and it beats the /16 to fw-hub. Point it at fw-hub, or remove it."],
    lesson: "The most specific route wins. A narrow route left behind after maintenance can quietly override the broad route you're looking at, so always check which route actually matches the destination.",
    why: "Azure picks the longest matching prefix, so maint-block (10.2.1.0/24, next hop None) beat to-spoke2 (10.2.0.0/16) and dropped the traffic. Once that /24 stops dropping it, traffic to 10.2.1.4 goes to fw-hub at 10.0.2.4 and on to vm-spoke2.",
    learn: [L("How Azure selects a route", "https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview#how-azure-selects-routes-for-traffic-routing"), L("Diagnose a VM routing problem", "https://learn.microsoft.com/azure/virtual-network/diagnose-network-routing-problem")],
    flows: [{ from: "vm-spoke1", to: "vm-spoke2", port: 443, want: "open" }],
    solution: [`az network route-table route update ${G} --route-table-name rt-spoke1 --name maint-block --next-hop-type VirtualAppliance --next-hop-ip-address 10.0.2.4`],
  },
  {
    id: "not-forwarding", tier: "intermediate", stage: "Routing", title: "Spoke-to-spoke down after the appliance was reimaged",
    story: "fw-hub (10.0.2.4) is the appliance in vnet-hub that passes spoke-to-spoke traffic along. It was rebuilt from a fresh image over the weekend. The OS on it is set to forward traffic, and the routes in both spokes still point at 10.0.2.4. Spoke-to-spoke traffic is dead anyway. Working means vm-spoke1 (10.1.1.4) reaches vm-spoke2 (10.2.1.4) on 443, through fw-hub.",
    fix: "Spoke-to-spoke traffic through fw-hub is dead after the rebuild.",
    setup: () => hubSpoke({ forwarding: false }),
    objectives: [
      { text: "Get vm-spoke1 reaching vm-spoke2 on 443", test: ({ st }) => can(st, "vm-spoke1", "10.2.1.4", 443) },
      { text: "Send that traffic through fw-hub", test: ({ st }) => viaFw(st) },
    ],
    par: 1,
    hints: [`Confirm the path first: az network watcher show-next-hop ${G} --vm vm-spoke1 --source-ip 10.1.1.4 --dest-ip 10.2.1.4. If it lands on fw-hub, look at the appliance's own NIC: az network nic show ${G} --name fw-hub-nic`, "Find enableIPForwarding in the NIC's settings. Azure hands a NIC only packets addressed to it, unless that setting is on. The OS setting is a separate switch.", "IP forwarding is off on fw-hub-nic, so Azure drops every packet fw-hub is meant to pass on. Turn it on for the NIC."],
    lesson: "An appliance needs IP forwarding in two places: in its operating system, and on its Azure NIC. The NIC setting is off by default, and without it Azure drops every packet that isn't addressed to the appliance itself.",
    why: "The routes delivered traffic to fw-hub, but its Azure NIC had IP forwarding off, so Azure dropped every packet not addressed to fw-hub itself. With it on for fw-hub-nic, fw-hub can pass vm-spoke1's traffic on to vm-spoke2 and carry the replies back.",
    learn: [L("Network interface: enable or disable IP forwarding", "https://learn.microsoft.com/azure/virtual-network/virtual-network-network-interface#enable-or-disable-ip-forwarding"), L("Hybrid connection with two-tier application: IP forwarding", "https://learn.microsoft.com/azure/virtual-network/virtual-network-scenario-udr-gw-nva#ip-forwarding"), ...HUB_LEARN],
    flows: [{ from: "vm-spoke1", to: "vm-spoke2", port: 443, want: "open" }],
    solution: [`az network nic update ${G} --name fw-hub-nic --ip-forwarding true`],
  },
  {
    id: "forwarded-flag", tier: "intermediate", stage: "Peering", title: "Spoke-to-spoke fails through a new hub",
    story: "A new vnet-hub, with the appliance fw-hub at 10.0.2.4, was peered to both spokes last week, and the spoke route tables send spoke-to-spoke traffic to fw-hub. Each spoke can talk to the hub itself, but vm-spoke1 (10.1.1.4) can't reach vm-spoke2 (10.2.1.4) on 443 through fw-hub. Working means that traffic flows through fw-hub, without peering the spokes to each other.",
    fix: "vm-spoke1 can't reach vm-spoke2 on 443 through fw-hub.",
    setup: () => hubSpoke({ fwd: false }),
    objectives: [
      { text: "Get vm-spoke1 reaching vm-spoke2 on 443", test: ({ st }) => can(st, "vm-spoke1", "10.2.1.4", 443) },
      { text: "Send that traffic through fw-hub", test: ({ st }) => viaFw(st) },
      { text: "Don't peer the spokes directly", test: ({ st }) => !Object.values(st.peerings).some((p) => p.vnet.includes("spoke") && p.remote.includes("spoke")) },
    ],
    par: 2,
    hints: [`Check the peering settings on the spokes: az network vnet peering list ${G} --vnet-name vnet-spoke2 -o table`, "Read the AllowForwardedTraffic column, on both spokes. Traffic fw-hub passes on from vm-spoke1 didn't start in the hub.", "Neither spoke's link to the hub allows forwarded traffic, so each spoke drops what fw-hub passes on. Turn it on for spoke2-to-hub (the request) and spoke1-to-hub (the reply)."],
    lesson: "Allow forwarded traffic is off by default. Without it, a spoke accepts traffic that started in the hub but drops traffic an appliance in the hub forwarded from somewhere else. Both spokes need it, one for the request and one for the reply.",
    why: "Traffic that fw-hub passes on didn't start in vnet-hub, and a spoke link with allow forwarded traffic off drops it. Turning it on for spoke2-to-hub lets the request into vnet-spoke2, and on spoke1-to-hub lets the reply back into vnet-spoke1.",
    learn: [L("Create, change, or delete a virtual network peering: settings", "https://learn.microsoft.com/azure/virtual-network/virtual-network-manage-peering#create-a-virtual-network-peering"), ...HUB_LEARN],
    flows: [{ from: "vm-spoke1", to: "vm-spoke2", port: 443, want: "open" }],
    solution: [`az network vnet peering update ${G} --vnet-name vnet-spoke2 --name spoke2-to-hub --allow-forwarded-traffic true`, `az network vnet peering update ${G} --vnet-name vnet-spoke1 --name spoke1-to-hub --allow-forwarded-traffic true`],
  },
  {
    id: "missing-record", tier: "intermediate", stage: "Name resolution", title: "Private endpoint name doesn't resolve",
    story: "A second storage account, stlogs02, got its own private endpoint, pe-stlogs02, in vnet-hub at 10.0.3.5, next to stlogs01's at 10.0.3.4. Public network access is disabled on both. From vm-spoke1 in the peered vnet-spoke1, stlogs01 works fine, but stlogs02.blob.core.windows.net doesn't resolve at all. The privatelink.blob.core.windows.net zone is linked to both networks. Working means the stlogs02 name gives vm-spoke1 its private IP.",
    fix: "stlogs02.blob.core.windows.net doesn't resolve from vm-spoke1.",
    setup: () => {
      const st = base();
      vnet(st, "vnet-spoke1", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24" } });
      vnet(st, "vnet-hub", ["10.0.0.0/16"], { "subnet-pe": { p: "10.0.3.0/24" } });
      host(st, "vm-spoke1", "vnet-spoke1", "subnet-app", "10.1.1.4");
      host(st, "pe-stlogs01", "vnet-hub", "subnet-pe", "10.0.3.4", { kind: "pe", ports: [443], label: "private endpoint" });
      host(st, "pe-stlogs02", "vnet-hub", "subnet-pe", "10.0.3.5", { kind: "pe", ports: [443], label: "private endpoint" });
      peer(st, "vnet-hub", "vnet-spoke1"); peer(st, "vnet-spoke1", "vnet-hub");
      st.zones["privatelink.blob.core.windows.net"] = { records: { stlogs01: "10.0.3.4" }, links: { "link-hub": { vnet: "vnet-hub", reg: false }, "link-spoke1": { vnet: "vnet-spoke1", reg: false } } };
      for (const [n, ip] of [["stlogs01", "203.0.113.10"], ["stlogs02", "203.0.113.11"]]) {
        st.publicDns.cname[`${n}.blob.core.windows.net`] = `${n}.privatelink.blob.core.windows.net`;
        st.publicDns.a[`${n}.privatelink.blob.core.windows.net`] = ip;
        st.publicEndpoints[ip] = { name: n, publicAccess: false };
      }
      return st;
    },
    objectives: [
      { text: "Make stlogs02.blob.core.windows.net resolve to 10.0.3.5 from vm-spoke1", test: ({ st }) => looksUp(st, "vm-spoke1", "stlogs02.blob.core.windows.net") === "10.0.3.5" },
      { text: "Keep stlogs01 resolving to 10.0.3.4", test: ({ st }) => looksUp(st, "vm-spoke1", "stlogs01.blob.core.windows.net") === "10.0.3.4" },
    ],
    par: 1,
    hints: ["ssh vm-spoke1, then nslookup both names and compare the answers. Type exit when done.", `stlogs02 follows its CNAME to the privatelink name, then gets NXDOMAIN, which means "no such name". The linked zone was asked and had no answer. List what the zone holds: az network private-dns record-set a list ${G} --zone-name privatelink.blob.core.windows.net -o table`, "The zone has an A record for stlogs01 but none for stlogs02. Add one for stlogs02 pointing at its private endpoint's IP."],
    lesson: "A private endpoint needs an A record in the privatelink zone. When the record is missing, the zone is still consulted, so the name comes back NXDOMAIN instead of the private IP.",
    why: "The lookup followed the CNAME to stlogs02.privatelink.blob.core.windows.net, and the linked zone had no record by that name, so it said NXDOMAIN. An A record for stlogs02 at 10.0.3.5 gives the name its private IP, and vm-spoke1 reaches pe-stlogs02 over the peering.",
    learn: [L("Troubleshoot private endpoint DNS resolution", "https://learn.microsoft.com/troubleshoot/azure/private-link/troubleshoot-private-endpoint-dns-resolution"), L("Azure Private Endpoint DNS integration", "https://learn.microsoft.com/azure/private-link/private-endpoint-dns-integration")],
    flows: [{ from: "vm-spoke1", dns: "stlogs02.blob.core.windows.net", port: 443, expect: "pe-stlogs02", want: "open" }],
    solution: [`az network private-dns record-set a add-record ${G} --zone-name privatelink.blob.core.windows.net --record-set-name stlogs02 --ipv4-address 10.0.3.5`],
  },
];

/** The tool to reach for first on the opening Intermediate levels. They fade out after these five. */
export const STARTER_TOOL: Record<string, string> = {
  "first-match-wins": "IP flow verify on vm-web (Diagnose tab, or az network watcher test-ip-flow). It names the rule that decides.",
  "two-locks": "Effective security rules on vm-api's NIC (Diagnose tab, or az network nic list-effective-nsg). It shows both NSGs in order.",
  "outbound-surprise": "Effective security rules on the VM that's sending (az network nic list-effective-nsg). Outbound is checked there first.",
  "wrong-tag": "IP flow verify on vm-web, inbound from the partner's address. Then read the rule it names.",
  "half-a-handshake": "The peering list on both sides (az network vnet peering list). Look at each link's state.",
};

/** Why questions added to Intermediate levels, so each fix ends with the idea behind it. Facts come from each level's own Learn pages. */
export const INTERMEDIATE_WHY: Record<string, { q: string; accept: string[] }> = {
  "first-match-wins": { q: "A deny at priority 200 and an allow at 300 both match. Which priority decides?", accept: ["200", "the deny", "deny", "deny at 200"] },
  "two-locks": { q: "Inbound to a VM, which NSG is checked first: the subnet's or the NIC's?", accept: ["subnet", "the subnet", "subnet's", "the subnet's", "subnet nsg"] },
  "outbound-surprise": { q: "Outbound from a VM, which NSG is checked first: the subnet's or the NIC's?", accept: ["nic", "the nic", "nic's", "the nic's", "nic nsg"] },
  "wrong-tag": { q: "Does traffic from a peered VNet match the Internet service tag? (yes or no)", accept: ["no", "n"] },
  "half-a-handshake": { q: "How many peering links does one working peering between two VNets need?", accept: ["2", "two"] },
  "overlap": { q: "Can two VNets with overlapping address spaces be peered? (yes or no)", accept: ["no", "n"] },
  "grew-apart": { q: "After adding address space to a peered VNet, which peering command updates the other side?", accept: ["sync", "peering sync", "az network vnet peering sync"] },
  "spokes-dont-talk": { q: "Is VNet peering transitive? (yes or no)", accept: ["no", "n"] },
  "ghost-next-hop": { q: "A route's next hop IP has nothing at that address. What happens to the traffic?", accept: ["dropped", "it's dropped", "it is dropped", "drop", "it gets dropped"] },
  "more-specific": { q: "Routes for 10.2.0.0/16 and 10.2.1.0/24 both match. Which prefix wins?", accept: ["10.2.1.0/24", "/24", "the /24", "24"] },
  "not-forwarding": { q: "Besides the appliance's operating system, where must IP forwarding be on?", accept: ["nic", "the nic", "its nic", "azure nic", "the azure nic", "network interface", "the network interface"] },
  "forwarded-flag": { q: "Is allow forwarded traffic on or off by default?", accept: ["off", "disabled", "false"] },
  "wrong-side-of-the-glass": { q: "Does peering share a private DNS zone's link with the other VNet? (yes or no)", accept: ["no", "n"] },
  "missing-record": { q: "The privatelink zone is linked but has no record for the account. What does the lookup return?", accept: ["NXDOMAIN"] },
};
