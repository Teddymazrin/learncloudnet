// Inside a Windows VM: the PowerShell way to test names, ports and web services.
// Each command has a Linux twin (Test-NetConnection is nc -zv, Resolve-DnsName is nslookup), so levels check one canonical form.
import { closestWord } from "./didyoumean";
import { cidr, ip2n } from "./ip";
import { connect, resolveFrom } from "./network";
import type { RunResult, State } from "./types";

export type Os = "linux" | "windows";

/** The PowerShell version of a Linux test command, for showing steps and hints. Anything else comes back as it was. */
export function toWindows(cmd: string): string {
  const c = cmd.trim();
  let m = c.match(/^nc\s+-zv\s+(\S+)\s+(\d+)$/);
  if (m) return `Test-NetConnection ${m[1]} -Port ${m[2]}`;
  m = c.match(/^curl\s+-sI\s+(\S+)$/);
  if (m) return `Invoke-WebRequest ${m[1]} -Method Head`;
  m = c.match(/^nslookup\s+(\S+)$/);
  if (m) return `Resolve-DnsName ${m[1]}`;
  if (/^ip\s+(a|addr|address)$/.test(c)) return "ipconfig";
  return cmd;
}

/** The Linux twin of a PowerShell line, so a goal like "test it with nc" counts either way. */
export function toLinux(tokens: string[]): string | null {
  const cmd = (tokens[0] ?? "").toLowerCase();
  const args = tokens.slice(1);
  const val = (name: string) => { const i = args.findIndex((a) => a.toLowerCase() === `-${name}`); return i >= 0 ? args[i + 1] : undefined; };
  const bare = args.filter((a, i) => a[0] !== "-" && (i === 0 || args[i - 1][0] !== "-"));
  if (cmd === "test-netconnection" || cmd === "tnc") {
    const host = val("computername") ?? bare[0], port = val("port");
    return host && port ? `nc -zv ${host} ${port}` : null;
  }
  if (cmd === "resolve-dnsname") { const n = val("name") ?? bare[0]; return n ? `nslookup ${n}` : null; }
  if (cmd === "nslookup" && bare[0]) return `nslookup ${bare[0]}`;
  if (cmd === "invoke-webrequest" || cmd === "iwr" || cmd === "curl" || cmd === "curl.exe") {
    const u = val("uri") ?? bare[0];
    return u ? `curl -sI ${/^https?:\/\//i.test(u) ? u : `https://${u}`}` : null;
  }
  return null;
}

const PS_CMDS = ["Test-NetConnection", "Resolve-DnsName", "nslookup", "Invoke-WebRequest", "ipconfig", "hostname", "exit"];
const row = (pairs: [string, string | number | boolean][]) => { const w = Math.max(...pairs.map(([k]) => k.length)); return pairs.map(([k, v]) => `${k.padEnd(w)} : ${v === true ? "True" : v === false ? "False" : v}`).join("\n"); };

/** One PowerShell line on a Windows VM. */
export function winCmd(st: State, hostName: string, tokens: string[]): RunResult & { canon?: string } {
  const h = st.hosts[hostName];
  const cmd = (tokens[0] ?? "").toLowerCase();
  const canon = toLinux(tokens) ?? undefined;
  const resolve = (host: string) => {
    if (ip2n(host) !== null) return { ip: host as string | undefined, steps: "" };
    const r = resolveFrom(st, hostName, host);
    return { ip: r.nx || r.timeout ? undefined : r.ip!, steps: r.timeout ? r.steps.filter((x) => !x.ok).map((x) => x.text).join(" ") : "" };
  };

  if (cmd === "test-netconnection" || cmd === "tnc") {
    if (!canon) return { text: "lab: usage: Test-NetConnection <host> -Port <port>, for example Test-NetConnection 10.1.1.4 -Port 443", error: true };
    const [, , host, p] = canon.split(" ");
    const port = Number(p);
    const r = resolve(host);
    if (!r.ip) return { canon, text: `WARNING: Name resolution of ${host} failed${r.steps ? `\nlab: ${r.steps}` : ""}` };
    const c = connect(st, hostName, r.ip, port);
    const block = row([["ComputerName", host], ["RemoteAddress", r.ip], ["RemotePort", port], ["InterfaceAlias", "Ethernet"], ["SourceAddress", h.ip], ["TcpTestSucceeded", c.ok]]);
    if (c.ok) return { canon, text: block, trace: c };
    return { canon, text: `WARNING: TCP connect to (${r.ip} : ${port}) failed\n${block}\nlab trace: ${c.stage === "port" ? "the VM answered but nothing is listening on that port. " : ""}${c.reason}`, trace: c };
  }
  // Windows ships nslookup.exe too. It prints its own format, not Resolve-DnsName's, so the two never look alike.
  if (cmd === "nslookup") {
    if (!canon) return { text: "lab: usage: nslookup <name>", error: true };
    const name = canon.split(" ")[1];
    const r = resolveFrom(st, hostName, name);
    if (r.timeout) return { canon, text: `DNS request timed out.\n    timeout was 2 seconds.\n*** Request to UnKnown timed-out\nlab: ${r.steps.filter((x) => !x.ok).map((x) => x.text).join(" ")}` };
    const head = [`Server:  UnKnown`, `Address:  ${r.server}`, ""];
    if (r.nx) return { canon, text: [...head, `*** UnKnown can't find ${name}: Non-existent domain`].join("\n") };
    const lines = [...head, "Non-authoritative answer:", `Name:    ${r.name}`, `Address:  ${r.ip}`];
    if (r.aliases.length) lines.push(`Aliases:  ${r.aliases[0]}`, ...r.aliases.slice(1).map((a) => `          ${a}`));
    return { canon, text: `${lines.join("\n")}\nlab: that's nslookup.exe. Resolve-DnsName is the PowerShell way, and shows the same answer as a table.` };
  }
  if (cmd === "resolve-dnsname") {
    if (!canon) return { text: "lab: usage: Resolve-DnsName <name>", error: true };
    const name = canon.split(" ")[1];
    const r = resolveFrom(st, hostName, name);
    if (r.timeout) return { canon, text: `Resolve-DnsName : ${name} : This operation returned because the timeout period expired\nlab: ${r.steps.filter((x) => !x.ok).map((x) => x.text).join(" ")}` };
    if (r.nx) return { canon, text: `Resolve-DnsName : ${name} : DNS name does not exist` };
    const lines = ["Name                           Type   TTL   Section    NameHost / IPAddress", "----                           ----   ---   -------    --------------------"];
    r.aliases.forEach((a, i) => lines.push(`${a.padEnd(31)}CNAME  3600  Answer     ${r.aliases[i + 1] ?? r.name}`));
    lines.push(`${r.name.padEnd(31)}A      10    Answer     ${r.ip}`);
    return { canon, text: `${lines.join("\n")}\nlab: answered by the DNS server at ${r.server}.` };
  }
  // In Windows PowerShell, curl is an alias for Invoke-WebRequest, so Linux flags like -sI fail. curl.exe is the real curl.
  if (cmd === "curl" && tokens.slice(1).some((t) => /^-[a-zA-Z]{1,3}$/.test(t))) {
    const bad = tokens.slice(1).find((t) => /^-[a-zA-Z]{1,3}$/.test(t))!;
    return { error: true, text: `Invoke-WebRequest : A parameter cannot be found that matches parameter name '${bad.slice(1)}'.\nlab: in Windows PowerShell, curl is a shortcut for Invoke-WebRequest, which doesn't take Linux flags. Use Invoke-WebRequest https://<host> -Method Head, or curl.exe ${tokens.slice(1).join(" ")}.` };
  }
  if (cmd === "invoke-webrequest" || cmd === "iwr" || cmd === "curl" || cmd === "curl.exe") {
    if (!canon) return { text: "lab: usage: Invoke-WebRequest https://<host> -Method Head", error: true };
    const host = canon.split(" ")[2].replace(/^https?:\/\//i, "").split("/")[0];
    const r = resolve(host);
    if (!r.ip) return { canon, text: `Invoke-WebRequest : The remote name could not be resolved: '${host}'` };
    const c = connect(st, hostName, r.ip, 443);
    if (c.ok) {
      const what = c.service ? `${c.service} answered at ${r.ip}.${c.egress ? ` The request left Azure through ${c.egress}.` : ""}` : `${st.hosts[c.target!].name} answered at ${r.ip} over the private path.`;
      return { canon, text: `${row([["StatusCode", 200], ["StatusDescription", "OK"]])}\nlab: ${what}`, trace: c };
    }
    if (c.stage === "public") return { canon, text: `Invoke-WebRequest : The remote server returned an error: (403) Forbidden.\nlab: ${host} resolved to ${r.ip}. ${c.reason}`, trace: c };
    return { canon, text: `Invoke-WebRequest : Unable to connect to the remote server\nlab trace: ${c.reason}`, trace: c };
  }
  if (cmd === "ipconfig") {
    const p = cidr(st.vnets[h.vnet].subnets[h.subnet].prefixes[0])!;
    const mask = [24, 16, 8, 0].map((s) => (((0xffffffff << (32 - p.len)) >>> 0) >>> s) & 255).join(".");
    return { canon: "ip addr", text: `Windows IP Configuration\n\nEthernet adapter Ethernet:\n\n   IPv4 Address. . . . . . . . . . . : ${h.ip}\n   Subnet Mask . . . . . . . . . . . : ${mask}` };
  }
  if (cmd === "hostname") return { text: h.name };
  if (cmd === "az") return { text: `lab: the Azure CLI isn't installed on ${h.name}. Type exit to return to Cloud Shell.`, error: true };
  const linux: Record<string, string> = { nc: "Test-NetConnection", ip: "ipconfig", dig: "Resolve-DnsName", ufw: "Get-NetFirewallRule", ss: "Get-NetTCPConnection", netstat: "Get-NetTCPConnection", systemctl: "Get-Service" };
  const near = linux[cmd] ?? closestWord(tokens[0], PS_CMDS);
  const linuxOnly = cmd in linux || ["ping", "sudo", "ls", "cat"].includes(cmd);
  return { error: true, text: `${linuxOnly ? `lab: ${tokens[0]} is a Linux command, and ${h.name} runs Windows. Switch VMs to Linux above the shell, or use the PowerShell command.\n` : ""}${tokens[0]} : The term '${tokens[0]}' is not recognized as the name of a cmdlet, function, script file, or operable program.${near ? ` Did you mean ${near}?` : ""}\nlab: on this Windows VM you can use Test-NetConnection, Resolve-DnsName, Invoke-WebRequest, ipconfig, hostname, exit.` };
}
