// The mentor: a troubleshooting process for fix levels, the way a senior engineer would walk you through one.
// See it fail, look with a tool, name the cause, fix it. Each step ticks itself off from what you actually did.
import type { Level } from "@/content/types";
import { evalFlow, type FlowResult } from "@/content/flows";
import { newSession, type Session, type State } from "@/sim/types";
import { toWindows, type Os } from "@/sim/windows";

/** Answers for "what's stopping it?", one per place a connection can fail in the simulator. */
export const CAUSES: [string, string][] = [
  ["nsg", "A security rule blocks it"],
  ["route", "Routing sends it the wrong way"],
  ["peering", "A peering stops it"],
  ["return", "The reply never makes it back"],
  ["dns", "The name gives the wrong address, or none"],
  ["host", "Nothing answers there"],
  ["probe", "No healthy backend behind the load balancer"],
  ["firewall", "A firewall rule blocks it"],
  ["guest", "The VM's own firewall blocks it"],
];
/** The causes a tier has taught by then. A choice offers the real one plus three of these, never a topic from later. */
const POOL: Record<string, string[]> = {
  beginner: ["nsg", "route", "peering", "dns", "host"],
  intermediate: ["nsg", "route", "peering", "dns", "host", "return", "firewall"],
  advanced: CAUSES.map((p) => p[0]),
  expert: CAUSES.map((p) => p[0]),
};
export function causeChoices(tier: string, actual: string, seed: string): [string, string][] {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => ((h = (h * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const others = (POOL[tier] ?? POOL.expert).filter((v) => v !== actual).sort(() => rnd() - 0.5).slice(0, 3);
  return [actual, ...others].sort(() => rnd() - 0.5).map((v) => CAUSES.find((p) => p[0] === v)!).filter(Boolean);
}
export const whereItStops = (f: FlowResult) => {
  if (!f.trace) return "dns";
  const s = f.trace.stage;
  return s === "public" ? "dns" : s === "port" || !s ? "host" : s;
};

/** Objectives split three ways: goals to reach, rules that already hold and must keep holding, and questions. */
export function splitObjectives(level: Level) {
  const st = level.setup();
  const ctx = { st, session: newSession() };
  const goals: number[] = [], guards: number[] = [], questions: number[] = [];
  level.objectives.forEach((o, k) => {
    if (o.question) questions.push(k);
    else if (!o.action && o.test(ctx)) guards.push(k);
    else goals.push(k);
  });
  return { goals, guards, questions };
}

/** Where the first broken connection stops when the level starts: the cause the player is asked to name. */
export function startingCause(level: Level): { cause: string; flow: FlowResult } | null {
  const st = level.setup();
  for (const f of level.flows ?? []) {
    if (f.want !== "open") continue;
    const r = evalFlow(st, f);
    if (!r.ok) return { cause: whereItStops(r), flow: r };
  }
  return null;
}

/** A fix level gets the process. Guided levels have their own steps, and the sandbox has none. */
export const usesMentor = (level: Level) => !!level.fix && !level.steps && !level.playground;

type LogEntry = Session["log"][number];
const TESTS = /^(nc|curl|nslookup|dig|ping)\b/;
const isTest = (e: LogEntry) => e.ok && ((!!e.inVm && TESTS.test((e.canon ?? e.raw).trim())) || /watcher test-connectivity/.test(e.raw));
const LOOKS = /watcher (test-ip-flow|show-next-hop|test-connectivity)|show-effective-route-table|list-effective-nsg|\b(list|show)\b/;
const isLook = (e: LogEntry) => e.ok && ((e.raw.startsWith("az ") && LOOKS.test(e.raw)) || (!!e.inVm && /^(ufw status|ss |netstat|systemctl (status|--failed))/.test(e.raw.trim())) || /run-command invoke/.test(e.raw));

/** One step of the process: why you do it, exactly how in the mode you're in, and what ticks it off. */
export interface MentorStep {
  id: "see" | "look" | "cause" | "fix" | "explain";
  title: string;
  done: boolean;
  say: string;
  /** Where to click in the Portal. */
  portal?: string;
  /** The Cloud Shell lines to type, one per row. */
  cmds?: string[];
  /** Keep the how folded under "Show me how", so working it out yourself comes first. */
  folded?: boolean;
  /** What makes the step tick, so you're never left guessing. */
  tick?: string;
  /** A choice of checks, each with where to click and what to type. */
  options?: StepOption[];
  /** A line to run before any of the options, such as leaving the VM. */
  before?: { label: string; cmds: string[] };
}
export interface StepOption { label: string; portal: string; cmds: string[] }
const ip4 = (s: string) => /^\d+\.\d+\.\d+\.\d+$/.test(s);

const target = (st: State, f: FlowResult) => f.flow.dns ?? (f.targetIp ?? (f.flow.to ? st.hosts[f.flow.to]?.ip : "") ?? "");
const DIAG = /watcher (test-ip-flow|show-next-hop|test-connectivity)|show-effective-route-table|list-effective-nsg/;

export function mentorSteps(level: Level, opts: { st: State; log: LogEntry[]; flows: FlowResult[]; vm: string | null; os?: Os; goalsDone: boolean; causeOk: boolean; hasCause: boolean; questionsDone: boolean; hasQuestions: boolean; explained: boolean }): MentorStep[] {
  const { st, log, flows, vm } = opts;
  const first = flows.find((f) => f.flow.want === "open" && !f.good) ?? flows.find((f) => f.flow.want === "open");
  const from = first?.flow.from ?? "";
  const tgt = first ? target(st, first) : "";
  const fromVm = !!first && st.hosts[from]?.kind === "vm";

  // Step 1: reproduce it from where the user sits.
  const see: MentorStep = { id: "see", title: "See it fail", done: log.some(isTest), say: "Prove the problem yourself before you change anything. Reports are often wrong." };
  if (first && fromVm) {
    const hop = vm === from ? [] : vm ? ["exit", `ssh ${from}`] : [`ssh ${from}`];
    const test = first.flow.dns ? [`nslookup ${first.flow.dns}`, `nc -zv ${first.flow.dns} ${first.flow.port}`] : [`nc -zv ${tgt} ${first.flow.port}`];
    see.portal = `Diagnose, then Connection troubleshoot. Source ${from}, destination ${tgt}, port ${first.flow.port}. Run it.`;
    see.cmds = [...hop, ...test].map((c) => (opts.os === "windows" ? toWindows(c) : c));
    see.tick = vm === from ? `Ticks off when the test runs. You're already on ${from}.` : `Ticks off when the test runs on ${from}.`;
  } else {
    // The traffic doesn't start on a lab VM, so there's nothing to log in to: the map's own test is the way to see it.
    see.done = see.done || opts.explained;
    see.say = `This traffic starts outside the lab VMs, so you can't log in to test it. Watch it instead.`;
    see.portal = "Tap Explain on the red line under the map.";
    see.tick = "Ticks off when you tap Explain on the broken line.";
  }

  // Step 2: one tool that checks one layer. The first test doesn't count twice.
  const firstTest = log.findIndex(isTest);
  const diag = level.hints.map(hintParts).find((h) => h.cmd && DIAG.test(h.cmd));
  const look: MentorStep = {
    id: "look", title: "Find where it stops", done: log.some((e, i) => i !== firstTest && isLook(e)),
    say: level.tool ?? "Pick one tool that checks one layer: names, routes, security rules, the peering, or the VM itself. Each tool in Diagnose says what it checks.",
    tick: "Ticks off when you run a Diagnose tool, or a list or show command.",
  };
  // "Show me how": a short menu of layer checks for this connection, not the answer. The level's own suggestion comes first.
  const win = (c: string) => (opts.os === "windows" ? toWindows(c) : c);
  const az = (c: string) => [c];
  const options: StepOption[] = [];
  if (diag?.cmd && diag.portal) options.push({ label: "Start with this one", portal: `${diag.portal[0].toUpperCase()}${diag.portal.slice(1)}.`, cmds: az(diag.cmd) });
  if (first && fromVm) {
    const src = st.hosts[from];
    const ip = first.targetIp ?? (ip4(tgt) ? tgt : null);
    const dst = first.target ? st.hosts[first.target] : Object.values(st.hosts).find((h) => h.ip === ip);
    const port = first.flow.port;
    const have = (re: RegExp) => options.some((o) => o.cmds.some((c) => re.test(c)));
    if (first.flow.dns) {
      const hop = vm === from ? [] : vm ? ["exit", `ssh ${from}`] : [`ssh ${from}`];
      options.push({ label: "Names: what address does the name give?", portal: `Names aren't in Diagnose. Switch to Cloud Shell, then: ssh ${from}, and look the name up.`, cmds: [...hop, win(`nslookup ${first.flow.dns}`)] });
    }
    if (ip && !have(/show-next-hop/)) options.push({ label: "Routes: where does Azure send it?", portal: `Diagnose, then Next hop. VM ${from}, destination ${ip}.`, cmds: az(`az network watcher show-next-hop -g rg-lab --vm ${from} --source-ip ${src.ip} --dest-ip ${ip}`) });
    if (ip && dst?.kind === "vm" && !have(/test-ip-flow/)) options.push({ label: "Security rules: is it let in?", portal: `Diagnose, then IP flow verify. VM ${dst.name}, inbound, TCP, local port ${port}, remote ${src.ip}.`, cmds: az(`az network watcher test-ip-flow -g rg-lab --vm ${dst.name} --direction Inbound --protocol TCP --local ${dst.ip}:${port} --remote ${src.ip}:*`) });
    if (!have(/show-effective-route-table/)) options.push({ label: `Every route on ${from}`, portal: `Diagnose, then Effective routes on ${from}.`, cmds: az(`az network nic show-effective-route-table -g rg-lab --name ${src.nic}`) });
  }
  if (options.length) { look.options = options; look.folded = true; if (vm) look.before = { label: `You're on ${vm}. az commands run in Cloud Shell, so leave the VM first`, cmds: ["exit"] }; }

  const steps: MentorStep[] = [see, look];
  if (opts.hasCause) steps.push({ id: "cause", title: "Name the cause", done: opts.causeOk, say: "What did the tool show? Say it out loud before you touch anything.", tick: "Ticks off when you pick what the evidence shows." });
  steps.push({
    id: "fix", title: "Fix it and test again", done: opts.goalsDone,
    say: "Change only the thing the evidence points at, nothing else. Then run your test from step 1 again.",
    portal: "Tap the resource the tool named on the map. Its settings open here, ready to change.",
    tick: "Ticks off when every line under Your job is ticked.",
  });
  if (opts.hasQuestions) steps.push({ id: "explain", title: "Explain it", done: opts.questionsDone, say: "One question to lock it in." });
  return steps;
}

/** For incidents and any level without its own hints: the layers a senior engineer checks, in order. */
export const METHOD_HINTS = [
  "Start at the source. Does the name resolve to the address you expect? Check from the VM that's failing.",
  "Next, the way out: effective routes on the source NIC, and the next hop for the destination.",
  "Then the filters on the path: security rules at the source going out, any firewall, and security rules at the target coming in.",
  "Then the way back: the reply needs a route through the same appliances, and the peering has to accept it.",
  "Last, the target itself: is the VM's own firewall open, and is something listening on the port?",
];

/** A hint can carry a Cloud Shell command. In Portal mode, say where to click instead and keep the command one tap away. */
const PORTAL_PATH: [RegExp, string][] = [
  [/watcher test-ip-flow/, "Diagnose, then IP flow verify"],
  [/watcher show-next-hop/, "Diagnose, then Next hop"],
  [/watcher test-connectivity/, "Diagnose, then Connection troubleshoot"],
  [/show-effective-route-table/, "Diagnose, then Effective routes"],
  [/list-effective-nsg/, "Diagnose, then Effective security rules"],
  [/nsg rule/, "tap the subnet or VM with that NSG on the map, then its security rules"],
  [/route-table route/, "tap the subnet with that route table on the map, then its routes"],
  [/vnet peering/, "tap the peering line between the networks on the map"],
  [/vnet (list|show|update|create)/, "tap the virtual network on the map"],
  [/private-dns/, "tap the DNS zone on the map, or use Create"],
  [/nic update|nic show/, "tap the VM on the map, then its network interface"],
  [/vnet subnet/, "tap the subnet on the map"],
  [/vm run-command/, "tap the VM on the map, then Run command"],
  [/storage account/, "Services, then the storage account"],
  [/dns-resolver/, "Services, then the DNS resolver"],
  [/firewall/, "Services, then the firewall"],
  [/lb |lb probe/, "Services, then the load balancer"],
  [/nat gateway|bastion/, "Services or Create"],
];
export interface HintParts { text: string; cmd: string | null; portal: string | null }
export function hintParts(hint: string): HintParts {
  const i = hint.search(/\baz [a-z]/);
  if (i < 0) return { text: hint, cmd: null, portal: null };
  const rest = hint.slice(i);
  const end = rest.search(/\.\s+[A-Z]|\.$/);
  const cmd = (end < 0 ? rest : rest.slice(0, end)).trim();
  const after = end < 0 ? "" : rest.slice(end + 1).trim();
  const portal = PORTAL_PATH.find(([re]) => re.test(cmd))?.[1] ?? "find it on the map or in Services";
  const before = hint.slice(0, i).replace(/[:\s]+$/, "");
  return { text: [before, after].filter(Boolean).join(". ").replace(/\.\./g, "."), cmd, portal };
}
