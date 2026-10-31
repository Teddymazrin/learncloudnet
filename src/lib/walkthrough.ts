// The full walkthrough of a level, two ways: the commands to type, and where to click in the Portal.
// Built from the level's own flows, hints and solution, so every level gets one and it never drifts from what solves it.
import type { Selection } from "@/components/NetworkMap";
import type { Level } from "@/content/types";
import { evalFlow, explainSteps } from "@/content/flows";
import { run } from "@/sim/shell";
import { newSession, type State } from "@/sim/types";
import { toWindows, type Os } from "@/sim/windows";
import { actionsFor, createActions, diagnoseActions, initialValues, serviceActions, type Action, type Field, type Values } from "./forms";
import { hintParts } from "./mentor";
import { whatsThis } from "./whatsthis";
import { typedForm } from "./hintinfo";

export type Phase = "see" | "look" | "fix" | "check";
export interface WalkStep {
  phase: Phase;
  /** What this step does and why, in plain words. */
  say: string;
  /** The VM the commands run on. Missing means Cloud Shell. */
  on?: string;
  cmds: string[];
  /** The same step in the Portal, one instruction per line. */
  portal: string[];
}

const G = "-g rg-lab";
const words = (c: string) => c.trim().split(/\s+/);
/** Words, with a quoted script kept whole and its quotes dropped. */
const tokens = (c: string) => (c.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map((t) => t.replace(/^(['"])(.*)\1$/, "$2"));

/** A command as its leading words and its flags. A flag on its own means true, so --allow-vnet-access and --allow-vnet-access true match. */
function parse(cmd: string) {
  const t = tokens(cmd);
  const head: string[] = [];
  const flags = new Map<string, string>();
  let k = 0;
  while (k < t.length && !t[k].startsWith("-")) head.push(t[k++]);
  while (k < t.length) {
    const f = t[k++] === "-n" ? "--name" : t[k - 1];
    const vals: string[] = [];
    while (k < t.length && !t[k].startsWith("-")) vals.push(t[k++]);
    flags.set(f, (vals.join(" ") || "true").toLowerCase());
  }
  return { head: head.join(" "), flags };
}

/** Values a text field could take: every value in the command, alone and as a run of words, and either side of ip:port. */
function textCandidates(cmd: string): string[] {
  const w = tokens(cmd);
  const out = new Set<string>([""]);
  for (let i = 0; i < w.length; i++) {
    if (w[i].startsWith("-")) continue;
    let runOf = w[i];
    out.add(runOf);
    for (let j = i + 1; j < w.length && !w[j].startsWith("-"); j++) { runOf += ` ${w[j]}`; out.add(runOf); }
  }
  for (const t of [...out]) if (t.includes(":")) t.split(":").forEach((x) => out.add(x));
  // Addresses tucked inside a value, like the DNS server in [{ip-address:192.168.10.10,port:53}].
  for (const m of cmd.match(/\d+\.\d+\.\d+\.\d+(\/\d+)?/g) ?? []) out.add(m);
  return [...out];
}

const DONE = 1e6;
/** How close a form's output is to the command. DONE when it sets every flag the command sets, to the same value.
 *  Edit forms also restate settings they leave alone, so extra flags are fine. */
function closeness(a: Action, v: Values, cmd: string): number {
  const b = a.build(v);
  if (!("cmds" in b)) return -DONE;
  const want = parse(cmd);
  return Math.max(...b.cmds.map((c) => {
    const got = parse(c);
    if (got.head !== want.head) return -DONE / 2;
    // A flag with the wrong value is closer than a missing one: the next box fixes the value.
    let hit = 0, near = 0, miss = 0;
    want.flags.forEach((val, f) => { const g = got.flags.get(f); if (g === val) hit++; else if (g !== undefined) near++; else miss++; });
    return near + miss ? hit * 2 + near * 0.5 - miss : DONE;
  }));
}

const shown = (a: Action, v: Values) => a.fields.filter((f) => !f.show || f.show(v));
const set = (a: Action, v: Values, k: string, val: string) => {
  const n = { ...v, [k]: val };
  return a.prefillOn === k && a.prefill ? { ...n, ...a.prefill(n) } : n;
};

/** Fill a form so it builds exactly this command, or null when it can't. */
export function fillForm(a: Action, cmd: string): Values | null {
  // An edit form fills itself from the item you pick, so try each item as a starting point.
  const pick = a.fields.find((f) => f.key === a.prefillOn && f.type === "select");
  const starts = pick ? (pick.options ?? []).map((o) => set(a, initialValues(a), pick.key, o[0])) : [initialValues(a)];
  for (const v0 of starts) { const v = climb(a, v0, cmd); if (v) return v; }
  return null;
}

const candidatesFor = (f: Field, texts: string[]) => (f.type === "check" ? ["true", "false"] : f.type === "select" ? (f.options ?? []).map((o) => o[0]) : texts);

function climb(a: Action, v0: Values, cmd: string): Values | null {
  // Forms won't build with a required box empty, so start empty boxes at their example value.
  let v = { ...v0 };
  for (const f of a.fields) if (f.type === "text" && !v[f.key]) v[f.key] = f.placeholder && !/\s/.test(f.placeholder) ? f.placeholder : "x";
  let best = closeness(a, v, cmd);
  const texts = textCandidates(cmd);
  for (let pass = 0; pass < 4 && best < DONE; pass++) {
    let moved = false;
    for (const f of shown(a, v)) {
      const cands = candidatesFor(f, texts);
      for (const c of cands) {
        if (c === v[f.key] || f.key === a.prefillOn) continue;
        let n = set(a, v, f.key, c);
        let s = closeness(a, n, cmd);
        // A choice like Source: Service Tag only pays off with the box it reveals, so try that box too.
        const before = new Set(shown(a, v).map((x) => x.key));
        for (const nf of shown(a, n).filter((x) => !before.has(x.key))) {
          for (const c2 of candidatesFor(nf, texts)) {
            const n2 = set(a, n, nf.key, c2);
            const s2 = closeness(a, n2, cmd);
            if (s2 > s) { s = s2; n = n2; }
          }
        }
        if (s > best) { best = s; v = n; moved = true; }
      }
    }
    if (!moved) break;
  }
  if (best < DONE) return null;
  // Clear any box the command didn't need.
  for (const f of a.fields) if (f.type === "text" && v[f.key] && closeness(a, { ...v, [f.key]: "" }, cmd) >= DONE) v = { ...v, [f.key]: "" };
  return v;
}

const LABEL = { selected: "Selected", services: "Services", create: "＋ Create", diagnose: "Diagnose" };

function tapLabel(s: Selection): string {
  switch (s.kind) {
    case "vnet": return `the virtual network ${s.id}`;
    case "subnet": return `the subnet ${s.subnet} in ${s.vnet}`;
    case "host": return s.id;
    case "peer": return `the peering line between ${s.a} and ${s.b}`;
    case "zone": return `the private DNS zone ${s.id}, under the networks`;
    case "service": return `the storage account ${s.id}, at the bottom of the map`;
  }
}

function selections(st: State): Selection[] {
  const out: Selection[] = [];
  for (const [vn, v] of Object.entries(st.vnets)) {
    for (const sn of Object.keys(v.subnets)) out.push({ kind: "subnet", vnet: vn, subnet: sn });
    out.push({ kind: "vnet", id: vn });
  }
  for (const h of Object.values(st.hosts)) out.push({ kind: "host", id: h.name });
  const seen = new Set<string>();
  for (const p of Object.values(st.peerings)) { const k = [p.vnet, p.remote].sort().join("|"); if (!seen.has(k)) { seen.add(k); out.push({ kind: "peer", a: p.vnet, b: p.remote }); } }
  for (const z of Object.keys(st.zones)) out.push({ kind: "zone", id: z });
  for (const e of Object.values(st.publicEndpoints)) out.push({ kind: "service", id: e.name });
  return out;
}

/** One field as an instruction: what to set it to, or that a box stays off. */
function fieldLine(f: Field, val: string): string | null {
  if (f.type === "check") return `${val === "true" ? "Turn on" : "Leave off"}: ${f.label}.`;
  const shownVal = f.type === "select" ? f.options?.find((o) => o[0] === val)?.[1] ?? val : val;
  return `${f.label}: ${shownVal || "(empty)"}.`;
}

/** Where to click in the Portal pane to run this exact command, and what to fill in. Null when there's no form for it. */
export function portalFor(st: State, cmd: string): string[] | null {
  const m = matchForm(st, cmd);
  if (!m) return null;
  const lines = shown(m.action, m.values).map((f) => fieldLine(f, m.values[f.key])).filter((x): x is string => !!x);
  return [...m.where, ...lines, `Select ${m.action.kind === "fix" ? "Apply" : "Run"}.`];
}

/** The Portal form that runs this exact command, filled in, and where to find it. */
function matchForm(st: State, cmd: string): { action: Action; values: Values; where: string[] } | null {
  const fits = (a: Action) => !a.verb || a.verb.some((v) => cmd.startsWith(v));
  const tries: [Action, string[]][] = [
    ...diagnoseActions(st).map((a): [Action, string[]] => [a, [`In the Portal pane, open ${LABEL.diagnose}, then ${a.title}.`]]),
    ...serviceActions(st).map((a): [Action, string[]] => [a, [`In the Portal pane, open ${LABEL.services}, then ${a.title}.`]]),
    ...selections(st).flatMap((s) => actionsFor(st, s).map((a): [Action, string[]] => [a, [`On the map, tap ${tapLabel(s)}.`, `In the Portal pane, under ${LABEL.selected}, open ${a.title}.`]])),
    ...createActions(st).map((a): [Action, string[]] => [a, [`In the Portal pane, open ${LABEL.create}, then ${a.title}.`]]),
  ];
  for (const [action, where] of tries) {
    if (!fits(action)) continue;
    const values = fillForm(action, cmd);
    if (values) return { action, values, where };
  }
  return null;
}

/** One change that fixes the level: the command, and in plain words what it changed and why that matters. */
export interface FixLine { cmd: string; what: string }

/** The level's fix, change by change. The words come from the Portal form for that change, which says what it does in this lab;
 *  a change with no form, like one inside a VM, uses the command's own note. */
export function fixSummary(level: Level): FixLine[] {
  const st = level.setup();
  const session = newSession();
  const out: FixLine[] = [];
  for (const cmd of level.solution) {
    const head = words(cmd)[0];
    const change = head === "az" ? !LOOK_ONLY.test(cmd) || CHANGE.test(cmd) : !["ssh", "exit", "answer", "cidr", "nc", "nslookup", "curl"].includes(head);
    if (change) {
      const m = head === "az" ? matchForm(st, cmd) : null;
      const built = m ? m.action.build(m.values) : null;
      const what = scriptWhat(cmd) ?? (built && "why" in built ? built.why : whatsThis(cmd)?.what ?? "");
      out.push({ cmd, what });
    }
    run(st, cmd, session);
  }
  return out;
}

/** A Run command script in plain words, so the fix says what changed inside the VM rather than how the script got there. */
function scriptWhat(cmd: string): string | null {
  const vm = cmd.match(/ -n (\S+)/)?.[1] ?? "the VM";
  const script = cmd.match(/--scripts ["'](.*)["']$/)?.[1] ?? (inVm(cmd) ? cmd : "");
  let m = script.match(/^ufw allow from (\S+) to any port (\d+)/);
  if (m) return `Lets ${m[1]} reach port ${m[2]} through ${vm}'s own firewall (UFW). That firewall is inside the VM, where Azure's network tools can't see it.`;
  m = script.match(/^(?:sudo )?systemctl start (\S+)/);
  if (m) return `Starts ${m[1]} on ${vm}, so something is listening on its port again.`;
  return null;
}

/** What was broken when the level started: the step where each goal connection failed, in the simulator's words.
 *  A level with its own debrief uses that. A level that builds something new has nothing broken. */
export function issueSummary(level: Level): string[] {
  if (level.debrief?.length) return level.debrief;
  const st = level.setup();
  const seen = new Set<string>();
  for (const f of level.flows ?? []) {
    if (f.want !== "open") continue;
    const r = evalFlow(st, f);
    if (r.good) continue;
    for (const s of explainSteps(st, r)) if (!s.ok) seen.add(s.text.replace(/^./, (c) => c.toUpperCase()).replace(/([^.])$/, "$1."));
  }
  return [...seen];
}

const LOOK_ONLY = /\b(list|show|test-ip-flow|show-next-hop|test-connectivity|show-effective-route-table|list-effective-nsg)\b/;
const CHANGE = / (create|update|delete|add|remove|set|invoke|sync)\b/;

/** A command that runs inside a VM, not in Cloud Shell. */
const inVm = (c: string) => !/^(az|ssh|exit|answer|cidr)\b/.test(c);

/** The connection test for a flow, from the VM it starts on: the lines to type and the Portal's own test. */
function testStep(st: State, level: Level, phase: Phase, os: Os): WalkStep | null {
  const f = (level.flows ?? []).find((x) => x.want === "open" && !evalFlow(level.setup(), x).good) ?? (level.flows ?? []).find((x) => x.want === "open");
  if (!f || st.hosts[f.from]?.kind !== "vm") return null;
  const r = evalFlow(st, f);
  const tgt = f.dns ?? f.to ?? "";
  const tgtIp = f.to ? st.hosts[f.to]?.ip ?? tgt : tgt;
  const cmds = (f.dns ? [`nslookup ${f.dns}`, `nc -zv ${f.dns} ${f.port}`] : [`nc -zv ${tgtIp} ${f.port}`]).map((c) => (os === "windows" ? toWindows(c) : c));
  const conn = portalFor(st, `az network watcher test-connectivity ${G} --source-resource ${f.from} --dest-address ${tgtIp} --dest-port ${f.port} --protocol Tcp`) ?? [];
  const say = phase === "see"
    ? `Reproduce the problem from ${f.from}, where it happens.${f.dns ? " First see what address the name gives, then try the connection." : ""} Expect it to fail${r.trace?.stage === "public" ? ", because the name gives a public IP" : ""}.`
    : `Run the same test again from ${f.from}. It should work now, and the line under the map turns green.`;
  return { phase, say, on: f.from, cmds, portal: [...conn, ...(f.dns ? [`The Portal has no name lookup inside a VM. To see the address, switch to Terminal and run the commands on ${f.from}.`] : [])] };
}

/** The whole level, start to finish: see it fail, look, fix, check. */
export function walkthrough(level: Level, os: Os = "linux"): WalkStep[] {
  const st = level.setup();
  const session = newSession(os);
  const steps: WalkStep[] = [];
  const see = testStep(st, level, "see", os);
  if (see) steps.push(see);

  // Look: each hint's command, with the hint's own words for why.
  for (const h of level.hints) {
    const p = hintParts(h);
    // Only checks that look, and that run as written: a hint that names a change, or a command in passing, isn't a step to follow here.
    const cmd = p.cmd && typedForm(st, p.cmd);
    if (!cmd || !LOOK_ONLY.test(cmd) || CHANGE.test(cmd)) continue;
    steps.push({ phase: "look", say: p.text ? `${p.text}${/[.?!:]$/.test(p.text) ? "" : "."}` : whatsThis(cmd)?.what ?? "", cmds: [cmd], portal: portalFor(st, cmd) ?? [`${(p.portal ?? "")[0]?.toUpperCase() ?? ""}${(p.portal ?? "").slice(1)}.`] });
  }

  // Fix: the solution, line by line, run against the lab so each Portal step sees the state the one before it left.
  let on: string | undefined;
  const guided = level.steps?.filter((s) => s.cmd && !s.cmd.startsWith("answer")).map((s) => ({ cmd: s.cmd!, say: s.say })) ?? [];
  const lines = guided.length ? guided : level.solution.map((cmd) => ({ cmd, say: "" }));
  for (const { cmd, say } of lines) {
    const head = words(cmd)[0];
    if (head === "ssh") { on = words(cmd)[1]; run(st, cmd, session); continue; }
    if (head === "exit") { on = undefined; run(st, cmd, session); continue; }
    // Quiz answers belong to the Explain it step, not the walkthrough.
    if (head === "answer") continue;
    const vmLine = inVm(cmd);
    const portal = vmLine ? [`This runs inside ${on ?? "the VM"}, where the Portal can't type for you. Switch to Terminal for this line.`]
      : head === "cidr" ? ["The Portal has no address calculator. Switch to Terminal and type this in Cloud Shell, or work it out by hand."]
      : portalFor(st, cmd) ?? [`${hintParts(`x: ${cmd}`).portal ?? "find it on the map or in Services"}.`];
    const mut = !vmLine && head !== "cidr" && !LOOK_ONLY.test(cmd);
    run(st, cmd, session);
    steps.push({ phase: mut ? "fix" : "look", say: say || whatsThis(cmd)?.what || "", on: vmLine ? on : undefined, cmds: [vmLine && os === "windows" ? toWindows(cmd) : cmd], portal: portal.map((l) => l.replace(/^./, (c) => c.toUpperCase())) });
  }

  const check = testStep(st, level, "check", os);
  if (check && level.fix) steps.push(check);
  return steps;
}
