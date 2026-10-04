import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { useStore, childrenOf, pageTitle } from "../../state/store";
import { Icon } from "../../ui/Icon";
import { PageIcon, relTime } from "../../ui/misc";
import { useMenu } from "../../ui/Menu";
import { pageMenu } from "../../shell/pageActions";

/** Inline subpage / page link card. Title and preview resolve live. */
export function PageLinkView({ node, selected, deleteNode }: ReactNodeViewProps) {
  const pageId = node.attrs.pageId as string | null;
  const page = useStore((s) => (pageId ? s.pages[pageId] : undefined));
  const kids = useStore((s) => (pageId ? childrenOf(s.pages, pageId).length : 0));
  const openPage = useStore((s) => s.openPage);
  const show = useMenu((s) => s.show);

  if (!page || page.deletedAt) {
    return (
      <NodeViewWrapper className={`page-link is-missing ${selected ? "is-selected" : ""}`} data-drag-handle>
        <Icon name="page" size={16} />
        <span className="page-link-title">{page ? `${pageTitle(page)} is in Trash` : "Missing page"}</span>
        <button className="chip-btn" onClick={() => deleteNode()}>Remove</button>
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper
      className={`page-link ${selected ? "is-selected" : ""}`}
      data-drag-handle
      onClick={(e: React.MouseEvent) => openPage(page.id, e.ctrlKey ? "tab" : e.altKey ? "right" : "current")}
      onContextMenu={(e: React.MouseEvent) => {
        e.preventDefault();
        show(e.clientX, e.clientY, pageMenu(page));
      }}
    >
      <span className="page-link-icon">
        <PageIcon icon={page.icon} size={18} />
      </span>
      <span className="page-link-main">
        <span className="page-link-title bidi">{pageTitle(page)}</span>
        <span className="page-link-meta bidi">
          {page.preview ? page.preview.slice(0, 90) : kids ? `${kids} subpage${kids === 1 ? "" : "s"}` : `Edited ${relTime(page.updatedAt)}`}
        </span>
      </span>
      <Icon name="forward" size={14} className="page-link-chevron" />
    </NodeViewWrapper>
  );
}
