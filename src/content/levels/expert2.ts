// Expert, part two. More incidents, including NAT gateway and load balancer faults, and red herrings
// where Azure's network is fine and the cause is inside the VM. Every behavior was taught earlier.
import { azfw, base, can, host, lb, linuxVm, looksUp, netSnapshot, peer, rule, site, ufwOn, vnet } from "../build";
import { probeOk, reach } from "@/sim/network";
import type { State } from "@/sim/types";
import type { Level } from "../types";
import { hybrid } from "./advanced";
import { LEARN_GUEST } from "./advanced3";

const L = (title: string, url: string) => ({ title, url });
const G = "-g rg-lab";
const RUN = (vm: string, script: string) => `az vm run-command invoke ${G} -n ${vm} --command-id RunShellScript --scripts "${script}"`;
const through = (st: State, from: string, ip: string, port: number, via: string) => { const r = reach(st, from, ip, port); return r.ok && r.via.includes(via); };
const egressVia = (st: State, from: string, ip: string, nat: string) => { const r = reach(st, from, ip, 443); return r.ok && !!r.egress?.includes(nat); };
const noSpokePeering = (st: State) => !Object.values(st.peerings).some((p) => p.vnet.includes("spoke") && p.remote.includes("spoke"));
const healthy = (st: State, lbName: string, vm: string) => probeOk(st, st.lbs![lbName], vm);
/** "The network wasn't the problem": nothing Azure's network tools can change differs from the start. */
const untouched = (setup: () => State) => { let start: string | null = null; return (st: State) => netSnapshot(st) === (start ??= netSnapshot(setup())); };

const LEARN = {
  ...LEARN_GUEST,
  appConn: L("Troubleshoot application connectivity issues on virtual machines in Azure", "https://learn.microsoft.com/troubleshoot/azure/virtual-machines/windows/troubleshoot-app-connection"),
  nsg: L("Troubleshoot NSG misconfigurations", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-nsg-blocking-traffic"),
  probeTs: L("Troubleshoot health probe failures in Azure Load Balancer", "https://learn.microsoft.com/troubleshoot/azure/load-balancer/troubleshoot-load-balancer-health-probe-failures"),
  probe: L("Azure Load Balancer health probes: probe source IP", "https://learn.microsoft.com/azure/load-balancer/load-balancer-custom-probe-overview#probe-source-ip-address"),
  nat: L("What is Azure NAT Gateway?", "https://learn.microsoft.com/azure/nat-gateway/nat-overview#azure-nat-gateway-basics"),
  natTs: L("Troubleshoot Azure NAT Gateway: configuration basics", "https://learn.microsoft.com/troubleshoot/azure/nat-gateway/troubleshoot-nat#nat-gateway-configuration-basics"),
  natIp: L("Troubleshoot NAT gateway connectivity: public IP isn't used", "https://learn.microsoft.com/troubleshoot/azure/nat-gateway/troubleshoot-nat-connectivity#nat-gateway-public-ip-isnt-used-to-connect-outbound"),
  outboundNsg: L("How network security groups filter network traffic: outbound", "https://learn.microsoft.com/azure/virtual-network/network-security-group-how-it-works#outbound-traffic"),
  udr: L("Virtual network traffic routing: custom routes", "https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview#custom-routes"),
  transit: L("Configure VPN gateway transit for virtual network peering", "https://learn.microsoft.com/azure/vpn-gateway/vpn-gateway-peering-gateway-transit"),
  zone: L("What is an Azure private DNS zone?", "https://learn.microsoft.com/azure/dns/private-dns-privatednszone"),
  zoneLink: L("What is a virtual network link?", "https://learn.microsoft.com/azure/dns/private-dns-virtual-network-links"),
  peering: L("Troubleshoot virtual network peering problems", "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-peering-issues"),
  fwSnat: L("Azure Firewall SNAT private IP address ranges", "https://learn.microsoft.com/azure/firewall/snat-private-range"),
  fw: L("Azure Firewall rule processing logic", "https://learn.microsoft.com/azure/firewall/rule-processing"),
};

function intranet(): State {
  const st = base();
  vnet(st, "vnet-corp", ["10.1.0.0/16"], { "subnet-web": { p: "10.1.1.0/24", nsg: "nsg-web" }, "subnet-users": { p: "10.1.2.0/24" } });
  linuxVm(st, "vm-intranet", "vnet-corp", "subnet-web", "10.1.1.4", { services: { nginx: 443 }, stopped: ["nginx"] });
  host(st, "vm-user", "vnet-corp", "subnet-users", "10.1.2.4");
  rule(st, "nsg-web", { name: "Allow-HTTPS-Users", priority: 200, direction: "Inbound", access: "Allow", protocol: "Tcp", src: ["10.1.2.0/24"], dst: ["*"], ports: ["443"] });
  rule(st, "nsg-web", { name: "Deny-All-Inbound", priority: 4000, direction: "Inbound", access: "Deny", protocol: "*", src: ["*"], dst: ["*"], ports: ["*"] });
  return st;
}

function metrics(): State {
  const st = base();
  vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24" }, "subnet-users": { p: "10.1.2.0/24" }, "subnet-monitor": { p: "10.1.5.0/24" } });
  for (const [n, ip] of [["vm-app1", "10.1.1.4"], ["vm-app2", "10.1.1.5"]]) linuxVm(st, n, "vnet-app", "subnet-app", ip, { services: { nginx: 443, "node-exporter": 9100 }, ufw: [[443, "10.1.2.0/24"], [22, "10.1.5.0/24"]] });
  host(st, "vm-monitor", "vnet-app", "subnet-monitor", "10.1.5.4");
  host(st, "vm-user", "vnet-app", "subnet-users", "10.1.2.4");
  return st;
}

/** A shop behind an internal load balancer: web1 and web2 in subnet-web, clients in subnet-client. */
function shop(o: { probePort: number; stopped2?: boolean; probeRule?: boolean }): State {
  const st = base();
  vnet(st, "vnet-shop", ["10.1.0.0/16"], { "subnet-web": { p: "10.1.1.0/24", nsg: "nsg-web" }, "subnet-client": { p: "10.1.2.0/24" } });
  linuxVm(st, "vm-web1", "vnet-shop", "subnet-web", "10.1.1.4", { services: { nginx: 443 } });
  linuxVm(st, "vm-web2", "vnet-shop", "subnet-web", "10.1.1.5", { services: { nginx: 443 }, stopped: o.stopped2 ? ["nginx"] : [] });
  host(st, "vm-client", "vnet-shop", "subnet-client", "10.1.2.4");
  lb(st, "lb-shop", "vnet-shop", "subnet-web", "10.1.1.10", { probePort: o.probePort, port: 443, backends: ["vm-web1", "vm-web2"] });
  rule(st, "nsg-web", { name: "Allow-HTTPS-Clients", priority: 200, direction: "Inbound", access: "Allow", protocol: "Tcp", src: ["10.1.2.0/24"], dst: ["*"], ports: ["443"] });
  if (o.probeRule !== false) rule(st, "nsg-web", { name: "Allow-LB-Probe", priority: 300, direction: "Inbound", access: "Allow", protocol: "Tcp", src: ["AzureLoadBalancer"], dst: ["*"], ports: ["*"] });
  rule(st, "nsg-web", { name: "Deny-All-Inbound", priority: 4000, direction: "Inbound", access: "Deny", protocol: "*", src: ["*"], dst: ["*"], ports: ["*"] });
  return st;
}

/** Private subnets that leave Azure through nat-gw (198.51.100.20). */
function egress(): State {
  const st = base();
  vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24" }, "subnet-web": { p: "10.1.2.0/24" }, "subnet-jobs": { p: "10.1.3.0/24" } });
  for (const s of ["subnet-app", "subnet-web", "subnet-jobs"]) st.vnets["vnet-app"].subnets[s].defaultOutbound = false;
  st.publicIps = { "pip-nat": { sku: "Standard", ip: "198.51.100.20", region: "eastus2" } };
  st.natGateways = { "nat-gw": { pips: ["pip-nat"] } };
  return st;
}

const setups = {
  intranet, metrics,
  hr: () => {
    const st = hybrid({ remote: false });
    delete st.hosts["vm-spoke1"];
    linuxVm(st, "vm-hr", "vnet-spoke1", "subnet-app", "10.1.1.4", { services: { nginx: 443 }, ufw: [[443, "10.0.0.0/8"], [22, "10.0.0.0/16"]] });
    return st;
  },
};

export const expertMore: Level[] = [
  {
    id: "intranet-down", tier: "expert", stage: "Incident", title: "The intranet site is down",
    story: "\"The intranet has been down for the whole office since this morning. Is the network broken again?\" The site runs on vm-intranet (10.1.1.4) over HTTPS. Office users sit in subnet-users, like vm-user. Users must never get SSH to the server.",
    fix: "The office can't open the intranet site.",
    clock: 10,
    setup: setups.intranet,
    objectives: [
      { text: "Get vm-user opening the intranet on vm-intranet (443)", test: ({ st }) => can(st, "vm-user", "10.1.1.4", 443) },
      { text: "Keep SSH from users to vm-intranet blocked", test: ({ st }) => !can(st, "vm-user", "10.1.1.4", 22) },
      { text: "Change only what is actually broken", test: ({ st }) => untouched(setups.intranet)(st) },
    ],
    par: 1,
    hints: [],
    lesson: "Sometimes the network is fine. nsg-web allowed 443 from users the whole time, and Connection troubleshoot said NoListenerOnDestination: nothing was listening. Ruling the network out quickly is as much a skill as fixing it.",
    why: "The packet already reached vm-intranet, but nothing was listening on 443 to answer it. Starting nginx put a listener on that port, so the path that was open all along now gets a reply.",
    learn: [LEARN.appConn, LEARN.connTs, LEARN.vmSteps, LEARN.runCmd],
    flows: [{ from: "vm-user", to: "vm-intranet", port: 443, want: "open" }, { from: "vm-user", to: "vm-intranet", port: 22, want: "closed" }],
    solution: [RUN("vm-intranet", "systemctl start nginx")],
  },
  {
    id: "metrics-gap", tier: "expert", stage: "Incident", title: "Monitoring lost both app servers",
    story: "\"Since the security team's hardening run on Monday, the dashboards show vm-app1 and vm-app2 as down. Users say the app itself works fine.\" vm-monitor in subnet-monitor collects metrics from both servers on port 9100. Only the monitoring subnet should reach that port. The security baseline stays in place.",
    fix: "The dashboards show both app servers as down.",
    clock: 12,
    setup: setups.metrics,
    objectives: [
      { text: "Get vm-monitor reaching vm-app1 and vm-app2 on 9100", test: ({ st }) => can(st, "vm-monitor", "10.1.1.4", 9100) && can(st, "vm-monitor", "10.1.1.5", 9100) },
      { text: "Keep vm-user blocked from 9100 on both servers", test: ({ st }) => !can(st, "vm-user", "10.1.1.4", 9100) && !can(st, "vm-user", "10.1.1.5", 9100) },
      { text: "Keep UFW running on both servers", test: ({ st }) => ufwOn(st, "vm-app1") && ufwOn(st, "vm-app2") },
      { text: "Change only what is actually broken", test: ({ st }) => untouched(setups.metrics)(st) },
    ],
    par: 2,
    hints: [],
    lesson: "No NSG anywhere, no route tables, and still blocked: the hardening run turned on UFW with rules for users and SSH only. Allow the one port from the one subnet that needs it, on every server, and leave the firewall on.",
    why: "With no NSG or route in the way, the only thing dropping 9100 was UFW inside each server. UFW lets in only what its rules allow, so a rule for 9100 from the monitoring subnet opened it for vm-monitor and no one else.",
    learn: [LEARN.connTs, LEARN.ufw, LEARN.runCmd, LEARN.noDisable],
    flows: [{ from: "vm-monitor", to: "vm-app1", port: 9100, want: "open" }, { from: "vm-monitor", to: "vm-app2", port: 9100, want: "open" }, { from: "vm-user", to: "vm-app1", port: 9100, want: "closed" }],
    solution: [RUN("vm-app1", "ufw allow from 10.1.5.0/24 to any port 9100 proto tcp"), RUN("vm-app2", "ufw allow from 10.1.5.0/24 to any port 9100 proto tcp")],
  },
  {
    id: "checkout-timeouts", tier: "expert", stage: "Incident", title: "Checkout times out for everyone",
    story: "\"Checkout has timed out for every customer since this morning's certificate change.\" The shop runs on vm-web1 and vm-web2 behind lb-shop, an internal load balancer at 10.1.1.10 on 443. Clients sit in subnet-client, like vm-client. Both servers have to be back in rotation, and clients never get SSH to them.",
    fix: "Checkout times out for everyone.",
    clock: 15,
    setup: () => shop({ probePort: 8443, stopped2: true }),
    objectives: [
      { text: "Get vm-client reaching lb-shop on 443", test: ({ st }) => can(st, "vm-client", "10.1.1.10", 443) },
      { text: "Get vm-web1 and vm-web2 both passing the health probe", test: ({ st }) => healthy(st, "lb-shop", "vm-web1") && healthy(st, "lb-shop", "vm-web2") },
      { text: "Keep SSH from vm-client to the web servers blocked", test: ({ st }) => !can(st, "vm-client", "10.1.1.4", 22) },
    ],
    par: 2,
    hints: [],
    lesson: "Two problems hid behind one symptom: the probe checked a port nothing listens on, which took every backend down, and one server's web service never came back after the change. Fix the probe, then check each backend on its own.",
    why: "A load balancer only sends traffic to backends that pass its health probe, and a probe on a port nothing listens on fails on every backend. With the probe on 443, vm-web1 passed at once. vm-web2 passed once nginx was running again.",
    learn: [LEARN.probeTs, LEARN.probeA, LEARN.runCmd],
    flows: [{ from: "vm-client", to: "lb-shop-fe", port: 443, want: "open" }, { from: "vm-client", to: "vm-web1", port: 22, want: "closed" }],
    solution: [`az network lb probe update ${G} --lb-name lb-shop --name probe-app --port 443`, RUN("vm-web2", "systemctl start nginx")],
  },
  {
    id: "no-updates", tier: "expert", stage: "Incident", title: "The batch server can't download updates",
    story: "\"Patching failed on the batch server again last night. It can't reach the update site, updates.example.org.\" vm-batch lives in the private subnet-batch and must go out to the internet through nat-gw, never a public IP of its own. It may only use HTTPS to the internet.",
    fix: "The batch server can't download updates.",
    clock: 20,
    setup: () => {
      const st = egress();
      st.vnets["vnet-app"].subnets["subnet-batch"] = { prefixes: ["10.1.4.0/24"], nsg: null, rt: "rt-batch", defaultOutbound: false };
      host(st, "vm-batch", "vnet-app", "subnet-batch", "10.1.4.4", { nicNsg: "nsg-batch-nic" });
      site(st, "updates.example.org", "203.0.113.80");
      st.vnets["vnet-app"].subnets["subnet-web"].natGateway = "nat-gw";
      st.rts["rt-batch"] = { routes: [{ name: "default-via-fw", prefix: "0.0.0.0/0", type: "VirtualAppliance", nhIp: "10.0.2.4" }] };
      rule(st, "nsg-batch-nic", { name: "Allow-VNet-Out", priority: 200, direction: "Outbound", access: "Allow", protocol: "*", src: ["*"], dst: ["VirtualNetwork"], ports: ["*"] });
      rule(st, "nsg-batch-nic", { name: "Deny-All-Out", priority: 4000, direction: "Outbound", access: "Deny", protocol: "*", src: ["*"], dst: ["*"], ports: ["*"] });
      return st;
    },
    objectives: [
      { text: "Get vm-batch reaching updates.example.org on 443 through nat-gw", test: ({ st }) => egressVia(st, "vm-batch", "203.0.113.80", "nat-gw") },
      { text: "Don't give vm-batch a public IP of its own", test: ({ st }) => !st.hosts["vm-batch"].publicIp },
      { text: "Keep vm-batch blocked from the internet on other ports, like 22", test: ({ st }) => !can(st, "vm-batch", "203.0.113.80", 22) },
    ],
    par: 3,
    hints: [],
    lesson: "Outbound runs a gauntlet: the NIC's NSG first, then routing, then the NAT gateway. A deny-all on the NIC, a default route to a retired firewall, and a NAT gateway on the wrong subnet each stop it alone. Allow only HTTPS out, so the fix doesn't open everything.",
    why: "Outbound traffic has to pass the NIC's NSG, then follow the subnet's routes, before a NAT gateway can carry it out. An HTTPS allow got it past the NIC, dropping the route to a firewall that no longer exists let it take the internet path, and linking nat-gw to subnet-batch let it leave from nat-gw's public IP. Port 22 still hits Deny-All-Out.",
    learn: [LEARN.outboundNsg, LEARN.nat, LEARN.natTs, LEARN.udr],
    flows: [],
    solution: [
      `az network nsg rule create ${G} --nsg-name nsg-batch-nic --name Allow-HTTPS-Out --priority 300 --direction Outbound --access Allow --protocol Tcp --destination-address-prefixes Internet --destination-port-ranges 443`,
      `az network route-table route delete ${G} --route-table-name rt-batch --name default-via-fw`,
      `az network vnet subnet update ${G} --vnet-name vnet-app --name subnet-batch --nat-gateway nat-gw`,
    ],
  },
  {
    id: "partner-api", tier: "expert", stage: "Incident", title: "The partner API rejects the new job servers",
    story: "\"The new job servers can't call the partner API. The old app servers still can.\" The partner only accepts calls from 198.51.100.20, the public IP of nat-gw. vm-app in subnet-app works today. vm-jobs sits in the new subnet-jobs, built yesterday from a network template. Neither VM may get its own public IP.",
    fix: "The new job servers can't call the partner API.",
    clock: 15,
    setup: () => {
      const st = egress();
      st.vnets["vnet-app"].subnets["subnet-app"].natGateway = "nat-gw";
      st.vnets["vnet-app"].subnets["subnet-jobs"].rt = "rt-jobs";
      st.rts["rt-jobs"] = { routes: [{ name: "block-internet", prefix: "0.0.0.0/0", type: "None" }] };
      host(st, "vm-app", "vnet-app", "subnet-app", "10.1.1.4");
      host(st, "vm-jobs", "vnet-app", "subnet-jobs", "10.1.3.4");
      site(st, "api.partner.example", "203.0.113.90");
      return st;
    },
    objectives: [
      { text: "Get vm-jobs reaching api.partner.example on 443 through nat-gw", test: ({ st }) => egressVia(st, "vm-jobs", "203.0.113.90", "nat-gw") },
      { text: "Keep vm-app going out through nat-gw", test: ({ st }) => egressVia(st, "vm-app", "203.0.113.90", "nat-gw") },
      { text: "Don't give either VM a public IP of its own", test: ({ st }) => !st.hosts["vm-jobs"].publicIp && !st.hosts["vm-app"].publicIp },
    ],
    par: 2,
    hints: [],
    lesson: "A NAT gateway serves only the subnets associated with it, so a new subnet has to be added. And a template's 0.0.0.0/0 route with next hop None drops internet traffic before any NAT gateway sees it. Connection troubleshoot reports that one as UserDefinedRoute.",
    why: "A custom route beats the default internet route, so the 0.0.0.0/0 route with next hop None dropped vm-jobs' traffic before it left the subnet. With that gone, linking nat-gw to subnet-jobs sent it out from 198.51.100.20, the one address the partner accepts.",
    learn: [LEARN.nat, LEARN.natIp, LEARN.udr, LEARN.connTs],
    flows: [],
    solution: [`az network vnet subnet update ${G} --vnet-name vnet-app --name subnet-jobs --nat-gateway nat-gw`, `az network route-table route delete ${G} --route-table-name rt-jobs --name block-internet`],
  },
  {
    id: "half-the-users", tier: "expert", stage: "Incident", title: "Some users get errors, others are fine",
    story: "\"Accounting can use the portal, but the sales team, new since Monday, gets timeouts. And ops says one server dropped out of rotation.\" The portal runs on vm-web1 and vm-web2 behind lb-portal, an internal load balancer at 10.1.1.10. Accounting is subnet-acct, sales is the new subnet-sales. Users never get SSH to the servers, and UFW stays on for both.",
    fix: "The sales team gets timeouts on the portal, and one server dropped out of rotation.",
    clock: 15,
    setup: () => {
      const st = base();
      vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-web": { p: "10.1.1.0/24", nsg: "nsg-web" }, "subnet-acct": { p: "10.1.2.0/24" }, "subnet-sales": { p: "10.1.3.0/24" } });
      linuxVm(st, "vm-web1", "vnet-app", "subnet-web", "10.1.1.4", { services: { nginx: 443 }, ufw: [[443, "10.1.0.0/16"], [443, "168.63.129.16"]] });
      linuxVm(st, "vm-web2", "vnet-app", "subnet-web", "10.1.1.5", { services: { nginx: 443 }, ufw: [[443, "10.1.0.0/16"]] });
      host(st, "vm-acct", "vnet-app", "subnet-acct", "10.1.2.4");
      host(st, "vm-sales", "vnet-app", "subnet-sales", "10.1.3.4");
      lb(st, "lb-portal", "vnet-app", "subnet-web", "10.1.1.10", { probePort: 443, port: 443, backends: ["vm-web1", "vm-web2"] });
      rule(st, "nsg-web", { name: "Allow-HTTPS-Users", priority: 200, direction: "Inbound", access: "Allow", protocol: "Tcp", src: ["10.1.2.0/24"], dst: ["*"], ports: ["443"] });
      rule(st, "nsg-web", { name: "Allow-LB-Probe", priority: 300, direction: "Inbound", access: "Allow", protocol: "Tcp", src: ["AzureLoadBalancer"], dst: ["*"], ports: ["443"] });
      rule(st, "nsg-web", { name: "Deny-All-Inbound", priority: 4000, direction: "Inbound", access: "Deny", protocol: "*", src: ["*"], dst: ["*"], ports: ["*"] });
      return st;
    },
    objectives: [
      { text: "Get vm-acct and vm-sales both reaching lb-portal on 443", test: ({ st }) => can(st, "vm-acct", "10.1.1.10", 443) && can(st, "vm-sales", "10.1.1.10", 443) },
      { text: "Get vm-web1 and vm-web2 both passing the health probe", test: ({ st }) => healthy(st, "lb-portal", "vm-web1") && healthy(st, "lb-portal", "vm-web2") },
      { text: "Keep SSH from users to the servers blocked", test: ({ st }) => !can(st, "vm-sales", "10.1.1.4", 22) && !can(st, "vm-acct", "10.1.1.5", 22) },
      { text: "Keep UFW running on both servers", test: ({ st }) => ufwOn(st, "vm-web1") && ufwOn(st, "vm-web2") },
    ],
    par: 2,
    hints: [],
    lesson: "\"Some users\" and \"one server\" are two separate faults. The NSG only allowed accounting's range, and vm-web2's firewall never allowed the probe from 168.63.129.16. The load balancer hid the second one by sending everyone to vm-web1.",
    why: "Two separate checks failed. nsg-web only allowed accounting's subnet, so sales traffic never reached either server. The health probe comes from 168.63.129.16, and vm-web2's UFW didn't allow it, so the load balancer took vm-web2 out. Allowing each missing source fixed each half.",
    learn: [LEARN.nsg, LEARN.probeFw, LEARN.probe, LEARN.ufw],
    flows: [{ from: "vm-sales", to: "lb-portal-fe", port: 443, want: "open" }, { from: "vm-acct", to: "lb-portal-fe", port: 443, want: "open" }],
    solution: [`az network nsg rule update ${G} --nsg-name nsg-web --name Allow-HTTPS-Users --source-address-prefixes 10.1.2.0/24 10.1.3.0/24`, RUN("vm-web2", "ufw allow from 168.63.129.16 to any port 443 proto tcp")],
  },
  {
    id: "hr-app", tier: "expert", stage: "Incident", title: "The office can't reach the HR app",
    story: "\"Since HR moved their app to Azure last week, nobody in the office can open it.\" The app runs on vm-hr in Spoke 1, on 443. The office reaches Azure over the hub's VPN gateway, and srv-onprem is an office server you can test from. HR's admin says the app is running. SSH from the office stays blocked, and UFW on vm-hr stays on.",
    fix: "Nobody in the office can open the HR app.",
    clock: 15,
    setup: setups.hr,
    objectives: [
      { text: "Get srv-onprem opening the HR app on vm-hr (443)", test: ({ st }) => can(st, "srv-onprem", "10.1.1.4", 443) },
      { text: "Keep SSH from the office blocked", test: ({ st }) => !can(st, "srv-onprem", "10.1.1.4", 22) },
      { text: "Keep UFW running on vm-hr", test: ({ st }) => ufwOn(st, "vm-hr") },
    ],
    par: 2,
    hints: [],
    lesson: "A workload moved to Azure often brings a firewall that doesn't match where its users are. Here the spoke wasn't using the hub's gateway, and vm-hr's UFW allowed only Azure ranges, never the office. Fix the path first, then what the VM itself accepts.",
    why: "The office only learns Spoke 1's range when the spoke uses the hub's gateway, so that gave traffic a path. Then it reached vm-hr, where UFW allowed only 10.x addresses, and the office is 192.168.0.0/16. A UFW allow for the office on 443 let it in without opening SSH.",
    learn: [LEARN.transit, LEARN.connTs, LEARN.ufw, LEARN.runCmd],
    flows: [{ from: "srv-onprem", to: "vm-hr", port: 443, want: "open" }, { from: "srv-onprem", to: "vm-hr", port: 22, want: "closed" }],
    solution: [`az network vnet peering update ${G} --vnet-name vnet-spoke1 --name spoke1-to-hub --use-remote-gateways true`, RUN("vm-hr", "ufw allow from 192.168.0.0/16 to any port 443 proto tcp")],
  },
  {
    id: "wiki-gone", tier: "expert", stage: "Incident", title: "The wiki is gone",
    story: "\"wiki.corp.internal doesn't open anymore. The intranet still works.\" Last night the wiki moved from an old VM to vm-wiki2 at 10.1.1.8, and a cleanup deleted the old VM. Names come from the private zone corp.internal. Users sit in subnet-users, like vm-user.",
    fix: "wiki.corp.internal doesn't open anymore.",
    clock: 12,
    setup: () => {
      const st = base();
      vnet(st, "vnet-app", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24" }, "subnet-users": { p: "10.1.2.0/24" } });
      host(st, "vm-intranet", "vnet-app", "subnet-app", "10.1.1.4", { ports: [22, 443] });
      linuxVm(st, "vm-wiki2", "vnet-app", "subnet-app", "10.1.1.8", { services: { nginx: 443 }, stopped: ["nginx"] });
      host(st, "vm-user", "vnet-app", "subnet-users", "10.1.2.4");
      st.zones["corp.internal"] = { records: { intranet: "10.1.1.4" }, links: { "link-app": { vnet: "vnet-app", reg: false } } };
      return st;
    },
    objectives: [
      { text: "Get wiki.corp.internal resolving to 10.1.1.8 and opening on 443 from vm-user", test: ({ st }) => looksUp(st, "vm-user", "wiki.corp.internal") === "10.1.1.8" && can(st, "vm-user", "10.1.1.8", 443) },
      { text: "Keep intranet.corp.internal resolving to 10.1.1.4", test: ({ st }) => looksUp(st, "vm-user", "intranet.corp.internal") === "10.1.1.4" },
    ],
    par: 2,
    hints: [],
    lesson: "A migration has two halves: the name has to point at the new server, and the new server has to be serving. The cleanup deleted the old wiki record by hand, and nothing added one for vm-wiki2: in a zone linked without autoregistration, records change only when someone changes them. And the new VM's web service was never started.",
    why: "Records in corp.internal change only when someone changes them, so the wiki name needed an A record pointing at 10.1.1.8. That sent users to the right server, and starting nginx gave them something to answer on 443.",
    learn: [LEARN.zone, L("Private DNS autoregistration", "https://learn.microsoft.com/azure/dns/private-dns-autoregistration"), LEARN.appConn, LEARN.runCmd],
    flows: [{ from: "vm-user", dns: "wiki.corp.internal", expect: "vm-wiki2", port: 443, want: "open" }],
    solution: [`az network private-dns record-set a add-record ${G} --zone-name corp.internal --record-set-name wiki --ipv4-address 10.1.1.8`, RUN("vm-wiki2", "systemctl start nginx")],
  },
  {
    id: "firewall-source", tier: "expert", stage: "Incident", title: "The API stopped answering Spoke 1",
    story: "\"Since azfw-hub went in, Spoke 1 can't call the API in Spoke 2.\" The API runs on vm-api on 443, and vm-spoke1 calls it. The design: spoke-to-spoke traffic goes through azfw-hub, an Azure Firewall at 10.0.1.4, with HTTPS allowed from Spoke 1 to Spoke 2. SSH from Spoke 1 stays blocked, the spokes are never peered, and UFW on vm-api stays on.",
    fix: "Spoke 1 can't call the API in Spoke 2.",
    clock: 20,
    setup: () => {
      const st = base();
      vnet(st, "vnet-spoke1", ["10.1.0.0/16"], { "subnet-app": { p: "10.1.1.0/24", rt: "rt-spoke1" } });
      vnet(st, "vnet-hub", ["10.0.0.0/16"], { AzureFirewallSubnet: { p: "10.0.1.0/26" } });
      vnet(st, "vnet-spoke2", ["10.2.0.0/16"], { "subnet-api": { p: "10.2.1.0/24", rt: "rt-spoke2" } });
      host(st, "vm-spoke1", "vnet-spoke1", "subnet-app", "10.1.1.4");
      linuxVm(st, "vm-api", "vnet-spoke2", "subnet-api", "10.2.1.4", { services: { api: 443 }, ufw: [[443, "10.0.1.0/26"], [22, "10.0.0.0/16"]] });
      azfw(st, "azfw-hub", "vnet-hub", "10.0.1.4", [{ name: "Allow-Spoke1-API", priority: 200, action: "Allow", rules: [{ name: "https", protocols: ["TCP"], src: ["10.1.0.0/16"], dst: ["10.2.0.0/16"], ports: ["443"] }] }]);
      for (const s of ["vnet-spoke1", "vnet-spoke2"]) { peer(st, "vnet-hub", s); peer(st, s, "vnet-hub", { fwd: s === "vnet-spoke1" }); }
      st.rts["rt-spoke1"] = { routes: [{ name: "to-spoke2", prefix: "10.2.0.0/16", type: "VirtualAppliance", nhIp: "10.0.1.4" }] };
      st.rts["rt-spoke2"] = { routes: [{ name: "to-spoke1", prefix: "10.1.0.0/16", type: "VirtualAppliance", nhIp: "10.0.1.4" }] };
      return st;
    },
    objectives: [
      { text: "Get vm-spoke1 reaching the API on vm-api (443) through azfw-hub", test: ({ st }) => through(st, "vm-spoke1", "10.2.1.4", 443, "azfw-hub") },
      { text: "Keep SSH from Spoke 1 to vm-api blocked", test: ({ st }) => !can(st, "vm-spoke1", "10.2.1.4", 22) },
      { text: "Keep UFW running on vm-api", test: ({ st }) => ufwOn(st, "vm-api") },
      { text: "Don't peer the spokes to each other", test: ({ st }) => noSpokePeering(st) },
    ],
    par: 2,
    hints: [],
    lesson: "Azure Firewall doesn't SNAT network rule traffic to private ranges, so vm-api sees Spoke 1's own addresses, not the firewall's subnet. A guest firewall written for the firewall's IPs refuses everyone. And Spoke 2's peering has to accept forwarded traffic before any of that matters.",
    why: "Spoke 2's peering had to accept traffic the hub forwards before anything from the firewall could arrive. After that, vm-api saw the caller's own Spoke 1 address, not the firewall's, because Azure Firewall doesn't SNAT network rule traffic to private ranges. So UFW had to allow Spoke 1 itself.",
    learn: [LEARN.fwSnat, LEARN.fw, LEARN.peering, LEARN.ufw],
    flows: [{ from: "vm-spoke1", to: "vm-api", port: 443, want: "open" }, { from: "vm-spoke1", to: "vm-api", port: 22, want: "closed" }],
    solution: [`az network vnet peering update ${G} --vnet-name vnet-spoke2 --name spoke2-to-hub --allow-forwarded-traffic true`, RUN("vm-api", "ufw allow from 10.1.0.0/16 to any port 443 proto tcp")],
  },
  {
    id: "launch-day", tier: "expert", stage: "Incident", title: "Nothing works on launch day",
    story: "\"Launch is in an hour and the client team can't open the shop at all.\" Clients are in vnet-client, like vm-client, which is peered with vnet-shop. They open shop.corp.internal, which points at lb-shop at 10.1.1.10, in front of vm-web1 and vm-web2. Both web servers have to be in rotation for launch traffic. Clients never get SSH to them.",
    fix: "The client team can't open the shop.",
    clock: 25,
    setup: () => {
      const st = shop({ probePort: 443, stopped2: true, probeRule: false });
      vnet(st, "vnet-client", ["10.2.0.0/16"], { "subnet-client": { p: "10.2.1.0/24" } });
      delete st.hosts["vm-client"];
      host(st, "vm-client", "vnet-client", "subnet-client", "10.2.1.4");
      peer(st, "vnet-shop", "vnet-client"); peer(st, "vnet-client", "vnet-shop");
      st.nsgs["nsg-web"].rules.find((r) => r.name === "Allow-HTTPS-Clients")!.src = ["10.2.0.0/16"];
      st.zones["corp.internal"] = { records: { shop: "10.1.1.10" }, links: { "link-shop": { vnet: "vnet-shop", reg: false } } };
      return st;
    },
    objectives: [
      { text: "Get shop.corp.internal resolving to 10.1.1.10 and opening on 443 from vm-client", test: ({ st }) => looksUp(st, "vm-client", "shop.corp.internal") === "10.1.1.10" && can(st, "vm-client", "10.1.1.10", 443) },
      { text: "Get vm-web1 and vm-web2 both passing the health probe", test: ({ st }) => healthy(st, "lb-shop", "vm-web1") && healthy(st, "lb-shop", "vm-web2") },
      { text: "Keep SSH from vm-client to the web servers blocked", test: ({ st }) => !can(st, "vm-client", "10.1.1.4", 22) },
    ],
    par: 3,
    hints: [],
    lesson: "Three layers, three faults: the private zone wasn't linked to the clients' VNet, a deny-all ran before the default rule that admits the probe, and one web server's service was stopped. Name, network, then the VM: work them in order and test after each.",
    why: "Each fault sat on a different layer. Linking corp.internal to vnet-client let clients resolve the name, an AzureLoadBalancer allow ahead of the deny-all let the probe in, and starting nginx on vm-web2 gave the probe an answer. With both servers healthy, the load balancer had backends to send clients to.",
    learn: [LEARN.zoneLink, LEARN.probeFw, LEARN.probe, LEARN.probeA],
    flows: [{ from: "vm-client", dns: "shop.corp.internal", expect: "lb-shop-fe", port: 443, want: "open" }],
    solution: [
      `az network private-dns link vnet create ${G} --zone-name corp.internal --name link-client --virtual-network vnet-client --registration-enabled false`,
      `az network nsg rule create ${G} --nsg-name nsg-web --name Allow-LB-Probe --priority 300 --direction Inbound --access Allow --protocol Tcp --source-address-prefixes AzureLoadBalancer --destination-port-ranges 443`,
      RUN("vm-web2", "systemctl start nginx"),
    ],
  },
];

