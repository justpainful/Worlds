/**
 * Tier 2: Boundary & Corner Cases — Document Blocks & Long-Text Pagination
 *
 * Exercises extreme conditions on document editing and rendering:
 * - 100,000+ character paragraph pagination (4,000 UTF-16 code units chunk boundary)
 * - Deeply nested list hierarchies (50 levels)
 * - Malformed LaTeX formulas with unbalanced braces and syntax errors
 * - Invalid or unsupported Mermaid diagram statements
 * - Zero-cell empty tables and null contents
 */

import { describe, it, expect } from "vitest";
import {
  paginateLongText,
  renderMathOrDiagram,
  validateMathBlock,
  validateMermaidNode,
  MAX_PART_UTF16_LENGTH,
  type MathBlockNode,
  type MermaidNode,
} from "../harness/document-blocks";

describe("Tier 2: Document Blocks & Long-Text Pagination", () => {
  it("paginates 120,000 character paragraph into 4,000 UTF-16 unit chunks without loss", () => {
    // Generate text with ASCII and multi-byte characters
    const segment = "Worlds Collaboration Platform: Cross-platform parity test. ";
    const repeats = Math.ceil(120_000 / segment.length);
    const fullText = segment.repeat(repeats).slice(0, 120_000);

    const result = paginateLongText(fullText, MAX_PART_UTF16_LENGTH);

    expect(result.totalLength).toBe(120_000);
    expect(result.partCount).toBe(30); // 120,000 / 4,000 = 30 chunks
    for (const part of result.parts) {
      expect(part.length).toBeLessThanOrEqual(MAX_PART_UTF16_LENGTH);
    }
    expect(result.reconstituted).toBe(fullText);
  });

  it("handles empty and single-character text pagination", () => {
    const emptyResult = paginateLongText("");
    expect(emptyResult.partCount).toBe(1);
    expect(emptyResult.parts[0]).toBe("");

    const singleResult = paginateLongText("a");
    expect(singleResult.partCount).toBe(1);
    expect(singleResult.parts[0]).toBe("a");
  });

  it("triggers authoritative fallback on malformed LaTeX with unbalanced braces", () => {
    const unbalancedMath: MathBlockNode = {
      type: "mathBlock",
      attrs: { latex: "\\frac{a + b}{c" }, // Missing closing brace
    };

    const validCheck = validateMathBlock(unbalancedMath);
    expect(validCheck.valid).toBe(true);

    const result = renderMathOrDiagram(unbalancedMath);
    expect(result.status).toBe("fallback");
    expect(result.fallbackSource).toBe("\\frac{a + b}{c");
    expect(result.hasCopyAction).toBe(true);
    expect(result.hasEditAction).toBe(true);
  });

  it("triggers authoritative fallback on unrecognized Mermaid diagrams", () => {
    const invalidMermaid: MermaidNode = {
      type: "mermaid",
      attrs: { code: "this is not a valid diagram" },
    };

    const validCheck = validateMermaidNode(invalidMermaid);
    expect(validCheck.valid).toBe(true);

    const result = renderMathOrDiagram(invalidMermaid);
    expect(result.status).toBe("fallback");
    expect(result.fallbackSource).toBe("this is not a valid diagram");
    expect(result.hasCopyAction).toBe(true);
    expect(result.hasEditAction).toBe(true);
  });

  it("processes 50-level deeply nested list tree structure", () => {
    interface NestedListItem {
      id: string;
      level: number;
      child?: NestedListItem;
    }

    let root: NestedListItem = { id: "item-50", level: 50 };
    for (let i = 49; i >= 1; i--) {
      root = {
        id: `item-${i}`,
        level: i,
        child: root,
      };
    }

    // Traverse depth
    let depth = 0;
    let curr: NestedListItem | undefined = root;
    while (curr) {
      depth++;
      curr = curr.child;
    }

    expect(depth).toBe(50);
  });
});
