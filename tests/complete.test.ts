import { describe, expect, it } from "vitest";
import { LEVELS } from "@/content";
import { suggest } from "@/lib/complete";
import { run } from "@/sim/shell";
import { newSession } from "@/sim/types";

const st = () => LEVELS.find((l) => l.id === "first-match-wins")!.setup();
const values = (d: string) => suggest(d, st(), false).map((s) => s.value);

describe("shell autocomplete", () => {
  it("completes the command path word by word", () => {
    expect(values("az net")).toContain("az network ");
    expect(values("az network ns")).toContain("az network nsg ");
    expect(values("az network nsg rule u")).toContain("az network nsg rule update ");
  });
  it("offers the flags levels use, without repeating one", () => {
    const v = values("az network nsg rule update -g rg-lab --nsg-name nsg-web --");
    expect(v.some((x) => x.endsWith("--priority "))).toBe(true);
    expect(v.some((x) => x.endsWith("--nsg-name "))).toBe(false);
  });
  it("suggests names from the lab after a name flag", () => {
    expect(values("az network nsg rule list -g rg-lab --nsg-name nsg")).toContain("az network nsg rule list -g rg-lab --nsg-name nsg-web ");
    expect(values("az network vnet show -g rg")).toContain("az network vnet show -g rg-lab ");
  });
  it("stays quiet inside a VM and on an empty line", () => {
    expect(suggest("ufw st", st(), true)).toEqual([]);
    expect(suggest("", st(), false)).toEqual([]);
  });
  it("every suggested command path is one the simulator runs", () => {
    for (const v of values("az network ")) {
      const r = run(st(), `${v.trim()} --help`, newSession());
      expect(r.error ?? false).toBe(false);
    }
  });
});

describe("early Intermediate levels name a tool to start with", () => {
  it("the first five have one, the rest don't", () => {
    const inter = LEVELS.filter((l) => l.tier === "intermediate");
    expect(inter.slice(0, 5).every((l) => !!l.tool)).toBe(true);
    expect(inter.slice(5).some((l) => !!l.tool)).toBe(false);
  });
});

describe("did you mean", () => {
  const say = (line: string) => run(st(), line, newSession()).text;
  it("names the closest command for a typo", () => {
    expect(say("az network nsg rule lst -g rg-lab --nsg-name nsg-web")).toContain("did you mean 'az network nsg rule list'?");
    expect(say("az network vnet peering lis -g rg-lab --vnet-name x")).toContain("az network vnet peering list");
  });
  it("adds a forgotten network group", () => {
    expect(say("az nsg rule list -g rg-lab --nsg-name nsg-web")).toContain("did you mean 'az network nsg rule list'?");
  });
  it("lists the next word when a group is cut short", () => {
    const t = say("az network nsg rule");
    expect(t).toContain("needs one more word");
    expect(t).toContain("update");
  });
  it("stays quiet when nothing is close", () => {
    expect(say("az network banana split now")).toContain("Type help");
    expect(say("az network banana split now")).not.toContain("did you mean");
  });
  it("catches typos outside az too", () => {
    expect(say("ax network vnet list")).toContain("Did you mean az?");
    const s = newSession();
    run(st(), "ssh vm-web", s);
    expect(run(st(), "nslokup example.com", s).text).toContain("Did you mean nslookup?");
  });
});

describe("did you mean never guesses a different verb", () => {
  it("lists the real options instead", () => {
    const t = run(LEVELS.find((l) => l.id === "spokes-dont-talk")!.setup(), "az network route-table route lst -g rg-lab", newSession()).text;
    expect(t).not.toContain("did you mean");
    expect(t).toContain("'az network route-table route' here has: create, delete, update.");
  });
});
