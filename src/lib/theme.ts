// Color themes. Each is a set of CSS variables in globals.css under [data-theme]. Ultraviolet lives in :root; Dark is the default.
export const THEME_KEY = "learncloudnet.theme.v1";
export const THEMES = [
  { id: "ultraviolet", name: "Ultraviolet", swatch: ["#0C0718", "#A36BFF", "#38E1FF"] },
  { id: "cobalt", name: "Cobalt", swatch: ["#060B17", "#4D8DFF", "#FFC145"] },
  { id: "amber", name: "Amber CRT", swatch: ["#0D0904", "#FFB020", "#55D6FF"] },
  { id: "graphite", name: "Graphite", swatch: ["#0B0C0E", "#5AC8FA", "#FFD166"] },
  { id: "dark", name: "Dark", swatch: ["#0E0F11", "#4D9DFF", "#2EE6C5"] },
  { id: "dim", name: "Dim", swatch: ["#22272E", "#539BF5", "#C69026"] },
  { id: "ember", name: "Ember (cozy)", swatch: ["#17110D", "#E8875B", "#9CC5A1"] },
  { id: "cabin", name: "Cabin (cozy)", swatch: ["#0F1513", "#F2B061", "#D99AA5"] },
  { id: "daylight", name: "Daylight", swatch: ["#F4F6FA", "#2563EB", "#0E7490"] },
] as const;
export type ThemeId = (typeof THEMES)[number]["id"];
export const DEFAULT_THEME: ThemeId = "dark";

export function applyTheme(id: ThemeId) {
  if (id === "ultraviolet") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = id;
  try { localStorage.setItem(THEME_KEY, id); } catch { /* ignore */ }
  window.dispatchEvent(new Event("learncloudnet-theme"));
}

/** Storage keys used the site's earlier name. Copy each to the current prefix once, so saved progress and settings carry over. */
const LEGACY_PREFIX = "next-hop.";
const STORAGE_PREFIX = "learncloudnet.";
export const MIGRATE_STORAGE = `try{var s=localStorage,o=[];for(var i=0;i<s.length;i++){var k=s.key(i);if(k&&k.indexOf("${LEGACY_PREFIX}")===0)o.push(k)}o.forEach(function(k){var n="${STORAGE_PREFIX}"+k.slice(${LEGACY_PREFIX.length});if(s.getItem(n)===null)s.setItem(n,s.getItem(k));s.removeItem(k)})}catch(e){}`;

/** Runs before the page paints, so a saved theme never flashes the default first. Migrates old storage keys first. */
export const THEME_BOOT = `${MIGRATE_STORAGE}try{var t=localStorage.getItem("${THEME_KEY}");if(t==="ultraviolet")delete document.documentElement.dataset.theme;else if(t)document.documentElement.dataset.theme=t}catch(e){}`;
