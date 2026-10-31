import { describe, expect, it } from "vitest";
import { LEVELS } from "@/content";
import { evalFlow } from "@/content/flows";
import { mentorSteps, usesMentor } from "@/lib/mentor";
import { whatsThis } from "@/lib/whatsthis";
import { hintParts } from "@/lib/mentor";
import { run } from "@/sim/shell";
import { newSession } from "@/sim/types";

const mentored = LEVELS.filter(usesMentor);

describe("step 2: Show me how", () => {
  for (const l of mentored) {
    it(`${l.id}: offers checks that run`, () => {
      const st = l.setup();
      const steps = mentorSteps(l, { st, log: [], flows: (l.flows ?? []).map((f) => evalFlow(st, f)), vm: null, goalsDone: false, causeOk: false, hasCause: true, questionsDone: false, hasQuestions: true, explained: false });
      const look = steps.find((s) => s.id === "look")!;
      // A level whose traffic doesn't start on a VM has nothing to log in to, so the menu can be empty there.
      const fromVm = (l.flows ?? []).some((f) => f.want === "open" && st.hosts[f.from]?.kind === "vm");
      if (fromVm) expect(look.options?.length, l.id).toBeGreaterThan(0);
      for (const o of look.options ?? []) {
        const s = newSession();
        for (const c of o.cmds) expect(run(st, c, s).error, `${l.id}: ${c}`).toBeFalsy();
      }
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
