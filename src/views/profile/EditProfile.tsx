import { useState } from "react";
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
  const setLink = (i: number, patch: Partial<Link>) => setD({ ...d, links: (d.links ?? []).map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const commit = async () => {
    const links = (d.links ?? [])
      .map((l) => ({ label: l.label.trim(), url: /^https?:\/\//.test(l.url.trim()) ? l.url.trim() : l.url.trim() ? `https://${l.url.trim()}` : "" }))
      .filter((l) => l.url);
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
          <Button variant="tinted" icon="check" onClick={commit}>
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
            <span className="field-label">Handle</span>
            <input className="field" dir="ltr" value={d.handle ?? ""} placeholder="handle" onChange={(e) => setD({ ...d, handle: e.target.value.replace(/\s/g, "") || null })} />
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
