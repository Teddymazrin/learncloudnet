import { describe, expect, it } from "vitest";
import { LEVELS } from "@/content";
import { run } from "@/sim/shell";
import { newSession, type State } from "@/sim/types";
import { actionsFor, initialValues } from "@/lib/forms";

const level = (id: string) => LEVELS.find((l) => l.id === id)!;
function play(id: string, cmds: string[]) {
  const l = level(id);
  const st = l.setup();
  const session = newSession();
  const outputs = cmds.map((c) => run(st, c, session));
  const met = l.objectives.map((o) => o.test({ st, session }));
  return { st, outputs, met, done: met.every(Boolean) };
}
const RUN = (vm: string, s: string) => `az vm run-command invoke -g rg-lab -n ${vm} --command-id RunShellScript --scripts "${s}"`;

describe("inside the VM", () => {
  it("Connection troubleshoot tells a guest firewall from a missing listener", () => {
    const r = play("intro-guest", [
      "az network watcher test-connectivity -g rg-lab --source-resource vm-client --dest-address 10.1.1.4 --dest-port 443",
      RUN("vm-web", "ufw allow from 10.1.2.0/24 to any port 443 proto tcp"),
      "az network watcher test-connectivity -g rg-lab --source-resource vm-client --dest-address 10.1.1.4 --dest-port 443",
    ]);
    expect(r.outputs[0].text).toContain("GuestFirewall");
    expect(r.outputs[2].text).toContain("NoListenerOnDestination");
  });
  it("nc times out on a guest firewall and is refused when nothing listens", () => {
    const st = level("intro-guest").setup();
    const s = newSession();
    run(st, "ssh vm-client", s);
    expect(run(st, "nc -zv 10.1.1.4 443", s).text).toContain("timed out");
    run(st, "exit", s);
    run(st, RUN("vm-web", "ufw allow 443/tcp"), s);
    run(st, "ssh vm-client", s);
    expect(run(st, "nc -zv 10.1.1.4 443", s).text).toContain("refused");
  });
  it("UFW status lists rules in order, and listeners show in ss", () => {
    const st = level("intro-guest").setup();
    const s = newSession();
    const out = run(st, RUN("vm-web", "ufw status numbered && ss -tlnp"), s).text;
    expect(out).toContain("Status: active");
    expect(out).toMatch(/\[ 1\] 22\/tcp\s+ALLOW IN\s+10\.1\.9\.0\/24/);
    expect(out).toContain("0.0.0.0:22");
    expect(out).not.toContain("0.0.0.0:443");
    run(st, "ssh vm-web", s);
    expect(run(st, "sudo systemctl status nginx", s).text).toContain("inactive (dead)");
    expect(run(st, "sudo systemctl start nginx", s).mut).toBe(true);
    expect(run(st, "ss -tlnp | grep :443", s).text).toContain("nginx");
  });
  it("--query value[0].message prints the script output", () => {
    const st = level("intro-guest").setup();
    const out = run(st, `${RUN("vm-web", "ufw status")} --query 'value[0].message'`, newSession()).text;
    expect(out).toMatch(/^Enable succeeded: \n\[stdout\]\nStatus: active/);
  });
  it("reading with Run command changes nothing and doesn't count", () => {
    const st = level("intro-guest").setup();
    expect(run(st, RUN("vm-web", "ufw status numbered"), newSession()).mut).toBe(false);
  });
  it("the Portal's Run command form builds the same command", () => {
    const st = level("intro-guest").setup();
    const a = actionsFor(st, { kind: "host", id: "vm-web" }).find((x) => x.id === "vm-run-vm-web")!;
    const b = a.build({ ...initialValues(a), script: "systemctl start nginx" });
    expect("cmds" in b && b.cmds[0]).toBe(RUN("vm-web", "systemctl start nginx"));
  });
});

describe("lazy fixes inside the VM stay unsolved", () => {
  it("intro-guest: disabling UFW fails", () => {
    const r = play("intro-guest", [RUN("vm-web", "ufw disable"), RUN("vm-web", "systemctl start nginx"), "answer 1 denied"]);
    expect(r.met[0]).toBe(true);
    expect(r.met[1]).toBe(false);
  });
  it("metrics-gap: allowing 9100 from anywhere lets users in", () => {
    const r = play("metrics-gap", [RUN("vm-app1", "ufw allow 9100/tcp"), RUN("vm-app2", "ufw allow 9100/tcp")]);
    expect(r.met[0]).toBe(true);
    expect(r.met[1]).toBe(false);
  });
  it("intranet-down: opening the NSG doesn't help and counts as touching the network", () => {
    const r = play("intranet-down", ["az network nsg rule create -g rg-lab --nsg-name nsg-web --name Allow-All --priority 100 --direction Inbound --access Allow --protocol '*' --source-address-prefixes '*' --destination-port-ranges '*'"]);
    expect(r.met).toEqual([false, false, false]);
  });
  it("guest-probe: fixing UFW alone leaves vm-web2 down", () => {
    const l = level("guest-probe");
    const r = play("guest-probe", l.solution.slice(0, 2));
    expect(r.met[0]).toBe(true);
    expect(r.met[1]).toBe(false);
  });
});

describe("guest firewall order", () => {
  it("a UFW deny listed before an allow wins", () => {
    const st: State = level("intro-guest").setup();
    const s = newSession();
    run(st, RUN("vm-web", "systemctl start nginx && ufw deny from 10.1.2.0/24 to any port 443 proto tcp && ufw allow 443/tcp"), s);
    run(st, "ssh vm-client", s);
    expect(run(st, "nc -zv 10.1.1.4 443", s).text).toContain("timed out");
  });
});
