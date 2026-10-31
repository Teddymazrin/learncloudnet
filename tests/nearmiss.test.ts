import { describe, expect, it } from "vitest";
import { LEVELS } from "@/content";
import { evalFlow, explainSteps } from "@/content/flows";

describe("Explain says why an allow didn't match, on every level", () => {
  const withNote: string[] = [];
  for (const l of LEVELS) {
    it(l.id, () => {
      const st = l.setup();
      for (const fl of (l.flows ?? []).filter((f) => f.want === "open")) {
        const f = evalFlow(st, fl);
        // What a test command prints never carries the note: only Explain does.
        expect(f.trace?.reason ?? "", l.id).not.toMatch(/doesn't match:/);
        const text = explainSteps(st, f).map((s) => s.text).join("\n");
        if (/doesn't match:/.test(text)) withNote.push(l.id);
      }
    });
  }
  it("shows up on the levels where a rule nearly matched", () => {
    expect(withNote).toContain("wrong-tag");
    expect(withNote.length).toBeGreaterThanOrEqual(3);
  });
});
