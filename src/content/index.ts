import { beginner } from "./levels/beginner";
import { intermediate, hubSpoke } from "./levels/intermediate";
import { beginnerMore } from "./levels/beginner2";
import { INTERMEDIATE_WHY, STARTER_TOOL, intermediateMore } from "./levels/intermediate2";
import { advanced } from "./levels/advanced";
import { expert } from "./levels/expert";
import { expertMore } from "./levels/expert2";
import { advancedGuest, advancedReviews } from "./levels/advanced3";
import { ADVANCED_WHY, advancedIntros, advancedMore } from "./levels/advanced2";
import { DEBRIEFS } from "./debriefs";
import { ask } from "./build";
import type { FormPolicy, Level, Tier, TierInfo } from "./types";
import { findLink, reach } from "@/sim/network";
import { emptyState, type State } from "@/sim/types";

export const TIERS: TierInfo[] = [
  { id: "beginner", name: "Beginner", style: "Guided", blurb: "One concept per level. Every command is shown and explained, flag by flag." },
  { id: "intermediate", name: "Intermediate", style: "Symptom and tools", blurb: "Real break/fix issues. You get the symptom and the diagnostics, not the command." },
  { id: "advanced", name: "Advanced", style: "Stacked faults", blurb: "Several things wrong at once across hub and spoke, hybrid, PaaS, DNS, outbound, load balancing, the VM itself, Azure Firewall and Bastion." },
  { id: "expert", name: "Expert", style: "Incident mode", blurb: "A complaint in the words users use, one or more faults, sometimes not in the network at all. No hints, and a clock." },
];

/** The sandbox can create and delete anything, including resource groups and subscriptions. Levels never get these. */
export function sandboxState(st: State): State {
  st.groups = { "rg-lab": { sub: "Lab subscription" } };
  st.subscriptions = ["Lab subscription"];
  return st;
}
/** A blank sandbox: one empty resource group, nothing else. */
export const emptySandbox = () => sandboxState(emptyState());

export const SANDBOX: Level = {
  id: "sandbox", tier: "intermediate", stage: "Sandbox", title: "Open lab",
  story: "A free hub-and-spoke lab with no goals. vnet-hub has the appliance fw-hub at 10.0.2.4, both spokes are peered to it, and nothing routes between spokes yet. Break things, fix them, try any command.",
  setup: () => sandboxState(hubSpoke(null, null)), objectives: [], par: 0, hints: ["Type help for the full command list."], lesson: "",
  learn: [
    { title: "Azure Virtual Network documentation", url: "https://learn.microsoft.com/azure/virtual-network/" },
    { title: "Hub-and-spoke network topology: spoke-to-spoke through the hub", url: "https://learn.microsoft.com/azure/networking/design-guide/hub-spoke#spoke-to-spoke-communication-patterns" },
    { title: "Troubleshoot NSG misconfigurations: rule order and default rules", url: "https://learn.microsoft.com/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-nsg-blocking-traffic" },
    { title: "Create, change, or delete a virtual network peering", url: "https://learn.microsoft.com/azure/virtual-network/virtual-network-manage-peering" },
  ],
  solution: [], playground: true,
  challenges: [
    {
      id: "spoke-to-spoke", title: "Get vm-spoke1 to vm-spoke2 on 443, through fw-hub",
      hint: "Each spoke needs a route to the other spoke with fw-hub (10.0.2.4) as the next hop. One direction isn't enough, the reply needs its way back.",
      test: ({ st }) => { const r = reach(st, "vm-spoke1", "10.2.1.4", 443); return r.ok && r.via.includes("fw-hub"); },
    },
    {
      id: "only-443", title: "Then keep vm-spoke1 out of vm-spoke2 on 22, while 443 still works",
      hint: "Nothing filters vm-spoke2 yet. Put an NSG on its subnet with a rule that denies 22 from vnet-spoke1 at a lower priority number than the default AllowVnetInBound rule.",
      test: ({ st }) => reach(st, "vm-spoke1", "10.2.1.4", 443).ok && !reach(st, "vm-spoke1", "10.2.1.4", 22).ok,
    },
    {
      id: "new-spoke", title: "Add vnet-spoke3 (10.3.0.0/16) with a subnet, peered to the hub on both sides",
      hint: "Create the VNet with a subnet, then two peering links: one on vnet-spoke3 and one on vnet-hub, both with VNet access allowed.",
      test: ({ st }) => {
        const v = st.vnets["vnet-spoke3"];
        const a = findLink(st, "vnet-spoke3", "vnet-hub"), b = findLink(st, "vnet-hub", "vnet-spoke3");
        return !!v && Object.keys(v.subnets).length > 0 && !!a?.allowVnetAccess && !!b?.allowVnetAccess;
      },
    },
  ],
};

/** The Portal is a real tool, so its forms are free in every tier. Guided Beginner levels still scope them with `only`. */
export const FORM_POLICY: Record<Tier, FormPolicy> = {
  beginner: { fix: "free", diagnose: true },
  intermediate: { fix: "free", diagnose: true },
  advanced: { fix: "free", diagnose: true },
  expert: { fix: "free", diagnose: true },
};
/** Create forms a level actually needs, read from its solution. Levels that create nothing get no Create tab. */
const CREATES: [RegExp, string][] = [[/^az network vnet create\b/, "create-vnet"], [/^az network nsg create\b/, "create-nsg"], [/^az network route-table create\b/, "create-rt"], [/^az network private-dns zone create\b/, "create-zone"], [/^az network public-ip create\b/, "create-pip"], [/^az network bastion create\b/, "create-bastion"], [/^az network nat gateway create\b/, "create-natgw"], [/^az vm create\b/, "create-vm"], [/^az group create\b/, "create-rg"], [/^az account create\b/, "create-sub"], [/^az group delete\b/, "delete-rg"]];
export const createsIn = (l: Level): string[] => (l.playground ? CREATES.map((c) => c[1]) : CREATES.filter(([re]) => l.solution.some((c) => re.test(c))).map((c) => c[1]));
/** Guided levels open their change forms at the first step that changes something, not before. */
export function formStep(l: Level): number {
  return (l.steps ?? []).findIndex((s) => !!s.cmd && /^az network /.test(s.cmd) && / (create|update|delete)\b/.test(s.cmd) && !/ watcher /.test(s.cmd));
}
export const formPolicy = (l: Level): FormPolicy => l.forms ?? (l.playground ? { fix: "free", diagnose: true } : FORM_POLICY[l.tier]);

/** The order levels are played in. Each tier ends with its Review level. */
const ORDER: Record<string, string[]> = {
  advanced: [
    "return-trip", "two-way-street",
    "intro-transit", "gateway-transit", "left-behind", "two-spokes",
    "intro-endpoints", "selected-networks", "endpoint-choice",
    "review-spokes-hybrid",
    "intro-custom-dns", "custom-dns", "intro-resolver", "resolver-inbound", "resolver-rules", "onprem-to-private",
    "review-endpoints-dns",
    "intro-nat", "nat-overridden",
    "intro-lb", "probed-down",
    "intro-guest", "guest-probe", "guest-or-network",
    "review-edge",
    "intro-firewall", "firewall-rules", "firewall-hybrid",
    "intro-bastion", "bastion-build", "bastion-peered",
    "review-advanced",
  ],
  expert: [
    "reports-down", "intranet-down", "spoke-silence", "metrics-gap", "uploads-failing", "checkout-timeouts",
    "office-blocked", "no-updates", "firewall-cutover", "partner-api", "bastion-lockout", "half-the-users",
    "corp-names", "hr-app", "wiki-gone", "firewall-source", "monday-morning", "launch-day",
  ],
  intermediate: ["first-match-wins", "two-locks", "outbound-surprise", "wrong-tag", "half-a-handshake", "overlap", "grew-apart", "spokes-dont-talk", "ghost-next-hop", "more-specific", "not-forwarding", "forwarded-flag", "wrong-side-of-the-glass", "missing-record", "review-intermediate"],
  beginner: ["meet-the-vnet", "reading-cidr", "carving-subnets", "nics-and-ips", "room-to-grow", "first-nsg", "ip-flow-verify", "service-tags", "outbound-rules", "nic-nsg", "where-packets-go", "first-route", "first-peering", "private-dns", "review-beginner"],
};
/** Add each Intermediate and Advanced level's why question, and its debrief. The answer joins the solution so the tests still prove it solvable. */
function enrich(l: Level): Level {
  const why = ADVANCED_WHY[l.id] ?? INTERMEDIATE_WHY[l.id];
  const n = l.objectives.filter((o) => o.question).length + 1;
  return {
    ...l,
    debrief: l.debrief ?? DEBRIEFS[l.id],
    tool: l.tool ?? STARTER_TOOL[l.id],
    objectives: why ? [...l.objectives, ask(n, why.q, why.accept)] : l.objectives,
    solution: why ? [...l.solution, `answer ${n} ${why.accept[0]}`] : l.solution,
  };
}
const ALL = [...beginner, ...beginnerMore, ...intermediate, ...intermediateMore, ...advanced, ...advancedIntros, ...advancedMore, ...advancedGuest, ...advancedReviews, ...expert, ...expertMore].map(enrich);
const byId = (id: string) => ALL.find((l) => l.id === id) ?? (() => { throw new Error(`level ${id} is in ORDER but not defined`); })();
const ordered = (tier: Tier, list: Level[]) => (ORDER[tier] ? ORDER[tier].map(byId) : list.filter((l) => l.tier === tier));
export const LEVELS: Level[] = [...ordered("beginner", ALL), ...ordered("intermediate", ALL), ...ordered("advanced", ALL), ...ordered("expert", ALL)];
export const levelsIn = (t: Tier) => LEVELS.filter((l) => l.tier === t);
export const getLevel = (id: string) => (id === SANDBOX.id ? SANDBOX : LEVELS.find((l) => l.id === id));
export function levelNumber(id: string): { n: number; of: number } {
  const l = LEVELS.find((x) => x.id === id);
  if (!l) return { n: 0, of: 0 };
  const list = levelsIn(l.tier);
  return { n: list.indexOf(l) + 1, of: list.length };
}
export function nextLevel(id: string): Level | undefined {
  const i = LEVELS.findIndex((l) => l.id === id);
  return i >= 0 ? LEVELS[i + 1] : undefined;
}
export type { FormPolicy, Level, Tier, TierInfo };
