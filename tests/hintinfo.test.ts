import { describe, expect, it } from "vitest";
import { LEVELS } from "@/content";
import { hintLayer, liveResult } from "@/lib/hintinfo";
import { hintParts, usesMentor } from "@/lib/mentor";

describe("hints with context", () => {
  it("nearly every hint on a fix level names the layer it checks", () => {
    // Guided levels' hints point at their own numbered steps, so a layer doesn't apply there.
    const hints = LEVELS.filter(usesMentor).flatMap((l) => l.hints.map((h) => `${l.id}: ${h}`));
    const none = hints.filter((h) => !hintLayer(h.slice(h.indexOf(": ") + 2)));
    expect(none.length / hints.length, none.join("\n")).toBeLessThan(0.1);
  });

  it("picks the right layer", () => {
    expect(hintLayer("Check which networks that private zone answers for: az network private-dns link vnet list")?.name).toBe("Names (DNS)");
    expect(hintLayer("Ask Network Watcher where the packet goes next: az network watcher show-next-hop")?.name).toBe("Routing");
    expect(hintLayer("Run ufw status on the VM")?.name).toBe("Inside the VM");
  });

  it("shows what a check returns in the lab right now, and never runs a change", () => {
    const l = LEVELS.find((x) => x.id === "wrong-side-of-the-glass")!;
    const st = l.setup();
    const cmd = hintParts(l.hints[1]).cmd!;
    expect(liveResult(st, cmd)).toMatch(/vnet-hub/);
    expect(liveResult(st, l.solution[0])).toBeNull();
    expect(Object.keys(st.zones["privatelink.blob.core.windows.net"].links)).toEqual(["link-hub"]);
  });
});
