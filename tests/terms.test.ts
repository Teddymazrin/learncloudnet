import { describe, expect, it } from "vitest";
import { LEVELS } from "@/content";
import { termsIn } from "@/lib/terms";

describe("terms under Explain questions", () => {
  it("defines service tag on the partner level", () => {
    const q = LEVELS.find((l) => l.id === "wrong-tag")!.objectives.find((o) => o.question)!;
    expect(termsIn(q.question!).map((t) => t[0])).toContain("Service tag");
  });
  it("most questions get at least one definition", () => {
    const qs = LEVELS.flatMap((l) => l.objectives.filter((o) => o.question).map((o) => o.question!));
    expect(qs.filter((q) => termsIn(q).length).length).toBeGreaterThan(qs.length * 0.7);
  });
  it("never gives a yes or no away", () => {
    for (const l of LEVELS) for (const o of l.objectives.filter((x) => x.question)) for (const [, d] of termsIn(o.question!)) expect(d, o.question).not.toMatch(/\b(yes|no)\b\.?$/i);
  });
});
