import { describe, expect, it } from "vitest";
import { MIGRATE_STORAGE, THEME_BOOT, THEME_KEY } from "@/lib/theme";

/** A minimal localStorage to run the boot script against. */
function fakeStorage(init: Record<string, string>) {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    dump: () => Object.fromEntries(m),
  };
}
const runIn = (script: string, localStorage: ReturnType<typeof fakeStorage>) => new Function("localStorage", script)(localStorage);

describe("storage key migration from the old name", () => {
  it("moves every old key to the learncloudnet prefix and removes the old ones", () => {
    const s = fakeStorage({ "next-hop.progress.v1": '{"done":{"meet-the-vnet":3},"skipped":[]}', "next-hop.theme.v1": "cobalt", "next-hop.sound.v1": "off", unrelated: "keep" });
    runIn(MIGRATE_STORAGE, s);
    expect(s.dump()).toEqual({ "learncloudnet.progress.v1": '{"done":{"meet-the-vnet":3},"skipped":[]}', "learncloudnet.theme.v1": "cobalt", "learncloudnet.sound.v1": "off", unrelated: "keep" });
  });

  it("never overwrites a value already saved under the new name", () => {
    const s = fakeStorage({ "next-hop.theme.v1": "amber", "learncloudnet.theme.v1": "dim" });
    runIn(MIGRATE_STORAGE, s);
    expect(s.dump()).toEqual({ "learncloudnet.theme.v1": "dim" });
  });

  it("runs before the theme is read, so a migrated theme applies on the first paint", () => {
    expect(THEME_BOOT.indexOf(MIGRATE_STORAGE)).toBe(0);
    expect(THEME_KEY).toBe("learncloudnet.theme.v1");
  });
});
