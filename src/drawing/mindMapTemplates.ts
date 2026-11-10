import { api } from "../lib/api";
import {
  DEFAULT_PAINT,
  DEFAULT_TEXT,
  DRAWING_SCHEMA,
  newFrame,
  newLayer,
  newNode,
  validateScene,
  type DrawingNode,
  type DrawingScene,
  type Shape,
} from "./model";
import { edit, sceneChanges } from "./operations";

export interface VisualCanvasPreset {
  key: string;
  title: string;
  icon: string;
  badge: string;
  description: string;
  build: () => DrawingScene;
}

function baseScene(title: string, w = 1600, h = 1000, bg = "#fbfaf7"): {
  scene: DrawingScene;
  frameId: string;
  layerId: string;
  add: (node: DrawingNode) => DrawingNode;
} {
  const frame = newFrame(title, { x: 0, y: 0, w, h });
  frame.background = bg;
  frame.grid = { visible: true, size: 32, snap: true };
  const layer = newLayer("Mind Map");
  const scene: DrawingScene = {
    schema: DRAWING_SCHEMA,
    defaultFrameId: frame.id,
    frames: { [frame.id]: frame },
    frameOrder: [frame.id],
    layers: { [layer.id]: layer },
    layerOrder: [layer.id],
    nodes: {},
    nodeOrder: [],
    assets: {},
    masks: {},
    steps: {},
    stepOrder: [],
  };
  const add = (node: DrawingNode) => {
    scene.nodes[node.id] = node;
    scene.nodeOrder.push(node.id);
    return node;
  };
  return { scene, frameId: frame.id, layerId: layer.id, add };
}

function addCard(
  ctx: ReturnType<typeof baseScene>,
  opts: {
    x: number;
    y: number;
    w: number;
    h: number;
    text: string;
    fill: string;
    stroke: string;
    textColor?: string;
    fontSize?: number;
    weight?: number;
    shape?: Shape;
    radius?: number;
  },
): DrawingNode {
  const shapeNode = newNode("shape", ctx.layerId, ctx.frameId, {
    x: opts.x,
    y: opts.y,
    w: opts.w,
    h: opts.h,
  });
  shapeNode.name = opts.text.split("\n")[0].slice(0, 40) || "Node";
  shapeNode.shape = opts.shape ?? "roundrect";
  shapeNode.paint = {
    ...structuredClone(DEFAULT_PAINT),
    fill: opts.fill,
    stroke: opts.stroke,
    strokeWidth: 2.5,
    radius: opts.radius ?? 20,
  };
  ctx.add(shapeNode);

  const padX = 16;
  const fontSize = opts.fontSize ?? 22;
  const lines = opts.text.split("\n").length;
  const textH = Math.min(opts.h - 12, Math.max(fontSize * 1.6 * lines, 36));
  const textY = opts.y + Math.max(8, Math.round((opts.h - textH) / 2));
  const textNode = newNode("text", ctx.layerId, ctx.frameId, {
    x: opts.x + padX,
    y: textY,
    w: Math.max(40, opts.w - padX * 2),
    h: Math.max(28, textH),
  });
  textNode.name = `${shapeNode.name} Label`;
  textNode.text = opts.text;
  textNode.textStyle = {
    ...structuredClone(DEFAULT_TEXT),
    size: fontSize,
    weight: opts.weight ?? 600,
    align: "center",
    direction: "auto",
    leading: 1.35,
    color: opts.textColor ?? "#1f242b",
  };
  ctx.add(textNode);
  return shapeNode;
}

function connectNodes(
  ctx: ReturnType<typeof baseScene>,
  from: DrawingNode,
  to: DrawingNode,
  opts: {
    color?: string;
    strokeWidth?: number;
    dash?: number[];
    label?: string;
    u1?: number;
    v1?: number;
    u2?: number;
    v2?: number;
  } = {},
) {
  const u1 = opts.u1 ?? 0.5;
  const v1 = opts.v1 ?? 0.5;
  const u2 = opts.u2 ?? 0.5;
  const v2 = opts.v2 ?? 0.5;
  const start = { x: from.x + from.w * u1, y: from.y + from.h * v1 };
  const end = { x: to.x + to.w * u2, y: to.y + to.h * v2 };
  const arrow = newNode("shape", ctx.layerId, ctx.frameId, {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.max(24, Math.abs(end.x - start.x)),
    h: Math.max(24, Math.abs(end.y - start.y)),
  });
  arrow.name = opts.label ? `Link: ${opts.label}` : "Connector";
  arrow.shape = "arrow";
  arrow.paint = {
    ...structuredClone(DEFAULT_PAINT),
    stroke: opts.color ?? "#5b6472",
    strokeWidth: opts.strokeWidth ?? 3,
    dash: opts.dash ?? [],
  };
  arrow.anchor = { nodeId: from.id, u: u1, v: v1, fallback: start };
  arrow.endAnchor = { nodeId: to.id, u: u2, v: v2, fallback: end };
  // Put connector behind cards in render order so borders stay clean
  ctx.scene.nodes[arrow.id] = arrow;
  ctx.scene.nodeOrder.unshift(arrow.id);

  if (opts.label) {
    const mx = (start.x + end.x) / 2;
    const my = (start.y + end.y) / 2;
    const pillW = Math.max(96, opts.label.length * 9 + 24);
    const pillH = 32;
    addCard(ctx, {
      x: Math.round(mx - pillW / 2),
      y: Math.round(my - pillH / 2),
      w: pillW,
      h: pillH,
      text: opts.label,
      fill: "#ffffff",
      stroke: opts.color ?? "#cbd5e1",
      textColor: "#334155",
      fontSize: 15,
      weight: 600,
      radius: 16,
    });
  }
}

export const VISUAL_MINDMAP_PRESETS: VisualCanvasPreset[] = [
  {
    key: "canvas_radial_mindmap",
    title: "لوحة خريطة ذهنية متفرعة (Radial Mind Map Canvas)",
    icon: "🧠",
    badge: "Visual Canvas",
    description: "خريطة ذهنية بصرية تفاعلية متعددة الألوان مع عقد مرتبطة بأسهم ذكية قابلة للسحب والتعديل.",
    build: () => {
      const ctx = baseScene("Radial Mind Map");
      const center = addCard(ctx, {
        x: 640,
        y: 430,
        w: 320,
        h: 130,
        text: "الفكرة المركزية\nCentral Topic",
        fill: "#1e293b",
        stroke: "#0f172a",
        textColor: "#ffffff",
        fontSize: 26,
        weight: 700,
        radius: 32,
      });

      const branches = [
        {
          title: "المحور الأول\nالأهداف والرؤية",
          x: 150,
          y: 160,
          fill: "#dbeafe",
          stroke: "#2563eb",
          u1: 0.1,
          v1: 0.2,
          u2: 0.9,
          v2: 0.8,
          subs: [
            { text: "هدف فرعي 1.1", x: 60, y: 50 },
            { text: "هدف فرعي 1.2", x: 320, y: 50 },
          ],
        },
        {
          title: "المحور الثاني\nالخطوات التنفيذية",
          x: 1180,
          y: 160,
          fill: "#dcfce7",
          stroke: "#16a34a",
          u1: 0.9,
          v1: 0.2,
          u2: 0.1,
          v2: 0.8,
          subs: [
            { text: "خطوة أولى 2.1", x: 1080, y: 50 },
            { text: "خطوة ثانية 2.2", x: 1340, y: 50 },
          ],
        },
        {
          title: "المحور الثالث\nالموارد والأدوات",
          x: 150,
          y: 720,
          fill: "#fef3c7",
          stroke: "#d97706",
          u1: 0.1,
          v1: 0.8,
          u2: 0.9,
          v2: 0.2,
          subs: [
            { text: "أداة / مورد 3.1", x: 60, y: 880 },
            { text: "أداة / مورد 3.2", x: 320, y: 880 },
          ],
        },
        {
          title: "المحور الرابع\nالمخاطر والبدائل",
          x: 1180,
          y: 720,
          fill: "#fce7f3",
          stroke: "#db2777",
          u1: 0.9,
          v1: 0.8,
          u2: 0.1,
          v2: 0.2,
          subs: [
            { text: "تحدي متوقع 4.1", x: 1080, y: 880 },
            { text: "خطة بديلة 4.2", x: 1340, y: 880 },
          ],
        },
      ];

      for (const b of branches) {
        const node = addCard(ctx, {
          x: b.x,
          y: b.y,
          w: 260,
          h: 100,
          text: b.title,
          fill: b.fill,
          stroke: b.stroke,
          fontSize: 20,
          radius: 22,
        });
        connectNodes(ctx, center, node, {
          color: b.stroke,
          strokeWidth: 3.5,
          u1: b.u1,
          v1: b.v1,
          u2: b.u2,
          v2: b.v2,
        });
        for (const sub of b.subs) {
          const sNode = addCard(ctx, {
            x: sub.x,
            y: sub.y,
            w: 210,
            h: 68,
            text: sub.text,
            fill: "#ffffff",
            stroke: b.stroke,
            fontSize: 17,
            weight: 500,
            radius: 16,
          });
          connectNodes(ctx, node, sNode, {
            color: b.stroke,
            strokeWidth: 2.5,
          });
        }
      }

      validateScene(ctx.scene);
      return ctx.scene;
    },
  },
  {
    key: "canvas_concept_network",
    title: "لوحة خريطة مفاهيمية (Concept Proposition Network)",
    icon: "🕸️",
    badge: "Visual Canvas",
    description: "شبكة مفاهيم هرمية مرتبطة بعبارات علاقة صريحة (يؤدي إلى، يتكون من، يعتمد على).",
    build: () => {
      const ctx = baseScene("Concept Map Network");
      const root = addCard(ctx, {
        x: 640,
        y: 70,
        w: 320,
        h: 96,
        text: "المفهوم المحوري\nCore Concept",
        fill: "#ede9fe",
        stroke: "#7c3aed",
        fontSize: 24,
        weight: 700,
      });

      const left = addCard(ctx, {
        x: 200,
        y: 340,
        w: 280,
        h: 90,
        text: "المكون الأساسي (أ)",
        fill: "#dbeafe",
        stroke: "#2563eb",
        fontSize: 20,
      });
      const mid = addCard(ctx, {
        x: 660,
        y: 340,
        w: 280,
        h: 90,
        text: "الآلية الفاعلة (ب)",
        fill: "#fef3c7",
        stroke: "#d97706",
        fontSize: 20,
      });
      const right = addCard(ctx, {
        x: 1120,
        y: 340,
        w: 280,
        h: 90,
        text: "الشرط اللازم (ج)",
        fill: "#dcfce7",
        stroke: "#16a34a",
        fontSize: 20,
      });

      const leaf1 = addCard(ctx, {
        x: 340,
        y: 660,
        w: 300,
        h: 96,
        text: "التطبيق العملي / الشاهد",
        fill: "#ffffff",
        stroke: "#2563eb",
        fontSize: 19,
      });
      const leaf2 = addCard(ctx, {
        x: 960,
        y: 660,
        w: 300,
        h: 96,
        text: "الأثر النهائي / النتيجة",
        fill: "#fae8ff",
        stroke: "#9333ea",
        fontSize: 19,
      });

      connectNodes(ctx, root, left, { color: "#7c3aed", label: "يتكون من", u1: 0.2, v1: 1, u2: 0.5, v2: 0 });
      connectNodes(ctx, root, mid, { color: "#7c3aed", label: "يعمل بواسطة", u1: 0.5, v1: 1, u2: 0.5, v2: 0 });
      connectNodes(ctx, root, right, { color: "#7c3aed", label: "يشترط وجود", u1: 0.8, v1: 1, u2: 0.5, v2: 0 });
      connectNodes(ctx, left, leaf1, { color: "#2563eb", label: "يُقاس عبر", u1: 0.5, v1: 1, u2: 0.4, v2: 0 });
      connectNodes(ctx, mid, leaf1, { color: "#d97706", label: "يفسّر", u1: 0.3, v1: 1, u2: 0.7, v2: 0 });
      connectNodes(ctx, mid, leaf2, { color: "#d97706", label: "يؤدي إلى", u1: 0.7, v1: 1, u2: 0.3, v2: 0 });
      connectNodes(ctx, right, leaf2, { color: "#16a34a", label: "يعزّز", u1: 0.5, v1: 1, u2: 0.6, v2: 0 });

      validateScene(ctx.scene);
      return ctx.scene;
    },
  },
  {
    key: "canvas_fishbone",
    title: "لوحة إيشيكاوا للأسباب الجذرية (Fishbone Canvas)",
    icon: "🐟",
    badge: "Visual Canvas",
    description: "مخطط عظمة السمكة لتحليل المشكلات عبر 6 فئات مسببة وصولاً إلى الأثر الرئيسي.",
    build: () => {
      const ctx = baseScene("Fishbone Root Cause Analysis");
      const effect = addCard(ctx, {
        x: 1220,
        y: 420,
        w: 300,
        h: 140,
        text: "🎯 المشكلة / الأثر\nProblem Statement",
        fill: "#fee2e2",
        stroke: "#dc2626",
        fontSize: 23,
        weight: 700,
      });

      const spineStart = addCard(ctx, {
        x: 80,
        y: 455,
        w: 180,
        h: 70,
        text: "الأسباب المحتملة",
        fill: "#f1f5f9",
        stroke: "#475569",
        fontSize: 18,
      });
      connectNodes(ctx, spineStart, effect, { color: "#dc2626", strokeWidth: 4, u1: 1, v1: 0.5, u2: 0, v2: 0.5 });

      const causes = [
        { text: "الأفراد والمهارات\n(People)", x: 260, y: 140, fill: "#dbeafe", stroke: "#2563eb" },
        { text: "العمليات والإجراءات\n(Process)", x: 600, y: 140, fill: "#dcfce7", stroke: "#16a34a" },
        { text: "الأدوات والتقنية\n(Technology)", x: 940, y: 140, fill: "#fef3c7", stroke: "#d97706" },
        { text: "البيانات والمدخلات\n(Materials)", x: 260, y: 740, fill: "#ede9fe", stroke: "#7c3aed" },
        { text: "القياس والمتابعة\n(Measurement)", x: 600, y: 740, fill: "#fce7f3", stroke: "#db2777" },
        { text: "البيئة المحيطة\n(Environment)", x: 940, y: 740, fill: "#e0f2fe", stroke: "#0284c7" },
      ];

      for (const c of causes) {
        const node = addCard(ctx, {
          x: c.x,
          y: c.y,
          w: 250,
          h: 100,
          text: c.text,
          fill: c.fill,
          stroke: c.stroke,
          fontSize: 19,
        });
        connectNodes(ctx, node, effect, {
          color: c.stroke,
          strokeWidth: 2.5,
          u1: 0.5,
          v1: c.y < 400 ? 1 : 0,
          u2: 0,
          v2: c.y < 400 ? 0.3 : 0.7,
        });
      }

      validateScene(ctx.scene);
      return ctx.scene;
    },
  },
  {
    key: "canvas_swot_2x2",
    title: "لوحة مصفوفة SWOT الرباعية (2×2 Strategic Canvas)",
    icon: "♟️",
    badge: "Visual Canvas",
    description: "لوحة تخطيط رباعية لنقاط القوة والضعف والفرص والتهديدات مع محور القرارات.",
    build: () => {
      const ctx = baseScene("SWOT Strategic Canvas");
      addCard(ctx, {
        x: 100,
        y: 80,
        w: 660,
        h: 390,
        text: "💪 نقاط القوة (Strengths)\n• ميزة تنافسية 1\n• كفاءة الفريق والموارد\n• أصول ومهارات متوفرة",
        fill: "#dcfce7",
        stroke: "#16a34a",
        fontSize: 22,
      });
      addCard(ctx, {
        x: 840,
        y: 80,
        w: 660,
        h: 390,
        text: "🩹 نقاط الضعف (Weaknesses)\n• فجوة في الموارد أو الوقت\n• عمليات تحتاج أتمتة\n• نقاط تحتاج تحسين",
        fill: "#fef3c7",
        stroke: "#d97706",
        fontSize: 22,
      });
      addCard(ctx, {
        x: 100,
        y: 530,
        w: 660,
        h: 390,
        text: "🌱 الفرص (Opportunities)\n• احتياج جديد في السوق\n• تقنية أو شراكة مساندة\n• توسع سريع",
        fill: "#dbeafe",
        stroke: "#2563eb",
        fontSize: 22,
      });
      addCard(ctx, {
        x: 840,
        y: 530,
        w: 660,
        h: 390,
        text: "⚡ التهديدات (Threats)\n• مخاطر خارجية أو تنظيمية\n• ضغط الوقت والمنافسة\n• تغير المتطلبات",
        fill: "#fee2e2",
        stroke: "#dc2626",
        fontSize: 22,
      });
      addCard(ctx, {
        x: 630,
        y: 440,
        w: 340,
        h: 120,
        text: "🎯 الهدف الاستراتيجي\nStrategic Core",
        fill: "#1e293b",
        stroke: "#0f172a",
        textColor: "#ffffff",
        fontSize: 22,
        weight: 700,
        radius: 28,
      });
      validateScene(ctx.scene);
      return ctx.scene;
    },
  },
];

export async function createVisualMindMap(preset: VisualCanvasPreset): Promise<string> {
  const page = await api.createPage({
    title: preset.title,
    kind: "drawing",
    icon: preset.icon,
  });
  const doc = await api.drawingLoad(page.id);
  const targetScene = preset.build();
  const changes = sceneChanges(doc.scene, targetScene);
  const op = edit("user", doc.revision, `Initialize ${preset.title}`, changes);
  await api.drawingApply(page.id, op);
  return page.id;
}
