import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { CalloutView, PromptView } from "../views/TextBlocks";
import { PageLinkView } from "../views/PageLinkView";
import { ImageView, VideoView, FileView } from "../views/MediaViews";
import { EmbedView, DiscordMessageView, ScheduleView } from "../views/RefViews";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    worldsBlocks: {
      setCallout: (tone?: string) => ReturnType;
      setPrompt: () => ReturnType;
      insertPageLink: (attrs: { pageId: string; title?: string }) => ReturnType;
      insertMedia: (type: "image" | "video" | "file", attrs: Record<string, unknown>) => ReturnType;
      insertAtom: (type: string, attrs: Record<string, unknown>) => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "paragraph+",
  defining: true,
  addAttributes() {
    return { tone: { default: "note" } };
  },
  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-callout": node.attrs.tone, class: "callout" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
  addCommands() {
    return {
      setCallout:
        (tone = "note") =>
        ({ commands }) =>
          commands.wrapIn(this.name, { tone }),
    };
  },
});

export const Prompt = Node.create({
  name: "prompt",
  group: "block",
  content: "paragraph+",
  defining: true,
  addAttributes() {
    return { label: { default: "Prompt" } };
  },
  parseHTML() {
    return [{ tag: "div[data-prompt]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-prompt": "", class: "prompt-block" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PromptView);
  },
  addCommands() {
    return {
      setPrompt:
        () =>
        ({ commands }) =>
          commands.wrapIn(this.name),
    };
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function atom(name: string, attrs: Record<string, { default: unknown }>, view: any) {
  return Node.create({
    name,
    group: "block",
    atom: true,
    draggable: true,
    selectable: true,
    addAttributes() {
      return attrs;
    },
    parseHTML() {
      return [{ tag: `div[data-${name}]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { [`data-${name}`]: "" })];
    },
    addNodeView() {
      return ReactNodeViewRenderer(view);
    },
  });
}

export const PageLink = atom("pageLink", { pageId: { default: null }, title: { default: "" } }, PageLinkView).extend({
  addCommands() {
    return {
      insertPageLink:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: "pageLink", attrs }),
    };
  },
});

const mediaAttrs = {
  attachmentId: { default: null },
  name: { default: "" },
  mime: { default: "" },
  size: { default: 0 },
  width: { default: null }, // natural px
  height: { default: null },
  display: { default: 100 }, // % of column, or 0 = full bleed
  align: { default: "center" },
  caption: { default: "" },
  poster: { default: null },
  preview: { default: true },
};

export const ImageNode = atom("image", mediaAttrs, ImageView).extend({
  addCommands() {
    return {
      insertMedia:
        (type, attrs) =>
        ({ commands }) =>
          commands.insertContent({ type, attrs }),
      insertAtom:
        (type, attrs) =>
        ({ commands }) =>
          commands.insertContent({ type, attrs }),
    };
  },
});
export const VideoNode = atom("video", mediaAttrs, VideoView);
export const FileNode = atom("file", mediaAttrs, FileView);
export const Embed = atom("embed", { url: { default: "" }, title: { default: "" }, mode: { default: "player" } }, EmbedView);
export const DiscordMessage = atom(
  "discordMessage",
  {
    url: { default: "" },
    author: { default: "" },
    avatar: { default: null },
    content: { default: "" },
    channel: { default: "" },
    timestamp: { default: null },
  },
  DiscordMessageView,
);
export const Schedule = atom("schedule", { automationId: { default: null } }, ScheduleView);
