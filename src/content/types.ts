import type { Session, State } from "@/sim/types";

export type Tier = "beginner" | "intermediate" | "advanced" | "expert";

export interface ObjectiveCtx { st: State; session: Session }

export interface Objective {
  text: string;
  test: (ctx: ObjectiveCtx) => boolean;
  /** Present when the objective is a question answered with `answer <n> <value>`. */
  question?: string;
  /** Present when the objective is about running a command, not about network state. */
  action?: boolean;
}

export interface GuidedStep {
  /** What this step does and why, in plain words. */
  say: string;
  /** The exact command to type. */
  cmd?: string;
  /** Flag-by-flag explanation of cmd. */
  flags?: [string, string][];
}

export interface Concept {
  heading: string;
  paragraphs: string[];
  /** Short, sourced facts worth remembering. */
  facts: string[];
}

/** A connection the level cares about, drawn live on the map and re-checked after every command. */
export interface Flow {
  from: string;
  /** Target host name, or use dns to resolve a name from the source VNet first. */
  to?: string;
  dns?: string;
  port: number;
  /** For a dns flow: the host the name is meant to reach. The map draws a dashed line to it until the name resolves. */
  expect?: string;
  /** "open" must end up working; "closed" must stay blocked. */
  want: "open" | "closed";
}

export interface LearnLink { title: string; url: string }

/** An optional goal in the sandbox, for practice after a tier. */
export interface Challenge { id: string; title: string; hint: string; test: (ctx: ObjectiveCtx) => boolean }

export interface Level {
  id: string;
  tier: Tier;
  stage: string;
  title: string;
  story: string;
  concept?: Concept;
  steps?: GuidedStep[];
  setup: () => State;
  objectives: Objective[];
  par: number;
  hints: string[];
  lesson: string;
  learn: LearnLink[];
  /** Commands that solve the level. Used by the test suite, never shown to players. */
  solution: string[];
  flows?: Flow[];
  playground?: boolean;
  /** Optional goals offered in a playground. */
  challenges?: Challenge[];
  /** What was wrong, by layer. Shown on the solved card. */
  debrief?: string[];
  /** Expert incident mode: the target time in minutes. Going over costs a star. */
  clock?: number;
  /** Shown when the level is solved: why the fix (or the build) makes it work, in a sentence or three. */
  why?: string;
  /** What's broken when the level starts, as the player would notice it. Only on levels where something needs fixing; never names the cause. */
  fix?: string;
  /** A tool to reach for first, shown on early Intermediate levels as the step between Beginner and figuring it out. */
  tool?: string;
  /** Override the tier's form policy for this level. */
  forms?: FormPolicy;
}

/** Where point-and-click forms are allowed. Forms never cost a star. */
export interface FormPolicy {
  fix: "free" | "off";
  diagnose: boolean;
  /** Limit change forms to these action id prefixes. Guided levels use it to offer only the change they teach. */
  only?: string[];
}

export interface TierInfo {
  id: Tier;
  name: string;
  blurb: string;
  style: string;
  /** Topics planned for tiers that aren't built yet. */
  planned?: string[];
}
