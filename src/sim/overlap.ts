import { cidr, overlap } from "./ip";
import type { State } from "./types";

/** Existing virtual networks whose address space overlaps these prefixes, as "vnet-a (10.1.0.0/16)", and whether any match exactly. */
export function overlapsWith(st: State, prefixes: string[], skip?: string): { list: string[]; exact: string[] } {
  const mine = prefixes.map((p) => cidr(p)).filter((c): c is NonNullable<typeof c> => !!c);
  const list: string[] = [], exact: string[] = [];
  Object.entries(st.vnets).filter(([n]) => n !== skip).forEach(([n, v]) => {
    const hit = v.prefixes.filter((p) => { const c = cidr(p); return !!c && mine.some((m) => overlap(m, c)); });
    if (!hit.length) return;
    list.push(`${n} (${hit.join(", ")})`);
    if (hit.some((p) => mine.some((m) => m.text === cidr(p)!.text))) exact.push(n);
  });
  return { list, exact };
}

/** One sentence for the overlap, or "" when there is none. */
export function overlapNote(st: State, prefixes: string[], skip?: string): string {
  const { list, exact } = overlapsWith(st, prefixes, skip);
  if (!list.length) return "";
  const what = exact.length ? `${prefixes.join(", ")} is the same range as ${exact.join(" and ")}` : `${prefixes.join(", ")} overlaps ${list.join(" and ")}`;
  return `${what}. Azure allows this, but networks with overlapping address space can't be peered.`;
}
