import { describe, expect, it } from "vitest";
import { LEVELS, SANDBOX } from "@/content";
import { run } from "@/sim/shell";
import { newSession } from "@/sim/types";
import type { Level } from "@/content/types";
import { evalFlow, explainSteps } from "@/content/flows";

function play(level: Level, lines: string[]) {
  const st = level.setup();
  const session = newSession();
  // Steps say "Type exit when done" after a VM test, so leave the VM before the next az command, as a player would.
  const outputs = lines.map((l) => { if (l.startsWith("az ") && session.vm) run(st, "exit", session); return run(st, l, session); });
  const met = level.objectives.map((o) => o.test({ st, session }));
  return { st, session, outputs, met, done: met.length > 0 && met.every(Boolean) };
}

describe("every level", () => {
  for (const level of LEVELS) {
    describe(level.id, () => {
      it("does not start solved", () => {
        expect(play(level, []).done).toBe(false);
      });
      it("is solved by its solution", () => {
        const r = play(level, level.solution);
        const errors = r.outputs.filter((o) => o.error).map((o) => o.text);
        expect(errors).toEqual([]);
        expect(r.met).toEqual(level.objectives.map(() => true));
      });
      it("every guided command runs without a lab error", () => {
        const cmds = (level.steps ?? []).map((s) => s.cmd).filter((c): c is string => !!c && !c.startsWith("answer"));
        const r = play(level, cmds);
        const errors = r.outputs.filter((o) => o.error).map((o) => o.text);
        expect(errors).toEqual([]);
      });
      it("goal flows start broken and end in the wanted state", () => {
        if (!level.flows?.length) return;
        const start = level.setup();
        if (level.tier !== "beginner") expect(level.flows.map((f) => evalFlow(start, f).good).every(Boolean)).toBe(false);
        const r = play(level, level.solution);
        expect(level.flows.map((f) => evalFlow(r.st, f).good)).toEqual(level.flows.map(() => true));
        for (const f of level.flows) {
          const fr = evalFlow(start, f);
          const steps = explainSteps(start, fr);
          expect(steps.length).toBeGreaterThan(0);
          if (!fr.ok) expect(steps.some((x) => !x.ok)).toBe(true);
        }
      });
      it("has sources and hints", () => {
        expect(level.learn.length).toBeGreaterThan(0);
        expect(level.learn.every((l) => l.url.startsWith("https://learn.microsoft.com/"))).toBe(true);
        // Expert is incident mode: no hints, a clock instead.
        if (level.tier === "expert") expect(level.clock).toBeGreaterThan(0);
        else expect(level.hints.length).toBeGreaterThan(0);
      });
    });
  }
  it("ids are unique", () => {
    const ids = LEVELS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("sandbox challenges start open and can each be completed", () => {
    const met = (r: ReturnType<typeof play>) => SANDBOX.challenges!.map((c) => c.test({ st: r.st, session: r.session }));
    expect(met(play(SANDBOX, []))).toEqual([false, false, false]);
    const routes = ["1", "2"].flatMap((n) => {
      const other = n === "1" ? "2" : "1";
      return [
        `az network route-table create -g rg-lab --name rt-spoke${n}`,
        `az network route-table route create -g rg-lab --route-table-name rt-spoke${n} --name to-spoke${other} --address-prefix 10.${other}.0.0/16 --next-hop-type VirtualAppliance --next-hop-ip-address 10.0.2.4`,
        `az network vnet subnet update -g rg-lab --vnet-name vnet-spoke${n} --name subnet-app --route-table rt-spoke${n}`,
      ];
    });
    const lock = [
      "az network nsg create -g rg-lab --name nsg-spoke2",
      "az network nsg rule create -g rg-lab --nsg-name nsg-spoke2 --name Deny-SSH-Spoke1 --priority 200 --direction Inbound --access Deny --protocol Tcp --source-address-prefixes 10.1.0.0/16 --destination-port-ranges 22",
      "az network vnet subnet update -g rg-lab --vnet-name vnet-spoke2 --name subnet-app --network-security-group nsg-spoke2",
    ];
    const spoke3 = [
      "az network vnet create -g rg-lab --name vnet-spoke3 --address-prefixes 10.3.0.0/16 --subnet-name subnet-app --subnet-prefixes 10.3.1.0/24",
      "az network vnet peering create -g rg-lab --name spoke3-to-hub --vnet-name vnet-spoke3 --remote-vnet vnet-hub --allow-vnet-access",
      "az network vnet peering create -g rg-lab --name hub-to-spoke3 --vnet-name vnet-hub --remote-vnet vnet-spoke3 --allow-vnet-access",
    ];
    const r = play(SANDBOX, [...routes, ...lock, ...spoke3]);
    expect(r.outputs.filter((o) => o.error).map((o) => o.text)).toEqual([]);
    expect(met(r)).toEqual([true, true, true]);
    expect(met(play(SANDBOX, routes.slice(0, 3)))[0]).toBe(false);
  });
  it("sandbox loads", () => {
    expect(Object.keys(SANDBOX.setup().vnets)).toHaveLength(3);
  });
});

describe("wrong turns stay unsolved", () => {
  const get = (id: string) => LEVELS.find((l) => l.id === id)!;
  it("opening everything does not solve first-match-wins", () => {
    expect(play(get("first-match-wins"), ["az network nsg rule update -g rg-lab --nsg-name nsg-web --name Deny-All-Inbound --access Allow"]).done).toBe(false);
  });
  it("peering without --allow-vnet-access carries no traffic", () => {
    const r = play(get("half-a-handshake"), ["az network vnet peering create -g rg-lab --name spoke1-to-hub --vnet-name vnet-spoke1 --remote-vnet vnet-hub"]);
    expect(r.met.slice(0, 2)).toEqual([true, false]);
  });
  it("one-way routes leave the reply stranded", () => {
    const r = play(get("spokes-dont-talk"), get("spokes-dont-talk").solution.slice(0, 3));
    expect(r.done).toBe(false);
  });
  it("wrong answers don't count", () => {
    expect(play(get("carving-subnets"), [...get("carving-subnets").solution.slice(0, 1), "answer 1 64", "answer 2 10.1.3.0"]).done).toBe(false);
  });
  it("review-beginner: peering alone isn't enough", () => {
    const r = play(get("review-beginner"), get("review-beginner").solution.slice(0, 1));
    expect(r.met).toEqual([true, false, true, false]);
  });
  it("review-intermediate: fixing one layer leaves it broken", () => {
    const l = get("review-intermediate");
    expect(play(l, l.solution.slice(0, 1)).done).toBe(false);
    expect(play(l, l.solution.slice(1)).done).toBe(false);
  });
  it("review-intermediate: opening both NSGs to everything fails the port 22 goal", () => {
    const l = get("review-intermediate");
    const r = play(l, [l.solution[0], "az network nsg rule create -g rg-lab --nsg-name nsg-vm-hub-nic --name Allow-All --priority 300 --direction Inbound --access Allow --protocol * --source-address-prefixes VirtualNetwork --destination-port-ranges *", "az network nsg rule update -g rg-lab --nsg-name nsg-shared --name Deny-Vnet-Inbound --access Allow"]);
    expect(r.met).toEqual([true, false]);
  });
  it("removing a range a subnet uses is refused", () => {
    const r = play(get("overlap"), ["az network vnet update -g rg-lab --name vnet-spoke2 --address-prefixes 10.0.0.0/16"]);
    expect(r.outputs[0].error).toBe(true);
  });
});

describe("stacked faults: every fix is needed", () => {
  // Advanced and Expert levels have several faults. Leaving out any one fix must leave the level unsolved.
  for (const level of LEVELS.filter((l) => (l.tier === "advanced" || l.tier === "expert") && l.solution.length > 1)) {
    it(level.id, () => {
      level.solution.forEach((cmd, i) => {
        if (!/^(az .* (create|update|delete|add|sync|invoke)( |$)|answer )/.test(cmd)) return; // ssh, nslookup and exit aren't fixes
        const partial = level.solution.filter((__, j) => j !== i);
        expect(play(level, partial).done, `still solved without: ${level.solution[i]}`).toBe(false);
      });
    });
  }
});

describe("lazy fixes stay unsolved", () => {
  const get = (id: string) => LEVELS.find((l) => l.id === id)!;
  it("selected-networks: opening the storage firewall to everyone fails", () => {
    const l = get("selected-networks");
    const r = play(l, ["az storage account update --name stdata01 --default-action Allow", l.solution[2]]);
    expect(r.met.slice(0, 2)).toEqual([true, false]);
  });
  it("endpoint-choice: turning public access back on fails", () => {
    const r = play(get("endpoint-choice"), ["az storage account update --name stlogs03 --public-network-access Enabled"]);
    expect(r.done).toBe(false);
    expect(r.met[2]).toBe(false);
  });
  it("room-to-grow: passing only the new range is refused", () => {
    const r = play(get("room-to-grow"), ["az network vnet update -g rg-lab --name vnet-app --address-prefixes 10.1.1.0/24"]);
    expect(r.outputs[0].error).toBe(true);
  });
  it("service-tags: the Internet tag doesn't let the peered partner in", () => {
    const r = play(get("service-tags"), ["az network nsg rule create -g rg-lab --nsg-name nsg-web --name Allow-HTTPS --priority 300 --direction Inbound --access Allow --protocol Tcp --source-address-prefixes Internet --destination-port-ranges 443"]);
    expect(r.met.slice(0, 2)).toEqual([false, false]);
  });
  it("nic-nsg: putting the NSG on the subnet locks out vm-app too", () => {
    const r = play(get("nic-nsg"), ["az network vnet subnet update -g rg-lab --vnet-name vnet-app --name subnet-app --network-security-group nsg-admin"]);
    expect(r.met[0]).toBe(false);
    expect(r.met[3]).toBe(false);
  });
  it("gateway-transit: the spoke can't use the gateway before the hub allows transit", () => {
    const r = play(get("gateway-transit"), [get("gateway-transit").solution[1]]);
    expect(r.outputs[0].error).toBe(true);
  });
  it("bastion-build: the wrong subnet name and a public IP in another region are refused", () => {
    const l = get("bastion-build");
    expect(play(l, ["az network bastion create -g rg-lab --name bas-hub --vnet-name vnet-hub --public-ip-address pip-bastion --sku Basic"]).outputs[0].error).toBe(true);
    const r = play(l, [l.solution[0], "az network bastion create -g rg-lab --name bas-hub --vnet-name vnet-hub --public-ip-address pip-bastion --sku Basic"]);
    expect(r.outputs[1].text).toContain("same region");
  });
  it("resolver-inbound: an endpoint in a busy subnet is refused", () => {
    const r = play(get("resolver-inbound"), [`az dns-resolver inbound-endpoint create -g rg-lab --dns-resolver-name dnspr-hub --name in2 --ip-configurations "[{private-ip-allocation-method:Dynamic,id:/x/virtualNetworks/vnet-hub/subnets/subnet-shared}]"`]);
    expect(r.outputs[0].error).toBe(true);
  });
  it("firewall-rules: an allow below the deny never matches", () => {
    const r = play(get("firewall-rules"), [get("firewall-rules").solution[1], "az network firewall network-rule create -g rg-lab --firewall-name azfw-hub --collection-name Allow-Late --name https --priority 400 --action Allow --protocols TCP --source-addresses 10.1.0.0/16 --destination-addresses 10.2.0.0/16 --destination-ports 443"]);
    expect(r.met[0]).toBe(false);
  });
});

describe("shell", () => {
  it("joins bash line continuations", () => {
    const r = play(LEVELS[1], ["az network vnet create \\\n  -g rg-lab \\\n  --name vnet-lab \\\n  --address-prefixes 10.50.0.0/16"]);
    expect(r.st.vnets["vnet-lab"]).toBeDefined();
  });
  it("cidr tool reports Azure usable count", () => {
    const r = play(LEVELS[0], ["cidr 10.1.3.0/26"]);
    expect(r.outputs[0].text).toContain("59 usable");
  });
});
