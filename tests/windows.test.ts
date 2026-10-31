import { describe, expect, it } from "vitest";
import { LEVELS } from "@/content";
import { linuxOnly } from "@/lib/os";
import { whatsThis } from "@/lib/whatsthis";
import { run, tokenize } from "@/sim/shell";
import { newSession } from "@/sim/types";
import { toLinux, toWindows } from "@/sim/windows";

describe("Windows VMs", () => {
  it("each Linux test has a PowerShell twin, and back", () => {
    for (const c of ["nc -zv 10.1.1.4 443", "nslookup db.lab.internal", "curl -sI https://stdata02.blob.core.windows.net"]) {
      const w = toWindows(c);
      expect(w).not.toBe(c);
      expect(toLinux(tokenize(w))).toBe(c);
    }
    expect(toLinux(tokenize("tnc 10.1.1.4 -Port 443"))).toBe("nc -zv 10.1.1.4 443");
  });

  it("most levels can be played on Windows", () => {
    expect(LEVELS.filter((l) => !linuxOnly(l)).length).toBeGreaterThan(LEVELS.length * 0.8);
  });

  for (const level of LEVELS.filter((l) => !linuxOnly(l) && l.steps?.length)) {
    it(`${level.id}: the guided steps work the same on Windows`, () => {
      const cmds = level.steps!.map((s) => s.cmd).filter((c): c is string => !!c && !c.startsWith("answer"));
      const play = (os: "linux" | "windows") => {
        const st = level.setup(), session = newSession(os);
        const out = cmds.map((c) => { if (c.startsWith("az ") && session.vm) run(st, "exit", session); return run(st, os === "windows" ? toWindows(c) : c, session); });
        return { out, met: level.objectives.map((o) => o.question || o.test({ st, session })) };
      };
      const lin = play("linux"), win = play("windows");
      expect(win.out.filter((o) => o.error).map((o) => o.text)).toEqual([]);
      expect(win.out.map((o) => !!o.trace?.ok)).toEqual(lin.out.map((o) => !!o.trace?.ok));
      expect(win.met).toEqual(lin.met);
    });
  }

  it("a Linux command on a Windows VM points to the PowerShell one", () => {
    const l = LEVELS.find((x) => x.id === "wrong-tag")!;
    const st = l.setup(), s = newSession("windows");
    run(st, "ssh vm-partner", s);
    expect(run(st, "nc -zv 10.1.1.4 443", s).text).toMatch(/Did you mean Test-NetConnection/);
    expect(run(st, "Test-NetConnection 10.1.1.4 -Port 443", s).text).toMatch(/TcpTestSucceeded : False/);
  });
});

describe("What's this?", () => {
  it("explains every command a step or hint asks you to type", () => {
    const cmds = new Set<string>();
    for (const l of LEVELS) for (const c of [...(l.steps ?? []).map((s) => s.cmd ?? ""), ...l.solution]) if (/^(ssh|nc|curl|nslookup|az network watcher)/.test(c)) cmds.add(c);
    for (const c of cmds) expect(whatsThis(c), c).not.toBeNull();
    for (const c of ["nc -zv 10.1.1.4 443", "ssh vm-web"]) expect(whatsThis(toWindows(c)), c).not.toBeNull();
  });
});

describe("Linux commands on a Windows VM", () => {
  const setup = () => {
    const l = LEVELS.find((x) => x.id === "wrong-side-of-the-glass")!;
    const st = l.setup();
    const s = newSession("windows");
    run(st, "ssh vm-spoke1", s);
    return { st, s };
  };
  it("fail as errors and say the VM runs Windows, instead of looking like they worked", () => {
    const { st, s } = setup();
    for (const c of ["nc -zv stlogs01.blob.core.windows.net 443", "ufw status", "ping 10.0.1.4", "curl -sI https://stlogs01.blob.core.windows.net"]) {
      const r = run(st, c, s);
      expect(r.error, c).toBe(true);
      expect(s.log.at(-1)?.ok, c).toBe(false);
    }
    expect(run(st, "nc -zv 10.0.3.4 443", s).text).toMatch(/Linux command, and vm-spoke1 runs Windows/);
  });
  it("nslookup is nslookup.exe, with its own output, not Resolve-DnsName's table", () => {
    const { st, s } = setup();
    const ns = run(st, "nslookup stlogs01.blob.core.windows.net", s).text;
    expect(ns).toMatch(/^Server:  UnKnown/);
    expect(ns).toMatch(/Address:  203\.0\.113\.10/);
    expect(ns).not.toMatch(/NameHost/);
    expect(run(st, "Resolve-DnsName stlogs01.blob.core.windows.net", s).text).toMatch(/NameHost/);
  });
});
