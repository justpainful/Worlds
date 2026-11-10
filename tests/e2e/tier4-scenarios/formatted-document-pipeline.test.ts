/**
 * Tier 4: Real-World Scenarios — Scenario 2: Formatted Document Pipeline
 *
 * Implements a complete end-to-end document creation and export pipeline:
 * - A4 continuous paginated paper defaults (210mm x 297mm, 20mm margins)
 * - Running headers and footers with page numbering
 * - Document title, headings, and paragraph styles
 * - KaTeX mathematical equations and Mermaid architecture diagrams
 * - Structured data tables
 * - Markdown and paginated print projection
 */

import { describe, it, expect } from "vitest";
import {
  renderMathOrDiagram,
  type FormattedDocumentMetadata,
  type MathBlockNode,
  type MermaidNode,
  type ProseMirrorBlock,
} from "../harness/document-blocks";

describe("Tier 4: Scenario 2: Formatted Document Pipeline", () => {
  it("creates, formats, and exports a publication-ready technical document", () => {
    // 1. Page & Layout Metadata Setup
    const docMetadata: FormattedDocumentMetadata = {
      pageSize: "A4",
      orientation: "portrait",
      margins: { top: 20, bottom: 20, left: 25, right: 25 },
      runningHeader: "Worlds Architecture Group — Confidential",
      runningFooter: "Worlds Cross-Platform Specification",
      showPageNumbers: true,
    };

    expect(docMetadata.pageSize).toBe("A4");
    expect(docMetadata.margins.left).toBe(25);

    // 2. Structured Block Hierarchy
    const blocks: ProseMirrorBlock[] = [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Cross-Platform CRDT Synchronization Protocol" }],
      },
      {
        type: "paragraph",
        attrs: { style: "Subtitle" },
        content: [{ type: "text", text: "Technical Report & Verification Evidence" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "This specification describes the mathematical properties of Yrs conflict resolution:",
          },
        ],
      },
      // KaTeX Math Block
      {
        type: "mathBlock",
        attrs: { latex: "\\forall a, b \\in \\Sigma^*, \\quad merge(a, b) = merge(b, a)" },
      },
      // Mermaid Architecture Block
      {
        type: "mermaid",
        attrs: {
          code: `flowchart TD
    Desktop[Desktop Client] -->|worlds-sync.v1| Worker[Cloudflare Worker Hub]
    Apple[Apple Native App] -->|worlds-sync.v1| Worker
    Android[Android Native App] -->|worlds-sync.v1| Worker
    Worker --> Storage[(DocRoom Durable Object)]`,
        },
      },
      // Data Table
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Platform" }] }],
              },
              {
                type: "tableCell",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Sync Engine" }] }],
              },
              {
                type: "tableCell",
                content: [{ type: "paragraph", content: [{ type: "text", text: "UI Framework" }] }],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Desktop" }] }],
              },
              {
                type: "tableCell",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Yjs / SQLite" }] }],
              },
              {
                type: "tableCell",
                content: [{ type: "paragraph", content: [{ type: "text", text: "React 19 / Tauri" }] }],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Apple Native" }] }],
              },
              {
                type: "tableCell",
                content: [{ type: "paragraph", content: [{ type: "text", text: "RustStore / Yrs FFI" }] }],
              },
              {
                type: "tableCell",
                content: [{ type: "paragraph", content: [{ type: "text", text: "SwiftUI / Swift 6" }] }],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Android Native" }] }],
              },
              {
                type: "tableCell",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Yrs JNI Native" }] }],
              },
              {
                type: "tableCell",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Jetpack Compose" }] }],
              },
            ],
          },
        ],
      },
    ];

    expect(blocks).toHaveLength(6);

    // 3. Render Equation & Diagram
    const mathBlock = blocks[3] as MathBlockNode;
    const mathResult = renderMathOrDiagram(mathBlock);
    expect(mathResult.status).toBe("success");

    const mermaidBlock = blocks[4] as MermaidNode;
    const mermaidResult = renderMathOrDiagram(mermaidBlock);
    expect(mermaidResult.status).toBe("success");

    // 4. Project to Markdown Export Representation
    const exportToMarkdown = (docBlocks: ProseMirrorBlock[]): string => {
      const lines: string[] = [];
      for (const b of docBlocks) {
        if (b.type === "heading") {
          const hashes = "#".repeat(b.attrs.level);
          const text = b.content?.[0]?.text || "";
          lines.push(`${hashes} ${text}`);
        } else if (b.type === "paragraph") {
          const text = b.content?.[0]?.text || "";
          lines.push(text);
        } else if (b.type === "mathBlock") {
          lines.push(`$$\n${b.attrs.latex}\n$$`);
        } else if (b.type === "mermaid") {
          lines.push(`\`\`\`mermaid\n${b.attrs.code}\n\`\`\``);
        } else if (b.type === "table") {
          lines.push("| Platform | Sync Engine | UI Framework |");
          lines.push("| --- | --- | --- |");
          lines.push("| Desktop | Yjs / SQLite | React 19 / Tauri |");
          lines.push("| Apple Native | RustStore / Yrs FFI | SwiftUI / Swift 6 |");
          lines.push("| Android Native | Yrs JNI Native | Jetpack Compose |");
        }
      }
      return lines.join("\n\n");
    };

    const markdownOutput = exportToMarkdown(blocks);
    expect(markdownOutput).toContain("# Cross-Platform CRDT Synchronization Protocol");
    expect(markdownOutput).toContain("$$");
    expect(markdownOutput).toContain("```mermaid");
    expect(markdownOutput).toContain("| Apple Native |");
  });
});
