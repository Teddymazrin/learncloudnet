// Advanced, part three. Inside the VM: the guest OS firewall and the app itself, which Azure's
// network tools can't see. Plus review levels that bring older topics back as one fault each.
// Facts come from the linked Microsoft Learn pages.
import { ask, base, can, host, lb, linuxVm, looksUp, rule, site, storage, ufwOn, vnet } from "../build";
import { probeOk, reach } from "@/sim/network";
import type { State } from "@/sim/types";
import type { Level } from "../types";
import { hybrid, nvaHub } from "./advanced";

const L = (title: string, url: string) => ({ title, url });
const G = "-g rg-lab";
const RUN = (vm: string, script: string) => `az vm run-command invoke ${G} -n ${vm} --command-id RunShellScript --scripts "${script}"`;
const through = (st: State, from: string, ip: string, port: number, via: string) => { const r = reach(st, from, ip, port); return r.ok && r.via.includes(via); };
const egressVia = (st: State, from: string, ip: string, nat: string) => { const r = reach(st, from, ip, 443); return r.ok && !!r.egress?.includes(nat); };
const noSpokePeering = (st: State) => !Object.values(st.peerings).some((p) => p.vnet.includes("spoke") && p.remote.includes("spoke"));
const healthy = (st: State, lbName: string, vm: string) => probeOk(st, st.lbs![lbName], vm);

export const LEARN_GUEST = {
  ufw: L("Use UFW to troubleshoot connectivity issues in Azure Ubuntu VMs", "https://learn.microsoft.com/troubleshoot/azure/virtual-machines/linux/ubuntu-ufw-guide"),
  runCmd: L("Run scripts in your Linux VM by using action Run Commands", "https://learn.microsoft.com/azure/virtual-machines/linux/run-command"),
  connTs: L("Connection troubleshoot overview: fault types", "https://learn.microsoft.com/azure/network-watcher/connection-troubleshoot-overview#fault-types"),
  vmSteps: L("Troubleshoot connectivity problems between Azure VMs", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-connectivity-problem-between-vms#troubleshooting-steps"),
  noDisable: L("Troubleshoot Azure VM connectivity problems: guest OS firewall", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/troubleshoot-vm-connectivity#resolution"),
  probeA: L("Troubleshoot health probe failures: application not listening", "https://learn.microsoft.com/troubleshoot/azure/load-balancer/troubleshoot-load-balancer-health-probe-failures#resolution-a"),
  probeFw: L("Troubleshoot health probe status: firewall or NSG blocking the port", "https://learn.microsoft.com/troubleshoot/azure/load-balancer/load-balancer-troubleshoot-health-probe-status"),
};
const LEARN = {
  ...LEARN_GUEST,
  transit: L("Configure VPN gateway transit for virtual network peering", "https://learn.microsoft.com/azure/vpn-gateway/vpn-gateway-peering-gateway-transit"),
  nsg: L("Troubleshoot NSG misconfigurations: rule order", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-nsg-blocking-traffic"),
  udr: L("Virtual network traffic routing: how Azure selects a route", "https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview#how-azure-selects-a-route"),
  peering: L("Create, change, or delete a virtual network peering", "https://learn.microsoft.com/azure/virtual-network/virtual-network-manage-peering"),
  se: L("Virtual network service endpoints", "https://learn.microsoft.com/azure/virtual-network/virtual-network-service-endpoints-overview"),
  dnsServers: L("Change DNS servers of a virtual network", "https://learn.microsoft.com/azure/virtual-network/manage-virtual-network#change-dns-servers-of-a-virtual-network-using-the-azure-cli"),
  zone: L("What is an Azure private DNS zone?", "https://learn.microsoft.com/azure/dns/private-dns-privatednszone"),
  nat: L("What is Azure NAT Gateway?", "https://learn.microsoft.com/azure/nat-gateway/nat-overview#azure-nat-gateway-basics"),
  outboundNsg: L("How network security groups filter network traffic: outbound", "https://learn.microsoft.com/azure/virtual-network/network-security-group-how-it-works#outbound-traffic"),
  probe: L("Azure Load Balancer health probes: probe source IP", "https://learn.microsoft.com/azure/load-balancer/load-balancer-custom-probe-overview#probe-source-ip-address"),
};

/** A web VM behind nothing, reached from a client subnet. No NSGs: only the VM itself can be at fault. */
function guestLab(): State {
  const st = base();
  vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-web": { p: "10.1.1.0/24" }, "subnet-client": { p: "10.1.2.0/24" }, "subnet-admin": { p: "10.1.9.0/24" } });
  linuxVm(st, "vm-web", "vnet-app", "subnet-web", "10.1.1.4", { services: { nginx: 443 }, stopped: ["nginx"], ufw: [[22, "10.1.9.0/24"]] });
  host(st, "vm-client", "vnet-app", "subnet-client", "10.1.2.4");
  host(st, "vm-admin", "vnet-app", "subnet-admin", "10.1.9.4");
  return st;
}

/** Two Linux web backends behind an internal load balancer. The NSG is right; the VMs are not. */
function webPool(): State {
  const st = base();
  vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-web": { p: "10.1.1.0/24", nsg: "nsg-web" }, "subnet-client": { p: "10.1.2.0/24" } });
  const ufw: [number, string][] = [[443, "10.1.2.0/24"], [22, "10.1.9.0/24"]];
  linuxVm(st, "vm-web1", "vnet-app", "subnet-web", "10.1.1.4", { services: { nginx: 443 }, ufw });
  linuxVm(st, "vm-web2", "vnet-app", "subnet-web", "10.1.1.5", { services: { nginx: 443 }, stopped: ["nginx"], ufw });
  host(st, "vm-client", "vnet-app", "subnet-client", "10.1.2.4");
  lb(st, "lb-app", "vnet-app", "subnet-web", "10.1.1.10", { probePort: 443, port: 443, backends: ["vm-web1", "vm-web2"] });
  rule(st, "nsg-web", { name: "Allow-HTTPS-Clients", priority: 200, direction: "Inbound", access: "Allow", protocol: "Tcp", src: ["10.1.2.0/24"], dst: ["*"], ports: ["443"] });
  rule(st, "nsg-web", { name: "Allow-LB-Probe", priority: 300, direction: "Inbound", access: "Allow", protocol: "Tcp", src: ["AzureLoadBalancer"], dst: ["*"], ports: ["443"] });
  rule(st, "nsg-web", { name: "Deny-All-Inbound", priority: 4000, direction: "Inbound", access: "Deny", protocol: "*", src: ["*"], dst: ["*"], ports: ["*"] });
  return st;
}

export const advancedGuest: Level[] = [
  {
    forms: { fix: "free", diagnose: true, only: ["vm-run-"] },
    id: "intro-guest", tier: "advanced", stage: "Inside the VM", title: "Check the VM's own firewall and app",
    story: "vm-client can't open the site on vm-web at 443. There's no NSG and no route table anywhere in vnet-app, so Azure isn't filtering anything. Find out what's stopping it inside the VM. SSH to vm-web is for subnet-admin only, so vm-client must not get it.",
    fix: "vm-client can't open the site on vm-web at 443.",
    concept: {
      heading: "Ruling the network out",
      paragraphs: [
        "When NSGs and routes look right, the VM itself is next. After checking the NIC, Learn's troubleshooting order for VM-to-VM problems goes: NSGs and routes, then the VM's own firewall, then whether the app is listening on the port.",
        "Connection troubleshoot can tell these apart. GuestFirewall means the VM's firewall blocked it. NoListenerOnDestination means nothing is listening on that port. NSG tools like IP flow verify never see inside the guest.",
        "Run Command runs a script inside the VM through the VM agent, as root, even when SSH is blocked. On Ubuntu the firewall is UFW: when it's active, a port that no rule allows is denied. One Learn page suggests turning the firewall off briefly to test, but another says not to disable it as a fix. Allow just what's needed, and leave it on.",
      ],
      facts: ["Order: NSG and routes, then the guest firewall, then the listener.", "UFW active: a port with no allow rule is denied.", "Run Command works even when SSH is blocked.", "Don't disable the guest firewall as a fix."],
    },
    steps: [
      { say: "Test the connection from Azure's side. Look at the issue type on the last hop.", cmd: `az network watcher test-connectivity ${G} --source-resource vm-client --dest-address 10.1.1.4 --dest-port 443` },
      { say: "GuestFirewall: the VM itself dropped it. Look inside with Run command.", cmd: RUN("vm-web", "ufw status numbered"), flags: [["--command-id RunShellScript", "run your own shell script"], ["--scripts", "the script, run as root by the VM agent"]] },
      { say: "Only SSH from the admin subnet is allowed. Allow 443 from the client subnet, nothing more.", cmd: RUN("vm-web", "ufw allow from 10.1.2.0/24 to any port 443 proto tcp") },
      { say: "Test again. The issue changes.", cmd: `az network watcher test-connectivity ${G} --source-resource vm-client --dest-address 10.1.1.4 --dest-port 443 --protocol Tcp` },
      { say: "NoListenerOnDestination: the firewall lets it in, but nothing answers. See what's listening, and the web server's state.", cmd: RUN("vm-web", "ss -tlnp && systemctl status nginx") },
      { say: "Start the web server.", cmd: RUN("vm-web", "systemctl start nginx") },
      { say: "Answer the question below.", cmd: "answer 1 denied" },
    ],
    setup: guestLab,
    objectives: [
      { text: "Let vm-client open the site on vm-web (443)", test: ({ st }) => can(st, "vm-client", "10.1.1.4", 443) },
      { text: "Keep UFW running on vm-web", test: ({ st }) => ufwOn(st, "vm-web") },
      { text: "Keep SSH from vm-client to vm-web blocked", test: ({ st }) => !can(st, "vm-client", "10.1.1.4", 22) },
      ask(1, "UFW is active and port 8080 isn't in its rule list. Is 8080 allowed or denied?", ["denied", "deny", "blocked"]),
    ],
    par: 2,
    hints: ["Connection troubleshoot names the issue type on the hop where it stops.", "The issue is inside vm-web: look with Run command, ufw status numbered and ss -tlnp.", "Run steps 3 and 6, then answer 1 denied."],
    lesson: "Azure can be perfectly configured while the VM refuses the connection. Connection troubleshoot tells a guest firewall apart from a missing listener, and Run command lets you look and fix from outside the VM.",
    why: "The new UFW rule lets 443 in from subnet-client only, so vm-web's own firewall stops dropping vm-client. Starting nginx puts a listener on 443, so the connection gets an answer. UFW stays on, and SSH is still allowed only from subnet-admin.",
    learn: [LEARN.vmSteps, LEARN.connTs, LEARN.ufw, LEARN.runCmd, LEARN.noDisable],
    flows: [{ from: "vm-client", to: "vm-web", port: 443, want: "open" }, { from: "vm-client", to: "vm-web", port: 22, want: "closed" }],
    solution: [RUN("vm-web", "ufw allow from 10.1.2.0/24 to any port 443 proto tcp"), RUN("vm-web", "systemctl start nginx"), "answer 1 denied"],
  },
  {
    id: "guest-probe", tier: "advanced", stage: "Inside the VM", title: "Load balancer marks both backends down",
    story: "A hardening script ran on the web servers, vm-web1 and vm-web2, last night. Since then lb-app at 10.1.1.10 times out for everyone, vm-client included. The network team has checked nsg-web: it allows the clients and the AzureLoadBalancer tag on 443. Both backends have to be healthy again, and UFW stays on.",
    fix: "lb-app at 10.1.1.10 times out for everyone since last night.",
    setup: webPool,
    objectives: [
      { text: "Get vm-client reaching lb-app on 443", test: ({ st }) => can(st, "vm-client", "10.1.1.10", 443) },
      { text: "Get vm-web1 and vm-web2 both passing the health probe", test: ({ st }) => healthy(st, "lb-app", "vm-web1") && healthy(st, "lb-app", "vm-web2") },
      { text: "Keep UFW running on both backends", test: ({ st }) => ufwOn(st, "vm-web1") && ufwOn(st, "vm-web2") },
      { text: "Keep SSH from vm-client to the backends blocked", test: ({ st }) => !can(st, "vm-client", "10.1.1.4", 22) && !can(st, "vm-client", "10.1.1.5", 22) },
    ],
    par: 3,
    hints: ["Every backend is down at once. Rule out the probe settings and the NSG first, then look inside the VMs.", "NSG tools can't see a VM's own firewall or whether its app is running. Run command can.", "Run ufw status numbered and ss -tlnp on each backend, and compare what UFW allows with where the probe comes from."],
    lesson: "Health probes come from 168.63.129.16, and a VM's own firewall has to let them in just like the NSG does. A hardening script that allows only client ranges takes every backend out of rotation, and a stopped service keeps one out even after the firewall is fixed.",
    why: "UFW on both web servers now allows 443 from 168.63.129.16, so the probe gets past each VM's own firewall. Starting nginx on vm-web2 gives the probe something to answer there, so both backends pass and lb-app sends traffic to them.",
    learn: [LEARN.probeFw, LEARN.probeA, LEARN.probe, LEARN.ufw, LEARN.runCmd],
    flows: [{ from: "vm-client", to: "lb-app-fe", port: 443, want: "open" }],
    solution: [RUN("vm-web1", "ufw allow from 168.63.129.16 to any port 443 proto tcp"), RUN("vm-web2", "ufw allow from 168.63.129.16 to any port 443 proto tcp"), RUN("vm-web2", "systemctl start nginx")],
  },
  {
    id: "guest-or-network", tier: "advanced", stage: "Inside the VM", title: "App is up, but Spoke 2 can't reach it",
    story: "\"nginx is running and answers locally,\" says the app team. Still, since the hub was rebuilt, vm-spoke2 can't reach the app on vm-spoke1 at 443. Spoke-to-spoke traffic goes through fw-hub at 10.0.2.4. The spokes aren't peered to each other. SSH to vm-spoke1 is for the hub's admins only, and UFW stays on.",
    fix: "vm-spoke2 can't reach the app on vm-spoke1 at 443.",
    setup: () => {
      const st = nvaHub({ fwd1: false });
      delete st.hosts["vm-spoke1"];
      linuxVm(st, "vm-spoke1", "vnet-spoke1", "subnet-app", "10.1.1.4", { services: { nginx: 443 }, ufw: [[443, "10.1.0.0/16"], [22, "10.0.0.0/16"]] });
      return st;
    },
    objectives: [
      { text: "Get vm-spoke2 reaching the app on vm-spoke1 (443) through fw-hub", test: ({ st }) => through(st, "vm-spoke2", "10.1.1.4", 443, "fw-hub") },
      { text: "Keep UFW running on vm-spoke1", test: ({ st }) => ufwOn(st, "vm-spoke1") },
      { text: "Keep SSH from vm-spoke2 to vm-spoke1 blocked", test: ({ st }) => !can(st, "vm-spoke2", "10.1.1.4", 22) },
      { text: "Don't peer the spokes to each other", test: ({ st }) => noSpokePeering(st) },
    ],
    par: 2,
    hints: ["Work the path in order: routes, peerings, then the VM. Fix one layer and test again.", "One fault is in Azure and one is inside the VM. Connection troubleshoot names the issue type each time.", "Look at the peering settings on spoke1's side, then at ufw status numbered on vm-spoke1 through Run command."],
    lesson: "\"The app is up\" and \"the network is fine\" can both be half true. Here a peering refused forwarded traffic, and the VM's firewall only trusted its own VNet. Connection troubleshoot's issue type tells you which layer you're in.",
    why: "Allowing forwarded traffic on spoke1-to-hub lets packets that fw-hub forwards from spoke2 into vnet-spoke1. UFW on vm-spoke1 now allows 443 from 10.2.0.0/16 too, so the app answers spoke2 while SSH stays limited to the hub.",
    learn: [LEARN.vmSteps, LEARN.peering, LEARN.connTs, LEARN.ufw, LEARN.runCmd],
    flows: [{ from: "vm-spoke2", to: "vm-spoke1", port: 443, want: "open" }, { from: "vm-spoke2", to: "vm-spoke1", port: 22, want: "closed" }],
    solution: [`az network vnet peering update ${G} --vnet-name vnet-spoke1 --name spoke1-to-hub --allow-forwarded-traffic true`, RUN("vm-spoke1", "ufw allow from 10.2.0.0/16 to any port 443 proto tcp")],
  },
];

/** Review levels. Each mixes the Advanced topics just taught with one fault from Beginner or Intermediate. */
export const advancedReviews: Level[] = [
  {
    id: "review-spokes-hybrid", tier: "advanced", stage: "Review", title: "Review: spoke, gateway and an old route",
    story: "The office can't open the app on vm-spoke1 at 443. srv-onprem, an office server, reaches Azure over the hub's VPN gateway, vgw-hub. Spoke 1 has an NSG and a route table left from older projects. SSH from the office stays blocked.",
    fix: "The office can't open the app on vm-spoke1 at 443.",
    setup: () => {
      const st = hybrid({ remote: false });
      st.vnets["vnet-spoke1"].subnets["subnet-app"].nsg = "nsg-app";
      st.vnets["vnet-spoke1"].subnets["subnet-app"].rt = "rt-app";
      rule(st, "nsg-app", { name: "Deny-All-Inbound", priority: 200, direction: "Inbound", access: "Deny", protocol: "*", src: ["*"], dst: ["*"], ports: ["*"] });
      rule(st, "nsg-app", { name: "Allow-HTTPS-OnPrem", priority: 300, direction: "Inbound", access: "Allow", protocol: "Tcp", src: ["192.168.0.0/16"], dst: ["*"], ports: ["443"] });
      st.rts["rt-app"] = { routes: [{ name: "to-onprem-old", prefix: "192.168.10.0/24", type: "VirtualAppliance", nhIp: "10.0.1.9" }] };
      return st;
    },
    objectives: [
      { text: "Let srv-onprem open the app on vm-spoke1 (443)", test: ({ st }) => can(st, "srv-onprem", "10.1.1.4", 443) },
      { text: "Keep SSH from the office blocked", test: ({ st }) => !can(st, "srv-onprem", "10.1.1.4", 22) },
    ],
    par: 3,
    hints: ["Three layers, three faults. Explain the connection after each fix.", "Check how on-premises learns the spoke, then the order of nsg-app's rules, then the routes the reply uses.", "Look at the spoke's peering settings, nsg-app with list-effective-nsg, and vm-spoke1's effective routes."],
    lesson: "A spoke reached from on-premises needs the gateway shared with it, an NSG whose allow runs before its deny, and a way back that no forgotten, more specific route steals. Longest prefix wins, even for a route to an appliance that's gone.",
    why: "Use remote gateways on spoke1-to-hub puts vnet-spoke1 behind vgw-hub, so on-premises learns the spoke's range and the spoke learns the way back. Allow-HTTPS-OnPrem now runs before Deny-All-Inbound, and with to-onprem-old gone, replies to 192.168.10.5 take the gateway route instead of a dead appliance at 10.0.1.9.",
    learn: [LEARN.transit, LEARN.nsg, LEARN.udr],
    flows: [{ from: "srv-onprem", to: "vm-spoke1", port: 443, want: "open" }, { from: "srv-onprem", to: "vm-spoke1", port: 22, want: "closed" }],
    solution: [
      `az network vnet peering update ${G} --vnet-name vnet-spoke1 --name spoke1-to-hub --use-remote-gateways true`,
      `az network nsg rule update ${G} --nsg-name nsg-app --name Allow-HTTPS-OnPrem --priority 150`,
      `az network route-table route delete ${G} --route-table-name rt-app --name to-onprem-old`,
    ],
  },
  {
    id: "review-endpoints-dns", tier: "advanced", stage: "Review", title: "Review: storage, DNS servers and a missing record",
    story: "vm-app has two problems since vnet-app moved off the old DNS server. It can't reach stdata01, which only allows subnet-app through its firewall. And it can't find api.corp.internal, the internal API on vm-api at 10.1.1.20. stdata01 keeps denying by default.",
    fix: "vm-app can't reach stdata01 and can't find api.corp.internal.",
    setup: () => {
      const st = base();
      vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24" } });
      host(st, "vm-app", "vnet-app", "subnet-app", "10.1.1.4");
      host(st, "vm-api", "vnet-app", "subnet-app", "10.1.1.20", { ports: [22, 443] });
      storage(st, "stdata01", "203.0.113.20", { defaultAction: "Deny", rules: [{ vnet: "vnet-app", subnet: "subnet-app" }] });
      st.zones["corp.internal"] = { records: {}, links: { "link-app": { vnet: "vnet-app", reg: false } } };
      st.vnets["vnet-app"].dnsServers = ["10.1.1.250"];
      return st;
    },
    objectives: [
      { text: "Get vm-app through to stdata01 on 443", test: ({ st }) => can(st, "vm-app", "203.0.113.20", 443) },
      { text: "Make api.corp.internal resolve to 10.1.1.20 from vm-app and answer on 443", test: ({ st }) => looksUp(st, "vm-app", "api.corp.internal") === "10.1.1.20" && can(st, "vm-app", "10.1.1.20", 443) },
      { text: "Keep stdata01 denying by default", test: ({ st }) => st.publicEndpoints["203.0.113.20"].defaultAction === "Deny" },
    ],
    par: 3,
    hints: ["Two complaints. Take storage first, then the name.", "A storage virtual network rule only counts for traffic through a service endpoint. A name lookup goes wherever the VNet's DNS servers point.", "Look at subnet-app's service endpoints, vnet-app's DNS servers, and the records in corp.internal."],
    lesson: "Old faults come back in new places: a VNet still pointing at a DNS server that's gone, a zone missing the one record that matters, and a storage rule that's useless without a service endpoint on the subnet.",
    why: "The Microsoft.Storage service endpoint on subnet-app makes its traffic match stdata01's existing virtual network rule. vnet-app now uses Azure-provided DNS instead of a server at 10.1.1.250 that's gone, so it reads the linked corp.internal zone, which now has an api record for 10.1.1.20.",
    learn: [LEARN.se, LEARN.dnsServers, LEARN.zone],
    flows: [{ from: "vm-app", dns: "api.corp.internal", expect: "vm-api", port: 443, want: "open" }],
    solution: [
      `az network vnet subnet update ${G} --vnet-name vnet-app --name subnet-app --service-endpoints Microsoft.Storage`,
      `az network vnet update ${G} --name vnet-app --dns-servers 168.63.129.16`,
      `az network private-dns record-set a add-record ${G} --zone-name corp.internal --record-set-name api --ipv4-address 10.1.1.20`,
    ],
  },
  {
    id: "review-edge", tier: "advanced", stage: "Review", title: "Review: outbound, load balancer and an old rule",
    story: "Two complaints came in together. vm-app in the private subnet-app can't download from updates.example.org, though nat-gw exists. And clients like vm-client in subnet-client time out on lb-app at 10.1.2.10 since the app on vm-web1 and vm-web2 moved to 443. vm-app must not get a public IP, and SSH from clients to the web servers stays blocked.",
    fix: "vm-app can't download updates, and clients time out on lb-app.",
    setup: () => {
      const st = base();
      vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24", nsg: "nsg-app" }, "subnet-web": { p: "10.1.2.0/24", nsg: "nsg-web" }, "subnet-client": { p: "10.1.3.0/24" } });
      st.vnets["vnet-app"].subnets["subnet-app"].defaultOutbound = false;
      host(st, "vm-app", "vnet-app", "subnet-app", "10.1.1.4");
      host(st, "vm-web1", "vnet-app", "subnet-web", "10.1.2.4", { ports: [22, 443] });
      host(st, "vm-web2", "vnet-app", "subnet-web", "10.1.2.5", { ports: [22, 443] });
      host(st, "vm-client", "vnet-app", "subnet-client", "10.1.3.4");
      site(st, "updates.example.org", "203.0.113.80");
      st.publicIps = { "pip-nat": { sku: "Standard", ip: "198.51.100.20", region: "eastus2" } };
      st.natGateways = { "nat-gw": { pips: ["pip-nat"] } };
      st.vnets["vnet-app"].subnets["subnet-web"].natGateway = "nat-gw";
      rule(st, "nsg-app", { name: "Deny-Internet-Out", priority: 200, direction: "Outbound", access: "Deny", protocol: "*", src: ["*"], dst: ["Internet"], ports: ["*"] });
      lb(st, "lb-app", "vnet-app", "subnet-web", "10.1.2.10", { probePort: 8080, port: 443, backends: ["vm-web1", "vm-web2"] });
      rule(st, "nsg-web", { name: "Allow-HTTPS-Clients", priority: 200, direction: "Inbound", access: "Allow", protocol: "Tcp", src: ["10.1.3.0/24"], dst: ["*"], ports: ["443"] });
      rule(st, "nsg-web", { name: "Allow-LB-Probe", priority: 300, direction: "Inbound", access: "Allow", protocol: "Tcp", src: ["AzureLoadBalancer"], dst: ["*"], ports: ["*"] });
      rule(st, "nsg-web", { name: "Deny-All-Inbound", priority: 4000, direction: "Inbound", access: "Deny", protocol: "*", src: ["*"], dst: ["*"], ports: ["*"] });
      return st;
    },
    objectives: [
      { text: "Get vm-app reaching updates.example.org through nat-gw", test: ({ st }) => egressVia(st, "vm-app", "203.0.113.80", "nat-gw") },
      { text: "Don't give vm-app a public IP of its own", test: ({ st }) => !st.hosts["vm-app"].publicIp },
      { text: "Get vm-client reaching lb-app on 443", test: ({ st }) => can(st, "vm-client", "10.1.2.10", 443) },
      { text: "Keep SSH from vm-client to the web servers blocked", test: ({ st }) => !can(st, "vm-client", "10.1.2.4", 22) },
    ],
    par: 3,
    hints: ["Split it by complaint: outbound first, then the load balancer.", "Outbound passes the NSG before it ever reaches a NAT gateway. A probe has to hit a port the app listens on.", "Look at nsg-app's outbound rules, which subnet nat-gw is associated with, and the probe against the app's port."],
    lesson: "Outbound traffic meets the NSG before it meets the NAT gateway, and the NAT gateway only serves the subnets it's associated with. A probe on the wrong port marks every backend down even when the NSG lets it in.",
    why: "With nothing in nsg-app denying internet traffic and nat-gw associated with subnet-app, vm-app's request leaves through pip-nat. probe-app now checks 443, where the web servers listen, so both backends pass and lb-app forwards to them again.",
    learn: [LEARN.outboundNsg, LEARN.nat, LEARN.probe],
    flows: [{ from: "vm-client", to: "lb-app-fe", port: 443, want: "open" }, { from: "vm-client", to: "vm-web1", port: 22, want: "closed" }],
    solution: [
      `az network nsg rule delete ${G} --nsg-name nsg-app --name Deny-Internet-Out`,
      `az network vnet subnet update ${G} --vnet-name vnet-app --name subnet-app --nat-gateway nat-gw`,
      `az network lb probe update ${G} --lb-name lb-app --name probe-app --port 443`,
    ],
  },
];
