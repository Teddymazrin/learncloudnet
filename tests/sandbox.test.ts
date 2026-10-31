import { describe, expect, it } from "vitest";
import { SANDBOX, emptySandbox, LEVELS } from "@/content";
import { evalFlow } from "@/content/flows";
import { actionsFor, createActions, initialValues } from "@/lib/forms";
import { run } from "@/sim/shell";
import { newSession } from "@/sim/types";

const az = (st: ReturnType<typeof emptySandbox>, c: string) => run(st, c, newSession());

describe("sandbox: build and delete anything", () => {
  it("builds a working pair of VMs from an empty lab and watches the connection", () => {
    const st = emptySandbox();
    expect(az(st, "az network vnet create -g rg-lab --name vnet-a --address-prefixes 10.10.0.0/16 --subnet-name app --subnet-prefixes 10.10.1.0/24").error).toBeFalsy();
    expect(az(st, "az vm create -g rg-lab --name vm-1 --vnet-name vnet-a --subnet app --image Ubuntu2204").text).toMatch(/10\.10\.1\.4/);
    az(st, "az vm create -g rg-lab --name vm-2 --vnet-name vnet-a --subnet app --image Win2022Datacenter");
    expect(st.hosts["vm-2"].ip).toBe("10.10.1.5");
    expect(evalFlow(st, { from: "vm-1", to: "vm-2", port: 443, want: "open" }).good).toBe(true);
  });

  it("follows Azure's in-use rules when deleting", () => {
    const st = SANDBOX.setup();
    az(st, "az network nsg create -g rg-lab --name nsg-x");
    az(st, "az network vnet subnet update -g rg-lab --vnet-name vnet-spoke2 --name subnet-app --network-security-group nsg-x");
    expect(az(st, "az network nsg delete -g rg-lab --name nsg-x").text).toMatch(/InUseNetworkSecurityGroupCannotBeDeleted/);
    expect(az(st, "az network vnet subnet delete -g rg-lab --vnet-name vnet-spoke2 --name subnet-app").text).toMatch(/InUseSubnetCannotBeDeleted/);
    expect(az(st, "az network vnet delete -g rg-lab --name vnet-spoke2").text).toMatch(/in use/);
    az(st, "az vm delete -g rg-lab --name vm-spoke2 --yes");
    expect(az(st, "az network vnet delete -g rg-lab --name vnet-spoke2").text).toMatch(/Disconnected/);
    expect(st.vnets["vnet-spoke2"]).toBeUndefined();
  });

  it("creates resource groups and subscriptions, and deleting a group deletes what's in it", () => {
    const st = emptySandbox();
    expect(az(st, "az network vnet create -g rg-app --name vnet-b --address-prefixes 10.20.0.0/16").text).toMatch(/ResourceGroupNotFound/);
    az(st, "az account create --display-name Dev");
    az(st, "az group create --name rg-app --subscription Dev");
    expect(st.groups!["rg-app"].sub).toBe("Dev");
    az(st, "az network vnet create -g rg-app --name vnet-b --address-prefixes 10.20.0.0/16");
    expect(st.vnets["vnet-b"].rg).toBe("rg-app");
    az(st, "az group delete --name rg-app --yes");
    expect(st.vnets["vnet-b"]).toBeUndefined();
  });

  it("warns about overlaps as you type, and about builds that won't carry traffic", () => {
    const st = SANDBOX.setup();
    const create = createActions(st).find((a) => a.id === "create-vnet")!;
    const b = create.build({ ...initialValues(create), space: "10.1.0.0/16" });
    expect(b.warn).toMatch(/same range as vnet-spoke1/);
    az(st, "az network vnet create -g rg-lab --name vnet-c --address-prefixes 10.30.0.0/16");
    expect(az(st, "az network vnet peering create -g rg-lab --vnet-name vnet-c --name c-to-hub --remote-vnet vnet-hub --allow-vnet-access").text).toMatch(/Initiated until vnet-hub links back/);
  });

  it("offers Delete on what you tap, using the resource's own group", () => {
    const st = SANDBOX.setup();
    az(st, "az group create --name rg-app");
    az(st, "az network vnet create -g rg-app --name vnet-d --address-prefixes 10.40.0.0/16");
    const del = actionsFor(st, { kind: "vnet", id: "vnet-d" }).find((a) => a.id.startsWith("del-vnet"))!;
    const b = del.build(initialValues(del));
    expect("cmds" in b && b.cmds[0]).toBe("az network vnet delete -g rg-app --name vnet-d");
  });

  it("levels never get sandbox building tools", () => {
    for (const l of LEVELS) {
      const st = l.setup();
      expect(st.groups, l.id).toBeUndefined();
      expect(az(st, "az group create --name rg-x").text, l.id).toMatch(/only available in the sandbox/);
    }
  });
});
