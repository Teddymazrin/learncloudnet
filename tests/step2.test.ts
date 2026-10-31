import { describe, expect, it } from "vitest";
import { LEVELS } from "@/content";
import { evalFlow } from "@/content/flows";
import { mentorSteps, usesMentor } from "@/lib/mentor";
import { whatsThis } from "@/lib/whatsthis";
import { hintParts } from "@/lib/mentor";

const mentored = LEVELS.filter(usesMentor);

describe("step 2: Find where it stops", () => {
  for (const l of mentored) {
    it(`${l.id}: names tools to check each layer`, () => {
      const st = l.setup();
      const steps = mentorSteps(l, { st, log: [], flows: (l.flows ?? []).map((f) => evalFlow(st, f)), vm: null, goalsDone: false, causeOk: false, hasCause: true, questionsDone: false, hasQuestions: true, explained: false });
      const look = steps.find((s) => s.id === "look")!;
      // A level whose traffic doesn't start on a VM has nothing to log in to, so the list can be empty there.
      const fromVm = (l.flows ?? []).some((f) => f.want === "open" && st.hosts[f.from]?.kind === "vm");
      if (fromVm) expect(look.tools?.length, l.id).toBeGreaterThan(0);
      expect(look.lookFor, l.id).toBeTruthy();
    });
  }
});

describe("What's this? covers every command a level asks for", () => {
  it("every az command in a hint or a fix has a note", () => {
    const missing = new Set<string>();
    for (const l of LEVELS) for (const c of [...l.solution, ...l.hints.map((h) => hintParts(h).cmd ?? "")]) if (c.startsWith("az ") && !whatsThis(c)) missing.add(c);
    expect([...missing]).toEqual([]);
  });
});
