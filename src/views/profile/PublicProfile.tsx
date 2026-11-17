import { useEffect, useState } from "react";
import { accountApi, type PublicProfileState } from "../../account/api";
import { useAccount } from "../../account/store";
import { errorMessage } from "../../lib/api";
import { openExternal } from "../../lib/links";
import type { Profile } from "../../lib/types";
import { publishProfile, type PublishProgress } from "../../profile/publish";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { Modal } from "../../ui/Modal";
import { relTime } from "../../ui/misc";
import { Segmented } from "../../ui/Segmented";
import { toast } from "./shared";

/**
 * The public profile at profile.<domain>/@username: publish this profile,
 * update it after changes, show or hide it, copy its link, or take it down.
 */
export function PublicProfileSheet({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const signedIn = useAccount((s) => s.view?.status === "active");
  const openSheet = useAccount((s) => s.open);
  const [state, setState] = useState<PublicProfileState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"publish" | "visible" | "remove" | null>(null);
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (!signedIn) return setLoading(false);
    let live = true;
    accountApi
      .publicProfile()
      .then((s) => live && setState(s))
      .catch((e) => live && setError(errorMessage(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [signedIn]);

  const publish = async () => {
    setBusy("publish");
    setError(null);
    setProgress(null);
    try {
      const s = await publishProfile(profile, { visible: state?.published ? undefined : true, onProgress: setProgress });
      setState(s);
      toast(state?.published ? "Public profile updated" : "Public profile published");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const setVisible = async (visible: boolean) => {
    if (!state?.published || state.visible === visible) return;
    setBusy("visible");
    setError(null);
    try {
      setState(await accountApi.setProfileVisible(visible));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    setError(null);
    try {
      await accountApi.unpublishProfile();
      setState(state ? { ...state, published: false, visible: false, profile: null, avatar: null, banner: null, publishedAt: null, updatedAt: null } : state);
      setConfirmRemove(false);
      toast("Public profile removed");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!state) return;
    await navigator.clipboard.writeText(state.url).catch(() => undefined);
    toast("Link copied");
  };

  const footer = signedIn ? (
    <>
      <Button variant="quiet" onClick={onClose}>
        Done
      </Button>
      <Button variant="tinted" icon={state?.published ? "refresh" : "globe"} disabled={loading || !!busy} onClick={publish}>
        {busy === "publish" ? (progress && progress.total ? `Uploading pictures ${progress.done} of ${progress.total}` : "Publishing") : state?.published ? "Update public profile" : "Publish profile"}
      </Button>
    </>
  ) : (
    <>
      <Button variant="quiet" onClick={onClose}>
        Not now
      </Button>
      <Button variant="tinted" icon="profile" onClick={() => openSheet({ kind: "signin" })}>
        Sign In
      </Button>
    </>
  );

  return (
    <Modal title="Public profile" onClose={onClose} width={520} footer={footer}>
      <div className="pf-public">
        {!signedIn ? (
          <p className="pf-public-note">Sign in to your Worlds account to give this profile a public page with its own link, like profile.enterworlds.space/@username.</p>
        ) : loading ? (
          <p className="pf-public-note">Loading</p>
        ) : (
          <>
            <div className="pf-public-link">
              <Icon name="globe" size={16} />
              <bdi dir="ltr" className="pf-public-url">
                {(state?.url ?? "").replace(/^https?:\/\//, "")}
              </bdi>
              <Button size="compact" icon="duplicate" disabled={!state?.published} onClick={copy}>
                Copy link
              </Button>
              <Button size="compact" icon="external" disabled={!state?.published || !state.visible} onClick={() => state && openExternal(state.url)}>
                Open
              </Button>
            </div>

            <div className="pf-public-row">
              <div>
                <div className="pf-public-label">Who can see it</div>
                <div className="pf-public-hint">
                  {!state?.published
                    ? "Nothing is public until you publish."
                    : state.visible
                      ? "Anyone with the link can see your profile."
                      : "Hidden: the link shows that no profile exists."}
                </div>
              </div>
              <Segmented
                value={state?.published && state.visible ? "visible" : "hidden"}
                options={[
                  { value: "visible", label: "Everyone", icon: "globe" },
                  { value: "hidden", label: "Hidden", icon: "lock" },
                ]}
                onChange={(v) => setVisible(v === "visible")}
              />
            </div>

            <p className="pf-public-note">
              Publishing copies your avatar, banner, name, username, bio, links and blocks from this profile. Live blocks such as streaks and activity stay in the app. Change anything here, then press Update to show it.
            </p>
            {state?.updatedAt && <p className="pf-public-hint">Last published {relTime(state.updatedAt)}</p>}
            {state && !state.filesEnabled && <p className="pf-public-hint is-error">This server cannot store pictures yet, so only the text is published.</p>}
            {error && <p className="pf-public-hint is-error">{error}</p>}

            {state?.published &&
              (confirmRemove ? (
                <div className="pf-public-remove">
                  <span>Remove the public page and its pictures? You can publish again later.</span>
                  <Button size="compact" variant="quiet" onClick={() => setConfirmRemove(false)}>
                    Keep
                  </Button>
                  <Button size="compact" variant="danger" disabled={!!busy} onClick={remove}>
                    Remove
                  </Button>
                </div>
              ) : (
                <button className="pf-public-danger" onClick={() => setConfirmRemove(true)}>
                  Remove public profile
                </button>
              ))}
          </>
        )}
      </div>
    </Modal>
  );
}
