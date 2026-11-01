// Soft, short tones for progress moments. Generated with Web Audio, no files to load. Off with one tap.
const KEY = "learncloudnet.sound.v1";
let ctx: AudioContext | null = null;

export function soundOn(): boolean {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}
export function setSound(on: boolean) {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* ignore */ }
}

function tone(freq: number, at: number, len: number, gain: number) {
  const c = ctx!;
  const o = c.createOscillator(), g = c.createGain();
  o.type = "sine";
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + at);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + len);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + at);
  o.stop(c.currentTime + at + len + 0.05);
}

/** goal: one objective or connection came good. solved: the level is done. */
export function chime(kind: "goal" | "solved") {
  if (!soundOn() || typeof window === "undefined") return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    if (kind === "goal") { tone(660, 0, 0.35, 0.05); tone(880, 0.09, 0.45, 0.04); }
    else { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.11, 0.9, 0.045)); }
  } catch { /* audio unavailable */ }
}
