/**
 * Publish a page to the web: on your public profile at
 * profile.<domain>/@you/<address>, or as a share link that can have a
 * password and an end date. The page is sent as clean HTML drawn from its
 * blocks; nothing else from Worlds goes with it.
 */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, errorMessage } from "../lib/api";
import { useStore, pageTitle } from "../state/store";
import { tr, uiLanguage } from "../i18n/ui";
import { Icon } from "../ui/Icon";
import { Modal } from "../ui/Modal";
import { MenuSelect } from "../ui/MenuSelect";
import { blocksToHtml } from "../files/importExport";
import { accountApi, type PublishedPage } from "./api";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60) || `page-${Date.now().toString(36)}`;

const ENDS: { value: string; label: string; days: number | null }[] = [
  { value: "1", label: "1 day", days: 1 },
  { value: "7", label: "7 days", days: 7 },
  { value: "30", label: "30 days", days: 30 },
  { value: "0", label: "No end date", days: null },
];

function Publish({ pageId, close }: { pageId: string; close: () => void }) {
  const meta = useStore((s) => s.pages[pageId]);
  const [profile, setProfile] = useState<{ username: string; url: string } | null>(null);
  const [mine, setMine] = useState<PublishedPage[]>([]);
  const [slug, setSlug] = useState(slugify(pageTitle(meta)));
  const [password, setPassword] = useState("");
  const [ends, setEnds] = useState("7");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  const refresh = () => accountApi.publishedList().then((r) => setMine(r.pages)).catch(() => undefined);
  useEffect(() => {
    accountApi
      .state()
      .then((s) => {
        setSignedIn(s.status === "active");
        if (s.status === "active") {
          accountApi.publicProfile().then((p) => setProfile({ username: p.username, url: p.url })).catch(() => undefined);
          refresh();
        }
      })
      .catch(() => setSignedIn(false));
  }, []);

  const origin = profile?.url ? new URL(profile.url).origin : "";
  const html = async () => {
    const p = await api.page(pageId);
    if (!p) throw new Error(tr("Page not found"));
    return { title: pageTitle(p), html: blocksToHtml(p.blocks.map((b) => b.content)), lang: (/[؀-ۿ]/.test(p.title) || uiLanguage() === "ar" ? "ar" : "en") as "ar" | "en" };
  };

  const publish = async (kind: "page" | "share") => {
    setBusy(true);
    setError(null);
    setMade(null);
    try {
      const body = await html();
      const days = ENDS.find((e) => e.value === ends)?.days ?? null;
      const r = await accountApi.publishPage({
        kind,
        ...body,
        ...(kind === "page" ? { slug } : { password: password || undefined, expiresAt: days ? Date.now() + days * 86400000 : null }),
      });
      const url = kind === "page" ? `${origin}/@${profile?.username}/${r.slug}` : `${origin}/s/${r.slug}`;
      setMade(url);
      await navigator.clipboard.writeText(url).catch(() => undefined);
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onProfile = mine.filter((m) => m.kind === "page");
  const shares = mine.filter((m) => m.kind === "share");

  return (
    <Modal title={`${tr("Publish to the web")}: ${pageTitle(meta)}`} onClose={close} width={620} className="publish-page">
      {signedIn === false ? (
        <p className="pub-note">{tr("Sign in to your Worlds account (Settings › Account) to publish pages to the web.")}</p>
      ) : (
        <>
          <section className="pub-section">
            <h3>
              <Icon name="globe" size={16} />
              {tr("On your public profile")}
            </h3>
            <div className="pub-row" dir="ltr">
              <span className="pub-prefix">{origin ? `${origin.replace(/^https:\/\//, "")}/@${profile?.username ?? ""}/` : ""}</span>
              <input className="field" value={slug} onChange={(e) => setSlug(slugify(e.target.value))} aria-label={tr("Address")} />
              <button className="btn btn-tinted btn-compact" disabled={busy || !profile} onClick={() => publish("page")}>
                {onProfile.some((p) => p.slug === slug) ? tr("Update") : tr("Publish")}
              </button>
            </div>
            <p className="pub-note">{tr("Anyone with the address can read it. Publishing again updates it.")}</p>
          </section>
          <section className="pub-section">
            <h3>
              <Icon name="link" size={16} />
              {tr("Share link")}
            </h3>
            <div className="pub-row">
              <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={tr("Password (optional)")} aria-label={tr("Password")} />
              <MenuSelect value={ends} onChange={(e) => setEnds(e.target.value)} aria-label={tr("Ends after")}>
                {ENDS.map((e) => (
                  <option key={e.value} value={e.value}>
                    {tr(e.label)}
                  </option>
                ))}
              </MenuSelect>
              <button className="btn btn-tinted btn-compact" disabled={busy || !profile} onClick={() => publish("share")}>
                {tr("Make link")}
              </button>
            </div>
            <p className="pub-note">{tr("The link stops working when it ends. With a password, readers must type it first.")}</p>
          </section>
          {made && (
            <div className="pub-made">
              <Icon name="success" size={16} />
              <a href={made} target="_blank" rel="noreferrer" dir="ltr">
                {made}
              </a>
              <span className="pub-dim">{tr("Copied")}</span>
            </div>
          )}
          {error && <div className="ask-error">{error}</div>}
          {mine.length > 0 && (
            <section className="pub-section">
              <h3>{tr("Published")}</h3>
              {[...onProfile, ...shares].map((m) => (
                <div key={`${m.kind}:${m.slug}`} className="pub-item">
                  <Icon name={m.kind === "page" ? "globe" : "link"} size={14} />
                  <span className="bidi">{m.title}</span>
                  <span className="pub-dim" dir="ltr">
                    {m.kind === "page" ? `/@${profile?.username}/${m.slug}` : `/s/${m.slug}`}
                  </span>
                  {m.hasPassword ? <Icon name="lock" size={12} /> : null}
                  <span className="pub-dim">
                    {m.views} {tr("views")}
                  </span>
                  <button
                    className="icon-btn"
                    aria-label={tr("Take down")}
                    data-tip={tr("Take down")}
                    onClick={() => accountApi.unpublishPage(m.kind, m.slug).then(refresh, (e) => setError(errorMessage(e)))}
                  >
                    <Icon name="delete" size={13} />
                  </button>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </Modal>
  );
}

export function openPublish(pageId: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
  };
  root.render(<Publish pageId={pageId} close={close} />);
}

// ---------------------------------------------------------------------------
// Email inbox: mail to your Worlds address becomes pages
// ---------------------------------------------------------------------------

let polling = 0;

async function pullMail() {
  try {
    const s = await accountApi.state();
    if (s.status !== "active") return;
    const { items } = await accountApi.mailItems();
    if (!items.length) return;
    const store = useStore.getState();
    let parent = store.settings["mail.parent"] as string | undefined;
    if (!parent || !store.pages[parent] || store.pages[parent].deletedAt) {
      parent = (await api.createPage({ title: uiLanguage() === "ar" ? "من البريد" : "From email" } as never)).id;
      store.setSetting("mail.parent", parent);
    }
    for (const m of items) {
      await api.createPage({ title: m.subject || m.sender, parentId: parent, markdown: `*${m.sender}*\n\n${m.body}` } as never);
    }
    await accountApi.mailAck(items.map((m) => m.id));
    await store.refreshPages();
    store.toast({ message: `${items.length} ${tr("emails arrived in Worlds")}` });
  } catch {
    /* offline or signed out: try again later */
  }
}

/** Check for mail sent to this person's Worlds address every few minutes. */
export function startMailInbox() {
  if (polling) return;
  polling = window.setInterval(pullMail, 5 * 60000);
  window.setTimeout(pullMail, 15000);
}

/** Settings: this person's Worlds email address. */
export function MailAddress() {
  const [address, setAddress] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "signedOut" | "ready">("loading");
  useEffect(() => {
    accountApi
      .state()
      .then((s) => {
        if (s.status !== "active") return setState("signedOut");
        return accountApi.mailAddress().then((r) => (setAddress(r.address), setState("ready")));
      })
      .catch(() => setState("signedOut"));
  }, []);
  if (state === "signedOut") return <span className="set-static">{tr("Sign in to your account to get an address")}</span>;
  if (!address) return <span className="set-static">{tr("Loading")}</span>;
  return (
    <div className="set-buttons">
      <code className="capture-token" dir="ltr">
        {address}
      </code>
      <button className="btn btn-plain btn-compact" onClick={() => navigator.clipboard.writeText(address).then(() => useStore.getState().toast({ message: tr("Copied") }))}>
        {tr("Copy")}
      </button>
    </div>
  );
}
