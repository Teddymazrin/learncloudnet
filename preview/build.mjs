// Builds a single self-contained HTML preview of the site (hash routing, no server).
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outdir = path.join(root, "preview", "dist");
mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: [path.join(here, "entry.tsx")],
  bundle: true, minify: process.env.DEV ? false : true, format: "iife", target: "es2020", jsx: "automatic",
  outdir, entryNames: "app",
  define: { "process.env.NODE_ENV": process.env.DEV ? '"development"' : '"production"' },
  alias: {
    "@": path.join(root, "src"),
    "next/link": path.join(here, "shims/link.tsx"),
    "next/navigation": path.join(here, "shims/navigation.ts"),
  },
  loader: { ".css": "css" },
  logLevel: "warning",
});

const js = readFileSync(path.join(outdir, "app.js"), "utf8").replace(/<\/script/g, "<\\/script");
const css = readFileSync(path.join(outdir, "app.css"), "utf8");
const fonts = "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap";
const html = `<title>Next Hop</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fonts}">
<style>${css}</style>
<div id="root"></div>
<script>${js}</script>
`;
writeFileSync(path.join(outdir, "next-hop-preview.html"), html);
console.log("wrote", path.join(outdir, "next-hop-preview.html"), Math.round(html.length / 1024) + " KB");
