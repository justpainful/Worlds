import { useEffect, useState } from "react";
import { accountApi } from "../../account/api";
import { useAccount } from "../../account/store";
import { normalizeUsername, usernameProblem } from "../../account/usernames";
import { errorMessage } from "../../lib/api";
import type { Profile } from "../../lib/types";
import { Button, IconButton } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { Modal } from "../../ui/Modal";
import { type Link } from "./shared";

// ---------------------------------------------------------------------------
// Edit Profile sheet
// ---------------------------------------------------------------------------

export function EditProfile({
  profile,
  onClose,
  onSave,
  onPick,
  onAdjust,
}: {
  profile: Profile;
  onClose: () => void;
  onSave: (p: Partial<Profile>) => Promise<Profile | null>;
  onPick: (f: "avatar" | "banner") => void;
  onAdjust: (f: "avatar" | "banner") => void;
}) {
  const [d, setD] = useState<Profile>(profile);
  // Signed in, the profile and the account are one person: the username is
  // required, must be free, and is saved to the account first.
  const signedIn = useAccount((s) => s.view?.status === "active");
  const handle = d.handle ?? "";
  const changed = handle !== (profile.handle ?? "");
  const problem = handle ? usernameProblem(handle) : signedIn ? "A username is required." : null;
  const [check, setCheck] = useState<{ name: string; ok: boolean; message: string | null } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    setSaveError(null);
    if (!signedIn || !changed || problem) return setCheck(null);
    let live = true;
    const t = window.setTimeout(() => {
      accountApi
        .checkUsername(handle)
        .then((r) => live && setCheck({ name: handle, ok: r.valid && r.available, message: r.message }))
        .catch(() => live && setCheck(null));
    }, 350);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [handle, signedIn, changed, problem]);
  const taken = check?.name === handle && !check.ok;
  const hint = problem ?? (taken ? check?.message ?? "That username is taken." : check?.name === handle && check.ok ? "Available" : null);
  const setLink = (i: number, patch: Partial<Link>) => setD({ ...d, links: (d.links ?? []).map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const commit = async () => {
    const links = (d.links ?? [])
      .map((l) => ({ label: l.label.trim(), url: /^https?:\/\//.test(l.url.trim()) ? l.url.trim() : l.url.trim() ? `https://${l.url.trim()}` : "" }))
      .filter((l) => l.url);
    if (problem || taken) return;
    if (signedIn && (changed || d.displayName !== profile.displayName)) {
      try {
        await accountApi.updateProfile({ displayName: d.displayName.trim() || undefined, username: changed ? handle : undefined });
      } catch (e) {
        setSaveError(errorMessage(e));
        return;
      }
    }
    const ok = await onSave({ displayName: d.displayName, handle: d.handle, bio: d.bio, status: d.status, location: d.location, links });
    if (ok) onClose();
  };
  return (
    <Modal
      title="Edit Profile"
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="tinted" icon="check" disabled={!!problem || taken} onClick={commit}>
            Save
          </Button>
        </>
      }
    >
      <div className="pf-edit">
        <div className="pf-edit-media">
          <Button size="compact" icon="image" onClick={() => onPick("banner")}>
            {profile.banner ? "Change banner" : "Add banner"}
          </Button>
          {profile.banner && (
            <Button size="compact" icon="sliders" onClick={() => onAdjust("banner")}>
              Adjust banner
            </Button>
          )}
          <Button size="compact" icon="profile" onClick={() => onPick("avatar")}>
            Change avatar
          </Button>
          {profile.avatar && (
            <Button size="compact" icon="sliders" onClick={() => onAdjust("avatar")}>
              Adjust avatar
            </Button>
          )}
        </div>
        <div className="pbi-two">
          <label className="pbi-row">
            <span className="field-label">Name</span>
            <input className="field bidi" dir="auto" value={d.displayName} onChange={(e) => setD({ ...d, displayName: e.target.value })} />
          </label>
          <label className="pbi-row">
            <span className="field-label">Username</span>
            <input
              className={`field ${hint && hint !== "Available" ? "is-invalid" : ""}`}
              dir="ltr"
              value={handle}
              placeholder="username"
              maxLength={21}
              onChange={(e) => setD({ ...d, handle: normalizeUsername(e.target.value) || null })}
            />
            {hint && <span className={`field-hint ${hint === "Available" ? "is-ok" : "is-error"}`}>{hint}</span>}
            {signedIn && !hint && !saveError && <span className="field-hint">Also your account username.</span>}
            {saveError && <span className="field-hint is-error">{saveError}</span>}
          </label>
        </div>
        <label className="pbi-row">
          <span className="field-label">Status</span>
          <input className="field bidi" dir="auto" maxLength={80} value={d.status ?? ""} placeholder="Exploring Game Development" onChange={(e) => setD({ ...d, status: e.target.value || null })} />
        </label>
        <label className="pbi-row">
          <span className="field-label">Bio</span>
          <textarea className="field bidi" dir="auto" rows={3} maxLength={400} value={d.bio ?? ""} placeholder="A sentence or two about you" onChange={(e) => setD({ ...d, bio: e.target.value || null })} />
        </label>
        <label className="pbi-row">
          <span className="field-label">Location</span>
          <input className="field bidi" dir="auto" value={d.location ?? ""} placeholder="City, country" onChange={(e) => setD({ ...d, location: e.target.value || null })} />
        </label>
        <div className="pbi-row">
          <span className="field-label">Links</span>
          <div className="links-edit">
            {(d.links ?? []).map((l, i) => (
              <div key={i} className="link-edit-row">
                <input className="field bidi" dir="auto" placeholder="Label" value={l.label} onChange={(e) => setLink(i, { label: e.target.value })} />
                <input className="field" dir="ltr" placeholder="https://" value={l.url} onChange={(e) => setLink(i, { url: e.target.value })} />
                <IconButton icon="close" label="Remove link" onClick={() => setD({ ...d, links: (d.links ?? []).filter((_, j) => j !== i) })} />
              </div>
            ))}
            {(d.links ?? []).length < 12 && (
              <button className="chip-btn" onClick={() => setD({ ...d, links: [...(d.links ?? []), { label: "", url: "" }] })}>
                <Icon name="add" size={13} />
                Add link
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
