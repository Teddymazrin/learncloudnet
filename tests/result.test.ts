import { describe, expect, it } from "vitest";
import { LEVELS } from "@/content";
import { summarize } from "@/lib/result";
import { run } from "@/sim/shell";
import { newSession } from "@/sim/types";

const level = LEVELS.find((l) => l.id === "wrong-tag")!;
const card = (cmd: string) => {
  const st = level.setup();
  const r = run(st, cmd, newSession());
  return summarize(cmd, r.text, !!r.error);
};

describe("the Portal result card says what a tool found, in plain words", () => {
  it("IP flow verify names the deciding rule", () => {
    const c = card("az network watcher test-ip-flow -g rg-lab --vm vm-web --direction Inbound --protocol TCP --local 10.1.1.4:443 --remote 10.5.1.4:*");
    expect(c.tone).toBe("bad");
    expect(c.title).toBe("Denied by Deny-All-Inbound");
    expect(c.detail).toContain("port 443");
  });
  it("Connection troubleshoot says where it stops and why", () => {
    const c = card("az network watcher test-connectivity -g rg-lab --source-resource vm-partner --dest-address 10.1.1.4 --dest-port 443");
    expect(c.title).toBe("Unreachable");
    expect(c.detail).toMatch(/stops at .*security rule/);
  });
  it("next hop and effective routes", () => {
    expect(card("az network watcher show-next-hop -g rg-lab --vm vm-partner --source-ip 10.5.1.4 --dest-ip 10.1.1.4").title).toMatch(/^Next hop: /);
    expect(card("az network nic show-effective-route-table -g rg-lab --name vm-web-nic").title).toMatch(/routes apply to vm-web-nic/);
    expect(card("az network nic list-effective-nsg -g rg-lab --name vm-web-nic").title).toMatch(/security rules apply/);
  });
  it("an error reads as an error", () => {
    expect(card("az network watcher show-next-hop -g rg-lab --vm vm-partner --source-ip 1.2.3.4 --dest-ip 10.1.1.4").tone).toBe("bad");
  });
});
