import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fieldHelp } from "@/lib/glossary";

describe("click to explain", () => {
  it("every Portal form field has an explanation", () => {
    const src = readFileSync("src/lib/forms.ts", "utf8");
    const labels = [...src.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
    expect(labels.filter((l) => !fieldHelp(l))).toEqual([]);
  });
});
