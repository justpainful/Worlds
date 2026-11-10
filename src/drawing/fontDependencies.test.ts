import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  if (typeof globalThis.document === "undefined") {
    globalThis.document = {
      createElement: () => ({ getContext: () => null, width: 0, height: 0 }),
      fonts: { load: async () => {}, [Symbol.iterator]: function*() {} },
    } as any;
  }
});

import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { FontDependencies } from "./FontDependencies";
import { newScene, newNode, newLayer } from "./model";

describe("FontDependencies (F07.10, R09.07)", () => {
  it("renders null when scenes have no text nodes", () => {
    const scene = newScene();
    const html = renderToStaticMarkup(React.createElement(FontDependencies, { scenes: [scene], arabic: false }));
    expect(html).toBe("");
  });

  it("extracts font family names and displays font rights guidance in project mode", () => {
    const scene = newScene();
    const layer = newLayer("Layer 1");
    scene.layers[layer.id] = layer;
    scene.layerOrder = [layer.id];

    const textNode = newNode("text", layer.id, null, { x: 0, y: 0, w: 200, h: 50 });
    textNode.text = "Sample Title";
    textNode.textStyle = {
      ...textNode.textStyle,
      font: "IBM Plex Sans Arabic",
      size: 24,
      weight: 600,
      italic: false,
      color: "#000000",
      direction: "auto",
    };
    scene.nodes[textNode.id] = textNode;
    scene.nodeOrder = [textNode.id];

    const html = renderToStaticMarkup(React.createElement(FontDependencies, { scenes: [scene], arabic: false, mode: "project" }));
    expect(html).toContain("IBM Plex Sans Arabic");
    expect(html).toContain("Fonts in the source");
    expect(html).toContain("Font names and settings are retained, but font files are not embedded");
    expect(html).toContain("Check each font&#x27;s license before sharing");
  });

  it("renders Arabic localization and image mode notice accurately", () => {
    const scene = newScene();
    const layer = newLayer("Layer 1");
    scene.layers[layer.id] = layer;
    scene.layerOrder = [layer.id];

    const textNode = newNode("text", layer.id, null, { x: 0, y: 0, w: 200, h: 50 });
    textNode.text = "عنوان تجريبي";
    textNode.textStyle = {
      ...textNode.textStyle,
      font: "Amiri",
      size: 20,
      weight: 400,
      italic: false,
      color: "#111111",
      direction: "rtl",
    };
    scene.nodes[textNode.id] = textNode;
    scene.nodeOrder = [textNode.id];

    const html = renderToStaticMarkup(React.createElement(FontDependencies, { scenes: [scene], arabic: true, mode: "image" }));
    expect(html).toContain("الخطوط في المصدر");
    expect(html).toContain("Amiri");
    expect(html).toContain("تُرسم الصورة بالخط المتاح على هذا الجهاز");
    expect(html).toContain("راجع ترخيص الخط قبل مشاركة الصورة");
  });

  it("deduplicates font names across multiple nodes and scenes", () => {
    const scene1 = newScene();
    const scene2 = newScene();
    const layer1 = newLayer("L1");
    scene1.layers[layer1.id] = layer1;
    scene1.layerOrder = [layer1.id];

    const n1 = newNode("text", layer1.id, null, { x: 0, y: 0, w: 100, h: 40 });
    n1.textStyle = { ...n1.textStyle, font: "CustomFont", size: 16, weight: 400, italic: false, color: "#000", direction: "ltr" };
    const n2 = newNode("text", layer1.id, null, { x: 0, y: 50, w: 100, h: 40 });
    n2.textStyle = { ...n2.textStyle, font: "CustomFont", size: 24, weight: 700, italic: true, color: "#000", direction: "ltr" };
    scene1.nodes[n1.id] = n1;
    scene1.nodes[n2.id] = n2;
    scene1.nodeOrder = [n1.id, n2.id];

    const layer2 = newLayer("L2");
    scene2.layers[layer2.id] = layer2;
    scene2.layerOrder = [layer2.id];
    const n3 = newNode("text", layer2.id, null, { x: 0, y: 0, w: 100, h: 40 });
    n3.textStyle = { ...n3.textStyle, font: "CustomFont", size: 12, weight: 300, italic: false, color: "#000", direction: "ltr" };
    scene2.nodes[n3.id] = n3;
    scene2.nodeOrder = [n3.id];

    const html = renderToStaticMarkup(React.createElement(FontDependencies, { scenes: [scene1, scene2], arabic: false }));
    // CustomFont appears only once in the names list
    const matchCount = (html.match(/CustomFont/g) || []).length;
    expect(matchCount).toBe(1);
  });
});
