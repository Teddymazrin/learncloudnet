// Turns a typed line into a result: az commands, in-VM tools, or lab commands.
import { closestWord } from "./didyoumean";
import { az, LabError } from "./az";
import { cidr, ip2n, lastAddr, n2ip, usable } from "./ip";
import { connect, resolveFrom } from "./network";
import { guestCmd } from "./guest";
import { winCmd } from "./windows";
import type { Flags, RunResult, Session, State } from "./types";

export function tokenize(line: string): string[] {
  line = line.replace(/\\\r?\n/g, " ").replace(/`\r?\n/g, " ").replace(/\r?\n/g, " ");
  const out: string[] = [];
  let cur = "", q: string | null = null, had = false;
  for (const ch of line) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; had = true; continue; }
    if (/\s/.test(ch)) { if (cur || had) { out.push(cur); cur = ""; had = false; } continue; }
    cur += ch;
  }
  if (cur || had) out.push(cur);
  return out;
}

const SHORT: Record<string, string> = { "-n": "name", "-g": "resource-group", "-o": "output", "-z": "zone-name", "-v": "virtual-network", "-e": "registration-enabled", "-l": "location", "-h": "help" };
const SYN: Record<string, string> = {
  "address-prefix": "address-prefixes", "subnet-prefix": "subnet-prefixes",
  "source-address-prefix": "source-address-prefixes", "destination-address-prefix": "destination-address-prefixes",
  "destination-port-range": "destination-port-ranges", "source-port-range": "source-port-ranges", nsg: "network-security-group",
};
const isFlag = (t: string) => t[0] === "-" && t !== "-" && !/^-\d/.test(t);

export function parse(tokens: string[]): { words: string[]; flags: Flags } {
  const words: string[] = [];
  const flags: Flags = {};
  let i = 0;
  while (i < tokens.length && !isFlag(tokens[i])) words.push(tokens[i++].toLowerCase());
  while (i < tokens.length) {
    const t = tokens[i++];
    let key: string;
    if (t.startsWith("--")) {
      const eq = t.indexOf("=");
      if (eq > 0) { key = t.slice(2, eq).toLowerCase(); key = SYN[key] ?? key; (flags[key] ??= []).push(t.slice(eq + 1)); continue; }
      key = t.slice(2).toLowerCase();
    } else if (SHORT[t]) key = SHORT[t];
    else key = t.slice(1).toLowerCase();
    key = SYN[key] ?? key;
    flags[key] ??= [];
    let got = false;
    while (i < tokens.length && !isFlag(tokens[i])) { flags[key].push(tokens[i++]); got = true; }
    if (!got) flags[key].push("true");
  }
  return { words, flags };
}

export const HELP = [
  "Cloud Shell (a subset of az network, resource group rg-lab)",
  "  az network vnet create | update | show | list",
  "  az network vnet subnet create | update | show",
  "  az network nic show | ip-config list --nic-name <vm>-nic",
  "  az network nic show-effective-route-table | list-effective-nsg --name <vm>-nic",
  "  az network nsg create | show",
  "  az network nsg rule create | update | delete | show | list [--include-default]",
  "  az network route-table create",
  "  az network route-table route create | update",
  "  az network vnet peering create | update | delete | list | show",
  "  az network private-dns zone list",
  "  az network private-dns link vnet create | list",
  "  az network nic update --name <nic> [--network-security-group <nsg>] [--ip-forwarding true|false]",
  "  az network vnet update --name <vnet> [--address-prefixes ...] [--dns-servers <ip> ...]",
  "  az network vnet peering sync --vnet-name <vnet> --name <peering>",
  "  az network private-dns zone create | record-set a add-record | record-set a list",
  "  az network vnet-gateway list   az network local-gateway list",
  "  az network firewall show | ip-config list | network-rule collection list | network-rule create",
  "  az network public-ip create   az network bastion create | show | list",
  "  az storage account show | update | network-rule add | network-rule list",
  "  az dns-resolver list | inbound-endpoint list|create | forwarding-ruleset list",
  "  az dns-resolver forwarding-rule list|create|update | vnet-link list|create",
  "  az network nat gateway create | list   az network public-ip create | list",
  "  az network vnet subnet update ... [--nat-gateway <name>] [--default-outbound false]",
  "  az network lb show | probe list | probe update --lb-name <lb> --name <probe> --port <n>",
  "  az network route-table route delete --route-table-name <rt> --name <route>",
  "  az network watcher test-connectivity --source-resource <vm> --dest-address <ip|name> --dest-port <n>",
  "  az network watcher test-ip-flow --vm ... --direction ... --protocol ... --local ip:port --remote ip:port",
  "  az network watcher show-next-hop --vm ... --source-ip ... --dest-ip ...",
  "  Common flags: -g/--resource-group, -n/--name, --query <path>, -o json|table|tsv",
  "",
  "On a VM (ssh <vm-name> first, exit to leave)",
  "  nslookup <name>   nc -zv <host> <port>   curl -sI https://<host>   ip addr",
  "  sudo ss -tlnp   systemctl status|start <service>   sudo ufw status [numbered]",
  "  sudo ufw allow <port>/tcp | allow from <ip|cidr> to any port <port> proto tcp | delete <n>",
  "",
  "Run Command (runs on the VM as root, even when SSH is blocked)",
  "  az vm run-command invoke -g rg-lab -n <vm> --command-id RunShellScript --scripts \"<commands>\"",
  "",
  "Lab tools",
  "  answer <n> <value>   answer question n on the level",
  "  cidr <prefix>        show the range, size and Azure-usable count of a CIDR block",
  "  help  hint  goals  reset  clear  ssh <vm>  exit",
  "",
  "Multi-line paste works with a trailing \\ (bash) or ` (PowerShell).",
].join("\n");

const META = ["help", "hint", "goals", "reset", "clear"] as const;
type Meta = (typeof META)[number];

function cidrTool(arg?: string): string {
  const c = arg ? cidr(arg) : null;
  if (!c || !arg!.includes("/")) return "usage: cidr <prefix>, for example cidr 10.1.0.0/16";
  return [
    `block      ${c.text}${c.aligned ? "" : `   (you typed ${arg}, the network address is ${n2ip(c.net)})`}`,
    `first      ${n2ip(c.net)}`,
    `last       ${lastAddr(c)}`,
    `addresses  ${c.size.toLocaleString("en-US")}`,
    `azure use  ${usable(c).toLocaleString("en-US")} usable as a subnet (5 reserved)`,
  ].join("\n");
}

function vmCmd(st: State, hostName: string, tokens: string[]): RunResult {
  const h = st.hosts[hostName];
  if (tokens[0] === "sudo" && tokens.length > 1) tokens = tokens.slice(1);
  const cmd = tokens[0].toLowerCase();
  const args = tokens.slice(1).filter((t) => t[0] !== "-");
  if (cmd === "nslookup") {
    if (!args[0]) return { text: "usage: nslookup <name>" };
    const r = resolveFrom(st, hostName, args[0]);
    if (r.timeout) return { text: `;; connection timed out; no servers could be reached\nlab: ${r.steps.filter((x) => !x.ok).map((x) => x.text).join(" ")}` };
    const lines = [`Server:\t\t${r.server}`, `Address:\t${r.server}#53`, ""];
    if (r.nx) { lines.push(`** server can't find ${r.name}: NXDOMAIN`); return { text: lines.join("\n") }; }
    lines.push("Non-authoritative answer:");
    r.aliases.forEach((a, i) => lines.push(`${a}\tcanonical name = ${r.aliases[i + 1] ?? r.name}.`));
    lines.push(`Name:\t${r.name}`, `Address: ${r.ip}`);
    return { text: lines.join("\n") };
  }
  const resolveHost = (host: string) => {
    if (ip2n(host) !== null) return { ip: host };
    const r = resolveFrom(st, hostName, host);
    return r.nx ? { nx: true } : { ip: r.ip! };
  };
  if (cmd === "nc") {
    if (args.length < 2) return { text: "usage: nc -zv <host> <port>" };
    const [host, p] = args; const port = Number(p);
    if (!Number.isInteger(port)) return { text: `nc: port number invalid: ${p}` };
    const r = resolveHost(host);
    if (!r.ip) return { text: `nc: getaddrinfo for host "${host}" port ${port}: Name or service not known` };
    const c = connect(st, hostName, r.ip, port);
    if (c.ok) return { text: `Connection to ${host} (${r.ip}) ${port} port [tcp/*] succeeded!`, trace: c };
    return { text: `nc: connect to ${host} (${r.ip}) port ${port} (tcp) failed: ${c.stage === "port" ? "Connection refused" : "Connection timed out"}\nlab trace: ${c.reason}`, trace: c };
  }
  if (cmd === "curl") {
    const url = args.find((x) => /^https?:\/\//i.test(x) || x.includes("."));
    if (!url) return { text: "usage: curl -sI https://<host>" };
    const host = url.replace(/^https?:\/\//i, "").split("/")[0];
    const r = resolveHost(host);
    if (!r.ip) return { text: `curl: (6) Could not resolve host: ${host}` };
    const c = connect(st, hostName, r.ip, 443);
    if (c.ok && c.service) return { text: `HTTP/1.1 200 OK\nlab: ${c.service} answered at ${r.ip}.${c.egress ? ` The request left Azure through ${c.egress}.` : ""}`, trace: c };
    if (c.ok) {
      const t = st.hosts[c.target!];
      return { text: `lab: TLS session opened to ${host} at ${r.ip} (${t.name}, ${t.kind === "pe" ? "private endpoint" : "VM"}).\nlab: the service answered over the private path.`, trace: c };
    }
    if (c.stage === "public") return { text: `HTTP/1.1 403 Forbidden\nx-ms-error-code: AuthorizationFailure\nlab: ${host} resolved to ${r.ip}. ${c.reason}`, trace: c };
    return { text: `curl: (28) Failed to connect to ${host} port 443: Connection timed out\nlab trace: ${c.reason}`, trace: c };
  }
  if (cmd === "ip" && /^(a|addr|address)$/.test(args[0] ?? "")) {
    const len = cidr(st.vnets[h.vnet].subnets[h.subnet].prefixes[0])!.len;
    return { text: `1: lo: <LOOPBACK,UP>\n    inet 127.0.0.1/8 scope host lo\n2: eth0: <BROADCAST,MULTICAST,UP>\n    inet ${h.ip}/${len} scope global eth0` };
  }
  if (cmd === "hostname") return { text: h.name };
  if (cmd === "az") return { text: `lab: the Azure CLI isn't installed on ${h.name}. Type exit to return to Cloud Shell.`, error: true };
  const g = guestCmd(st, hostName, tokens.join(" "));
  if (g.known) return { text: g.text, mut: g.mut };
  const near = closestWord(cmd, VM_CMDS);
  return { text: `${cmd}: command not found.${near ? ` Did you mean ${near}?` : ""} On a VM you can use nslookup, nc -zv, curl -sI, ip addr, ss -tlnp, systemctl, ufw, exit.` };
}

const VM_CMDS = ["nslookup", "nc", "curl", "ip", "hostname", "ss", "netstat", "systemctl", "ufw", "exit"];
const SHELL_CMDS = ["az", "ssh", "help", "goals", "hint", "clear", "reset", "answer", "cidr"];

/** Run one line. Mutates st and session. */
export function run(st: State, line: string, session: Session): RunResult {
  const raw = line.trim();
  if (!raw) return { text: "" };
  const tokens = tokenize(raw);
  if (!tokens.length) return { text: "" };
  const { words, flags } = parse(tokens);
  const head = tokens[0].toLowerCase();
  const log = (ok: boolean) => session.log.push({ raw, words, flags, ok, inVm: session.vm });

  if ((META as readonly string[]).includes(head)) return { text: head === "help" ? HELP : "", meta: head as Meta };
  if (head === "answer") {
    const n = tokens[1], val = tokens.slice(2).join(" ");
    if (!n || !val) return { text: "usage: answer <question number> <your answer>, for example answer 1 65536", error: true };
    session.answers[n] = val;
    log(true);
    return { text: `lab: answer ${n} recorded: ${val}` };
  }
  if (head === "cidr") { log(true); return { text: cidrTool(tokens[1]) }; }

  if (session.vm) {
    if (head === "exit" || head === "logout") { const was = session.vm; session.vm = null; return { text: `logout\nConnection to ${was} closed.` }; }
    // ssh from a VM: same VM is a no-op, another VM hops there through the lab's management path.
    if (head === "ssh" && (words[1] ?? "").replace(/^.*@/, "").replace(/[,;.]+$/, "") === session.vm) return { text: `lab: you're already on ${session.vm}. Run your test here.` };
    if (head === "ssh" && words[1]) { const was = session.vm; session.vm = null; const r = run(st, raw, session); if (session.vm) r.text = `lab: left ${was}.\n${r.text}`; else session.vm = was; return r; }
    if (session.os === "windows") {
      const { canon, ...r } = winCmd(st, session.vm, tokens);
      session.log.push({ raw, words, flags, ok: !/is not recognized|^lab: usage/.test(r.text), inVm: session.vm, canon });
      return r;
    }
    const r = vmCmd(st, session.vm, tokens);
    log(!/command not found|usage:|ERROR:/.test(r.text));
    return r;
  }
  if (head === "ssh") {
    const target = (words[1] ?? "").replace(/^.*@/, "").replace(/[,;.]+$/, "");
    if (!target) return { text: "usage: ssh <vm-name>" };
    const h = st.hosts[target];
    if (!h) return { text: `ssh: Could not resolve hostname ${target}. VMs in this lab: ${Object.values(st.hosts).filter((x) => x.kind === "vm").map((x) => x.name).join(", ")}`, error: true };
    if (h.kind !== "vm" && h.kind !== "dns") return { text: `lab: ${target} is ${h.kind === "pe" ? "a private endpoint" : "a managed network resource"}. You can only open a shell on the lab VMs.`, error: true };
    session.vm = target;
    log(true);
    return { text: `lab: connected to ${target} (${h.ip}) through the lab's management path.\nType exit to return to Cloud Shell.` };
  }
  if (head === "exit") return { text: "lab: you're already in Cloud Shell." };
  if (head !== "az") {
    if (["nslookup", "nc", "curl", "ping", "dig", "ufw", "ss", "netstat", "systemctl", "sudo"].includes(head)) return { text: `lab: ${head} runs on a VM. Use ssh <vm-name> first.`, error: true };
    const near = closestWord(head, SHELL_CMDS);
    return { text: `${head}: command not found.${near ? ` Did you mean ${near}?` : ""} Type help.`, error: true };
  }
  if (words.length === 1 || flags.help) return { text: HELP };
  try {
    const r = az(st, words, flags);
    log(true);
    return { text: [r.text, ...r.notes].filter(Boolean).join("\n"), mut: r.mut };
  } catch (e) {
    if (e instanceof LabError) { log(false); return { text: e.message, error: true }; }
    throw e;
  }
}
