/**
 * Tier 3: Cross-Feature Combinations — Editor Blocks + Math & Diagram Rendering & Fallback
 *
 * Combines ProseMirror document model, mathBlock (KaTeX), mermaid diagrams,
 * and authoritative fallback requirements:
 * - Complex mixed-content document (headers, paragraphs, math equations, diagrams)
 * - Safe fallback rendering with copy/edit actions when parser fails or is disabled
 * - Bidirectional edit: modifying fallback source recovers formatted visual representation
 */

import { describe, it, expect } from "vitest";
import {
  renderMathOrDiagram,
  validateMathBlock,
  validateMermaidNode,
  type MathBlockNode,
  type MermaidNode,
  type ProseMirrorBlock,
} from "../harness/document-blocks";

describe("Tier 3: Editor Blocks + Math & Diagram Fallback", () => {
  it("structures multi-block document with inline math equations and mermaid architectures", () => {
    const documentBlocks: ProseMirrorBlock[] = [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Distributed Systems Architecture" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "The network state converges according to theorem: " },
        ],
      },
      {
        type: "mathBlock",
        attrs: { latex: "\\lim_{t \\to \\infty} P(S_t = s) = \\pi(s)" },
      },
      {
        type: "mermaid",
        attrs: {
          code: `flowchart LR
    Client -->|worlds-sync.v1| Gateway
    Gateway --> Worker[Cloudflare Worker]
    Worker --> SQLite[(DocRoom SQLite)]`,
        },
      },
      {
        type: "callout",
        attrs: { tone: "tip" },
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "All connections verify Ed25519 signatures." }],
          },
        ],
      },
    ];

    expect(documentBlocks).toHaveLength(5);
    expect(documentBlocks[2].type).toBe("mathBlock");
    expect(documentBlocks[3].type).toBe("mermaid");

    // Render math block
    const mathNode = documentBlocks[2] as MathBlockNode;
    expect(validateMathBlock(mathNode).valid).toBe(true);
    const mathResult = renderMathOrDiagram(mathNode);
    expect(mathResult.status).toBe("success");
    expect(mathResult.renderedOutput).toContain("katex-html");

    // Render mermaid diagram
    const mermaidNode = documentBlocks[3] as MermaidNode;
    expect(validateMermaidNode(mermaidNode).valid).toBe(true);
    const mermaidResult = renderMathOrDiagram(mermaidNode);
    expect(mermaidResult.status).toBe("success");
    expect(mermaidResult.renderedOutput).toContain("mermaid-svg");
  });

  it("recovers from engine failure via interactive source editing", () => {
    // 1. Initial state: broken LaTeX formula
    const brokenMath: MathBlockNode = {
      type: "mathBlock",
      attrs: { latex: "\\sqrt{x + y" }, // Missing closing brace
    };

    const initialRender = renderMathOrDiagram(brokenMath);
    expect(initialRender.status).toBe("fallback");
    expect(initialRender.hasCopyAction).toBe(true);
    expect(initialRender.hasEditAction).toBe(true);
    expect(initialRender.fallbackSource).toBe("\\sqrt{x + y");

    // 2. User simulates clicking "Edit" and fixes the missing brace
    const fixedMath: MathBlockNode = {
      type: "mathBlock",
      attrs: { latex: initialRender.fallbackSource + "}" },
    };

    const recoveredRender = renderMathOrDiagram(fixedMath);
    expect(recoveredRender.status).toBe("success");
    expect(recoveredRender.renderedOutput).toContain("\\sqrt{x + y}");
  });

  it("handles platform-specific disabled vector rendering without hiding content", () => {
    // Platform where native SVG/vector renderer is unavailable
    const mermaidDiagram: MermaidNode = {
      type: "mermaid",
      attrs: {
        code: "graph TD\nA-->B",
      },
    };

    const simulatedDisabledRender = renderMathOrDiagram(mermaidDiagram, true);
    expect(simulatedDisabledRender.status).toBe("fallback");
    expect(simulatedDisabledRender.fallbackSource).toContain("graph TD");
    // Verify it never returns null or crashes
    expect(simulatedDisabledRender.fallbackSource).toBeDefined();
    expect(simulatedDisabledRender.hasCopyAction).toBe(true);
  });
});
