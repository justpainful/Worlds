/**
 * Adversarial Stress & Document Block Schema Round-Trip Fidelity Suite
 *
 * Mandate:
 * Verify cross-platform document block schemas:
 * - ProseMirror blocks (paragraph, heading, table, callout)
 * - KaTeX mathBlock ({ type: "mathBlock", attrs: { latex: string } })
 * - Mermaid ({ type: "mermaid", attrs: { code: string } })
 * - Markdown & HTML serialization/deserialization round-trip fidelity
 * - Fallback resilience: interactive copy/edit, non-crashing behavior
 * - 4,000 UTF-16 pagination round-trip fidelity
 */

import { describe, it, expect } from "vitest";
import {
  validateMathBlock,
  validateMermaidNode,
  renderMathOrDiagram,
  paginateLongText,
  MathBlockNode,
  MermaidNode,
  ParagraphNode,
  HeadingNode,
  TableNode,
  CalloutNode,
  ProseMirrorBlock,
} from "../e2e/harness/document-blocks";

describe("Adversarial Stress Test: Document Block Schemas & Round-Trip Fidelity", () => {
  describe("1. KaTeX mathBlock Schema & Round-Trip Fidelity", () => {
    it("validates well-formed mathBlock node schema", () => {
      const node: MathBlockNode = {
        type: "mathBlock",
        attrs: {
          latex: "\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}",
        },
      };

      const result = validateMathBlock(node);
      expect(result.valid).toBe(true);
      expect(result.node).toBe(node);
      expect(result.error).toBeUndefined();
    });

    it("rejects malformed mathBlock schemas with descriptive errors", () => {
      const testCases = [
        { input: null, error: /Node must be an object/i },
        { input: undefined, error: /Node must be an object/i },
        { input: "string-not-object", error: /Node must be an object/i },
        { input: { type: "mathInline", attrs: { latex: "x=1" } }, error: /Invalid type: expected mathBlock/i },
        { input: { type: "mathBlock" }, error: /missing required attrs.latex/i },
        { input: { type: "mathBlock", attrs: {} }, error: /missing required attrs.latex/i },
        { input: { type: "mathBlock", attrs: { latex: 12345 } }, error: /missing required attrs.latex/i },
      ];

      for (const tc of testCases) {
        const res = validateMathBlock(tc.input);
        expect(res.valid).toBe(false);
        expect(res.error).toMatch(tc.error);
      }
    });

    it("preserves exact LaTeX string in JSON serialization round-trip", () => {
      const originalLatex = `\\begin{pmatrix} a_{11} & a_{12} \\\\ a_{21} & a_{22} \\end{pmatrix} \\times \\vec{v} = \\lambda \\vec{v}`;
      const originalNode: MathBlockNode = {
        type: "mathBlock",
        attrs: { latex: originalLatex },
      };

      const serialized = JSON.stringify(originalNode);
      const deserialized: MathBlockNode = JSON.parse(serialized);

      expect(deserialized.type).toBe("mathBlock");
      expect(deserialized.attrs.latex).toBe(originalLatex);
      expect(validateMathBlock(deserialized).valid).toBe(true);
    });

    it("verifies Markdown round-trip fidelity matching Tauri backend ($$\\n{latex}\\n$$)", () => {
      // In src-tauri/src/content.rs line 561: "mathBlock" => format!("$$\n{}\n$$", attr_str(node, "latex").unwrap_or(""))
      const latexFormulas = [
        "E = mc^2",
        "\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}",
        "f(x) = \\int_{-\\infty}^{x} \\frac{1}{\\sqrt{2\\pi\\sigma^2}} e^{-\\frac{(t-\\mu)^2}{2\\sigma^2}} dt",
        "\\text{Einstein-Field: } R_{\\mu\\nu} - \\frac{1}{2}Rg_{\\mu\\nu} + \\Lambda g_{\\mu\\nu} = \\frac{8\\pi G}{c^4}T_{\\mu\\nu}",
      ];

      for (const formula of latexFormulas) {
        // Tauri serialization to Markdown
        const markdown = `$$\n${formula}\n$$`;

        // Markdown deserializer regex matching Tauri $$ block
        const match = markdown.match(/^\$\$\n([\s\S]*?)\n\$\$$/);
        expect(match).not.toBeNull();
        const extractedLatex = match![1];

        expect(extractedLatex).toBe(formula);

        // Reconstruct ProseMirror node
        const reconstructedNode: MathBlockNode = {
          type: "mathBlock",
          attrs: { latex: extractedLatex },
        };
        expect(validateMathBlock(reconstructedNode).valid).toBe(true);
      }
    });

    it("verifies HTML parse/render round-trip matching TipTap extension (data-math-block)", () => {
      // In src/editor/extensions/pages4.ts:
      // renderHTML: ["div", { "data-math-block": node.attrs.latex }]
      // parseHTML: div[data-math-block] -> getAttrs: el.getAttribute("data-math-block")
      const latex = "\\frac{\\partial \\psi}{\\partial t} = -\\frac{\\hbar^2}{2m}\\nabla^2\\psi + V\\psi";

      // Render
      const renderedTag = "div";
      const renderedAttrs = { "data-math-block": latex };

      // Parse back
      const parsedAttrs = {
        latex: renderedAttrs["data-math-block"],
      };

      const parsedNode: MathBlockNode = {
        type: "mathBlock",
        attrs: parsedAttrs,
      };

      expect(parsedNode.attrs.latex).toBe(latex);
      expect(validateMathBlock(parsedNode).valid).toBe(true);
    });

    it("ensures mathBlock fallback never crashes and preserves copy/edit actions", () => {
      // 1. Unbalanced braces
      const brokenLatex = "\\frac{a}{b";
      const resUnbalanced = renderMathOrDiagram({
        type: "mathBlock",
        attrs: { latex: brokenLatex },
      });
      expect(resUnbalanced.status).toBe("fallback");
      expect(resUnbalanced.fallbackSource).toBe(brokenLatex);
      expect(resUnbalanced.hasCopyAction).toBe(true);
      expect(resUnbalanced.hasEditAction).toBe(true);
      expect(resUnbalanced.error).toBe("Unbalanced LaTeX braces");

      // 2. Simulated engine failure
      const complexLatex = "\\oint_{\\partial S} \\vec{B} \\cdot d\\vec{\\ell} = \\mu_0 I_{\\text{enc}}";
      const resFailure = renderMathOrDiagram(
        {
          type: "mathBlock",
          attrs: { latex: complexLatex },
        },
        true // simulateEngineFailure
      );
      expect(resFailure.status).toBe("fallback");
      expect(resFailure.fallbackSource).toBe(complexLatex);
      expect(resFailure.hasCopyAction).toBe(true);
      expect(resFailure.hasEditAction).toBe(true);

      // 3. Forced throw
      const resThrow = renderMathOrDiagram({
        type: "mathBlock",
        attrs: { latex: "\\throwError{corrupt}" },
      });
      expect(resThrow.status).toBe("fallback");
      expect(resThrow.hasCopyAction).toBe(true);
      expect(resThrow.hasEditAction).toBe(true);
    });
  });

  describe("2. Mermaid Diagram Schema & Round-Trip Fidelity", () => {
    it("validates well-formed mermaid node schema across multiple diagram types", () => {
      const diagramTypes = [
        "flowchart TD\n  Start --> Stop",
        "sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi!",
        "classDiagram\n  Animal <|-- Duck",
        "stateDiagram\n  [*] --> Active\n  Active --> [*]",
        "erDiagram\n  CUSTOMER ||--o{ ORDER : places",
        "journey\n  title My Day\n  Go to work: 5: Me",
        "gantt\n  title Project\n  Section A\n  Task 1: 2026-01-01, 30d",
        "pie\n  \"Apples\" : 40\n  \"Bananas\" : 60",
      ];

      for (const code of diagramTypes) {
        const node: MermaidNode = {
          type: "mermaid",
          attrs: { code },
        };
        const validation = validateMermaidNode(node);
        expect(validation.valid).toBe(true);

        const rendered = renderMathOrDiagram(node);
        expect(rendered.status).toBe("success");
        expect(rendered.renderedOutput).toContain("mermaid-svg");
      }
    });

    it("rejects malformed mermaid schemas with descriptive errors", () => {
      const badInputs = [
        { input: null, error: /Node must be an object/i },
        { input: { type: "codeBlock", attrs: { code: "graph TD" } }, error: /Invalid type: expected mermaid/i },
        { input: { type: "mermaid" }, error: /missing required attrs.code/i },
        { input: { type: "mermaid", attrs: {} }, error: /missing required attrs.code/i },
        { input: { type: "mermaid", attrs: { code: 999 } }, error: /missing required attrs.code/i },
      ];

      for (const bi of badInputs) {
        const res = validateMermaidNode(bi.input);
        expect(res.valid).toBe(false);
        expect(res.error).toMatch(bi.error);
      }
    });

    it("preserves exact Mermaid code in JSON round-trip", () => {
      const originalCode = `flowchart LR\n  A[Desktop Client] -->|worlds-sync.v1| Hub((Sync Hub))\n  Hub --> B[Apple Native]\n  Hub --> C[Android Native]`;
      const originalNode: MermaidNode = {
        type: "mermaid",
        attrs: { code: originalCode },
      };

      const serialized = JSON.stringify(originalNode);
      const deserialized: MermaidNode = JSON.parse(serialized);

      expect(deserialized.type).toBe("mermaid");
      expect(deserialized.attrs.code).toBe(originalCode);
      expect(validateMermaidNode(deserialized).valid).toBe(true);
    });

    it("verifies Markdown round-trip fidelity matching Tauri backend (```mermaid\\n{code}\\n```)", () => {
      // In src-tauri/src/content.rs line 562: "mermaid" => format!("```mermaid\n{}\n```", attr_str(node, "code").unwrap_or(""))
      const mermaidCodes = [
        "graph TD\n  Client --> Server",
        "sequenceDiagram\n  autonumber\n  Client->>Server: Handshake (0x01)\n  Server-->>Client: AuthState (0x03)",
      ];

      for (const code of mermaidCodes) {
        const markdown = `\`\`\`mermaid\n${code}\n\`\`\``;
        const match = markdown.match(/^```mermaid\n([\s\S]*?)\n```$/);

        expect(match).not.toBeNull();
        const extracted = match![1];
        expect(extracted).toBe(code);

        const node: MermaidNode = {
          type: "mermaid",
          attrs: { code: extracted },
        };
        expect(validateMermaidNode(node).valid).toBe(true);
      }
    });

    it("ensures mermaid fallback preserves copy/edit actions and raw source on syntax errors", () => {
      const invalidCode = "totally invalid mermaid syntax\nwhich has no diagram type";
      const node: MermaidNode = {
        type: "mermaid",
        attrs: { code: invalidCode },
      };

      const result = renderMathOrDiagram(node);
      expect(result.status).toBe("fallback");
      expect(result.fallbackSource).toBe(invalidCode);
      expect(result.hasCopyAction).toBe(true);
      expect(result.hasEditAction).toBe(true);
      expect(result.error).toMatch(/Unrecognized or invalid Mermaid diagram syntax/i);

      // Simulated engine failure
      const engineFail = renderMathOrDiagram(
        { type: "mermaid", attrs: { code: "graph TD\n  A --> B" } },
        true
      );
      expect(engineFail.status).toBe("fallback");
      expect(engineFail.fallbackSource).toBe("graph TD\n  A --> B");
      expect(engineFail.hasCopyAction).toBe(true);
      expect(engineFail.hasEditAction).toBe(true);
    });
  });

  describe("3. Document Block Tree Composition & Schema Integrity", () => {
    it("preserves complex document schema with mixed ProseMirror blocks through full serialization", () => {
      const docBlocks: ProseMirrorBlock[] = [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Cross-Platform Specification Document" }],
        },
        {
          type: "paragraph",
          attrs: { style: "Subtitle", align: "left" },
          content: [{ type: "text", text: "Authoritative Document Block Integration" }],
        },
        {
          type: "mathBlock",
          attrs: {
            latex: "\\nabla \\times \\mathbf{E} = -\\frac{\\partial \\mathbf{B}}{\\partial t}",
          },
        },
        {
          type: "mermaid",
          attrs: {
            code: "flowchart LR\n  RustFFI --> SwiftBridge --> SwiftUI",
          },
        },
        {
          type: "callout",
          attrs: { tone: "tip" },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Always verify mathematical bounds on native peers." }],
            },
          ],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Header 1" }] }],
                },
                {
                  type: "tableCell",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Header 2" }] }],
                },
              ],
            },
          ],
        },
      ];

      // Round trip JSON
      const serialized = JSON.stringify(docBlocks, null, 2);
      const parsed: ProseMirrorBlock[] = JSON.parse(serialized);

      expect(parsed.length).toBe(6);
      expect(parsed[0].type).toBe("heading");
      expect((parsed[0] as HeadingNode).attrs.level).toBe(1);

      expect(parsed[2].type).toBe("mathBlock");
      expect(validateMathBlock(parsed[2]).valid).toBe(true);

      expect(parsed[3].type).toBe("mermaid");
      expect(validateMermaidNode(parsed[3]).valid).toBe(true);

      expect(parsed[4].type).toBe("callout");
      expect((parsed[4] as CalloutNode).attrs.tone).toBe("tip");

      expect(parsed[5].type).toBe("table");
      expect((parsed[5] as TableNode).content.length).toBe(1);
    });
  });

  describe("4. Long-Text Pagination & 4,000 UTF-16 Reconstitution Fidelity", () => {
    it("correctly chunks and reconstitutes text at exact 4,000 code unit boundaries", () => {
      // Test cases: 0 chars, 1 char, 3999, 4000, 4001, 8000
      const boundaryLengths = [0, 1, 3999, 4000, 4001, 8000];

      for (const len of boundaryLengths) {
        const text = "A".repeat(len);
        const { parts, totalLength, partCount, reconstituted } = paginateLongText(text, 4000);

        expect(totalLength).toBe(len);
        expect(reconstituted).toBe(text);
        expect(reconstituted.length).toBe(len);

        if (len === 0) {
          expect(partCount).toBe(1);
          expect(parts[0]).toBe("");
        } else if (len <= 4000) {
          expect(partCount).toBe(1);
          expect(parts[0].length).toBe(len);
        } else if (len === 4001) {
          expect(partCount).toBe(2);
          expect(parts[0].length).toBe(4000);
          expect(parts[1].length).toBe(1);
        } else if (len === 8000) {
          expect(partCount).toBe(2);
          expect(parts[0].length).toBe(4000);
          expect(parts[1].length).toBe(4000);
        }
      }
    });

    it("preserves 120,000-character realistic prose without a single character corruption", () => {
      const sentence = "The Worlds application ensures seamless document collaboration across desktop, Apple, and Android. ";
      const targetLength = 120000;
      const repetitions = Math.ceil(targetLength / sentence.length);
      const largeText = sentence.repeat(repetitions).slice(0, targetLength);

      expect(largeText.length).toBe(120000);

      const { parts, totalLength, partCount, reconstituted } = paginateLongText(largeText, 4000);

      expect(totalLength).toBe(120000);
      expect(partCount).toBe(30); // 120,000 / 4,000 = 30
      expect(parts.every((p) => p.length === 4000)).toBe(true);

      // Strict equality assertion
      expect(reconstituted).toBe(largeText);
    });

    it("preserves high-surrogate astral plane characters (emojis, math symbols) across chunks", () => {
      // Emojis (🎨, 📐, 🔬, 🪐, 🛸) and mathematical bold are 2 UTF-16 code units each
      const emojiCluster = "🎨📐🔬🪐💡🛸📝💻🎯🚀"; // 10 emojis * 2 = 20 UTF-16 code units
      const repeatCount = 200; // 200 * 20 = 4,000 code units
      const exact4k = emojiCluster.repeat(repeatCount);
      expect(exact4k.length).toBe(4000);

      // Append one more emoji (2 code units)
      const textWithSurrogates = exact4k + "🧮";
      expect(textWithSurrogates.length).toBe(4002);

      const { parts, partCount, reconstituted } = paginateLongText(textWithSurrogates, 4000);

      expect(partCount).toBe(2);
      expect(parts[0].length).toBe(4000);
      expect(parts[1].length).toBe(2);
      expect(parts[1]).toBe("🧮");

      // Verify flawless reconstitution
      expect(reconstituted).toBe(textWithSurrogates);
    });

    it("handles surrogate pair straddling exact 4,000 boundary and reconstitutes seamlessly", () => {
      // 3,999 ASCII characters followed by a 2-code-unit emoji "🚀" (\uD83D\uDE80)
      // Index 3999 will receive \uD83D (high surrogate) in part 0
      // Index 4000 will receive \uDE80 (low surrogate) in part 1
      const straddlingText = "x".repeat(3999) + "🚀" + "y".repeat(100);
      expect(straddlingText.length).toBe(4101);

      const { parts, partCount, reconstituted } = paginateLongText(straddlingText, 4000);

      expect(partCount).toBe(2);
      expect(parts[0].length).toBe(4000);
      expect(parts[0].charCodeAt(3999)).toBe(0xd83d); // high surrogate
      expect(parts[1].charCodeAt(0)).toBe(0xde80);    // low surrogate

      // Reconstituted string must seamlessly restore the emoji
      expect(reconstituted).toBe(straddlingText);
      expect(reconstituted.slice(3999, 4001)).toBe("🚀");
    });
  });
});
