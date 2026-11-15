/**
 * A message about a pack item to someone outside Worlds (docs/PACKS.md):
 * filled in from the item, shown to the person to read and change, then
 * opened in their own WhatsApp or mail app, where they send it. Worlds never
 * sends it for them; once they say it went, the item records it.
 */
import { useMemo, useState } from "react";
import { uiLanguage } from "../../i18n/ui";
import { openExternal } from "../../lib/links";
import type { PageMeta } from "../../lib/types";
import { useStore } from "../../state/store";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Modal";
import { EmptyState } from "../../ui/misc";
import type { KindDef, MessageDef, PackDef } from "../definition";
import { updatePackItem } from "../items";
import { draftMessage, messageUrl } from "../messages";

export function MessageDialog({ p, pack, kind, m, onClose }: { p: PageMeta; pack: PackDef; kind: KindDef; m: MessageDef; onClose: () => void }) {
  const pages = useStore((s) => s.pages);
  const lang = uiLanguage() === "ar" ? "ar" : "en";
  const draft = useMemo(() => draftMessage(m, pack, kind, p, pages, lang), [m, pack, kind, p, pages, lang]);
  const [text, setText] = useState(draft?.text ?? "");
  const [opened, setOpened] = useState(false);
  const via = m.to.via ? kind.fields.find((f) => f.id === m.to.via) : undefined;
  const target = via?.to ? pack.kinds.find((k) => k.id === via.to) : kind;
  const email = draft?.channel === "email";

  const open = () => {
    if (!draft) return;
    void openExternal(messageUrl({ ...draft, text }, p.title));
    setOpened(true);
  };
  const copy = () => {
    void navigator.clipboard?.writeText(text);
    useStore.getState().toast({ message: "Copied", tone: "success" });
  };
  const sent = () => {
    if (m.done) void updatePackItem(p, m.done);
    onClose();
  };

  return (
    <Modal
      title={m.label}
      onClose={onClose}
      width={520}
      footer={
        draft ? (
          <>
            <Button variant="quiet" onClick={onClose}>Cancel</Button>
            <Button variant="plain" icon="duplicate" onClick={copy} disabled={!text.trim()}>Copy</Button>
            {m.done && opened ? (
              <Button variant="tinted" icon="check" onClick={sent}>It was sent</Button>
            ) : (
              <Button variant="tinted" icon="send" onClick={open} disabled={!text.trim()}>{email ? "Open in Mail" : "Open in WhatsApp"}</Button>
            )}
          </>
        ) : (
          <Button variant="quiet" onClick={onClose}>Close</Button>
        )
      }
    >
      {draft ? (
        <div className="pl-message">
          <div className="field-label">To</div>
          <div className="pl-message-to" dir="ltr">
            {draft.name ? <strong>{draft.name}</strong> : null} {draft.channel === "whatsapp" ? `+${draft.to}` : draft.to}
          </div>
          <div className="field-label">Message</div>
          <textarea className="field bidi" dir="auto" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
          <p className="pl-message-note">{email ? "It opens in your mail app, where you send it yourself." : "It opens in WhatsApp, where you send it yourself."}</p>
        </div>
      ) : (
        <EmptyState
          compact
          icon="warning"
          title="There is no one to send this to yet"
          text={target ? `Add a phone number or email on the ${target.label} first.` : "Add a phone number or email first."}
        />
      )}
    </Modal>
  );
}
