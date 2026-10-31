// A sweep of every level for the level panel's features: the walkthrough, the guide's action items, hints, Resources and the map.
// Each check runs on all 80 levels, in Linux and in Windows where the level allows it.
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { LEVELS } from "@/content";
import { evalFlow } from "@/content/flows";
import { linesOnMap, NetworkMap } from "@/components/NetworkMap";
import { hintLayer, liveResult, runsAsTyped } from "@/lib/hintinfo";
import { hintParts, hopTo, mentorSteps, usesMentor } from "@/lib/mentor";
import { linuxOnly } from "@/lib/os";
import { resourcesOf } from "@/lib/resources";
import { fixSummary, issueSummary, walkthrough } from "@/lib/walkthrough";
import { run } from "@/sim/shell";
import { newSession } from "@/sim/types";

const levels = LEVELS.filter((l) => !l.playground);
const oses = (l: (typeof levels)[number]) => (linuxOnly(l) ? (["linux"] as const) : (["linux", "windows"] as const));

describe("sweep: the walkthrough", () => {
  for (const l of levels) for (const os of oses(l)) {
    it(`${l.id} (${os}): following it line by line, from where it says, solves the level`, () => {
      const st = l.setup();
      const s = newSession(os);
      const problems: string[] = [];
      for (const w of walkthrough(l, os)) {
        if (!w.say.trim()) problems.push(`${w.phase}: no explanation for ${w.cmds.join("; ")}`);
        if (!w.portal.length) problems.push(`${w.phase}: no Portal steps for ${w.cmds.join("; ")}`);
        for (const c of [...hopTo(s.vm, w.on), ...w.cmds]) {
          const r = run(st, c, s);
          if (r.error || /isn't part of this simulator|is not recognized|command not found|usage:/.test(r.text)) problems.push(`${w.phase}: ${c} → ${r.text.split("\n")[0]}`);
        }
      }
      expect(problems).toEqual([]);
      // Questions are answered in the Explain it step, not by the walkthrough.
      const open = l.objectives.filter((o) => !o.question && !o.test({ st, session: s })).map((o) => o.text);
      expect(open).toEqual([]);
    });
  }
  it("Portal steps for a change never fall back to 'find it on the map'", () => {
    const vague: string[] = [];
    for (const l of levels) for (const w of walkthrough(l)) if (w.phase === "fix" && !w.on && w.portal.some((p) => /find it on the map or in Services/i.test(p))) vague.push(`${l.id}: ${w.cmds[0]}`);
    expect(vague).toEqual([]);
  });
});

describe("sweep: the guide's action items", () => {
  for (const l of levels.filter(usesMentor)) for (const os of oses(l)) {
    it(`${l.id} (${os}): every step says what to do, and nothing reads undefined`, () => {
      const st = l.setup();
      const steps = mentorSteps(l, { st, log: [], flows: (l.flows ?? []).map((f) => evalFlow(st, f)), vm: null, os, goalsDone: false, causeOk: false, hasCause: true, questionsDone: false, hasQuestions: true, explained: false });
      for (const m of steps) {
        expect(m.say.trim(), `${m.id}`).toBeTruthy();
        const text = [m.say, m.why, m.lookFor, ...(m.tools ?? []), m.tick].filter(Boolean).join(" ");
        expect(text, m.id).not.toMatch(/undefined|null|NaN|\(\)|\s{2,}/);
        if (os === "windows") expect(m.tools?.join(" ") ?? "", m.id).not.toMatch(/\b(nslookup|nc)\b/);
      }
    });
  }
});

describe("sweep: hints", () => {
  it("a hint's command stops where its prose starts, so Type it never types a sentence", () => {
    const prose: string[] = [];
    for (const l of levels) for (const h of l.hints) {
      const cmd = hintParts(h).cmd;
      if (cmd && /,\s|\s(then|with|and|compare|read|each)\s|'sb/.test(cmd)) prose.push(`${l.id}: ${cmd}`);
    }
    expect(prose).toEqual([]);
  });
  it("most hint commands run as typed; the rest are named in passing and show as words", () => {
    const all = levels.flatMap((l) => l.hints.map((h) => [l, hintParts(h).cmd] as const)).filter(([, c]) => c);
    const runs = all.filter(([l, c]) => runsAsTyped(l.setup(), c!));
    // About 30% only name a command in passing ("az network vnet show to see the range"). Those read as words, with no Type it.
    expect(runs.length / all.length).toBeGreaterThan(0.65);
  });
  it("a hint's look-only command shows what it returns", () => {
    const silent: string[] = [];
    for (const l of levels) for (const h of l.hints) {
      const cmd = hintParts(h).cmd;
      if (cmd && runsAsTyped(l.setup(), cmd) && /\b(list|show|test-ip-flow|show-next-hop|show-effective-route-table|list-effective-nsg)\b/.test(cmd) && !/ (create|update|delete|add|invoke)\b/.test(cmd) && !liveResult(l.setup(), cmd)) silent.push(`${l.id}: ${cmd}`);
    }
    expect(silent).toEqual([]);
  });
  it("every hint with a command names its layer", () => {
    const none: string[] = [];
    for (const l of levels) for (const h of l.hints) if (hintParts(h).cmd && !hintLayer(h)) none.push(`${l.id}: ${h}`);
    expect(none).toEqual([]);
  });
});

describe("sweep: Resources and the map", () => {
  for (const l of levels) {
    it(`${l.id}: Resources list every resource once, and the map draws`, () => {
      const st = l.setup();
      for (const g of resourcesOf(st)) {
        const names = g.items.map((i) => i.name);
        expect(names.filter((n, k) => names.indexOf(n) !== k), g.type).toEqual([]);
        for (const i of g.items) expect(`${i.name} ${i.detail}`, g.type).not.toMatch(/undefined|null|NaN/);
      }
      const flows = (l.flows ?? []).map((f) => evalFlow(st, f));
      const svg = renderToString(createElement(NetworkMap, { st, trace: null, flows }));
      for (const ep of Object.values(st.publicEndpoints)) expect(svg).toContain(`Storage account · ${ep.name}`);
      expect(svg).not.toMatch(/NaN|undefined/);
    });
  }
});

describe("sweep: the solved card", () => {
  it("every level with a problem says what the issue was, and every level that changes something says what the fix was", () => {
    const problems: string[] = [];
    for (const l of levels) {
      const issue = issueSummary(l), fixes = fixSummary(l);
      if (l.fix && !issue.length) problems.push(`${l.id}: no issue`);
      const changes = l.solution.some((c) => c.startsWith("az ") && !/\b(list|show)\b/.test(c));
      if (changes && !fixes.length) problems.push(`${l.id}: no fix`);
      for (const t of [...issue, ...fixes.map((f) => f.what)]) if (!t.trim() || /undefined|null|NaN/.test(t)) problems.push(`${l.id}: ${t}`);
    }
    expect(problems).toEqual([]);
  });
});

describe("sweep: map lines and the map key", () => {
  it("on every level: once solved, no red or grey line is left, and a test along a goal line isn't drawn twice", () => {
    const problems: string[] = [];
    for (const l of levels) {
      const st = l.setup();
      const s = newSession();
      for (const c of l.solution) run(st, c, s);
      const flows = (l.flows ?? []).map((f) => evalFlow(st, f));
      if (!flows.every((f) => f.good)) continue;
      const on = linesOnMap(st, flows, null);
      if (on.failing || on.shouldGo) problems.push(`${l.id}: still shows ${on.failing ? "red" : "grey dashed"} after the fix`);
      if (on.privateLink !== Object.values(st.publicEndpoints).some((e) => !!st.hosts[`pe-${e.name}`])) problems.push(`${l.id}: private link entry wrong`);
      // Re-test each goal from where it starts: the test's line must not land on top of the goal line.
      for (const f of (l.flows ?? []).filter((x) => x.want === "open" && st.hosts[x.from]?.kind === "vm")) {
        const t = newSession();
        run(st, `ssh ${f.from}`, t);
        const r = run(st, `nc -zv ${f.dns ?? st.hosts[f.to!].ip} ${f.port}`, t);
        if (r.trace && linesOnMap(st, flows, r.trace).lastTest) problems.push(`${l.id}: test line drawn on top of ${f.from}'s goal line`);
      }
      const svg = renderToString(createElement(NetworkMap, { st, trace: null, flows }));
      if (/flow bad|flow ghost/.test(svg)) problems.push(`${l.id}: map still draws a broken line`);
    }
    expect(problems).toEqual([]);
  });
});
