import { describe, expect, it } from "vitest";
import { LEVELS, SANDBOX, createsIn, formPolicy, formStep } from "@/content";
import { run } from "@/sim/shell";
import { newSession, type State } from "@/sim/types";
import { actionsFor, allowed, createActions, diagnoseActions, initialValues, serviceActions, type Action, type Values } from "@/lib/forms";
import type { Selection } from "@/components/NetworkMap";

const level = (id: string) => LEVELS.find((l) => l.id === id)!;

/** Fill a form like a user would and run what it builds. */
function use(st: State, actions: Action[], idPrefix: string, set: Values = {}) {
  const a = actions.find((x) => x.id.startsWith(idPrefix));
  if (!a) throw new Error(`no action ${idPrefix} in ${actions.map((x) => x.id).join(", ")}`);
  let v = initialValues(a);
  for (const [k, val] of Object.entries(set)) {
    v = { ...v, [k]: val };
    if (a.prefillOn === k && a.prefill) v = { ...v, ...a.prefill(v) };
  }
  const b = a.build(v);
  if (!("cmds" in b)) throw new Error(`${a.id}: ${b.error}`);
  const session = newSession();
  for (const c of b.cmds) {
    const r = run(st, c, session);
    expect(r.error, `${c}\n${r.text}`).toBeFalsy();
  }
  return b;
}
const sel = (s: Selection) => s;
const solved = (id: string, st: State) => level(id).objectives.filter((o) => !o.question && !o.action).every((o) => o.test({ st, session: newSession() }));

describe("forms solve levels without typing", () => {
  it("first-nsg: create and associate an NSG", () => {
    const st = level("first-nsg").setup();
    use(st, createActions(st), "create-nsg", { name: "nsg-web" });
    use(st, actionsFor(st, sel({ kind: "subnet", vnet: "vnet-app", subnet: "subnet-web" })), "sn-nsg-", { nsg: "nsg-web" });
    expect(st.vnets["vnet-app"].subnets["subnet-web"].nsg).toBe("nsg-web");
  });
  it("ip-flow-verify: add an allow rule", () => {
    const st = level("ip-flow-verify").setup();
    use(st, actionsFor(st, sel({ kind: "subnet", vnet: "vnet-app", subnet: "subnet-web" })), "rule-add-nsg-web-Inbound", { source: "IP", sourceIps: "10.1.2.0/24", ports: "443", priority: "200", name: "Allow-HTTPS-Client" });
    expect(solved("ip-flow-verify", st)).toBe(true);
  });
  it("first-peering: one form creates both links", () => {
    const st = level("first-peering").setup();
    const b = use(st, actionsFor(st, sel({ kind: "vnet", id: "vnet-a" })), "peer-vnet-a", { remote: "vnet-b" });
    expect(b.cmds).toHaveLength(2);
    expect(solved("first-peering", st)).toBe(true);
  });
  it("first-match-wins: edit a rule's priority", () => {
    const st = level("first-match-wins").setup();
    use(st, actionsFor(st, sel({ kind: "subnet", vnet: "vnet-app", subnet: "subnet-web" })), "rule-edit-nsg-web", { rule: "Allow-HTTPS-Client", priority: "150" });
    expect(solved("first-match-wins", st)).toBe(true);
  });
  it("two-locks: add a rule to the NIC's NSG from the VM", () => {
    const st = level("two-locks").setup();
    const vm = Object.values(st.hosts).find((h) => h.nicNsg)!;
    use(st, actionsFor(st, sel({ kind: "host", id: vm.name })), `rule-add-${vm.nicNsg}-Inbound`, { source: "IP", sourceIps: "10.1.2.0/24", ports: "8443", name: "Allow-API-Client" });
    expect(solved("two-locks", st)).toBe(true);
  });
  it("half-a-handshake: create only the missing link", () => {
    const st = level("half-a-handshake").setup();
    const b = use(st, actionsFor(st, sel({ kind: "peer", a: "vnet-hub", b: "vnet-spoke1" })), "peer-vnet-spoke1");
    expect(b.cmds).toHaveLength(1);
    expect(solved("half-a-handshake", st)).toBe(true);
  });
  it("review-beginner: missing link, then an NSG on the subnet", () => {
    const st = level("review-beginner").setup();
    use(st, actionsFor(st, sel({ kind: "peer", a: "vnet-shop", b: "vnet-pay" })), "peer-vnet-pay");
    use(st, createActions(st), "create-nsg", { name: "nsg-api" });
    use(st, actionsFor(st, sel({ kind: "subnet", vnet: "vnet-pay", subnet: "subnet-api" })), "sn-nsg-", { nsg: "nsg-api" });
    expect(solved("review-beginner", st)).toBe(true);
  });
  it("review-intermediate: turn access on, then open the NIC for 443", () => {
    const st = level("review-intermediate").setup();
    use(st, actionsFor(st, sel({ kind: "peer", a: "vnet-hub", b: "vnet-spoke1" })), "peer-edit-vnet-spoke1-", { access: "true" });
    use(st, actionsFor(st, sel({ kind: "host", id: "vm-hub" })), "rule-add-nsg-vm-hub-nic-Inbound", { source: "IP", sourceIps: "10.1.0.0/16", ports: "443", name: "Allow-Reports-Spoke1" });
    expect(solved("review-intermediate", st)).toBe(true);
  });
  it("room-to-grow: add a range, then a subnet", () => {
    const st = level("room-to-grow").setup();
    use(st, actionsFor(st, sel({ kind: "vnet", id: "vnet-app" })), "vnet-space-", { space: "10.1.0.0/24, 10.1.1.0/24" });
    use(st, actionsFor(st, sel({ kind: "vnet", id: "vnet-app" })), "subnet-add-", { name: "subnet-data", range: "10.1.1.0/24" });
    expect(solved("room-to-grow", st)).toBe(true);
  });
  it("service-tags: one rule with the VirtualNetwork tag", () => {
    const st = level("service-tags").setup();
    use(st, actionsFor(st, sel({ kind: "subnet", vnet: "vnet-app", subnet: "subnet-web" })), "rule-add-nsg-web-Inbound", { source: "Tag", tag: "VirtualNetwork", ports: "443", priority: "300", name: "Allow-HTTPS-VNet" });
    expect(solved("service-tags", st)).toBe(true);
  });
  it("outbound-rules: an outbound deny from the subnet", () => {
    const st = level("outbound-rules").setup();
    use(st, actionsFor(st, sel({ kind: "subnet", vnet: "vnet-app", subnet: "subnet-web" })), "rule-add-nsg-web-Outbound", { dest: "IP", destIps: "10.1.3.0/24", ports: "22", priority: "200", name: "Deny-SSH-To-DB", access: "Deny" });
    expect(solved("outbound-rules", st)).toBe(true);
  });
  it("nic-nsg: associate an NSG with one NIC", () => {
    const st = level("nic-nsg").setup();
    use(st, actionsFor(st, sel({ kind: "host", id: "vm-admin" })), "nic-nsg-vm-admin", { nsg: "nsg-admin" });
    expect(solved("nic-nsg", st)).toBe(true);
  });
  it("first-route: table, None route, association", () => {
    const st = level("first-route").setup();
    use(st, createActions(st), "create-rt", { name: "rt-web" });
    use(st, actionsFor(st, sel({ kind: "subnet", vnet: "vnet-app", subnet: "subnet-web" })), "sn-rt-", { rt: "rt-web" });
    use(st, actionsFor(st, sel({ kind: "subnet", vnet: "vnet-app", subnet: "subnet-web" })), "route-add-rt-web", { name: "drop-old", prefix: "10.1.9.0/24", type: "None" });
    expect(solved("first-route", st)).toBe(true);
  });
  it("private-dns: zone, record, link", () => {
    const st = level("private-dns").setup();
    use(st, createActions(st), "create-zone", { name: "lab.internal" });
    use(st, actionsFor(st, sel({ kind: "zone", id: "lab.internal" })), "zone-record-", { name: "db", ip: "10.1.3.4" });
    use(st, actionsFor(st, sel({ kind: "zone", id: "lab.internal" })), "zone-link-", { vnet: "vnet-app" });
    expect(solved("private-dns", st)).toBe(true);
  });
  it("overlap: change the address space, then peer", () => {
    const st = level("overlap").setup();
    use(st, actionsFor(st, sel({ kind: "vnet", id: "vnet-spoke2" })), "vnet-space-", { space: "10.20.0.0/16" });
    use(st, actionsFor(st, sel({ kind: "vnet", id: "vnet-spoke2" })), "peer-vnet-spoke2", { remote: "vnet-hub" });
    expect(solved("overlap", st)).toBe(true);
  });
  it("spokes-dont-talk: route tables, routes and associations", () => {
    const st = level("spokes-dont-talk").setup();
    for (const [n, me, other, pfx] of [["1", "vnet-spoke1", "spoke2", "10.2.0.0/16"], ["2", "vnet-spoke2", "spoke1", "10.1.0.0/16"]]) {
      use(st, createActions(st), "create-rt", { name: `rt-spoke${n}` });
      use(st, actionsFor(st, sel({ kind: "subnet", vnet: me, subnet: "subnet-app" })), "sn-rt-", { rt: `rt-spoke${n}` });
      use(st, actionsFor(st, sel({ kind: "subnet", vnet: me, subnet: "subnet-app" })), `route-add-rt-spoke${n}`, { name: `to-${other}`, prefix: pfx, nh: "10.0.2.4" });
    }
    expect(solved("spokes-dont-talk", st)).toBe(true);
  });
  it("ghost-next-hop: edit a route's next hop", () => {
    const st = level("ghost-next-hop").setup();
    use(st, actionsFor(st, sel({ kind: "subnet", vnet: "vnet-spoke1", subnet: "subnet-app" })), "route-edit-rt-spoke1", { route: "to-spoke2", nh: "10.0.2.4" });
    expect(solved("ghost-next-hop", st)).toBe(true);
  });
  it("wrong-side-of-the-glass: link the zone", () => {
    const st = level("wrong-side-of-the-glass").setup();
    const z = Object.keys(st.zones)[0];
    use(st, actionsFor(st, sel({ kind: "zone", id: z })), "zone-link-", { vnet: "vnet-spoke1" });
    expect(solved("wrong-side-of-the-glass", st)).toBe(true);
  });
  it("reading-cidr: create a virtual network", () => {
    const st = level("reading-cidr").setup();
    use(st, createActions(st), "create-vnet", { name: "vnet-lab", space: "10.50.0.0/16" });
    expect(st.vnets["vnet-lab"].prefixes).toEqual(["10.50.0.0/16"]);
  });
});

describe("forms", () => {
  it("diagnostics run cleanly in every level with a VM", () => {
    for (const l of [...LEVELS, SANDBOX]) {
      const st = l.setup();
      const d = diagnoseActions(st);
      if (!d.length) continue;
      const other = Object.values(st.hosts).find((h) => h.name !== d[0].fields[0].def) ?? Object.values(st.hosts)[0];
      use(st, d, "diag-ipflow", { rip: other.ip });
      use(st, d, "diag-nexthop", { dest: other.ip });
      use(st, d, "diag-routes");
      use(st, d, "diag-nsg");
    }
  });
  it("tier policy: the Portal is free in every tier", () => {
    expect(formPolicy(level("meet-the-vnet"))).toEqual({ fix: "off", diagnose: false });
    expect(formPolicy(level("first-nsg"))).toMatchObject({ fix: "free", diagnose: false });
    expect(formPolicy(level("where-packets-go"))).toEqual({ fix: "off", diagnose: true });
    for (const id of ["first-match-wins", "gateway-transit", "reports-down"]) expect(formPolicy(level(id))).toEqual({ fix: "free", diagnose: true });
    expect(formPolicy(SANDBOX).fix).toBe("free");
  });
  it("guided levels offer only the change they teach", () => {
    const l = level("carving-subnets");
    const st = l.setup();
    expect(allowed(actionsFor(st, { kind: "vnet", id: "vnet-app" }), formPolicy(l)).map((a) => a.id)).toEqual(["subnet-add-vnet-app"]);
    expect(allowed(createActions(st), formPolicy(l))).toEqual([]);
    const m = level("first-match-wins");
    expect(allowed(actionsFor(m.setup(), { kind: "vnet", id: "vnet-app" }), formPolicy(m)).length).toBeGreaterThan(1);
  });
  it("every guided level's allowed forms can still solve it", () => {
    for (const l of LEVELS.filter((x) => x.forms?.only)) expect(portalForms(l, l.setup()).length, l.id).toBeGreaterThan(0);
  });
  it("incomplete forms say what's missing instead of building", () => {
    const st = level("ip-flow-verify").setup();
    const a = actionsFor(st, { kind: "subnet", vnet: "vnet-app", subnet: "subnet-web" }).find((x) => x.id.startsWith("rule-add"))!;
    const b = a.build({ ...initialValues(a), source: "IP", sourceIps: "" });
    expect("error" in b).toBe(true);
  });
  it("rule explanations say where the rule lands", () => {
    const st = level("first-match-wins").setup();
    const b = use(st, actionsFor(st, { kind: "subnet", vnet: "vnet-app", subnet: "subnet-web" }), "rule-edit-nsg-web", { rule: "Allow-HTTPS-Client", priority: "150" });
    expect(b.why).toMatch(/before .*\(\d+\)/);
  });
});

/** Every change form the Portal offers in this state, under the level's policy, the way the player builds the tabs. */
function portalForms(l: (typeof LEVELS)[number], st: State): Action[] {
  const sels: Selection[] = [
    ...Object.keys(st.vnets).map((id) => ({ kind: "vnet" as const, id })),
    ...Object.entries(st.vnets).flatMap(([v, vn]) => Object.keys(vn.subnets).map((sn) => ({ kind: "subnet" as const, vnet: v, subnet: sn }))),
    ...Object.keys(st.hosts).map((id) => ({ kind: "host" as const, id })),
    ...Object.keys(st.zones).map((id) => ({ kind: "zone" as const, id })),
    ...Object.values(st.peerings).map((p) => ({ kind: "peer" as const, a: p.vnet, b: p.remote })),
  ];
  const all = [...sels.flatMap((x) => actionsFor(st, x)), ...createActions(st).filter((a) => createsIn(l).includes(a.id)), ...serviceActions(st)];
  return allowed(all, formPolicy(l));
}
const CHANGE = /^az ((network|storage|dns-resolver) .* (create|update|delete|add|sync|add-record)|vm run-command invoke)( |$)/;

describe("the Portal can make every fix", () => {
  for (const l of LEVELS) {
    it(l.id, () => {
      const st = l.setup();
      const session = newSession();
      for (const cmd of l.solution) {
        const verb = cmd.split(" -")[0].trim();
        if (CHANGE.test(verb + " ")) {
          const forms = portalForms(l, st);
          expect(forms.some((a) => a.verb?.some((v) => verb === v)), `no Portal form for: ${verb}`).toBe(true);
        }
        run(st, cmd, session);
      }
    });
  }
});

describe("Advanced and Expert solved through the Portal alone", () => {
  it("gateway-transit: transit on the hub, remote gateway on the spoke", () => {
    const st = level("gateway-transit").setup();
    use(st, actionsFor(st, sel({ kind: "peer", a: "vnet-hub", b: "vnet-spoke1" })), "peer-edit-vnet-hub-", { gwt: "true" });
    use(st, actionsFor(st, sel({ kind: "peer", a: "vnet-hub", b: "vnet-spoke1" })), "peer-edit-vnet-spoke1-", { urg: "true" });
    use(st, actionsFor(st, sel({ kind: "subnet", vnet: "vnet-spoke1", subnet: "subnet-app" })), "rule-del-nsg-app", { rule: "Deny-OnPrem-Out" });
    expect(solved("gateway-transit", st)).toBe(true);
  });
  it("selected-networks: service endpoint, then a storage rule", () => {
    const st = level("selected-networks").setup();
    use(st, actionsFor(st, sel({ kind: "subnet", vnet: "vnet-app", subnet: "subnet-app" })), "sn-se-", { se: "Microsoft.Storage" });
    use(st, serviceActions(st), "st-rule-stdata01", { sub: "vnet-app/subnet-app" });
    use(st, actionsFor(st, sel({ kind: "subnet", vnet: "vnet-app", subnet: "subnet-app" })), "rule-add-nsg-app-Outbound", { dest: "Tag", destTag: "Storage", ports: "*", protocol: "Any", priority: "200", name: "Allow-Storage-Out" });
    expect(solved("selected-networks", st)).toBe(true);
  });
  it("custom-dns: DNS servers and a zone link", () => {
    const st = level("custom-dns").setup();
    use(st, actionsFor(st, sel({ kind: "vnet", id: "vnet-spoke1" })), "vnet-dns-", { mode: "custom", ips: "10.0.4.4" });
    use(st, actionsFor(st, sel({ kind: "zone", id: "privatelink.blob.core.windows.net" })), "zone-link-", { vnet: "vnet-hub" });
    expect(solved("custom-dns", st)).toBe(true);
  });
  it("resolver-inbound: inbound endpoint, then point the spoke at it", () => {
    const st = level("resolver-inbound").setup();
    use(st, serviceActions(st), "dnspr-in-dnspr-hub", { sub: "vnet-hub/snet-dns-in" });
    use(st, actionsFor(st, sel({ kind: "vnet", id: "vnet-spoke1" })), "vnet-dns-", { mode: "custom", ips: "10.0.5.4" });
    expect(solved("resolver-inbound", st)).toBe(true);
  });
  it("resolver-rules: fix the rule target and link the spoke", () => {
    const st = level("resolver-rules").setup();
    use(st, serviceActions(st), "rs-rule-rs-onprem", { rule: "corp", target: "192.168.10.10" });
    use(st, serviceActions(st), "rs-link-rs-onprem", { vnet: "vnet-spoke1" });
    expect(solved("resolver-rules", st)).toBe(true);
  });
  it("firewall-rules: a new allow collection and the return route", () => {
    const st = level("firewall-rules").setup();
    use(st, actionsFor(st, sel({ kind: "host", id: "azfw-hub" })), "fw-rule-", { col: "__new", colName: "Allow-HTTPS", priority: "150", name: "https", src: "10.1.0.0/16", dst: "10.2.0.0/16", ports: "443" });
    use(st, actionsFor(st, sel({ kind: "subnet", vnet: "vnet-spoke2", subnet: "subnet-app" })), "route-add-rt-spoke2", { name: "to-spoke1", prefix: "10.1.0.0/16", type: "VirtualAppliance", nh: "10.0.1.4" });
    expect(solved("firewall-rules", st)).toBe(true);
  });
  it("bastion-build: subnet, public IP, Bastion, NSG rule", () => {
    const st = level("bastion-build").setup();
    use(st, actionsFor(st, sel({ kind: "vnet", id: "vnet-hub" })), "subnet-add-", { name: "AzureBastionSubnet", range: "10.0.7.0/26" });
    use(st, createActions(st), "create-pip", { name: "pip-bastion2", sku: "Standard" });
    use(st, createActions(st), "create-bastion", { name: "bas-hub", vnet: "vnet-hub", pip: "pip-bastion2", sku: "Basic" });
    use(st, actionsFor(st, sel({ kind: "subnet", vnet: "vnet-hub", subnet: "subnet-app" })), "rule-edit-nsg-app", { rule: "Allow-SSH-Bastion", source: "IP", sourceIps: "10.0.7.0/26" });
    expect(solved("bastion-build", st)).toBe(true);
  });
  it("corp-names: back to Azure DNS, then link the ruleset", () => {
    const st = level("corp-names").setup();
    use(st, actionsFor(st, sel({ kind: "vnet", id: "vnet-spoke2" })), "vnet-dns-", { mode: "default" });
    use(st, serviceActions(st), "rs-link-rs-onprem", { vnet: "vnet-spoke2" });
    expect(solved("corp-names", st)).toBe(true);
  });
  it("endpoint-choice: storage networking form keeps public access off", () => {
    const st = level("endpoint-choice").setup();
    const a = serviceActions(st).find((x) => x.id === "st-net-stlogs03")!;
    expect("error" in a.build(initialValues(a))).toBe(true);
  });
});

describe("editing a rule's destination", () => {
  it("counts a destination change, and the rule ends up with it", () => {
    const l = LEVELS.find((x) => x.id === "wrong-tag")!;
    const st = l.setup();
    const s = newSession();
    run(st, "az network nsg rule create -g rg-lab --nsg-name nsg-web --name Allow-HTTPS-SvcTag --priority 300 --direction Inbound --access Allow --protocol Tcp --source-address-prefixes VirtualNetwork --destination-address-prefixes VirtualNetwork --destination-port-ranges 443", s);
    use(st, actionsFor(st, sel({ kind: "subnet", vnet: "vnet-app", subnet: "subnet-web" })), "rule-edit-nsg-web", { rule: "Allow-HTTPS-SvcTag", dest: "IP", destIps: "10.1.1.4" });
    expect(st.nsgs["nsg-web"].rules.find((r) => r.name === "Allow-HTTPS-SvcTag")!.dst).toEqual(["10.1.1.4"]);
  });
});
