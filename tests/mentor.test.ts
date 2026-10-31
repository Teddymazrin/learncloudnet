import { describe, expect, it } from "vitest";
import { LEVELS } from "@/content";
import { evalFlow } from "@/content/flows";
import { causeChoices, hintParts, hopTo, mentorSteps, splitObjectives, startingCause, usesMentor } from "@/lib/mentor";
import { run } from "@/sim/shell";
import { newSession } from "@/sim/types";

const mentored = LEVELS.filter(usesMentor);

describe("the mentor's process", () => {
  it("covers every fix level past the guided ones", () => {
    expect(mentored.length).toBeGreaterThan(40);
    expect(mentored.every((l) => l.tier !== "beginner" || !l.steps)).toBe(true);
  });

  it("the cause to name is always one of four choices", () => {
    for (const l of mentored) {
      const c = startingCause(l);
      if (!c) continue;
      const choices = causeChoices(l.tier, c.cause, l.id).map((x) => x[0]);
      expect(choices.length, l.id).toBeLessThanOrEqual(4);
      expect(choices, l.id).toContain(c.cause);
    }
  });

  it("nothing shows as done before you start: rules that already hold are 'don't break', not tasks", () => {
    for (const l of LEVELS) {
      const { goals } = splitObjectives(l);
      const st = l.setup();
      for (const k of goals) expect(l.objectives[k].test({ st, session: newSession() }), `${l.id}: ${l.objectives[k].text}`).toBe(false);
    }
  });

  it("steps tick off from what you actually do", () => {
    const l = LEVELS.find((x) => x.id === "wrong-tag")!;
    const st = l.setup();
    const s = newSession();
    const steps = () => mentorSteps(l, { st, log: s.log, flows: (l.flows ?? []).map((f) => evalFlow(st, f)), goalsDone: false, causeOk: false, hasCause: true, questionsDone: false, hasQuestions: true, vm: s.vm, explained: false });
    expect(steps().map((x) => x.done)).toEqual([false, false, false, false, false]);
    run(st, "ssh vm-partner", s); run(st, "nc -zv 10.1.1.4 443", s); run(st, "exit", s);
    expect(steps()[0].done).toBe(true);
    run(st, "az network watcher test-ip-flow -g rg-lab --vm vm-web --direction Inbound --protocol TCP --local 10.1.1.4:443 --remote 10.5.1.4:*", s);
    expect(steps()[1].done).toBe(true);
  });

  it("each step is an action item: what to do, why, what to look for, and the tools, with no full commands", () => {
    const l = LEVELS.find((x) => x.id === "wrong-side-of-the-glass")!;
    const st = l.setup();
    const s = newSession();
    const steps = () => mentorSteps(l, { st, log: s.log, flows: (l.flows ?? []).map((f) => evalFlow(st, f)), goalsDone: false, causeOk: false, hasCause: true, questionsDone: false, hasQuestions: false, vm: s.vm, explained: false });
    expect(steps()[0].say).toBe("From vm-spoke1, look up stlogs01.blob.core.windows.net, then try to connect to it on port 443.");
    expect(steps()[0].lookFor).toMatch(/10\.0\.3\.4 \(pe-stlogs01\)/);
    // The step names the tools and where they run, and stays the same as you move between the VM and Cloud Shell.
    const before = steps().map((m) => [m.say, m.why, m.lookFor]);
    run(st, "ssh vm-spoke1", s);
    expect(steps().map((m) => [m.say, m.why, m.lookFor])).toEqual(before);
    expect(steps()[0].tools?.[0]).toMatch(/You're already on it/);
    for (const m of steps()) for (const t of m.tools ?? []) expect(t, t).not.toMatch(/\baz network\b|--/);
    expect(hopTo(s.vm, undefined)).toEqual(["exit"]);
    expect(hopTo(null, "vm-spoke1")).toEqual(["ssh vm-spoke1"]);
  });

  it("every step past the first says what ticks it off, and every test step has a way to do it", () => {
    for (const l of mentored) {
      const st = l.setup();
      const steps = mentorSteps(l, { st, log: [], flows: (l.flows ?? []).map((f) => evalFlow(st, f)), goalsDone: false, causeOk: false, hasCause: true, questionsDone: false, hasQuestions: true, vm: null, explained: false });
      for (const m of steps.filter((x) => x.id !== "explain")) expect(m.tick, `${l.id} ${m.id}`).toBeTruthy();
      expect(steps[0].tools?.length, l.id).toBeTruthy();
      for (const m of steps.filter((x) => x.id !== "explain")) expect(m.why, `${l.id} ${m.id}`).toBeTruthy();
    }
  });
});

describe("hints work in the Portal too", () => {
  it("every command in a hint maps to a place to click", () => {
    for (const l of LEVELS) for (const h of l.hints) {
      const p = hintParts(h);
      if (p.cmd) expect(p.portal, `${l.id}: ${p.cmd}`).not.toBe("find it on the map or in Services");
    }
  });
  it("splits the words from the command", () => {
    const p = hintParts("Ask Network Watcher which rule decides: az network watcher test-ip-flow -g rg-lab --vm vm-web");
    expect(p.text).toBe("Ask Network Watcher which rule decides");
    expect(p.cmd).toMatch(/^az network watcher test-ip-flow/);
    expect(p.portal).toBe("Diagnose, then IP flow verify");
  });
});

describe("Explain says why a rule checked first didn't match", () => {
  it("names the 200 rule and its Internet source on the partner level", async () => {
    const { explainSteps } = await import("@/content/flows");
    const l = LEVELS.find((x) => x.id === "wrong-tag")!;
    const st = l.setup();
    const f = evalFlow(st, l.flows!.find((x) => x.want === "open")!);
    const text = explainSteps(st, f).map((s) => s.text).join("\n");
    expect(text).toMatch(/Allow-Partner-HTTPS \(priority 200\) is checked first but doesn't match: its source is Internet, which doesn't include 10\.5\.1\.4/);
    const s = newSession();
    run(st, "ssh vm-partner", s);
    expect(run(st, "nc -zv 10.1.1.4 443", s).text).not.toMatch(/checked first/);
  });
});
