import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LEVELS } from "@/content";
import { evalFlow } from "@/content/flows";
import { NetworkMap } from "@/components/NetworkMap";

const viewBox = (html: string) => html.match(/viewBox="([^"]+)"/)![1].split(" ").map(Number);
const wide = LEVELS.find((l) => Object.keys(l.setup().vnets).length >= 3 && (l.flows ?? []).length)!;

describe("mini map zooms to the problem", () => {
  it("shows every VNet without focus", () => {
    const st = wide.setup();
    const flows = (wide.flows ?? []).map((f) => evalFlow(st, f));
    expect(viewBox(renderToStaticMarkup(createElement(NetworkMap, { st, trace: null, flows })))[0]).toBe(0);
  });
  it("crops to the VNet that just changed and says how many are hidden", () => {
    const st = wide.setup();
    const order = st.layout.filter((n) => st.vnets[n]);
    const last = order[order.length - 1];
    const html = renderToStaticMarkup(createElement(NetworkMap, { st, trace: null, changed: new Set([`vnet:${last}`]), focus: true }));
    const [x, , w] = viewBox(html);
    expect(x).toBeGreaterThan(0);
    expect(w).toBeLessThan(500);
    expect(html).toContain(`‹ ${order.length - 1} more`);
  });
});
