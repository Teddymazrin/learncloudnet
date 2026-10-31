import { describe, expect, it } from "vitest";
import { LEVELS } from "@/content";
import { newSession } from "@/sim/types";
import { run } from "@/sim/shell";
import { evalFlow } from "@/content/flows";

// Tasks say what the player does, so each one opens with an action word.
const VERBS = /^(Add|Allow|Answer|Associate|Block|Change|Check|Connect|Create|Delete|Don't|Find|Fix|Get|Give|Keep|Let|Link|List|Look|Make|Move|Open|Peer|Point|Put|Read|Remove|Route|Run|Send|Set|Show|Start|Stop|Test|Trace|Turn|Use|Clear|Restore|Deploy|Attach|Detach|Enable|Disable|Resolve|Reach|Shrink|Grow|Split|Inspect|Confirm|Leave|Bring|Return|Write|Note|Update|Swap|Plan|Pick|Name|Spot|Work|Prove|Rule|Stay|Have|Drop|Accept|Deny|Lock|Unblock|Re-?\w+)\b/;

describe("tasks read as actions", () => {
  for (const l of LEVELS) {
    it(l.id, () => {
      for (const o of l.objectives) {
        if (o.question) continue;
        expect(o.text, `${l.id}: "${o.text}"`).toMatch(VERBS);
        expect(o.text).not.toContain(String.fromCharCode(0x2014));
      }
    });
  }
});

describe("What needs fixing", () => {
  it("only on levels that start with something broken", () => {
    for (const l of LEVELS.filter((x) => x.fix)) {
      const st = l.setup();
      const ctx = { st, session: newSession() };
      const unmet = l.objectives.filter((o) => !o.question && !o.action && !o.test(ctx));
      expect(unmet.length, `${l.id} has a fix line but nothing is broken at the start`).toBeGreaterThan(0);
      expect(l.fix).not.toContain(String.fromCharCode(0x2014));
      expect(l.playground).toBeFalsy();
    }
  });
  it("every Expert incident has one", () => {
    const missing = LEVELS.filter((l) => l.tier === "expert" && !l.playground && !l.fix).map((l) => l.id);
    expect(missing).toEqual([]);
  });
});

describe("Why it worked", () => {
  it("every level explains why the fix worked", () => {
    const missing = LEVELS.filter((l) => !l.playground && !l.why).map((l) => l.id);
    expect(missing).toEqual([]);
    for (const l of LEVELS) if (l.why) expect(l.why).not.toContain(String.fromCharCode(0x2014));
  });
});

describe("Names on the map", () => {
  it("every connection by name points the map at the host it really reaches once solved", () => {
    for (const l of LEVELS) {
      const flows = (l.flows ?? []).filter((f) => f.dns && !f.to);
      if (!flows.length) continue;
      const st = l.setup();
      const s = newSession();
      for (const c of l.solution) run(st, c, s);
      for (const f of flows) {
        const target = evalFlow(st, f).target;
        // A name that ends at a public service, not a lab host, has nothing to point at.
        if (target) expect(f.expect, `${l.id}: ${f.dns} should expect ${target}`).toBe(target);
        else expect(f.expect, `${l.id}: ${f.dns}`).toBeUndefined();
      }
    }
  });
});
