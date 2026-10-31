// Color themes. Each is a set of CSS variables in globals.css under [data-theme]. Ultraviolet lives in :root; Dark is the default.
export const THEME_KEY = "next-hop.theme.v1";
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
  window.dispatchEvent(new Event("next-hop-theme"));
}

/** Runs before the page paints, so a saved theme never flashes the default first. */
export const THEME_BOOT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="ultraviolet")delete document.documentElement.dataset.theme;else if(t)document.documentElement.dataset.theme=t}catch(e){}`;
