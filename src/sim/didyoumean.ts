// "Did you mean ...?" for commands the simulator doesn't know: a typo, a missing word, or a group without its verb.

/** Edit distance between two strings (insert, delete, substitute). */
export function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/** The closest known word, if it's close enough to be a typo. */
export function closestWord(word: string, known: readonly string[]): string | null {
  let best: string | null = null, bestD = Infinity;
  for (const k of known) { const d = distance(word.toLowerCase(), k); if (d < bestD) { best = k; bestD = d; } }
  return best !== null && bestD > 0 && bestD <= Math.max(1, Math.floor(word.length / 3)) ? best : null;
}

/** A hint line for an unknown az command path, or "" when nothing is close. */
export function suggestCommand(typed: string, supported: readonly string[]): string {
  const t = typed.trim().replace(/\s+/g, " ").toLowerCase();
  // A group typed without its last word, like "az network nsg rule".
  const next = new Set(supported.filter((c) => c.startsWith(t + " ")).map((c) => c.slice(t.length + 1).split(" ")[0]));
  if (next.size) return `lab: '${t}' needs one more word: ${[...next].sort().join(", ")}.`;
  // Forgot "network", like "az nsg rule list".
  const withNetwork = t.replace(/^az /, "az network ");
  if (supported.includes(withNetwork)) return `lab: did you mean '${withNetwork}'?`;
  // A typo: same number of words, each one close to the command's word. Never guess a different verb.
  let best = "", bestD = Infinity;
  for (const c of supported) {
    const cw = c.split(" ");
    for (const v of [t, withNetwork]) {
      const vw = v.split(" ");
      if (vw.length !== cw.length) continue;
      let sum = 0;
      for (let i = 0; i < vw.length && sum < Infinity; i++) {
        const d = distance(vw[i], cw[i]);
        sum = d <= Math.max(1, Math.floor(cw[i].length / 3)) ? sum + d : Infinity;
      }
      if (sum < bestD) { best = c; bestD = sum; }
    }
  }
  if (bestD < Infinity) return `lab: did you mean '${best}'?`;
  // The group is right but the last word isn't one the simulator has: list what it does have.
  for (const v of [t, withNetwork]) {
    const group = v.split(" ").slice(0, -1).join(" ");
    const verbs = new Set(supported.filter((c) => c.startsWith(group + " ") && c.split(" ").length === v.split(" ").length).map((c) => c.split(" ").at(-1)!));
    if (group.split(" ").length > 2 && verbs.size) return `lab: '${group}' here has: ${[...verbs].sort().join(", ")}.`;
  }
  return "";
}
