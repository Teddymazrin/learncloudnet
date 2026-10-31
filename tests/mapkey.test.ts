import { describe, expect, it } from "vitest";
import { LEVELS } from "@/content";
import { evalFlow } from "@/content/flows";
import { linesOnMap, traceOverlaps } from "@/components/NetworkMap";
import { run } from "@/sim/shell";
import { newSession } from "@/sim/types";

describe("the map key explains only what's on the map", () => {
  const l = LEVELS.find((x) => x.id === "wrong-side-of-the-glass")!;
  it("before the fix: red, grey dashed and the private link", () => {
    const st = l.setup();
    const on = linesOnMap(st, (l.flows ?? []).map((f) => evalFlow(st, f)), null);
    expect(on).toMatchObject({ failing: true, shouldGo: true, privateLink: true, lastTest: false, zones: true });
  });
  it("after the fix, red and grey are gone, and a test along the goal line isn't drawn on top of it", () => {
    const st = l.setup();
    const s = newSession();
    run(st, l.solution[0], s);
    run(st, "ssh vm-spoke1", s);
    const trace = run(st, "nc -zv stlogs01.blob.core.windows.net 443", s).trace!;
    const flows = (l.flows ?? []).map((f) => evalFlow(st, f));
    expect(traceOverlaps(trace, flows)).toBe(true);
    expect(linesOnMap(st, flows, trace)).toMatchObject({ failing: false, shouldGo: false, lastTest: false, privateLink: true });
  });
  it("a level with no storage never mentions the private link", () => {
    const w = LEVELS.find((x) => x.id === "wrong-tag")!;
    const st = w.setup();
    expect(linesOnMap(st, (w.flows ?? []).map((f) => evalFlow(st, f)), null).privateLink).toBe(false);
  });
});
