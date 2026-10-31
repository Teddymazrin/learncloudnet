// Inside a Linux VM: UFW, listening sockets and services. Used by ssh sessions and by Run Command.
// Behavior follows "Use UFW to troubleshoot connectivity issues in Azure Ubuntu VMs" and
// "Troubleshoot health probe failures in Azure Load Balancer" on Microsoft Learn.
import { cidr } from "./ip";
import type { Host, State } from "./types";

export interface GuestResult { text: string; mut: boolean; known: boolean }

const NAMED: Record<string, number> = { ssh: 22, http: 80, https: 443 };
const portOf = (v: string) => NAMED[v.toLowerCase()] ?? (/^\d+(\/tcp)?$/i.test(v) ? Number(v.replace(/\/tcp$/i, "")) : NaN);
const procName = (h: Host, port: number) => Object.entries(h.services ?? {}).find(([, p]) => p === port)?.[0] ?? (port === 22 ? "sshd" : port === 53 ? "named" : "app");
const pad = (s: string, n: number) => s.padEnd(n);

function ufwTable(h: Host, numbered: boolean): string {
  const fw = h.guestFw;
  if (!fw?.active) return "Status: inactive";
  const head = numbered ? ["     To                         Action      From", "     --                         ------      ----"] : ["To                         Action      From", "--                         ------      ----"];
  const rows = fw.rules.map((r, i) => `${numbered ? `[${String(i + 1).padStart(2)}] ` : ""}${pad(`${r.port}/tcp`, 27)}${pad(numbered ? `${r.action} IN` : r.action, 12)}${r.from}`);
  return ["Status: active", "", ...head, ...rows].join("\n");
}

function ufw(h: Host, args: string[]): GuestResult {
  const ok = (text: string, mut = false): GuestResult => ({ text, mut, known: true });
  const fw = (h.guestFw ??= { active: false, rules: [] });
  const sub = (args[0] ?? "").toLowerCase();
  if (sub === "status") return ok(ufwTable(h, (args[1] ?? "").toLowerCase() === "numbered"));
  if (sub === "enable") { const was = fw.active; fw.active = true; return ok("Firewall is active and enabled on system startup", !was); }
  if (sub === "disable") { const was = fw.active; fw.active = false; return ok("Firewall stopped and disabled on system startup", was); }
  if (sub === "delete") {
    const n = Number(args[1]);
    if (!Number.isInteger(n) || n < 1 || n > fw.rules.length) return ok(`ERROR: Could not find rule '${args[1] ?? ""}'`);
    fw.rules.splice(n - 1, 1);
    return ok("Rule deleted", true);
  }
  if (sub === "allow" || sub === "deny") {
    const action = sub === "allow" ? "ALLOW" : "DENY";
    let from = "Anywhere", port = NaN;
    // ufw allow 443/tcp | ufw allow ssh | ufw allow from 10.1.0.0/24 to any port 22 proto tcp
    if ((args[1] ?? "").toLowerCase() === "from") {
      from = args[2] ?? "";
      const pi = args.findIndex((a) => a.toLowerCase() === "port");
      port = pi > 0 ? portOf(args[pi + 1] ?? "") : NaN;
      if (!/^any$/i.test(from) && !cidr(from.includes("/") ? from : `${from}/32`)) return ok(`ERROR: Bad source address`);
      if (/^any$/i.test(from)) from = "Anywhere";
    } else port = portOf(args[1] ?? "");
    if (!Number.isInteger(port) || port < 1 || port > 65535) return ok("ERROR: Bad port");
    if (fw.rules.some((r) => r.port === port && r.from === from && r.action === action)) return ok("Skipping adding existing rule");
    fw.rules.push({ port, from, action });
    return ok(fw.active ? "Rule added" : "Rules updated", true);
  }
  return ok("usage: ufw status [numbered] | allow <port>[/tcp] | allow from <ip|cidr> to any port <port> proto tcp | deny ... | delete <n> | enable | disable");
}

function listening(h: Host): string {
  const rows = [...h.ports].sort((a, b) => a - b).map((p) => `LISTEN  0       128     0.0.0.0:${pad(String(p), 12)}0.0.0.0:*          users:(("${procName(h, p)}",fd=3))`);
  return ["State   Recv-Q  Send-Q  Local Address:Port  Peer Address:Port  Process", ...rows].join("\n");
}

function systemctl(h: Host, args: string[]): GuestResult {
  const ok = (text: string, mut = false): GuestResult => ({ text, mut, known: true });
  const verb = (args[0] ?? "").toLowerCase();
  const svcs = h.services ?? {};
  if (verb === "--failed") return ok("  UNIT  LOAD  ACTIVE  SUB  DESCRIPTION\n0 loaded units listed.");
  const name = (args[1] ?? "").replace(/\.service$/, "");
  if (!name) return ok("usage: systemctl status|start|restart|stop <service>");
  const port = svcs[name] ?? (name === "sshd" || name === "ssh" ? 22 : undefined);
  if (port === undefined) return ok(`Unit ${name}.service could not be found.`);
  const running = h.ports.includes(port);
  if (verb === "status") return ok([`● ${name}.service`, `     Loaded: loaded (/lib/systemd/system/${name}.service; enabled)`, `     Active: ${running ? "active (running)" : "inactive (dead)"}`, running ? `     Listening on 0.0.0.0:${port}` : ""].filter(Boolean).join("\n"));
  if (verb === "start" || verb === "restart") { if (!running) h.ports.push(port); return ok("", !running); }
  if (verb === "stop") { h.ports = h.ports.filter((p) => p !== port); return ok("", running); }
  if (verb === "enable") return ok(`Created symlink /etc/systemd/system/multi-user.target.wants/${name}.service.`);
  return ok("usage: systemctl status|start|restart|stop <service>");
}

/** One command line inside the guest, with an optional `| grep <text>`. Unknown commands come back with known false. */
export function guestCmd(st: State, hostName: string, line: string): GuestResult {
  const h = st.hosts[hostName];
  const [main, ...pipes] = line.split("|").map((s) => s.trim());
  const words = main.split(/\s+/).filter(Boolean);
  if (words[0] === "sudo") words.shift();
  const cmd = (words[0] ?? "").toLowerCase();
  const args = words.slice(1);
  let r: GuestResult;
  if (cmd === "ufw") r = ufw(h, args);
  else if (cmd === "ss" || cmd === "netstat") r = { text: listening(h), mut: false, known: true };
  else if (cmd === "systemctl") r = systemctl(h, args);
  else return { text: "", mut: false, known: false };
  for (const p of pipes) {
    const m = p.match(/^grep\s+(?:-i\s+)?['"]?(.*?)['"]?$/);
    if (m) r = { ...r, text: r.text.split("\n").filter((l) => l.toLowerCase().includes(m[1].toLowerCase())).join("\n") };
  }
  return r;
}

/** A Run Command script: commands joined by &&, ; or new lines, run as root. */
export function runScript(st: State, hostName: string, script: string): GuestResult {
  const out: string[] = [];
  let mut = false;
  for (const part of script.split(/&&|;|\n/).map((s) => s.trim()).filter(Boolean)) {
    const r = guestCmd(st, hostName, part);
    if (!r.known) { out.push(`/bin/sh: 1: ${part.split(/\s+/)[0]}: command not found. lab: Run Command here models ufw, ss, netstat and systemctl.`); continue; }
    mut ||= r.mut;
    if (r.text) out.push(r.text);
  }
  return { text: out.join("\n"), mut, known: true };
}
