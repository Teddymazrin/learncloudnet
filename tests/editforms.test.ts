import { describe, expect, it } from "vitest";
import { LEVELS, SANDBOX } from "@/content";
import { actionsFor, initialValues, serviceActions, type Action, type Values } from "@/lib/forms";
import type { Selection } from "@/components/NetworkMap";

/** Every Portal action a level offers, from every thing you can tap on its map. */
function allActions(st: ReturnType<(typeof LEVELS)[number]["setup"]>): Action[] {
  const sels: Selection[] = [];
  for (const [vn, v] of Object.entries(st.vnets)) {
    sels.push({ kind: "vnet", id: vn });
    for (const sn of Object.keys(v.subnets)) sels.push({ kind: "subnet", vnet: vn, subnet: sn });
    for (const other of Object.keys(st.vnets)) if (other > vn) sels.push({ kind: "peer", a: vn, b: other });
  }
  for (const h of Object.keys(st.hosts)) sels.push({ kind: "host", id: h });
  for (const z of Object.keys(st.zones)) sels.push({ kind: "zone", id: z });
  return [...sels.flatMap((s) => actionsFor(st, s)), ...serviceActions(st)];
}

const NO_CHANGE = /current settings/i;

describe("edit forms notice a change to any field", () => {
  const audited = new Set<string>();
  for (const l of [...LEVELS, SANDBOX]) {
    it(l.id, () => {
      const st = l.setup();
      for (const a of allActions(st)) {
        let v: Values = initialValues(a);
        if (a.prefillOn && a.prefill) v = { ...v, ...a.prefill(v) };
        const base = a.build(v);
        if ("cmds" in base || !NO_CHANGE.test(base.error)) continue;
        audited.add(a.id.split("-").slice(0, 2).join("-"));
        for (const f of a.fields) {
          if (f.key === a.prefillOn || (f.show && !f.show(v))) continue;
          const nv = f.type === "select" ? f.options?.find(([x]) => x !== v[f.key])?.[0]
            : f.type === "check" ? (v[f.key] === "true" ? "false" : "true")
            : (/prior/i.test(f.key) ? ["345", "346"] : /port/i.test(f.key) ? ["8443", "9443"] : ["10.9.9.0/24", "10.8.8.0/24"]).find((x) => x !== v[f.key]);
          if (nv === undefined) continue;
          const b = a.build({ ...v, [f.key]: nv });
          expect("cmds" in b || !NO_CHANGE.test(b.error), `${a.id}: changing ${f.label} was ignored`).toBe(true);
        }
      }
    });
  }
  it("reaches the edit forms", () => {
    expect(audited.size).toBeGreaterThanOrEqual(3);
  });
});
