"use client";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { HELP, run } from "@/sim/shell";
import { newSession, type Session, type State, type TraceResult } from "@/sim/types";
import { createsIn, emptySandbox, formPolicy, formStep, getLevel, levelNumber, nextLevel, TIERS } from "@/content";
import type { Flow, Level } from "@/content/types";
import { useProgress } from "@/lib/progress";
import { linesOnMap, NetworkMap, NvaIcon, PeIcon, RouteIc, Shield, VmIcon, VnetIc, type Packet, type Selection } from "./NetworkMap";
import { MapViewport } from "./MapViewport";
import { Inspector } from "./Inspector";
import { Portal, type PortalGroup } from "./Portal";
import { actionsFor, allowed, createActions, diagnoseActions, serviceActions, type Action, type Built } from "@/lib/forms";
import { evalFlow, explainSteps, flowName, type FlowResult } from "@/content/flows";
import { TOUR } from "@/content/explain";
import type { TraceStep } from "@/sim/network";
import { changeLabel, changedKeys, signatures } from "@/lib/diff";
import { chime } from "@/lib/sound";
import { Terminal, type Line } from "./Terminal";
import { suggest } from "@/lib/complete";
import { causeChoices, hintParts, hopTo, METHOD_HINTS, mentorSteps, splitObjectives, type MentorStep, startingCause, usesMentor } from "@/lib/mentor";
import { summarize, type ResultCard } from "@/lib/result";
import { whatsThis } from "@/lib/whatsthis";
import { resourcesOf } from "@/lib/resources";
import { hintLayer, liveResult, typedForm } from "@/lib/hintinfo";
import { fixSummary, issueSummary, walkthrough, type Phase } from "@/lib/walkthrough";
import { termsIn } from "@/lib/terms";
import { toWindows, type Os } from "@/sim/windows";
import { linuxOnly } from "@/lib/os";
import { Stars } from "./Stars";
import { Confetti } from "./Confetti";

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

const TOUR_KEY = "learncloudnet.tour.v1";
const MODE_KEY = "learncloudnet.mode.v1";
const OS_KEY = "learncloudnet.os.v1";
const HELP_KEY = "learncloudnet.help.v1";
const SIZE_KEY = "learncloudnet.layout.v1";
const CHALLENGE_KEY = "learncloudnet.challenges.v1";

const selLabel = (s: Selection) => (s.kind === "subnet" ? s.subnet : s.kind === "peer" ? `${s.a} ⇄ ${s.b}` : s.id);

/** The first hint is free. More hints or Explain cost a star, and asking for the fix caps it at 1. */
function starsFor(level: Level, changes: number, paid: number, seconds: number, sawFix: boolean) {
  let s = 3;
  if (changes > level.par) s--;
  if (paid > 0) s--;
  if (level.clock && seconds > level.clock * 60) s--;
  if (sawFix) s = 1;
  return Math.max(1, s);
}
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/** Where a set of lines runs, and what to type first when the shell is somewhere else. The lines themselves never shift as you move. */
function Where({ on, vm, onType }: { on?: string; vm: string | null; onType: (c: string) => void }) {
  const hop = hopTo(vm, on);
  return (
    <div className={`where${hop.length ? " away" : ""}`}>
      <span className="where-chip">{on ? `Runs on ${on}` : "Runs in Cloud Shell"}</span>
      {hop.length > 0
        ? <><span className="where-note">You&apos;re {vm ? `on ${vm}` : "in Cloud Shell"}, so get there first:</span><ol className="mstep-cmds">{hop.map((c) => <li key={c}><CmdRow cmd={c} onType={onType} /></li>)}</ol></>
        : <span className="where-note">You&apos;re there.</span>}
    </div>
  );
}

/** One step of the process as an action item: what to do, why, what to look for, and which tools do it. The exact lines live in the walkthrough. */
/** With help hidden, a step still says what to do and what ticks it, but not why, what to look for, or which tools. */
function StepItem({ step, brief }: { step: MentorStep; brief?: boolean }) {
  return (
    <div className="mstep-item">
      {step.say && <p className="mstep-say">{step.say}</p>}
      {!brief && step.why && <p className="mstep-why"><b>Why</b>{step.why}</p>}
      {!brief && step.lookFor && <p className="mstep-look"><b>Look for</b>{step.lookFor}</p>}
      {!brief && step.tools && <div className="mstep-tools"><b>Tools</b><ul>{step.tools.map((t) => <li key={t}>{t}</li>)}</ul></div>}
      {step.tick && <p className="mstep-tick">{step.tick}</p>}
    </div>
  );
}

/** One command to type, with a Type it button and a "What's this?" note on what it does and what each part means. */
function CmdRow({ cmd, onType }: { cmd: string; onType: (c: string) => void }) {
  const note = whatsThis(cmd);
  return (
    <span className="cmd-row">
      <span className="cmdline"><code>{cmd}</code><button type="button" onClick={() => onType(cmd)}>Type it</button></span>
      {note && (
        <details className="whats">
          <summary>What&apos;s this?</summary>
          <p>{note.what}</p>
          {note.parts.length > 0 && <ul className="flags">{note.parts.map(([k, d]) => <li key={k}><code>{k}</code> {d}</li>)}</ul>}
        </details>
      )}
    </span>
  );
}

/** A hint, in the player's mode: in the Portal, where to click (the command one tap away); in Cloud Shell, the command. */
function HintBody({ hint, portal, os, onType, st }: { hint: string; portal: boolean; os: Os; onType: (c: string) => void; st?: State }) {
  const h0 = hintParts(hint);
  // A command named in passing, without the names it needs, reads as words. Only a line that runs gets Type it.
  const typed = h0.cmd && st ? typedForm(st, h0.cmd) : h0.cmd;
  if (h0.cmd && !typed) return <span>{hint}</span>;
  const h = { ...h0, cmd: typed };
  if (!h.cmd) {
    // A bare in-VM command, like a step of the fix.
    if (!/^(ssh|nc|curl|nslookup|ufw|systemctl|ss|ip|sudo)\s/.test(hint)) return <span>{hint}</span>;
    return <CmdRow cmd={os === "windows" ? toWindows(hint) : hint} onType={onType} />;
  }
  return (
    <span className="hint-body">
      {h.text && <span>{h.text}{/[.?!:]$/.test(h.text) ? "" : "."}</span>}
      {portal ? (
        <>
          <span className="hint-portal">In the Portal: {h.portal}.</span>
          <details className="hint-cmd"><summary>Cloud Shell command</summary><code>{h.cmd}</code></details>
        </>
      ) : <CmdRow cmd={h.cmd} onType={onType} />}
    </span>
  );
}

/** A hint with its context: the layer it checks, why that layer matters, what to look for, and what the check returns in the lab right now. */
function HintCard({ hint, label, st, portal, os, onType, repeat }: { hint: string; label: string; st: State; portal: boolean; os: Os; onType: (c: string) => void; repeat?: boolean }) {
  const layer = hintLayer(hint);
  const cmd = hintParts(hint).cmd;
  const live = cmd ? liveResult(st, cmd, os) : null;
  return (
    <div className="hint">
      <div className="hint-head"><span className="label" style={{ margin: 0 }}>{label}</span>{layer && <span className="hint-layer">{layer.name}</span>}</div>
      <HintBody hint={hint} portal={portal} os={os} onType={onType} st={st} />
      {/* The same layer as the hint before it: its why is already on screen. */}
      {layer && !repeat && <p className="hint-why"><b>Why this layer</b>{layer.why}</p>}
      {layer && !repeat && <p className="hint-why"><b>Look for</b>{layer.lookFor}</p>}
      {live && <details className="hint-live"><summary>What it shows in your lab right now</summary><pre>{live}</pre></details>}
    </div>
  );
}

const WALK_PHASE: Record<Phase, string> = { see: "See it fail", look: "Look", fix: "Fix", check: "Check it works" };

const vmPrompt = (s: Session) => (!s.vm ? "cloudshell:~$" : s.os === "windows" ? `PS ${s.vm} C:\\Users\\azureuser>` : `azureuser@${s.vm}:~$`);

const TOUR_TARGET: Record<string, string> = { vnet: ".v-box", subnet: ".s-box", tag: ".tag", host: ".h-box", flow: ".flow" };

interface Sizes { panel: number; bottom: number }
const SIZES: Sizes = { panel: 400, bottom: 300 };

export function LevelPlayer({ id }: { id: string }) {
  const level = getLevel(id)!;
  const progress = useProgress();
  const st = useRef<State>(level.setup());
  const session = useRef<Session>(newSession());
  const [tick, setTick] = useState(0);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Selection | null>(null);
  const [tab, setTab] = useState<"level" | "map">("level");
  const [explained, setExplained] = useState<Record<number, TraceStep[]>>({});
  // Mentor: the cause the player named, a wrong guess to answer, and whether they asked to see the fix.
  const [causeOk, setCauseOk] = useState(false);
  const [causeWrong, setCauseWrong] = useState<string | null>(null);
  const [sawFix, setSawFix] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Phones: scroll to the Portal once the Level tab has rendered it.
  const [toPortal, setToPortal] = useState(0);
  useEffect(() => {
    if (!toPortal) return;
    const t = setTimeout(() => deskRef.current?.querySelector(".bottom .portal")?.scrollIntoView({ block: "start" }), 60);
    return () => clearTimeout(t);
  }, [toPortal]);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Reset puts the page back too, not just the lab: every section closed, the walkthrough folded, back at the top.
  const resetAll = () => {
    start();
    print("lab: lab reset to the level's starting state.", "lab");
    setTab("level"); setWalkTab(null); setResult(null);
    deskRef.current?.querySelectorAll<HTMLDetailsElement>(".panel details[open]").forEach((d) => { d.open = false; });
    deskRef.current?.querySelector(".panel-scroll")?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
    flash("Lab reset to how the level started.");
  };
  const flash = (msg: string) => { setNotice(msg); if (noticeTimer.current) clearTimeout(noticeTimer.current); noticeTimer.current = setTimeout(() => setNotice(null), 3500); };
  // The full walkthrough: which way it's shown, and whether the steps past "see it fail" are open.
  const [walkTab, setWalkTab] = useState<"cmd" | "portal" | null>(null);
  const [walkAll, setWalkAll] = useState(false);
  const sawFixRef = useRef(false);
  // The last command's output, and the Portal's plain-words card for it.
  const lastOut = useRef<{ text: string; error: boolean } | null>(null);
  const [result, setResult] = useState<ResultCard | null>(null);
  const [explains, setExplains] = useState(0);
  const [tourStep, setTourStep] = useState<number | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [wrong, setWrong] = useState<Record<string, string>>({});
  const [changes, setChanges] = useState(0);
  const [hints, setHints] = useState(0);
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [met, setMet] = useState<boolean[]>(() => level.objectives.map(() => false));
  const [finished, setFinished] = useState<number | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [showConcept, setShowConcept] = useState(false);
  const [lastChange, setLastChange] = useState<string | null>(null);
  // Whether the player has picked Portal or Cloud Shell yet. Until then, ask.
  const [modeChosen, setModeChosen] = useState(true);
  // Stuck detection: changes or errors that didn't move any goal, and time since the last progress.
  const [nudgeReady, setNudgeReady] = useState(false);
  const idleRef = useRef(0);
  const progressAt = useRef(Date.now());
  const [focusKey, setFocusKey] = useState(0);
  const [form, setForm] = useState<Action | null>(null);
  const [mode, setModeState] = useState<"terminal" | "portal">("terminal");
  const [osPick, setOsPick] = useState<Os>("linux");
  // One switch for the mentor's guidance on every level, for when you want to work it out alone.
  const [helpOn, setHelpOn] = useState(true);
  const setHelp = (on: boolean) => { setHelpOn(on); try { localStorage.setItem(HELP_KEY, on ? "on" : "off"); } catch { /* ignore */ } };
  const osLocked = useMemo(() => linuxOnly(level), [level]);
  const os: Os = osLocked ? "linux" : osPick;
  // The saved pick loads after the session is made, so keep the session in step with what the switch shows.
  session.current.os = os;
  const [group, setGroup] = useState<PortalGroup>("selected");
  const [packet, setPacket] = useState<Packet | null>(null);
  const [celebrate, setCelebrate] = useState<Set<number>>(new Set());
  const [sizes, setSizes] = useState<Sizes>(SIZES);
  const [inspectPos, setInspectPos] = useState({ x: 0, y: 0 });
  // Sandbox: connections you chose to watch on the map, and whether the lab starts empty.
  const [watches, setWatches] = useState<Flow[]>([]);
  const blankRef = useRef(false);
  const [watchFrom, setWatchFrom] = useState("");
  const [watchTo, setWatchTo] = useState("");
  const [watchPort, setWatchPort] = useState("443");
  const [inspectFolded, setInspectFolded] = useState(false);
  const [doneChallenges, setDoneChallenges] = useState<string[]>([]);
  const [tourAt, setTourAt] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const deskRef = useRef<HTMLElement>(null);
  const changesRef = useRef(0);
  const metRef = useRef<boolean[]>(level.objectives.map(() => false));
  const goodRef = useRef<boolean[] | null>(null);
  const packetKey = useRef(0);
  const finishedRef = useRef<number | null>(null);
  const assistRef = useRef(0);
  const startedAt = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  // Expert is incident mode: no hints, no Explain, and goals say whether things work, not where they break.
  const incident = level.tier === "expert";
  const policy = formPolicy(level);
  const tier = TIERS.find((t) => t.id === level.tier)!;
  const next = level.playground ? undefined : nextLevel(level.id);
  const num = levelNumber(level.id);

  const print = useCallback((text: string, cls?: Line["cls"]) => { if (text) setLines((l) => [...l, { text, cls }]); }, []);
  const send = useCallback((p: { from: "trace" } | { from: "flow"; index: number }) => setPacket({ ...p, key: ++packetKey.current }), []);

  const start = useCallback(() => {
    st.current = level.playground && blankRef.current ? emptySandbox() : level.setup();
    setWatches([]);
    session.current = newSession(os);
    setChanges(0); setHints(0); setTrace(null); setFinished(null); setSelected(null); setChanged(new Set()); setExplained({}); setExplains(0);
    setCauseOk(false); setCauseWrong(null); setSawFix(false); sawFixRef.current = false; setWalkAll(false); setPacket(null); setCelebrate(new Set());
    startedAt.current = Date.now(); setElapsed(0);
    changesRef.current = 0; finishedRef.current = null; assistRef.current = 0; goodRef.current = null; setForm(null); setResult(null);
    // Goals that already hold, like "port 22 stays blocked", show as met from the start, so only real progress counts as progress.
    metRef.current = level.objectives.map((o) => !o.question && !o.action && o.test({ st: st.current, session: session.current }));
    setMet(metRef.current);
    setWrong({});
    setLastChange(null); setNudgeReady(false); idleRef.current = 0; progressAt.current = Date.now();
    setLines([{ text: `lab: ${level.playground ? "Sandbox" : "Level"} loaded: ${level.title}. Type help for commands, goals to see your tasks.`, cls: "lab" }]);
    setTick((t) => t + 1);
  }, [level]);

  useEffect(() => { try { if (!localStorage.getItem(TOUR_KEY)) setTourStep(0); } catch { setTourStep(0); } }, []);
  useEffect(() => {
    if (!level.clock || finished !== null) return;
    const t = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 1000);
    return () => clearInterval(t);
  }, [level.clock, finished]);
  useEffect(() => {
    try {
      if (localStorage.getItem(OS_KEY) === "windows") setOsPick("windows");
      if (localStorage.getItem(HELP_KEY) === "off") setHelpOn(false);
      const m = localStorage.getItem(MODE_KEY); if (m === "portal" || m === "terminal") setModeState(m); else setModeChosen(false);
      const z = JSON.parse(localStorage.getItem(SIZE_KEY) ?? "null"); if (z?.panel && z?.bottom) setSizes(z);
      const c = JSON.parse(localStorage.getItem(CHALLENGE_KEY) ?? "[]"); if (Array.isArray(c)) setDoneChallenges(c);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { start(); if (!level.playground) progress.setLast(level.id); }, [level.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Phones get a mini map above the shell, so the network is in view while you type.
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    try {
      const mq = window.matchMedia("(max-width: 920px)");
      const on = () => setIsPhone(mq.matches);
      on(); mq.addEventListener("change", on);
      return () => mq.removeEventListener("change", on);
    } catch { /* ignore */ }
  }, []);

  const check = useCallback((hintsNow: number, changesNow: number) => {
    const now = level.objectives.map((o) => o.test({ st: st.current, session: session.current }));
    const prev = metRef.current;
    let gained = false;
    now.forEach((v, k) => {
      if (v && !prev[k]) { print(`lab: ✓ ${level.objectives[k].text}`, "good"); gained = true; }
      if (!v && prev[k]) print(`lab: ✗ no longer true: ${level.objectives[k].text}`, "err");
    });
    metRef.current = now;
    setMet(now);
    if (now.length && now.every(Boolean) && finishedRef.current === null) {
      const secs = (Date.now() - startedAt.current) / 1000;
      setElapsed(secs);
      const s = starsFor(level, changesNow, Math.max(0, hintsNow - 1) + assistRef.current, secs, sawFixRef.current);
      finishedRef.current = s;
      setFinished(s);
      progress.record(level.id, s);
      chime("solved");
      // Let the last goal connection light up before the card covers the map.
      setTimeout(() => setShowDone(true), 900);
    } else if (gained) chime("goal");
  }, [level, print, progress]);

  // Hints never run out. The level's own ladder comes first (or the senior engineer's checklist when it has none),
  // then the fix itself. The first hint is free.
  const ladder = level.hints.length ? level.hints : METHOD_HINTS;
  const showHint = useCallback(() => {
    setNudgeReady(false);
    if (hints < ladder.length) {
      print(`hint ${hints + 1}: ${ladder[hints]}`, "lab");
      setHints(hints + 1);
      return;
    }
    sawFixRef.current = true;
    setSawFix(true);
    print(`lab: the fix, step by step:\n${level.solution.filter((c) => c !== "exit" && !c.startsWith("answer ")).map((c) => `  ${c}`).join("\n")}`, "lab");
  }, [hints, ladder, level, print]);
  const canNudge = hints === 0;
  const markStuck = useCallback(() => {
    if (!canNudge || nudgeReady) return;
    setNudgeReady(true);
    print("lab: stuck? Ask for a hint. The first one is free.", "lab");
  }, [canNudge, nudgeReady, print]);
  useEffect(() => {
    if (!canNudge || nudgeReady || finished !== null) return;
    const t = setInterval(() => { if (Date.now() - progressAt.current > 4 * 60 * 1000) markStuck(); }, 20000);
    return () => clearInterval(t);
  }, [canNudge, nudgeReady, finished, markStuck]);

  const exec = useCallback((line: string): boolean => {
    const shown = line.replace(/\s+$/, "");
    const prompt = vmPrompt(session.current);
    print(`${prompt} ${shown}`, "cmd");
    let r;
    const before = signatures(st.current);
    const flowsBefore = (level.flows ?? []).map((f) => evalFlow(st.current, f).good);
    const metBefore = metRef.current.filter(Boolean).length;
    try { r = run(st.current, shown, session.current); }
    catch (e) { lastOut.current = { text: (e as Error).message, error: true }; print(`lab: the simulator hit an error on that command (${(e as Error).message}). Your lab state is unchanged.`, "err"); return false; }
    if (r.meta === "clear") { setLines([]); return true; }
    if (r.meta === "hint") { showHint(); return true; }
    if (r.meta === "help") { print(HELP); return true; }
    if (r.meta === "reset") { start(); print("lab: lab reset to the level's starting state.", "lab"); return true; }
    if (r.meta === "goals") {
      print(`${level.title}\n${level.story}\nTasks in this level:\n${level.objectives.map((o, k) => `  [${metRef.current[k] ? "x" : " "}] ${o.text}`).join("\n")}${level.fix ? `\nWhat needs fixing: ${level.fix}` : ""}`);
      return true;
    }
    print(r.text, r.error ? "err" : undefined);
    lastOut.current = { text: r.text, error: !!r.error };
    if (r.trace) { setTrace(r.trace); send({ from: "trace" }); }
    if (r.mut && !r.error) {
      const ch = changedKeys(before, signatures(st.current));
      setChanged(ch);
      setLastChange(ch.size ? [...ch].map(changeLabel).join(", ") : null);
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
      pulseTimer.current = setTimeout(() => setChanged(new Set()), 2600);
    }
    const c = r.mut && !r.error ? changesRef.current + 1 : changesRef.current;
    changesRef.current = c;
    setChanges(c);
    setTick((t) => t + 1);
    check(hints, c);
    // Say whether a change moved anything, so a wrong turn is visible right away.
    if ((r.mut && !r.error) || r.error) {
      const after = (level.flows ?? []).map((f) => evalFlow(st.current, f));
      const gained = after.some((f, k) => f.good && !flowsBefore[k]) || metRef.current.filter(Boolean).length > metBefore;
      const lost = after.filter((f, k) => !f.good && flowsBefore[k]);
      if (gained) { idleRef.current = 0; progressAt.current = Date.now(); }
      else {
        idleRef.current += 1;
        if (r.mut && !r.error) {
          if (lost.length) print(`lab: careful: ${flowName(lost[0].flow)} ${incident ? "isn't right anymore" : `is now ${level.tier === "beginner" ? lost[0].status : "broken"}`}.`, "err");
          else if (after.length && !after.every((f) => f.good)) {
            const f = after.find((x) => !x.good)!;
            print(incident ? "lab: that changed something, but no goal moved yet." : `lab: no goal moved. ${flowName(f.flow)} is still ${level.tier === "beginner" ? f.status : "not working"}.`, "lab");
          } else if (!metRef.current.every(Boolean)) print("lab: that changed something, but no goal moved yet.", "lab");
        }
        if (idleRef.current >= 3) markStuck();
      }
    }
    return !r.error;
  }, [print, showHint, start, level, hints, check, send, incident, markStuck]);

  const typeIt = (cmd: string) => { setMode("terminal"); setDraft(cmd); setFocusKey((k) => k + 1); };
  const stepDone = useMemo(() => {
    const ran = new Set(session.current.log.filter((e) => e.ok).map((e) => norm(e.canon ?? e.raw)));
    const answered = level.objectives.every((o, k) => !o.question || met[k]);
    return (level.steps ?? []).map((s) => !!s.cmd && (ran.has(norm(s.cmd)) || (s.cmd.startsWith("answer") && answered)));
  }, [level, lines, met]); // eslint-disable-line react-hooks/exhaustive-deps
  // A step with nothing to type counts as done once you've moved past it. The first step not done is the one you're on.
  const stepShownDone = stepDone.map((d, k) => d || stepDone.slice(k + 1).some(Boolean));
  const stepNow = stepShownDone.findIndex((d) => !d);

  // Forms only offer what this level needs: no Create tab unless it creates something,
  // and a guided level's change forms open at the step that builds, not while you're still reading.
  const fStep = formStep(level);
  // A step counts as reached when its kind of command ran, however it was typed or whichever form built it.
  const verb = (c: string) => norm(c).split(" ").slice(0, c.startsWith("az ") ? 4 : 1).join(" ");
  const ranVerbs = new Set(session.current.log.filter((e) => e.ok).map((e) => verb(e.raw)));
  const formsOpen = fStep < 0 || (level.steps ?? []).slice(0, fStep).every((s, k) => stepDone[k] || (!!s.cmd && !s.cmd.startsWith("answer") && ranVerbs.has(verb(s.cmd))));
  const fixPolicy = formsOpen ? policy.fix : "off";
  const needs = createsIn(level);
  const onlyCreates = !!policy.only?.length && policy.only.every((p) => p.startsWith("create-"));
  // Portal forms are a real tool, not a hint, so they never cost a star.
  const formCost = () => undefined;
  const runForm = (a: Action, b: Built): boolean => {
    // The Portal talks to Azure, not to a VM: if the shell is logged in to one, run the form's commands from Cloud Shell.
    if (session.current.vm) { print(`lab: the Portal runs in Azure, not on ${session.current.vm}. Leaving the VM.`, "lab"); exec("exit"); }
    for (const c of b.cmds) if (!exec(c)) { setResult(summarize(c, lastOut.current?.text ?? "", true)); return false; }
    print(`lab: what that did: ${b.why}`, "lab");
    setResult(summarize(b.cmds[b.cmds.length - 1], lastOut.current?.text ?? "", false, a.kind === "fix" ? b.why : undefined));
    return true;
  };
  const portalOk = fixPolicy !== "off" || policy.diagnose;
  const view = portalOk ? mode : "terminal";
  const pickOs = (o: Os) => { setOsPick(o); session.current.os = o; setTick((t) => t + 1); try { localStorage.setItem(OS_KEY, o); } catch { /* ignore */ } };
  const osCmd = (c: string) => (os === "windows" ? toWindows(c) : c);
  const setMode = (m: "terminal" | "portal") => { setModeState(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ } };
  const selActions = allowed(actionsFor(st.current, selected), { ...policy, fix: fixPolicy });
  const createList = allowed(createActions(st.current).filter((a) => needs.includes(a.id)), { ...policy, fix: fixPolicy });
  const serviceList = allowed(serviceActions(st.current), { ...policy, fix: fixPolicy });
  const select = (x: Selection | null) => { setSelected(x); if (view === "portal") { setForm(null); if (x && fixPolicy !== "off" && !onlyCreates) setGroup("selected"); } };
  const groups: Record<PortalGroup, Action[] | null> = {
    selected: fixPolicy !== "off" && !onlyCreates ? selActions : null,
    create: createList.length ? createList : null,
    services: fixPolicy !== "off" && serviceList.length ? serviceList : null,
    diagnose: policy.diagnose ? diagnoseActions(st.current, selected?.kind === "host" ? selected.id : undefined) : null,
  };
  const activeGroup: PortalGroup = groups[group] !== null ? group : (["selected", "services", "create", "diagnose"] as const).find((g) => groups[g] !== null) ?? "diagnose";
  const modeSwitch = portalOk ? (
    <span className="mode-switch" role="tablist" aria-label="How to make changes">
      <button type="button" role="tab" aria-selected={view === "terminal"} className={view === "terminal" ? "on" : ""} onClick={() => setMode("terminal")}>Terminal</button>
      <button type="button" role="tab" aria-selected={view === "portal"} className={view === "portal" ? "on" : ""} onClick={() => setMode("portal")}>Portal</button>
    </span>
  ) : null;

  // What the lab VMs run. A level about the VM's own firewall or services is written for Ubuntu, so it says so instead.
  const osSwitch = osLocked ? <span className="os-lock" title="This level's VMs run Ubuntu">VMs: Linux</span> : (
    <span className="mode-switch os-switch" role="tablist" aria-label="What the VMs run"><span className="os-label">VMs</span>
      <button type="button" role="tab" aria-selected={os === "linux"} className={os === "linux" ? "on" : ""} onClick={() => pickOs("linux")}>Linux</button>
      <button type="button" role="tab" aria-selected={os === "windows"} className={os === "windows" ? "on" : ""} onClick={() => pickOs("windows")}>Windows</button>
    </span>
  );


  const flows = useMemo(() => [...(level.flows ?? []), ...watches].map((f) => evalFlow(st.current, f)), [level, tick, watches]); // eslint-disable-line react-hooks/exhaustive-deps
  const levelFlowCount = level.flows?.length ?? 0;
  const vmNames = Object.values(st.current.hosts).filter((h) => h.kind === "vm").map((h) => h.name);
  const addWatch = () => {
    const port = Number(watchPort);
    const from = watchFrom || vmNames[0];
    const to = watchTo.trim();
    if (!from || !to || !Number.isInteger(port) || port < 1 || port > 65535) return;
    const f: Flow = st.current.hosts[to] ? { from, to, port, want: "open" } : { from, dns: to, port, want: "open" };
    setWatches((w) => [...w, f]);
    print(`lab: watching ${from} → ${to}:${port}. It updates on the map after every change.`, "lab");
  };
  const removeWatch = (k: number) => { setWatches((w) => w.filter((_, i) => i !== k - levelFlowCount)); setExplained({}); };
  const flowsGood = flows.filter((f) => f.good).length;

  // When a goal connection starts working, glow it and send a packet along it.
  useEffect(() => {
    const good = flows.map((f) => f.good);
    const prev = goodRef.current;
    goodRef.current = good;
    if (!prev) return;
    const fresh = new Set(good.map((g, k) => (g && !prev[k] && flows[k].flow.want === "open" ? k : -1)).filter((k) => k >= 0));
    if (!fresh.size) return;
    setCelebrate(fresh);
    send({ from: "flow", index: [...fresh][0] });
    const t = setTimeout(() => setCelebrate(new Set()), 2400);
    return () => clearTimeout(t);
  }, [flows, send]);

  // Sandbox challenges are checked after every command.
  const challengeMet = useMemo(() => (level.challenges ?? []).map((c) => c.test({ st: st.current, session: session.current })), [level, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const fresh = (level.challenges ?? []).filter((c, k) => challengeMet[k] && !doneChallenges.includes(c.id));
    if (!fresh.length) return;
    fresh.forEach((c) => print(`lab: ✓ challenge complete: ${c.title}`, "good"));
    chime("goal");
    const all = [...doneChallenges, ...fresh.map((c) => c.id)];
    setDoneChallenges(all);
    try { localStorage.setItem(CHALLENGE_KEY, JSON.stringify(all)); } catch { /* ignore */ }
  }, [challengeMet]); // eslint-disable-line react-hooks/exhaustive-deps

  const freeExplain = level.tier === "beginner";
  const reveal = (k: number) => {
    setExplained((e) => ({ ...e, [k]: explainSteps(st.current, flows[k]) }));
    send({ from: "flow", index: k });
    if (!freeExplain) { setExplains((e) => e + 1); assistRef.current += 1; }
  };
  const doExplain = (k: number) => {
    if (explained[k]) { const n = { ...explained }; delete n[k]; setExplained(n); return; }
    reveal(k);
  };

  const endTour = () => { setTourStep(null); try { localStorage.setItem(TOUR_KEY, "1"); } catch { /* ignore */ } };
  const tour = tourStep !== null ? TOUR[tourStep] : null;
  const tourFocus = tour && !(tour.focus === "flow" && !flows.length) ? tour.focus : null;

  // Point the coach mark at the real thing on the map.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !tour) { setTourAt(null); return; }
    let raf = 0;
    const place = (again: boolean) => {
      const target = tourFocus ? stage.querySelector(TOUR_TARGET[tourFocus]) : null;
      const sb = stage.getBoundingClientRect();
      // On phones the map tab can be hidden; place the coach once the map is showing.
      if (!sb.width || !sb.height) return;
      if (!target) { setTourAt({ left: 12, top: 12, below: true }); return; }
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
      const r = target.getBoundingClientRect();
      // Measure the coach itself: on a narrow screen its text wraps and it grows taller.
      const W = Math.min(308, sb.width - 16), H = stage.querySelector<HTMLElement>(".coach")?.offsetHeight || 180;
      const x = Math.max(8, Math.min(r.left - sb.left, sb.width - W));
      const y = Math.max(8, Math.min(r.top - sb.top, sb.height - H));
      // Below, above, right, left of the target, in that order. Large targets get the corner of the map.
      if (r.bottom - sb.top + H < sb.height) setTourAt({ left: x, top: r.bottom - sb.top + 10, below: true });
      else if (r.top - sb.top > H) setTourAt({ left: x, top: r.top - sb.top - 10, below: false });
      else if (sb.right - r.right > W + 8) setTourAt({ left: r.right - sb.left + 10, top: y, below: true });
      else if (r.left - sb.left > W + 8) setTourAt({ left: r.left - sb.left - W - 10, top: y, below: true });
      else setTourAt({ left: 8, top: sb.height - H - 8, below: true });
      // Once the coach has rendered with this step's text, and the map has fit itself, place it again.
      if (again) raf = requestAnimationFrame(() => place(false));
    };
    raf = requestAnimationFrame(() => place(true));
    const late = setTimeout(() => place(false), 400);
    return () => { cancelAnimationFrame(raf); clearTimeout(late); };
  }, [tour, tourFocus, tick, tab]);

  // Drag handles between the panes. Sizes are remembered per browser.
  const resize = (axis: "panel" | "bottom") => (e: RPointerEvent<HTMLDivElement>) => {
    const desk = deskRef.current;
    if (!desk) return;
    e.preventDefault();
    const d = desk.getBoundingClientRect();
    document.body.classList.add(axis === "panel" ? "resizing-x" : "resizing-y");
    const move = (ev: PointerEvent) => setSizes((z) => axis === "panel"
      ? { ...z, panel: Math.round(Math.min(Math.max(ev.clientX - d.left, 300), d.width * 0.5)) }
      : { ...z, bottom: Math.round(Math.min(Math.max(d.bottom - ev.clientY, 140), d.height - 200)) });
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing-x", "resizing-y");
      setSizes((z) => { try { localStorage.setItem(SIZE_KEY, JSON.stringify(z)); } catch { /* ignore */ } return z; });
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const nudge = (axis: "panel" | "bottom") => (e: RKeyboardEvent) => {
    const step = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -24 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 24 : 0;
    if (!step) return;
    e.preventDefault();
    setSizes((z) => axis === "panel" ? { ...z, panel: Math.min(Math.max(z.panel + step, 300), 640) } : { ...z, bottom: Math.min(Math.max(z.bottom - step, 140), 640) });
  };

  const mentor = usesMentor(level);
  const split = useMemo(() => splitObjectives(level), [level]);
  const cause0 = useMemo(() => startingCause(level), [level]);
  const msteps = mentor ? mentorSteps(level, {
    st: st.current, log: session.current.log, flows, vm: session.current.vm, os, explained: Object.keys(explained).length > 0,
    goalsDone: split.goals.every((k) => met[k]), causeOk, hasCause: !!cause0,
    questionsDone: split.questions.every((k) => met[k]), hasQuestions: split.questions.length > 0,
  }) : [];
  const current = msteps.findIndex((m) => !m.done);

  const questions = (qs: typeof level.objectives) => (
    <div className="questions">
      {qs.map((o) => {
        const n = /^Q(\d+)\./.exec(o.text)?.[1] ?? "1";
        const ok = met[level.objectives.indexOf(o)];
        return (
          <form key={o.text} className={`qa${ok ? " ok" : ""}`} onSubmit={(e) => {
            e.preventDefault();
            const f = e.currentTarget.elements.namedItem("a") as HTMLInputElement;
            const v = f.value.trim();
            if (v) { exec(`answer ${n} ${v}`); setWrong((w) => ({ ...w, [n]: v })); f.value = ""; }
          }}>
            <label htmlFor={`qa-${n}`}>{o.question}</label>
            {!ok && termsIn(o.question ?? "").length > 0 && <dl className="terms">{termsIn(o.question ?? "").map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}</dl>}
            {ok ? <span className="qa-ok">✓ Correct</span> : (
              <div className="qa-row">
                <input id={`qa-${n}`} name="a" autoComplete="off" spellCheck={false} placeholder="Your answer" />
                <button type="submit">Check</button>
              </div>
            )}
            {!ok && wrong[n] && <span className="qa-no">&quot;{wrong[n]}&quot; isn&apos;t it. Try again.</span>}
          </form>
        );
      })}
    </div>
  );
  const answerStep = !!level.steps?.some((s) => s.cmd?.startsWith("answer"));
  const looseQuestions = answerStep ? [] : level.objectives.filter((o) => o.question);

  const prompt = vmPrompt(session.current);
  const resources = useMemo(() => resourcesOf(st.current), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const walk = useMemo(() => (level.playground ? [] : walkthrough(level, os)), [level, os]);
  const issue = useMemo(() => (level.playground ? [] : issueSummary(level)), [level]);
  const fixes = useMemo(() => (level.playground ? [] : fixSummary(level)), [level]);
  // Guided levels already show every command, so their walkthrough is free. Elsewhere it's the fix, and counts as seeing it.
  const walkFree = !!level.steps;
  const walkOpen = walkFree || walkAll || sawFix;
  const wTab = walkTab ?? (view === "portal" ? "portal" : "cmd");
  const best = progress.done[level.id];
  const openGoals = level.objectives.filter((_, k) => !met[k]).length;

  const onMap = linesOnMap(st.current, incident ? [] : flows, trace);
  const mapKey = (
    <details className="map-key">
      <summary title="What the lines, colors and icons on the map mean"><span className="mk-q" aria-hidden="true">?</span>Map key</summary>
      <div className="map-key-body">
        <ul>
          <li><span className="k k-rg" />Resource group, the outer dashed frame</li>
          <li><span className="k k-vnet" /><svg className="k-ic" viewBox="-2 -2 38 22" width="30" height="18"><VnetIc x={0} y={0} /></svg>Virtual network, with its address space top right</li>
          <li><span className="k k-subnet" />Subnet, with range and usable IPs (5 reserved)</li>
          <li><svg className="k-ic" viewBox="-1 -1 15 17" width="14" height="16"><Shield x={0.5} y={1} /></svg>Network security group. A small shield on a VM&apos;s NIC means the NIC has one too</li>
          <li><svg className="k-ic" viewBox="-1 -1 15 15" width="14" height="14"><RouteIc x={0} y={0} /></svg>Route table on the subnet</li>
          <li><svg className="k-ic" viewBox="-10 0 52 38" width="34" height="25"><VmIcon x={0} y={0} nicNsg={false} /></svg>VM <svg className="k-ic" viewBox="0 0 40 34" width="28" height="24"><NvaIcon x={0} y={0} /></svg>Appliance <svg className="k-ic" viewBox="0 0 40 34" width="28" height="24"><PeIcon x={0} y={0} /></svg>Private endpoint</li>
          {/* Lines are only explained when that kind of line is on the map right now. */}
          {onMap.peering && <li><span className="k k-line" />Peering Connected <span className="k k-line half" />Initiated or access off</li>}
          {onMap.goals && <li><span className="k k-flow ok" />Goal working <span className="k k-flow bad" />Goal broken, X marks where it stops</li>}
          {onMap.failing && <li className="k-row"><span className="k k-flow bad" /><span>Red: where the traffic actually goes now, and it&apos;s failing</span></li>}
          {onMap.shouldGo && <li className="k-row"><span className="k k-ghost" /><span>Grey dashed: where the traffic should go; it turns green once you fix it</span></li>}
          {onMap.privateLink && <li className="k-row"><span className="k k-pl" /><span>Green dotted: the private link between a private endpoint and its storage account; it&apos;s always there and already works</span></li>}
          {onMap.lastTest && <li className="k-row"><span className="k k-trace" /><span>Moving white dots: the path of the last test you ran</span></li>}
          {onMap.zones && <li className="k-row"><span className="k k-zone" /><span>Private DNS zone. Grey dotted lines go to the networks linked to it</span></li>}
          <li>Orange pulse: what your last command changed. Drag to pan, Ctrl and scroll to zoom.</li>
        </ul>
        <button className="btn ghost" type="button" onClick={() => setTourStep(0)}>Replay the map tour</button>
      </div>
    </details>
  );

  const coach = tour && tourAt && (
    <div className={`coach${tourAt.below ? "" : " above"}`} role="dialog" aria-label="Map tour" style={{ left: tourAt.left, top: tourAt.top }}>
      <div className="coach-step">{tourStep! + 1} / {TOUR.length}</div>
      <b>{tour.title}</b>
      <p>{tour.text}</p>
      <div className="row">
        {tourStep! < TOUR.length - 1 ? <button className="btn primary" type="button" onClick={() => setTourStep(tourStep! + 1)}>Next</button> : <button className="btn primary" type="button" onClick={endTour}>Got it</button>}
        <button className="btn ghost" type="button" onClick={endTour}>Skip</button>
      </div>
    </div>
  );

  // The inspector can be dragged out of the way, or folded to its title, so it never hides the part of the map you need.
  const dragInspector = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const sx = e.clientX, sy = e.clientY, p0 = inspectPos;
    const move = (ev: PointerEvent) => setInspectPos({ x: p0.x + ev.clientX - sx, y: p0.y + ev.clientY - sy });
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // Phones: leave the map for the Level tab, with the selected resource's changes open in the Portal pane.
  const openPortal = () => { setMode("portal"); setForm(null); setGroup("selected"); setTab("level"); setToPortal((n) => n + 1); };
  const inspector = selected && (
    <div className={`inspect-card${inspectFolded ? " folded" : ""}`} style={{ ["--ix" as string]: `${inspectPos.x}px`, ["--iy" as string]: `${inspectPos.y}px` }}>
      <div className="inspect-grip" onPointerDown={dragInspector} onDoubleClick={() => setInspectPos({ x: 0, y: 0 })} title="Drag to move. Double-click to put it back.">
        <span aria-hidden="true">⠿</span><span>Drag to move</span>
        <button type="button" onClick={() => setInspectFolded(!inspectFolded)}>{inspectFolded ? "Unfold" : "Fold"}</button>
      </div>
      <Inspector st={st.current} sel={selected} flows={incident ? [] : flows} explained={flows.filter((_, k) => explained[k])} onClose={() => select(null)} actions={
        // Phones show the map and the Portal on different tabs, so offer a way across instead of a pointer to a pane you can't see.
        isPhone && portalOk && selActions.length ? <button type="button" className="btn primary" onClick={openPortal}>Change it in the Portal ›</button>
        : view === "portal" && selActions.length ? <p className="note" style={{ margin: 0 }}>{selActions.length} change{selActions.length === 1 ? "" : "s"} available in the Portal pane.</p> : null} />
    </div>
  );

  return (
    <div className="wrap player">
      <div className="tabs" role="tablist" aria-label="View">
        <button role="tab" aria-selected={tab === "level"} className={tab === "level" ? "on" : ""} onClick={() => setTab("level")}>Level</button>
        <button role="tab" aria-selected={tab === "map"} className={`${tab === "map" ? "on" : ""}${changed.size && tab !== "map" ? " ping" : ""}`} onClick={() => setTab("map")}>
          Network{flows.length > 0 && <span className={`tab-badge ${flowsGood === flows.length ? "ok" : "bad"}`}>{flowsGood}/{flows.length}</span>}
        </button>
      </div>
      <main className="desk" data-tab={tab} ref={deskRef} style={{ ["--pw" as string]: `${sizes.panel}px`, ["--bh" as string]: `${sizes.bottom}px` }}>
        <section className="panel" aria-label="Level">
          <div className="panel-scroll">
            <div className="meta">
              {level.playground ? <span>Sandbox</span> : <span>{tier.name} · {level.stage} · {num.n} of {num.of}</span>}
              {level.clock ? <span className={`clock${elapsed > level.clock * 60 ? " over" : ""}`} title="Time against the target">{mmss(elapsed)} / {level.clock}:00</span> : null}
              {best ? <span className="best" title="Your best result">{"★".repeat(best)}</span> : null}
            </div>
            <h1>{level.title}</h1>
            {!modeChosen && portalOk && (
              <div className="mode-pick">
                <span className="label" style={{ margin: 0 }}>How do you want to work?</span>
                <div className="mode-pick-row">
                  <button className="btn" type="button" onClick={() => { setMode("portal"); setModeChosen(true); }}><b>Portal</b><small>Point and click, like the Azure portal</small></button>
                  <button className="btn" type="button" onClick={() => { setMode("terminal"); setModeChosen(true); }}><b>Cloud Shell</b><small>Type Azure CLI commands</small></button>
                </div>
                <span className="note">Both are real ways to do the job. You can switch any time above the shell.</span>
              </div>
            )}

            {level.fix ? (
              <div className="mission">
                <div className="mission-part problem">
                  <span className="label">Problem</span>
                  <p>{level.fix}</p>
                </div>
                {split.goals.length > 0 && (
                  <div className="mission-part">
                    <span className="label">{openGoals ? "Your job" : "Job done"}</span>
                    <ul className="goals">
                      {split.goals.map((k) => <li key={k} className={met[k] ? "met" : ""}><i className="mark" /><span>{level.objectives[k].text}</span></li>)}
                    </ul>
                    {!mentor && looseQuestions.length > 0 && questions(looseQuestions)}
                  </div>
                )}
                {split.guards.length > 0 && (
                  <div className="mission-part">
                    <span className="label">Without breaking</span>
                    <ul className="guards">
                      {split.guards.map((k) => <li key={k} className={met[k] ? "" : "broken"}><i className="lock" aria-hidden="true" /><span>{level.objectives[k].text}</span><b>{met[k] ? "holding" : "broken"}</b></li>)}
                    </ul>
                  </div>
                )}
              </div>
            ) : split.goals.length > 0 && (
              <div className="goal-box">
                <div className="label">{openGoals ? "Your tasks" : "All tasks done"}</div>
                <ul className="goals">
                  {split.goals.map((k) => <li key={k} className={met[k] ? "met" : ""}><i className="mark" /><span>{level.objectives[k].text}</span></li>)}
                </ul>
                {looseQuestions.length > 0 && questions(looseQuestions)}
              </div>
            )}
            {mentor ? (
              <details className="background"><summary>Background</summary><p className="story">{level.story}</p></details>
            ) : <p className="story">{level.story}</p>}
            {resources.length > 0 && (
              <details className="background resources">
                <summary>Resources ({resources.reduce((n, g) => n + g.items.length, 0)})</summary>
                <p className="note">Everything in this lab, by type, as it is right now. Tap one to find it on the map.</p>
                {resources.map((g) => (
                  <div key={g.type} className="res-group">
                    <span className="label">{g.type}</span>
                    <ul>
                      {g.items.map((r) => (
                        <li key={r.name}>
                          {r.sel ? <button type="button" onClick={() => { select(r.sel!); if (isPhone) setTab("map"); }}><b>{r.name}</b><span>{r.detail}</span></button> : <div><b>{r.name}</b><span>{r.detail}</span></div>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </details>
            )}

            {/* The sandbox has no goals, so say what's in it and how to start, instead of leaving a blank lab. */}
            {level.playground && (
              <div className="sandbox-guide">
                <span className="label" style={{ margin: 0 }}>How to use the sandbox</span>
                <p>Nothing here is graded. Build anything, break things on purpose, and watch what happens on the map.</p>
                <div className="sandbox-start">
                  <span>Start from</span>
                  <button type="button" className="btn ghost" onClick={() => { blankRef.current = false; start(); print("lab: sandbox reset to the hub and spoke.", "lab"); }}>Hub and spoke</button>
                  <button type="button" className="btn ghost" onClick={() => { blankRef.current = true; start(); print("lab: empty sandbox. Create a virtual network to begin.", "lab"); }}>Empty lab</button>
                </div>
                <b>What you can do</b>
                <ul>
                  <li><b>Create:</b> in the Portal, open Create for networks, VMs, NSGs, route tables, resource groups and subscriptions.</li>
                  <li><b>Change or delete:</b> tap anything on the map. Its actions, including Delete, open in the Portal. Azure&apos;s real rules apply, so an attached NSG can&apos;t be deleted until you detach it.</li>
                  <li><b>Watch traffic:</b> add a connection below. It turns green or red on the map after every change, and Explain walks it hop by hop.</li>
                </ul>
                <b>Watch a connection</b>
                {vmNames.length ? (
                  <div className="watch-row">
                    <select aria-label="From VM" value={watchFrom || vmNames[0]} onChange={(e) => setWatchFrom(e.target.value)}>{vmNames.map((n) => <option key={n} value={n}>{n}</option>)}</select>
                    <span aria-hidden="true">→</span>
                    <input aria-label="To a VM or a name" list="watch-targets" placeholder="vm-spoke2 or a name" value={watchTo} onChange={(e) => setWatchTo(e.target.value)} />
                    <datalist id="watch-targets">{vmNames.map((n) => <option key={n} value={n} />)}</datalist>
                    <input aria-label="Port" className="watch-port" value={watchPort} onChange={(e) => setWatchPort(e.target.value)} />
                    <button type="button" className="btn" onClick={addWatch}>Watch</button>
                  </div>
                ) : <p className="note" style={{ margin: 0 }}>Create a VM first, then watch connections from it.</p>}
                <p className="note" style={{ margin: 0 }}>Use Cloud Shell or the Portal, whichever you like. Type <code>help</code> for every command. Reset, at the bottom, puts the lab back the way it started.</p>
              </div>
            )}

            {level.concept && (
              <div className="learn-line">
                <span className="label" style={{ margin: 0 }}>You&apos;ll learn</span>
                <div className="learn-row">
                  <b>{level.concept.heading}</b>
                  <button className="btn ghost" type="button" onClick={() => setShowConcept(true)}>Read more</button>
                </div>
              </div>
            )}

            {level.challenges && (
              <div className="goal-box">
                <div className="label">Optional challenges</div>
                <ul className="goals">
                  {level.challenges.map((c, k) => {
                    const ok = challengeMet[k] || doneChallenges.includes(c.id);
                    return (
                      <li key={c.id} className={ok ? "met" : ""}><i className="mark" /><span>{c.title}{!ok && <details className="mini-hint"><summary>Nudge</summary>{c.hint}</details>}</span></li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* The mentor: how a senior engineer would have you work it, one step at a time. */}
            {mentor && (
              <div className="mentor-box">
                <div className="mentor-head">
                  <span className="label" style={{ margin: 0 }}>How to work it</span>
                  <button type="button" className="help-toggle" aria-pressed={!helpOn} onClick={() => setHelp(!helpOn)}>{helpOn ? "Hide help" : "Show help"}</button>
                </div>
                {!helpOn && <p className="note" style={{ margin: "6px 0 0" }}>Help is hidden on every level. Each step still says what to do and ticks off as you go, but not why, what to look for, or which tools to use.</p>}
                <ol className="mentor">
                  {msteps.map((m, i) => (
                    <li key={m.id} className={`mstep${m.done ? " done" : ""}${i === current ? " now" : ""}`}>
                      <div className="mstep-head"><span className="mstep-n">{m.done ? "✓" : i + 1}</span><b>{m.title}</b>{m.done ? <span className="mstep-state">Done</span> : i === current ? <span className="mstep-state">You&apos;re here</span> : null}</div>
                      {i === current && <StepItem step={m} brief={!helpOn} />}
                      {m.id === "cause" && i === current && cause0 && (
                        <div className="chips">
                          {causeChoices(level.tier, cause0.cause, level.id).map(([v, t]) => (
                            <button key={v} type="button" className={causeWrong === v ? "no" : ""} onClick={() => {
                              if (v === cause0.cause) { setCauseOk(true); setCauseWrong(null); print("lab: right, that's what the evidence shows. Now fix it.", "good"); }
                              else setCauseWrong(v);
                            }}>{t}</button>
                          ))}
                        </div>
                      )}
                      {m.id === "cause" && i === current && causeWrong && <p className="qa-no">That&apos;s not what the tools show. Look at where the packet stops, then pick again.</p>}
                      {m.id === "explain" && (i === current || m.done) && questions(split.questions.map((k) => level.objectives[k]))}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {level.steps && (
              <ol className="steps">
                {level.steps.map((s, k) => {
                  const isAnswer = !!s.cmd?.startsWith("answer");
                  const qs = isAnswer ? level.objectives.filter((o) => o.question) : [];
                  return (
                    <li key={k} className={`step${stepShownDone[k] ? " done" : k === stepNow ? " now" : ""}`}>
                      <p className="step-say"><span>{s.say}</span>{stepShownDone[k] ? <span className="mstep-state">Done</span> : k === stepNow ? <span className="mstep-state">You&apos;re here</span> : null}</p>
                      {qs.length > 0 && questions(qs)}
                      {s.cmd && !isAnswer && <CmdRow cmd={osCmd(s.cmd)} onType={typeIt} />}
                      {s.flags && osCmd(s.cmd ?? "") === s.cmd && <ul className="flags">{s.flags.map(([fl, d]) => <li key={fl}><code>{fl}</code> {d}</li>)}</ul>}
                    </li>
                  );
                })}
              </ol>
            )}

            {walk.length > 0 && (
              <details className="walk">
                <summary>Full walkthrough</summary>
                <p className="note">Every step to solve this level, from seeing it fail to checking the fix. Follow it in Cloud Shell or in the Portal, and switch any time to see the other way.</p>
                <span className="mode-switch walk-tabs" role="tablist" aria-label="Walkthrough as">
                  <button type="button" role="tab" aria-selected={wTab === "cmd"} className={wTab === "cmd" ? "on" : ""} onClick={() => setWalkTab("cmd")}>Command steps</button>
                  <button type="button" role="tab" aria-selected={wTab === "portal"} className={wTab === "portal" ? "on" : ""} onClick={() => setWalkTab("portal")}>Portal steps</button>
                </span>
                {/* Lines that run on a VM come in Linux and Windows flavors. This is the same switch as above the shell, so the two never disagree. */}
                {wTab === "cmd" && walk.some((w) => w.on) && <div className="mstep-os walk-os"><span>VM commands for</span>{osSwitch}</div>}
                {wTab === "portal" && isPhone && <p className="note" style={{ margin: "0 0 6px" }}>On a phone, the map is on the Network tab. Tap the resource there, then Change it in the Portal to come back with its settings open.</p>}
                <ol className="walk-steps">
                  {walk.filter((w, k) => walkOpen || k === 0 || w.phase === "see").map((w, k) => (
                    <li key={k} className={`walk-step ${w.phase}`}>
                      <span className="walk-phase">{WALK_PHASE[w.phase]}</span>
                      {w.say && <p>{w.say}</p>}
                      {wTab === "cmd" ? (
                        <>
                          <Where on={w.on} vm={session.current.vm} onType={typeIt} />
                          <ol className="mstep-cmds">{w.cmds.map((c, j) => <li key={j}><CmdRow cmd={c} onType={typeIt} /></li>)}</ol>
                        </>
                      ) : <ol className="walk-portal">{w.portal.map((t, j) => <li key={j}>{t}</li>)}</ol>}
                    </li>
                  ))}
                </ol>
                {!walkOpen && (
                  <div className="walk-reveal">
                    <button type="button" className="btn" onClick={() => { sawFixRef.current = true; setWalkAll(true); }}>Show every step</button>
                    <span className="note">{walk.length - 1} more step{walk.length === 2 ? "" : "s"}, including the fix. Seeing them counts as seeing the fix, so this run earns 1 star. Replay the level later for 3.</span>
                  </div>
                )}
              </details>
            )}

            {(hints > 0 || sawFix) && (
              <div className="hint-list">
                {ladder.slice(0, hints).map((h, k) => <HintCard key={k} hint={h} label={k === 0 ? "Hint (free)" : `Hint ${k + 1}`} st={st.current} portal={view === "portal"} os={os} onType={typeIt} repeat={k > 0 && !!hintLayer(h) && hintLayer(ladder[k - 1])?.name === hintLayer(h)?.name} />)}
                {sawFix && (
                  <div className="hint the-fix">
                    <span className="label" style={{ margin: 0 }}>The fix</span>
                    <ol className="fix-steps">{level.solution.filter((c) => c !== "exit" && !c.startsWith("answer ")).map((c, k) => <li key={k}><HintBody hint={c} portal={view === "portal"} os={os} onType={typeIt} /></li>)}</ol>
                  </div>
                )}
              </div>
            )}

            <details className="sources">
              <summary>Sources on Microsoft Learn ({level.learn.length})</summary>
              <div className="links">{level.learn.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">{l.title}</a>)}</div>
            </details>
          </div>

          {/* Say what happened right where you tapped. On a phone the shell, where the lab also says it, is far below. */}
          {notice && <p className="toast" role="status">{notice}</p>}
          <div className="panel-foot">
            {!level.playground && <button className={`btn${nudgeReady ? " nudge" : ""}`} type="button" onClick={showHint}>{hints === 0 ? "Ask for a hint (free)" : hints < ladder.length ? "Another hint" : sawFix ? "Show the fix again" : "Show me the fix"}</button>}
            <button className="btn ghost" onClick={resetAll}>Reset</button>
            {!level.playground && (
              <span className="foot-stats" title="State-changing commands against par">
                {changes}/{level.par} changes{explains > 0 ? ` · ${explains} explain${explains === 1 ? "" : "s"}` : ""}
              </span>
            )}
          </div>
        </section>

        <div className="split split-v" role="separator" aria-orientation="vertical" aria-label="Resize the level panel" tabIndex={0} onPointerDown={resize("panel")} onKeyDown={nudge("panel")} />

        <section className={`work${view === "portal" ? " portal-mode" : ""}`}>
          <div className="map">
            <div className="map-head">
              <span className="label" style={{ margin: 0 }}>Network map</span>
              {mapKey}
            </div>
            <MapViewport version={tick} stageRef={stageRef} overlay={<>{coach}{inspector}</>}>
              {(scale) => <NetworkMap st={st.current} trace={trace} flows={incident ? [] : flows} changed={changed} selected={selected} onSelect={(x) => select(x)} tour={tourFocus} scale={scale} packet={packet} celebrate={celebrate} />}
            </MapViewport>
            {flows.length > 0 && (
              <ul className="flow-list">
                {flows.map((f, k) => {
                  return (
                    <li key={k} className={f.good ? "ok" : "bad"}>
                      <div className="flow-row">
                        <span className="dot" aria-hidden="true" />
                        <code>{flowName(f.flow)}</code>
                        <span className="flow-status">{f.flow.want === "closed" ? "should stay blocked" : "should work"}: <b>{(incident || (level.tier !== "beginner" && !explained[k])) ? (f.good ? (f.flow.want === "closed" ? "blocked" : "working") : f.flow.want === "closed" ? "open, and it shouldn't be" : "not working") : f.status}</b></span>
                        {!incident && (!f.good || explained[k]) && <button className="btn ghost explain-btn" type="button" onClick={() => doExplain(k)}>{explained[k] ? "Hide" : "Explain"}</button>}
                        {k >= levelFlowCount && <button className="btn ghost explain-btn" type="button" aria-label="Stop watching" onClick={() => removeWatch(k)}>×</button>}
                      </div>
                      {explained[k] && (
                        <>
                          <ol className="explain">
                            {explained[k].map((x, j) => <li key={j} className={x.ok ? "ok" : "bad"}>{x.text}</li>)}
                          </ol>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="split split-h" role="separator" aria-orientation="horizontal" aria-label="Resize the terminal" tabIndex={0} onPointerDown={resize("bottom")} onKeyDown={nudge("bottom")} />

          <div className="bottom">
            {/* Phones: a live mini map and what it would tell you, without leaving the shell. */}
            {isPhone && tab === "level" && (
              <button type="button" className="mini-map" onClick={() => setTab("map")} aria-label="Open the network map">
                <NetworkMap st={st.current} trace={trace} flows={incident ? [] : flows} changed={changed} packet={packet} celebrate={celebrate} focus />
                <span className="mini-map-open">Open map ›</span>
              </button>
            )}
            <div className="live-strip" aria-live="polite">
              {level.objectives.length > 0 && <span className={met.every(Boolean) ? "ok" : ""}>Goals {met.filter(Boolean).length}/{level.objectives.length}</span>}
              {flows.length > 0 && <button type="button" className={flowsGood === flows.length ? "ok" : "bad"} onClick={() => setTab("map")}>Connections {flowsGood}/{flows.length} ›</button>}
              {lastChange && <span className="chg">Changed: {lastChange}</span>}
            </div>
            {view === "portal" ? (
              <Portal onClear={() => setLines([])} lines={lines} headExtra={modeSwitch} group={activeGroup} setGroup={setGroup} selectedLabel={selected ? selLabel(selected) : null} groups={groups} form={form} setForm={setForm} cost={formCost} onRun={runForm} result={result} onDismiss={() => setResult(null)}
                note={!formsOpen ? `Change forms open at step ${fStep + 1}, once the steps before it are done.` : policy.fix === "off" ? "This level is about looking, not changing." : undefined} />
            ) : (
              <Terminal lines={lines} prompt={prompt} title={session.current.vm ? `ssh · ${session.current.vm}` : "Cloud Shell · bash"} draft={draft} setDraft={setDraft} onRun={exec} focusKey={focusKey} headExtra={<>{modeSwitch}{osSwitch}</>} quick={level.hints.length ? undefined : ["help", "goals", "clear"]} suggest={(d) => suggest(d, st.current, !!session.current.vm)} />
            )}
          </div>
        </section>
      </main>

      {showConcept && level.concept && (
        <div className="veil" onClick={(e) => { if (e.target === e.currentTarget) setShowConcept(false); }}>
          <div className="sheet concept-sheet" role="dialog" aria-modal="true" aria-labelledby="concept-title">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <span className="label" style={{ margin: 0 }}>You&apos;ll learn</span>
              <button className="btn ghost" type="button" onClick={() => setShowConcept(false)}>Close</button>
            </div>
            <h2 id="concept-title">{level.concept.heading}</h2>
            {level.concept.paragraphs.map((p, k) => <p key={k}>{p}</p>)}
            <div className="label" style={{ margin: "6px 0 0" }}>Remember</div>
            <ul>{level.concept.facts.map((f, k) => <li key={k}>{f}</li>)}</ul>
          </div>
        </div>
      )}

      {showDone && finished !== null && (
        <div className="veil" onClick={(e) => { if (e.target === e.currentTarget) setShowDone(false); }}>
          <Confetti />
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="done-title">
            <div className="meta"><span>{tier.name} · {level.stage} · {num.n} of {num.of}</span></div>
            <h2 id="done-title">{level.title} solved</h2>
            <Stars n={finished} />
            <div className="stats"><span>Changes <b>{changes} (par {level.par})</b></span>{level.clock ? <span>Time <b>{mmss(elapsed)} (target {level.clock}:00)</b></span> : <span>Hints used <b>{hints}</b></span>}<span>XP earned <b>{finished * 50}</b></span></div>
            {issue.length > 0 && <div className="debrief issue"><div className="label">The issue</div><ul>{issue.map((d, k) => <li key={k}>{d}</li>)}</ul></div>}
            {fixes.length > 0 && (
              <div className="the-fix-card">
                <div className="label">{level.fix ? "The fix" : "What you built"}</div>
                <ol>{fixes.map((f, k) => <li key={k}><p>{f.what}</p><code>{f.cmd}</code></li>)}</ol>
                {level.fix && <p className="note" style={{ margin: 0 }}>This is one way to fix it. If yours worked differently, it still counts.</p>}
              </div>
            )}
            {level.why && <div className="why"><div className="label">Why it worked</div><p style={{ margin: 0 }}>{level.why}</p></div>}
            <div className="lesson"><div className="label">Remember</div><p style={{ margin: 0 }}>{level.lesson}</p></div>
            <details className="sources"><summary>Read more on Microsoft Learn</summary><div className="links">{level.learn.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">{l.title}</a>)}</div></details>
            <div className="row">
              {next ? <Link className="btn primary" href={`/learn/${next.id}/`}>Next level: {next.title}</Link> : <Link className="btn primary" href="/learn/">Back to the path</Link>}
              <button className="btn" onClick={() => setShowDone(false)}>Stay in this lab</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
