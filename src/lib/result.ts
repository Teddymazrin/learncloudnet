// The Portal's result card: what a tool or change just told you, in plain words, so you don't have to dig through JSON.

export interface ResultCard { tone: "ok" | "bad" | "info"; title: string; detail: string }

const ISSUE: Record<string, string> = {
  NetworkSecurityRule: "a security rule blocks it",
  UserDefinedRoute: "a user-defined route sends it the wrong way",
  GuestFirewall: "the VM's own firewall blocks it",
  NoListenerOnDestination: "nothing is listening on that port",
  DIPProbeDown: "the load balancer's health probe is down",
  DnsResolution: "the name didn't resolve",
};

const parse = (text: string): unknown => { try { return JSON.parse(text); } catch { return null; } };
const flag = (cmd: string, name: string) => cmd.match(new RegExp(`--${name}\\s+("[^"]*"|\\S+)`))?.[1]?.replace(/"/g, "");

/** Sum up one command's output. `text` is what the simulator printed for it. */
export function summarize(cmd: string, text: string, error: boolean, why?: string): ResultCard {
  if (error) return { tone: "bad", title: "That didn't run", detail: text.split("\n")[0].replace(/^lab:\s*/, "") };
  const j = parse(text) as Record<string, unknown> | Record<string, unknown>[] | null;

  if (/watcher test-ip-flow/.test(cmd) && j && !Array.isArray(j)) {
    const rule = String(j.ruleName ?? "").split("/").pop() || "no rule";
    const dir = flag(cmd, "direction") ?? "", port = (flag(cmd, "local") ?? "").split(":")[1];
    return { tone: j.access === "Allow" ? "ok" : "bad", title: `${j.access === "Allow" ? "Allowed" : "Denied"} by ${rule}`, detail: `IP flow verify · ${dir} ${flag(cmd, "protocol") ?? ""}${port && port !== "*" ? ` port ${port}` : ""} on ${flag(cmd, "vm")}` };
  }
  if (/watcher show-next-hop/.test(cmd) && j && !Array.isArray(j)) {
    const type = String(j.nextHopType);
    if (type === "None") return { tone: "bad", title: "No next hop: Azure drops it", detail: `Next hop · ${flag(cmd, "vm")} to ${flag(cmd, "dest-ip")}` };
    const rt = String(j.routeTableId ?? "");
    return { tone: "info", title: `Next hop: ${type}${j.nextHopIpAddress ? ` ${j.nextHopIpAddress}` : ""}`, detail: `${flag(cmd, "vm")} to ${flag(cmd, "dest-ip")} · decided by ${rt === "System Route" ? "a system route" : `route table ${rt.split("/").pop()}`}` };
  }
  if (/watcher test-connectivity/.test(cmd) && j && !Array.isArray(j)) {
    const to = `${flag(cmd, "source-resource")} to ${flag(cmd, "dest-address")}:${flag(cmd, "dest-port")}`;
    if (j.connectionStatus === "Reachable") return { tone: "ok", title: "Reachable", detail: `Connection troubleshoot · ${to}` };
    const hops = (j.hops as { address: string; issues: { type: string; context?: { value: string }[] }[] }[]) ?? [];
    const bad = hops.find((h) => h.issues.length);
    const issue = bad?.issues[0];
    const rule = issue?.context?.[0]?.value;
    return { tone: "bad", title: "Unreachable", detail: `${to} · ${issue ? `stops at ${bad!.address}: ${ISSUE[issue.type] ?? issue.type}${rule ? ` (${rule})` : ""}` : "no hop reported an issue"}` };
  }
  if (/show-effective-route-table/.test(cmd) && Array.isArray(j)) {
    const user = j.filter((r) => r.source === "User" && r.state === "Active");
    return { tone: "info", title: `${j.length} routes apply to ${flag(cmd, "name")}`, detail: user.length ? `Your routes: ${user.map((r) => `${(r.addressPrefix as string[])[0]} to ${r.nextHopType}${(r.nextHopIpAddress as string[]).length ? ` ${(r.nextHopIpAddress as string[])[0]}` : ""}`).join(", ")}` : "Only Azure's system routes. No route table changes anything here." };
  }
  if (/list-effective-nsg/.test(cmd)) {
    if (/^lab:/.test(text)) return { tone: "info", title: "No security rules apply", detail: text.replace(/^lab:\s*/, "") };
    const rows = text.split("\n").length - 2;
    return { tone: "info", title: `${rows} security rules apply to ${flag(cmd, "name")}`, detail: "Read them in the output below, lowest priority number first. The first match wins." };
  }
  if (why) return { tone: "ok", title: "Done", detail: why };
  return { tone: "info", title: "Done", detail: "The full output is below." };
}
