import { describe, expect, it } from "vitest";
import { LEVELS } from "@/content";
import { fillForm, portalFor, walkthrough } from "@/lib/walkthrough";
import { serviceActions } from "@/lib/forms";
import { run } from "@/sim/shell";
import { newSession } from "@/sim/types";

const levels = LEVELS.filter((l) => !l.playground);

describe("the walkthrough", () => {
  it("every level has one, and its commands solve the level", () => {
    for (const l of levels) {
      const steps = walkthrough(l);
      expect(steps.length, l.id).toBeGreaterThan(0);
      // A level that only asks you to look, like reading a network's address space, has nothing to fix.
      const changes = l.solution.some((c) => c.startsWith("az ") && !/\b(list|show)\b/.test(c));
      expect(steps.some((s) => s.phase === "fix"), l.id).toBe(changes);
    }
  });

  it("every az change in a solution has a Portal form that builds exactly that command", () => {
    const missing: string[] = [];
    for (const l of levels) {
      const st = l.setup();
      const s = newSession();
      for (const cmd of l.solution) {
        if (cmd.startsWith("az ") && !/\b(list|show)\b/.test(cmd) && !portalFor(st, cmd)) missing.push(`${l.id}: ${cmd}`);
        run(st, cmd, s);
      }
    }
    expect(missing).toEqual([]);
  });

  it("fills a form field by field from the command", () => {
    const l = LEVELS.find((x) => x.id === "wrong-side-of-the-glass")!;
    const lines = portalFor(l.setup(), l.solution[0])!;
    expect(lines).toContain("On the map, tap the private DNS zone privatelink.blob.core.windows.net, under the networks.");
    expect(lines).toContain("Virtual network: vnet-spoke1.");
    expect(lines).toContain("Leave off: Enable auto registration.");
    expect(lines).toContain("Link name: link-spoke1.");
    const st = l.setup();
    st.publicEndpoints["203.0.113.10"].publicAccess = true;
    const a = serviceActions(st).find((x) => x.id === "st-net-stlogs01")!;
    expect(fillForm(a, "az storage account update --name stlogs01 --public-network-access Disabled")?.pna).toBe("Disabled");
  });

  it("each line says where it runs", () => {
    const steps = walkthrough(LEVELS.find((x) => x.id === "wrong-side-of-the-glass")!);
    expect(steps[0]).toMatchObject({ phase: "see", on: "vm-spoke1", cmds: ["nslookup stlogs01.blob.core.windows.net", "nc -zv stlogs01.blob.core.windows.net 443"] });
    expect(steps.at(-1)?.phase).toBe("check");
  });
});

describe("the walkthrough reads right", () => {
  it("says what each command really does, and leaves quiz answers to the Explain step", () => {
    const steps = walkthrough(LEVELS.find((x) => x.id === "wrong-side-of-the-glass")!);
    expect(steps.map((s) => s.phase)).toEqual(["see", "look", "fix", "check"]);
    expect(steps[2].say).toMatch(/^Links a private DNS zone/);
    expect(steps[1].portal.join(" ")).toMatch(/DNS zone/);
    for (const l of levels) expect(walkthrough(l).every((s) => !s.cmds.some((c) => c.startsWith("answer "))), l.id).toBe(true);
  });
});
