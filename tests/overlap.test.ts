import { describe, expect, it } from "vitest";
import { SANDBOX } from "@/content";
import { run } from "@/sim/shell";
import { newSession } from "@/sim/types";

describe("creating a VNet that overlaps another", () => {
  it("still works, like Azure, but says which network it overlaps and that they can't be peered", () => {
    const st = SANDBOX.setup();
    const r = run(st, "az network vnet create -g rg-lab --name vnet-5 --address-prefixes 10.1.1.0/24", newSession());
    expect(r.error).toBeFalsy();
    expect(st.vnets["vnet-5"]).toBeTruthy();
    expect(r.text).toMatch(/overlaps vnet-spoke1 \(10\.1\.0\.0\/16\)\. Azure allows this, but networks with overlapping address space can't be peered/);
  });
  it("says nothing when the range is free", () => {
    const st = SANDBOX.setup();
    expect(run(st, "az network vnet create -g rg-lab --name vnet-6 --address-prefixes 10.60.0.0/16", newSession()).text).not.toMatch(/overlaps/);
  });
});
