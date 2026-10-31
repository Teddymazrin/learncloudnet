// Context for a hint: the layer it checks, why that layer matters, what to look for, and what the check returns in the lab right now.
import { run } from "@/sim/shell";
import { newSession, type State } from "@/sim/types";

export interface Layer { name: string; why: string; lookFor: string }

/** Most specific first: a hint about a VM's firewall also says "rule", but the VM is the layer. */
const LAYERS: [RegExp, Layer][] = [
  [/\bufw\b|systemctl|run-command|\bss -|listening|guest|inside the vm/, { name: "Inside the VM", why: "Azure's network tools can't see inside a VM. Its own firewall and its services can still stop traffic that Azure lets through.", lookFor: "Whether the service is running and listening on the port, and whether the VM's firewall allows it." }],
  [/\blb\b|probe|load balancer|backend/, { name: "Load balancer", why: "A load balancer only sends traffic to backends that pass its health probe.", lookFor: "The probe's port, and whether each backend answers on it." }],
  [/firewall/, { name: "Azure Firewall", why: "Azure Firewall denies anything no rule allows. Rule collections run by priority, lowest number first.", lookFor: "A rule matching the source, destination and port, in an Allow collection that comes before any Deny that also matches." }],
  [/bastion/, { name: "Azure Bastion", why: "Bastion reaches VMs from its own subnet, so the VMs' security rules have to let that subnet in.", lookFor: "Bastion's subnet (AzureBastionSubnet) and the rules that allow SSH or RDP from it." }],
  [/storage account|network-rule|service endpoint|networkruleset/, { name: "Storage networking", why: "A storage account decides who gets in by where the request comes from: public access, network rules, or a private endpoint.", lookFor: "Public network access, the default action, and which subnets are allowed." }],
  [/private-dns|nslookup|resolve|\bdns\b|zone|record|cname|forwarding|resolver/, { name: "Names (DNS)", why: "Every connection starts with a name lookup. The wrong address sends the traffic somewhere else entirely. A private DNS zone only answers for the networks linked to it.", lookFor: "The address the name gives, the networks the zone is linked to, and whether the record exists with the right IP." }],
  [/peering|forwarded|transit/, { name: "Peering", why: "A peering needs a link from each network, and each link has its own settings.", lookFor: "Connected on both sides, with VNet access allowed, and forwarded traffic or gateway transit where the path needs them." }],
  [/\bnsg\b|test-ip-flow|ip flow|security rule|effective-nsg|\b(allow|deny)\b|priority|\btag\b/, { name: "Security rules", why: "The subnet's NSG and the NIC's NSG both have to allow the traffic. In each one, the matching rule with the lowest priority number decides.", lookFor: "Which rule decides, and whether it says Allow or Deny." }],
  [/route|next-hop|next hop|\budr\b|gateway/, { name: "Routing", why: "Azure sends each packet by the most specific matching route. A route of yours can send traffic to an appliance or drop it.", lookFor: "The next hop type and IP for the destination. None, or an IP where nothing lives, means the packet is dropped." }],
  [/address|prefix|subnet|cidr|\bvnet\b|\/\d\d\b|ip-config|\bnic\b/, { name: "Addressing", why: "Subnets have to fit inside the network's address space and can't overlap, and Azure keeps 5 addresses in each.", lookFor: "The address ranges and what's attached to each subnet." }],
];

/** The layer a hint checks, read from its words and command. */
export function hintLayer(hint: string): Layer | null {
  const h = hint.toLowerCase();
  return LAYERS.find(([re]) => re.test(h))?.[1] ?? null;
}

const BAD_SYNTAX = /isn't part of this simulator|arguments are required|is not a valid|^usage:|^lab: usage/;
const runs = (st: State, cmd: string) => { try { return !BAD_SYNTAX.test(run(structuredClone(st), cmd, newSession()).text); } catch { return false; } };

/** The line to type for a command from a hint: as written, or with the lab's resource group when that's all it's missing.
 *  Null when the hint only names a command in passing, without the names it needs: those are words to read, not a line to type.
 *  A command that fails because of the lab's state still counts, since it's a real command. */
export function typedForm(st: State, cmd: string): string | null {
  if (runs(st, cmd)) return cmd;
  const withGroup = /^az /.test(cmd) && !/(\s-g\s|--resource-group)/.test(cmd) ? `${cmd} -g rg-lab` : null;
  return withGroup && runs(st, withGroup) ? withGroup : null;
}
export const runsAsTyped = (st: State, cmd: string) => typedForm(st, cmd) !== null;

/** What a read-only check prints against a copy of the lab as it is now, or null when it doesn't run cleanly. */
export function liveResult(st: State, cmd0: string, os: "linux" | "windows" = "linux"): string | null {
  if (!/^az /.test(cmd0) || !/\b(list|show|test-ip-flow|show-next-hop|test-connectivity|show-effective-route-table|list-effective-nsg)\b/.test(cmd0) || / (create|update|delete|add|remove|set|invoke)\b/.test(cmd0)) return null;
  const cmd = typedForm(st, cmd0);
  if (!cmd) return null;
  try {
    const r = run(structuredClone(st), cmd, newSession(os));
    if (r.error || r.meta) return null;
    if (!r.text.trim() || /^\[\s*\]$/.test(r.text.trim())) return "(Nothing. The list is empty.)";
    const lines = r.text.split("\n");
    return lines.length > 18 ? `${lines.slice(0, 18).join("\n")}\n… ${lines.length - 18} more lines` : r.text;
  } catch { return null; }
}
