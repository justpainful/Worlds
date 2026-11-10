/**
 * E2E Test Harness: Document Blocks, Math/Mermaid Contracts & Pagination
 *
 * Implements authoritative block contracts from PROJECT.md § Interface Contracts:
 * - ProseMirror / Markdown block schemas (headings, lists, tables, callouts, math, diagrams)
 * - mathBlock: { type: "mathBlock", attrs: { latex: string } }
 * - mermaid: { type: "mermaid", attrs: { code: string } }
 * - Fallback requirement: If native rendering fails, render syntax-highlighted source
 *   with interactive copy/edit action, never crash or hide content.
 * - Formatted Document: A4 paper layout, running header/footer.
 * - Long-text chunking: 4,000 UTF-16 code units per part for Android resilience.
 */

export const MAX_PART_UTF16_LENGTH = 4000;

export interface MathBlockNode {
  type: "mathBlock";
  attrs: {
    latex: string;
  };
}

export interface MermaidNode {
  type: "mermaid";
  attrs: {
    code: string;
  };
}

export interface TextNode {
  type: "text";
  text: string;
  marks?: Array<{
    type: "bold" | "italic" | "code" | "highlight" | "link";
    attrs?: Record<string, unknown>;
  }>;
}

export interface ParagraphNode {
  type: "paragraph";
  content?: Array<TextNode | MathBlockNode>;
  attrs?: {
    align?: "left" | "center" | "right" | "justify";
    style?: "Normal" | "Title" | "Subtitle" | "Caption";
  };
}

export interface HeadingNode {
  type: "heading";
  attrs: {
    level: 1 | 2 | 3 | 4 | 5 | 6;
  };
  content?: TextNode[];
}

export interface TableNode {
  type: "table";
  content: Array<{
    type: "tableRow";
    content: Array<{
      type: "tableCell";
      content: ParagraphNode[];
    }>;
  }>;
}

export interface CalloutNode {
  type: "callout";
  attrs: {
    tone?: "note" | "warning" | "tip" | "danger";
  };
  content: ParagraphNode[];
}

export type ProseMirrorBlock =
  | ParagraphNode
  | HeadingNode
  | MathBlockNode
  | MermaidNode
  | TableNode
  | CalloutNode;

export interface FormattedDocumentMetadata {
  pageSize: "A4" | "Letter";
  orientation: "portrait" | "landscape";
  margins: { top: number; bottom: number; left: number; right: number }; // mm
  runningHeader?: string;
  runningFooter?: string;
  showPageNumbers: boolean;
}

export interface RenderResult {
  status: "success" | "fallback" | "error";
  renderedOutput?: string;
  fallbackSource?: string;
  hasCopyAction?: boolean;
  hasEditAction?: boolean;
  error?: string;
}

/**
 * Validates mathBlock node contracts
 */
export function validateMathBlock(node: unknown): {
  valid: boolean;
  node?: MathBlockNode;
  error?: string;
} {
  if (!node || typeof node !== "object") {
    return { valid: false, error: "Node must be an object" };
  }
  const n = node as MathBlockNode;
  if (n.type !== "mathBlock") {
    return { valid: false, error: `Invalid type: expected mathBlock, got ${n.type}` };
  }
  if (!n.attrs || typeof n.attrs.latex !== "string") {
    return { valid: false, error: "mathBlock missing required attrs.latex string" };
  }
  return { valid: true, node: n };
}

/**
 * Validates mermaid diagram node contracts
 */
export function validateMermaidNode(node: unknown): {
  valid: boolean;
  node?: MermaidNode;
  error?: string;
} {
  if (!node || typeof node !== "object") {
    return { valid: false, error: "Node must be an object" };
  }
  const n = node as MermaidNode;
  if (n.type !== "mermaid") {
    return { valid: false, error: `Invalid type: expected mermaid, got ${n.type}` };
  }
  if (!n.attrs || typeof n.attrs.code !== "string") {
    return { valid: false, error: "mermaid missing required attrs.code string" };
  }
  return { valid: true, node: n };
}

/**
 * Hybrid Math/Diagram Renderer with authoritative fallback protection.
 * If KaTeX/Mermaid parsing fails or native renderer cannot load, falls back
 * to syntax-highlighted source with interactive copy & edit action.
 */
export function renderMathOrDiagram(
  node: MathBlockNode | MermaidNode,
  simulateEngineFailure = false
): RenderResult {
  if (node.type === "mathBlock") {
    const latex = node.attrs.latex.trim();
    if (simulateEngineFailure || latex.includes("\\throwError") || latex.length === 0) {
      // Must provide graceful fallback without crashing
      return {
        status: "fallback",
        fallbackSource: latex,
        hasCopyAction: true,
        hasEditAction: true,
      };
    }
    // Simple verification check: check balanced braces
    let balance = 0;
    for (const ch of latex) {
      if (ch === "{") balance++;
      if (ch === "}") balance--;
      if (balance < 0) break;
    }
    if (balance !== 0) {
      return {
        status: "fallback",
        fallbackSource: latex,
        hasCopyAction: true,
        hasEditAction: true,
        error: "Unbalanced LaTeX braces",
      };
    }
    return {
      status: "success",
      renderedOutput: `<span class="katex-html">${latex}</span>`,
    };
  }

  if (node.type === "mermaid") {
    const code = node.attrs.code.trim();
    if (
      simulateEngineFailure ||
      !code.match(/^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie)/i)
    ) {
      return {
        status: "fallback",
        fallbackSource: code,
        hasCopyAction: true,
        hasEditAction: true,
        error: "Unrecognized or invalid Mermaid diagram syntax",
      };
    }
    return {
      status: "success",
      renderedOutput: `<svg class="mermaid-svg" data-code="${encodeURIComponent(code)}"></svg>`,
    };
  }

  return { status: "error", error: "Unknown node type" };
}

/**
 * Splits large paragraphs into chunks bounded by maxChunkLength (default 4,000 UTF-16 code units),
 * preserving entire draft integrity across Android and desktop editors.
 */
export function paginateLongText(
  text: string,
  maxChunkLength: number = MAX_PART_UTF16_LENGTH
): {
  parts: string[];
  totalLength: number;
  partCount: number;
  reconstituted: string;
} {
  const parts: string[] = [];
  let index = 0;
  while (index < text.length) {
    parts.push(text.slice(index, index + maxChunkLength));
    index += maxChunkLength;
  }
  if (parts.length === 0) {
    parts.push("");
  }
  return {
    parts,
    totalLength: text.length,
    partCount: parts.length,
    reconstituted: parts.join(""),
  };
}
