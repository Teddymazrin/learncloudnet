// Hash routing for the single-file preview build. Maps site paths to plain #names.
export function toHash(href: string): string {
  if (/^https?:/.test(href)) return href;
  const parts = href.split("/").filter(Boolean);
  return "#" + (parts.length ? parts.join("-") : "home");
}
export function currentPath(): string {
  const h = (typeof location !== "undefined" ? location.hash : "").replace(/^#/, "");
  if (!h || h === "home") return "/";
  if (h.startsWith("learn-")) return `/learn/${h.slice(6)}/`;
  return `/${h}/`;
}
export function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}
