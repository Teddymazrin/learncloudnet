import { describe, expect, it } from "vitest";
import { SANDBOX } from "@/content";
import { actionsFor } from "@/lib/forms";
import { peeringState, findLink } from "@/sim/network";
import { run } from "@/sim/shell";
import { newSession } from "@/sim/types";

const az = (st: ReturnType<typeof SANDBOX.setup>, c: string) => run(st, c, newSession());

describe("detaching an NSG or route table (the az reference: Use null to detach it)", () => {
  it("detaches a subnet's route table and NSG with null or an empty value, then lets them be deleted", () => {
    const st = SANDBOX.setup();
    az(st, "az network route-table create -g rg-lab -n rt-x");
    az(st, "az network nsg create -g rg-lab -n nsg-x");
    az(st, "az network vnet subnet update -g rg-lab --vnet-name vnet-spoke1 --name subnet-app --route-table rt-x --network-security-group nsg-x");
    // The hint in the in-use error must be a command that works.
    const hint = az(st, "az network route-table delete -g rg-lab -n rt-x").text;
    expect(hint).toMatch(/--route-table null/);
    expect(az(st, "az network vnet subnet update -g rg-lab --vnet-name vnet-spoke1 --name subnet-app --route-table null").text).not.toMatch(/not found/);
    expect(st.vnets["vnet-spoke1"].subnets["subnet-app"].rt).toBeNull();
    expect(az(st, "az network vnet subnet update -g rg-lab --vnet-name vnet-spoke1 --name subnet-app --network-security-group \"\"").text).not.toMatch(/not found/);
    expect(st.vnets["vnet-spoke1"].subnets["subnet-app"].nsg).toBeNull();
    expect(az(st, "az network route-table delete -g rg-lab -n rt-x").text).toBe("");
    expect(az(st, "az network nsg delete -g rg-lab -n nsg-x").text).toBe("");
  });

  it("detaches a NIC's NSG with null", () => {
    const st = SANDBOX.setup();
    az(st, "az network nsg create -g rg-lab -n nsg-nic");
    const nic = st.hosts["vm-spoke1"].nic;
    az(st, `az network nic update -g rg-lab --name ${nic} --network-security-group nsg-nic`);
    expect(st.hosts["vm-spoke1"].nicNsg).toBe("nsg-nic");
    az(st, `az network nic update -g rg-lab --name ${nic} --network-security-group null`);
    expect(st.hosts["vm-spoke1"].nicNsg).toBeNull();
  });

  it("offers None in the Portal association forms once something is attached", () => {
    const st = SANDBOX.setup();
    az(st, "az network route-table create -g rg-lab -n rt-x");
    az(st, "az network vnet subnet update -g rg-lab --vnet-name vnet-spoke1 --name subnet-app --route-table rt-x");
    const a = actionsFor(st, { kind: "subnet", vnet: "vnet-spoke1", subnet: "subnet-app" }).find((x) => x.id === "sn-rt-vnet-spoke1-subnet-app");
    expect(a).toBeTruthy();
    const none = a!.fields[0].options!.find(([, label]) => /None/.test(label));
    expect(none).toBeTruthy();
    const built = a!.build({ rt: none![0] } as never) as { cmds: string[] };
    expect(built.cmds[0]).toMatch(/--route-table null$/);
    az(st, built.cmds[0]);
    expect(st.vnets["vnet-spoke1"].subnets["subnet-app"].rt).toBeNull();
  });
});

describe("peering Disconnected state", () => {
  it("leaves the other link Disconnected and refuses to re-peer until it's deleted too", () => {
    const st = SANDBOX.setup();
    expect(az(st, "az network vnet peering delete -g rg-lab --vnet-name vnet-spoke1 --name spoke1-to-hub").text).toMatch(/hub-to-spoke1 on vnet-hub is now Disconnected/);
    expect(peeringState(st, findLink(st, "vnet-hub", "vnet-spoke1")!)).toBe("Disconnected");
    expect(az(st, "az network vnet peering create -g rg-lab --vnet-name vnet-spoke1 --name spoke1-to-hub --remote-vnet vnet-hub --allow-vnet-access").text).toMatch(/can't be re-created while one side is Disconnected/);
    az(st, "az network vnet peering delete -g rg-lab --vnet-name vnet-hub --name hub-to-spoke1");
    az(st, "az network vnet peering create -g rg-lab --vnet-name vnet-spoke1 --name spoke1-to-hub --remote-vnet vnet-hub --allow-vnet-access");
    az(st, "az network vnet peering create -g rg-lab --vnet-name vnet-hub --name hub-to-spoke1 --remote-vnet vnet-spoke1 --allow-vnet-access");
    expect(peeringState(st, findLink(st, "vnet-hub", "vnet-spoke1")!)).toBe("Connected");
  });

  it("deleting a link that was only Initiated leaves nothing Disconnected", () => {
    const st = SANDBOX.setup();
    az(st, "az network vnet create -g rg-lab --name vnet-c --address-prefixes 10.9.0.0/16");
    az(st, "az network vnet peering create -g rg-lab --vnet-name vnet-c --name c-to-hub --remote-vnet vnet-hub --allow-vnet-access");
    expect(az(st, "az network vnet peering delete -g rg-lab --vnet-name vnet-c --name c-to-hub").text).toBe("");
    expect(Object.values(st.peerings).some((p) => p.disconnected)).toBe(false);
  });
});

describe("nsg rule create defaults (az reference: Inbound, Allow, *, port 80)", () => {
  it("applies the real defaults and says so, flagging port 80", () => {
    const st = SANDBOX.setup();
    az(st, "az network nsg create -g rg-lab -n nsg-x");
    const out = az(st, "az network nsg rule create -g rg-lab --nsg-name nsg-x -n r1 --priority 200").text;
    expect(out).not.toMatch(/arguments are required/);
    expect(out).toMatch(/--destination-port-ranges 80/);
    expect(out).toMatch(/Port 80 is easy to miss/);
    const r = st.nsgs["nsg-x"].rules[0];
    expect([r.direction, r.access, r.protocol, r.ports]).toEqual(["Inbound", "Allow", "*", ["80"]]);
  });

  it("still requires --priority, like the real CLI", () => {
    const st = SANDBOX.setup();
    az(st, "az network nsg create -g rg-lab -n nsg-x");
    expect(az(st, "az network nsg rule create -g rg-lab --nsg-name nsg-x -n r1").text).toMatch(/required: --priority/);
  });

  it("adds no note when every flag is passed", () => {
    const st = SANDBOX.setup();
    az(st, "az network nsg create -g rg-lab -n nsg-x");
    expect(az(st, "az network nsg rule create -g rg-lab --nsg-name nsg-x -n r1 --priority 200 --direction Inbound --access Deny --protocol Tcp --destination-port-ranges 22").text).not.toMatch(/defaults/);
  });
});
