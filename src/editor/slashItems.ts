import type { Editor, Range } from "@tiptap/core";
import type { IconName } from "../ui/Icon";
import { emit } from "../lib/bus";
import { useStore } from "../state/store";
import { pickAndInsert } from "./media";
import { promptText } from "./prompt";

export interface SlashItem {
  id: string;
  title: string;
  subtitle?: string;
  icon: IconName;
  group: string;
  keywords?: string;
  hint?: string;
  run: (editor: Editor, range: Range, ctx: { pageId: string }) => void;
}

const block = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);

export function slashItems(): SlashItem[] {
  return [
    // Text
    { id: "text", title: "Text", icon: "text", group: "Basic", keywords: "paragraph plain", run: (e, r) => block(e, r).setParagraph().run() },
    { id: "h1", title: "Heading 1", icon: "h1", group: "Basic", hint: "#", keywords: "title big", run: (e, r) => block(e, r).setHeading({ level: 1 }).run() },
    { id: "h2", title: "Heading 2", icon: "h2", group: "Basic", hint: "##", run: (e, r) => block(e, r).setHeading({ level: 2 }).run() },
    { id: "h3", title: "Heading 3", icon: "h3", group: "Basic", hint: "###", run: (e, r) => block(e, r).setHeading({ level: 3 }).run() },
    { id: "bullet", title: "Bulleted List", icon: "bulletList", group: "Basic", hint: "-", keywords: "ul unordered", run: (e, r) => block(e, r).toggleBulletList().run() },
    { id: "numbered", title: "Numbered List", icon: "numberedList", group: "Basic", hint: "1.", keywords: "ol ordered", run: (e, r) => block(e, r).toggleOrderedList().run() },
    { id: "check", title: "Checklist", icon: "checklist", group: "Basic", hint: "[]", keywords: "todo task checkbox to-do", run: (e, r) => block(e, r).toggleTaskList().run() },
    { id: "quote", title: "Quote", icon: "quote", group: "Basic", hint: ">", run: (e, r) => block(e, r).toggleBlockquote().run() },
    { id: "callout", title: "Callout", icon: "callout", group: "Basic", keywords: "note tip info", run: (e, r) => block(e, r).setCallout("note").run() },
    { id: "highlight", title: "Highlight", icon: "highlight", group: "Basic", keywords: "emphasis important", run: (e, r) => block(e, r).setCallout("highlight").run() },
    { id: "code", title: "Code", icon: "code", group: "Basic", hint: "```", run: (e, r) => block(e, r).toggleCodeBlock().run() },
    {
      id: "table",
      title: "Table",
      icon: "table",
      group: "Basic",
      keywords: "grid rows columns",
      run: (e, r) => block(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    { id: "divider", title: "Divider", icon: "divider", group: "Basic", hint: "---", keywords: "separator line hr", run: (e, r) => block(e, r).setHorizontalRule().run() },

    // Pages
    {
      id: "subpage",
      title: "Subpage",
      subtitle: "A new page inside this one",
      icon: "subpage",
      group: "Pages",
      keywords: "child nested page",
      run: async (e, r, ctx) => {
        block(e, r).run();
        const { api } = await import("../lib/api");
        const meta = await api.createPage({ parentId: ctx.pageId });
        await useStore.getState().refreshPages();
        useStore.getState().setExpanded(ctx.pageId, true);
        e.chain().focus().insertPageLink({ pageId: meta.id, title: meta.title }).run();
      },
    },
    {
      id: "mention",
      title: "Page Reference",
      subtitle: "Mention another page",
      icon: "mention",
      group: "Pages",
      hint: "@",
      keywords: "link reference mention",
      run: (e, r) => block(e, r).insertContent("@").run(),
    },

    // Media
    // Layout and structure
    { id: "columns2", title: "2 Columns", subtitle: "Blocks side by side", icon: "splitVertical", group: "Layout", keywords: "columns layout side grid two", run: (e, r) => block(e, r).insertColumns(2).run() },
    { id: "columns3", title: "3 Columns", icon: "splitVertical", group: "Layout", keywords: "columns layout three grid", run: (e, r) => block(e, r).insertColumns(3).run() },
    { id: "toggle", title: "Toggle", subtitle: "Collapsible section", icon: "forward", group: "Layout", hint: ">>", keywords: "collapse fold expand details accordion", run: (e, r) => block(e, r).insertToggle(0).run() },
    { id: "toggleh2", title: "Toggle Heading", icon: "h2", group: "Layout", keywords: "collapse fold heading section", run: (e, r) => block(e, r).insertToggle(2).run() },
    { id: "collection", title: "Collection", subtitle: "Subpages as a table with properties", icon: "table", group: "Layout", keywords: "database table pages list properties", run: (e, r) => block(e, r).insertCollection({ view: "table" }).run() },
    { id: "board", title: "Board", subtitle: "Subpages grouped by Status", icon: "splitVertical", group: "Layout", keywords: "kanban board status tasks columns", run: (e, r) => block(e, r).insertCollection({ view: "board" }).run() },
    { id: "collection-gallery", title: "Gallery", subtitle: "Subpages as cards with covers", icon: "grid", group: "Layout", keywords: "cards gallery covers grid", run: (e, r) => block(e, r).insertCollection({ view: "gallery" }).run() },
    { id: "toc", title: "Table of Contents", subtitle: "Live list of this page's headings", icon: "listView", group: "Layout", keywords: "toc contents outline index headings", run: (e, r) => block(e, r).insertToc().run() },
    { id: "image-gallery", title: "Image Gallery", subtitle: "Several pictures in a grid", icon: "grid", group: "Media", keywords: "photos pictures album images grid gallery", run: (e, r) => block(e, r).insertGallery().run() },
    { id: "today", title: "Today's Date", icon: "calendar", group: "Insert", keywords: "date today now day", run: (e, r) => block(e, r).insertContent(new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + " ").run() },
    { id: "now", title: "Current Time", icon: "clock", group: "Insert", keywords: "time now clock", run: (e, r) => block(e, r).insertContent(new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) + " ").run() },
    { id: "datetime", title: "Date and Time", icon: "schedule", group: "Insert", keywords: "timestamp stamp log", run: (e, r) => block(e, r).insertContent(new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) + " ").run() },
    { id: "image", title: "Image", icon: "image", group: "Media", keywords: "picture photo gif", run: (e, r, ctx) => { block(e, r).run(); pickAndInsert(e, ctx.pageId, "image"); } },
    { id: "video", title: "Video", icon: "video", group: "Media", keywords: "movie clip", run: (e, r, ctx) => { block(e, r).run(); pickAndInsert(e, ctx.pageId, "video"); } },
    { id: "file", title: "File", icon: "file", group: "Media", keywords: "attachment upload document", run: (e, r, ctx) => { block(e, r).run(); pickAndInsert(e, ctx.pageId, "file"); } },
    {
      id: "embed",
      title: "Embed Link",
      icon: "link",
      group: "Media",
      keywords: "url website bookmark",
      run: async (e, r) => {
        block(e, r).run();
        const url = await promptText({ title: "Embed a link", placeholder: "https://", validate: (v) => (/^https?:\/\/\S+$/.test(v) ? null : "Enter a full URL") });
        if (url) e.chain().focus().insertAtom("embed", { url }).run();
      },
    },

    // AI
    { id: "prompt", title: "Prompt", subtitle: "Reusable instruction for Claude", icon: "prompt", group: "Assistant", run: (e, r) => block(e, r).setPrompt().run() },
    {
      id: "instructions",
      title: "Assistant Instructions",
      subtitle: "Private rules for this page",
      icon: "instructions",
      group: "Assistant",
      keywords: "ai rules claude",
      run: (e, r, ctx) => {
        block(e, r).run();
        emit("page:info", { pageId: ctx.pageId, panel: "instructions" });
      },
    },
    {
      id: "ask",
      title: "Ask Claude",
      icon: "assistant",
      group: "Assistant",
      keywords: "ai write help",
      run: (e, r, ctx) => {
        block(e, r).run();
        emit("ai:open", { pageId: ctx.pageId });
      },
    },

    // Discord
    {
      id: "discordMessage",
      title: "Discord Message",
      subtitle: "Reference a message by link",
      icon: "discord",
      group: "Discord",
      keywords: "embed message bot",
      run: async (e, r) => {
        block(e, r).run();
        const url = await promptText({
          title: "Discord message link",
          placeholder: "https://discord.com/channels/…",
          validate: (v) => (/^https:\/\/(\w+\.)?discord(app)?\.com\/channels\/\d+\/\d+\/\d+/.test(v) ? null : "Paste a message link (Copy Message Link in Discord)"),
        });
        if (!url) return;
        e.chain().focus().insertAtom("discordMessage", { url }).run();
      },
    },
    {
      id: "schedule",
      title: "Schedule",
      subtitle: "Send this page on a schedule",
      icon: "schedule",
      group: "Discord",
      keywords: "automation timer reminder",
      run: (e, r, ctx) => {
        block(e, r).run();
        emit("automation:new", { pageId: ctx.pageId });
      },
    },
  ];
}
