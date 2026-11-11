import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown, parseMarkdownInline } from "./markdown.js";

test("parses Markdown headings, paragraphs, and lists into safe text blocks", () => {
  assert.deepEqual(parseMarkdown("## Findings\n\nFees are **recorded**.\n- First point\n- Second point"), [
    { type: "heading", level: 2, text: "Findings" },
    { type: "paragraph", text: "Fees are **recorded**." },
    { type: "list", ordered: false, items: ["First point", "Second point"] },
  ]);
  assert.deepEqual(parseMarkdownInline("**bold** and *emphasis*"), [
    { type: "strong", text: "bold" },
    { type: "text", text: " and " },
    { type: "emphasis", text: "emphasis" },
  ]);
});

test("parses Markdown comparison tables without interpreting cell HTML", () => {
  assert.deepEqual(parseMarkdown("| Item | Fee |\n| --- | ---: |\n| Payment | **2.00 USD**"), [
    { type: "table", headers: ["Item", "Fee"], rows: [["Payment", "**2.00 USD**"]] },
  ]);
  assert.deepEqual(parseMarkdownInline("<script>alert(1)</script>"), [
    { type: "text", text: "<script>alert(1)</script>" },
  ]);
});
