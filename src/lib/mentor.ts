// The mentor: a troubleshooting process for fix levels, the way a senior engineer would walk you through one.
// See it fail, look with a tool, name the cause, fix it. Each step ticks itself off from what you actually did.
import type { Level } from "@/content/types";
import { evalFlow, type FlowResult } from "@/content/flows";
import { newSession, type Session, type State } from "@/sim/types";
import type { Os } from "@/sim/windows";

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

/** One step of the process, as an action item: what to do, why it matters, what to look for, and the tools that do it.
 *  The exact commands and clicks live in the walkthrough, so this stays the method, not the answer. */
export interface MentorStep {
  id: "see" | "look" | "cause" | "fix" | "explain";
  title: string;
  done: boolean;
  /** The action, in one or two sentences. */
  say: string;
  /** Why this step matters. */
  why?: string;
  /** What the result tells you, so you know what you're looking at. */
  lookFor?: string;
  /** Tools that do it, each named with where it runs: a VM, Cloud Shell, or the Portal. Names only, no full commands. */
  tools?: string[];
  /** What makes the step tick, so you're never left guessing. */
  tick?: string;
}

/** What to type to get from where the shell is (a VM, or Cloud Shell when null) to where a command runs. */
export function hopTo(vm: string | null, on: string | undefined): string[] {
  if (!on) return vm ? ["exit"] : [];
  return vm === on ? [] : vm ? ["exit", `ssh ${on}`] : [`ssh ${on}`];
}
const ip4 = (s: string) => /^\d+\.\d+\.\d+\.\d+$/.test(s);

const target = (st: State, f: FlowResult) => f.flow.dns ?? (f.targetIp ?? (f.flow.to ? st.hosts[f.flow.to]?.ip : "") ?? "");
const DIAG = /watcher (test-ip-flow|show-next-hop|test-connectivity)|show-effective-route-table|list-effective-nsg/;

export function mentorSteps(level: Level, opts: { st: State; log: LogEntry[]; flows: FlowResult[]; vm: string | null; os?: Os; goalsDone: boolean; causeOk: boolean; hasCause: boolean; questionsDone: boolean; hasQuestions: boolean; explained: boolean }): MentorStep[] {
  const { st, log, flows, vm } = opts;
  const first = flows.find((f) => f.flow.want === "open" && !f.good) ?? flows.find((f) => f.flow.want === "open");
  const from = first?.flow.from ?? "";
  const tgt = first ? target(st, first) : "";
  const fromVm = !!first && st.hosts[from]?.kind === "vm";
  const win = opts.os === "windows";

  // Step 1: reproduce it from where the problem is.
  const see: MentorStep = { id: "see", title: "See it fail", done: log.some(isTest), say: "", why: "Reports are often wrong or vague. Seeing the failure yourself tells you exactly what breaks, and gives you a test to rerun after the fix." };
  if (first && fromVm) {
    see.say = first.flow.dns ? `From ${from}, look up ${first.flow.dns}, then try to connect to it on port ${first.flow.port}.` : `From ${from}, try to connect to ${tgt} on port ${first.flow.port}.`;
    see.lookFor = first.flow.dns
      ? `The address the name gives. ${st.hosts[first.flow.expect ?? ""]?.ip ? `${st.hosts[first.flow.expect!].ip} (${first.flow.expect}) is what it should be. ` : ""}Anything else, like a public IP or no answer, means the problem starts with DNS.`
      : "Whether the connection opens. A timeout means something on the path drops it. Refused means the packet arrived but nothing is listening.";
    see.tools = [
      `On ${from}: ${first.flow.dns ? (win ? "Resolve-DnsName, then Test-NetConnection" : "nslookup, then nc") : win ? "Test-NetConnection" : "nc"}. Get there with ssh ${from} in Cloud Shell${vm === from ? ". You're already on it" : ""}.`,
      `Portal: Diagnose, then Connection troubleshoot, from ${from}.`,
    ];
    see.tick = `Ticks off when a test runs on ${from}.`;
  } else {
    // The traffic doesn't start on a lab VM, so there's nothing to log in to: the map's own test is the way to see it.
    see.done = see.done || opts.explained;
    see.say = "This traffic starts outside the lab VMs, so you can't log in to test it. Watch it on the map instead.";
    see.lookFor = "The step where the line turns red, and the reason Explain gives for it.";
    see.tools = ["Explain on the red line under the map."];
    see.tick = "Ticks off when you tap Explain on the broken line.";
  }

  // Step 2: one tool that checks one layer. The first test doesn't count twice.
  const firstTest = log.findIndex(isTest);
  const diag = level.hints.map(hintParts).find((h) => h.cmd && DIAG.test(h.cmd));
  const look: MentorStep = {
    id: "look", title: "Find where it stops", done: log.some((e, i) => i !== firstTest && isLook(e)),
    say: level.tool ?? "Check one layer at a time until one says no: names, routes, security rules, the peering, or the VM itself.",
    why: "Each tool checks one layer. Ruling layers out one by one is faster than guessing, and it tells you exactly what to change.",
    lookFor: "The first layer that says no: a security rule that denies, a next hop of None or an address where nothing lives, a peering that isn't Connected, or a name that gives the wrong address.",
    tick: "Ticks off when you run a Diagnose tool, or a list or show command.",
  };
  const tools: string[] = [];
  if (diag?.portal) tools.push(`Start here: ${diag.portal}.`);
  if (first && fromVm) {
    const ip = first.targetIp ?? (ip4(tgt) ? tgt : null);
    const dst = first.target ? st.hosts[first.target] : Object.values(st.hosts).find((h) => h.ip === ip);
    if (first.flow.dns) tools.push(`Names: ${win ? "Resolve-DnsName" : "nslookup"} on ${from}.`);
    if (ip) tools.push(`Routes: Next hop in Diagnose, from ${from} to ${ip}.`);
    if (ip && dst?.kind === "vm") tools.push(`Security rules: IP flow verify in Diagnose, on ${dst.name}.`);
    tools.push(`Every route: Effective routes in Diagnose, on ${from}.`);
  }
  if (tools.length) look.tools = [...new Set(tools)];

  const steps: MentorStep[] = [see, look];
  if (opts.hasCause) steps.push({ id: "cause", title: "Name the cause", done: opts.causeOk, say: "Pick what the evidence shows.", why: "Saying the cause before you change anything stops you fixing the wrong thing.", lookFor: "Where the packet stopped in step 2, not where you guessed it would.", tick: "Ticks off when you pick what the evidence shows." });
  steps.push({
    id: "fix", title: "Fix it and test again", done: opts.goalsDone,
    say: "Change only the thing the evidence points at, then rerun your test from step 1.",
    why: "One change at a time tells you what fixed it. Changing several things hides the cause and can break something else.",
    lookFor: "The lines under Your job tick off, the line under the map turns green, and nothing under Without breaking turns red.",
    tools: ["Portal: tap the resource on the map. Its settings open in the Portal pane.", "Cloud Shell: the matching az command. What's this? under each one explains it."],
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
  [/private-dns/, "tap the DNS zone on the map, or use Create"],
  [/vnet peering/, "tap the peering line between the networks on the map"],
  [/vnet (list|show|update|create)/, "tap the virtual network on the map"],
  [/nic update|nic show|nic ip-config/, "tap the VM on the map, then its network interface"],
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
  // A hint often carries on in prose after the command ("az network vnet list, then ..."). The command stops there.
  const sentence = (end < 0 ? rest : rest.slice(0, end)).trim();
  const cut = sentence.search(/,\s|\s+(?:then|with|and|on|for|to)\s+/);
  const cmd = (cut < 0 ? sentence : sentence.slice(0, cut)).trim();
  const tail = cut < 0 ? "" : sentence.slice(cut).replace(/^[,\s]+/, "");
  const after = [tail && tail[0].toUpperCase() + tail.slice(1), end < 0 ? "" : rest.slice(end + 1).trim()].filter(Boolean).join(". ");
  const portal = PORTAL_PATH.find(([re]) => re.test(cmd))?.[1] ?? "find it on the map or in Services";
  const before = hint.slice(0, i).replace(/[:\s]+$/, "");
  return { text: [before, after].filter(Boolean).join(". ").replace(/\.\./g, "."), cmd, portal };
}
