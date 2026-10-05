import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { Button } from "../../ui/Button";
import { EmptyState, Spinner } from "../../ui/misc";
import { detectStreamFormat, type StreamFormat } from "../create";
import { openExternal } from "../../lib/links";
import { ResourceHeader, saveMeta, useResource } from "./ResourceHeader";

interface StreamMeta {
  url: string;
  format: StreamFormat;
}

type PlayState = { kind: "loading" } | { kind: "playing" } | { kind: "error"; message: string };

/**
 * An external stream (HLS, DASH or a plain video URL). Worlds keeps the link,
 * not a copy: it is played from where it lives, and is never presented as a
 * local file.
 */
export function StreamView({ id }: { id: string }) {
  const meta = useStore((s) => s.pages[id]);
  const { page, error } = useResource(id);
  const [editing, setEditing] = useState(false);
  if (error) return <EmptyState icon="warning" title="This stream could not be opened" text={error} />;
  if (!page || !meta) return <div className="page-loading"><Spinner /></div>;
  const stream = (page.metadata as { stream?: StreamMeta }).stream;
  return (
    <div className="res-view res-stream">
      <ResourceHeader
        meta={meta}
        subtitle={<span className="res-badge">External stream · {stream ? FORMAT_LABEL[stream.format] : "no link"}</span>}
        actions={<Button variant="quiet" icon="link" onClick={() => setEditing((v) => !v)}>Link</Button>}
      />
      {(editing || !stream) && <StreamLinkEditor id={id} stream={stream} onDone={() => setEditing(false)} />}
      {stream && <StreamPlayer key={stream.url} stream={stream} />}
    </div>
  );
}

const FORMAT_LABEL: Record<StreamFormat, string> = { hls: "HLS (m3u8)", dash: "DASH (mpd)", progressive: "Video link" };

function StreamLinkEditor({ id, stream, onDone }: { id: string; stream?: StreamMeta; onDone: () => void }) {
  const [url, setUrl] = useState(stream?.url ?? "");
  let valid = false;
  try {
    const u = new URL(url.trim());
    valid = u.protocol === "https:" || u.protocol === "http:";
  } catch {
    valid = false;
  }
  const save = async () => {
    if (!valid) return;
    await saveMeta(id, "stream", { url: url.trim(), format: detectStreamFormat(url.trim()) });
    onDone();
  };
  return (
    <div className="res-card stream-link">
      <input className="field" dir="ltr" value={url} placeholder="https://example.com/live/index.m3u8" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
      <Button variant="tinted" disabled={!valid} onClick={save}>Save</Button>
    </div>
  );
}

function StreamPlayer({ stream }: { stream: StreamMeta }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<PlayState>({ kind: "loading" });

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    let destroy: (() => void) | null = null;
    let cancelled = false;
    const fail = (message: string) => !cancelled && setState({ kind: "error", message });
    el.onloadeddata = () => !cancelled && setState({ kind: "playing" });
    el.onerror = () => fail("The stream did not play. The link may be offline, expired, or blocked by its server.");

    if (stream.format === "hls" && !el.canPlayType("application/vnd.apple.mpegurl")) {
      import("hls.js").then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) return fail("This system cannot play HLS streams.");
        // No worker: the app's content policy does not allow script blobs.
        const hls = new Hls({ enableWorker: false });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) fail(`The stream stopped: ${data.details}.`);
        });
        hls.loadSource(stream.url);
        hls.attachMedia(el);
        destroy = () => hls.destroy();
      });
    } else if (stream.format === "dash") {
      fail("DASH streams (.mpd) are saved, but Worlds cannot play them yet.");
    } else {
      el.src = stream.url;
    }
    return () => {
      cancelled = true;
      destroy?.();
      el.removeAttribute("src");
      el.load();
    };
  }, [stream.url, stream.format]);

  return (
    <div className="res-stream-stage">
      <video ref={video} controls playsInline />
      {state.kind === "loading" && (
        <div className="stream-overlay">
          <Spinner />
          <span>Connecting to the stream</span>
        </div>
      )}
      {state.kind === "error" && (
        <div className="stream-overlay is-error">
          <span className="bidi">{state.message}</span>
          <Button variant="quiet" icon="openExternal" onClick={() => openExternal(stream.url)}>Open the link</Button>
        </div>
      )}
      <p className="stream-url" dir="ltr">{stream.url}</p>
    </div>
  );
}
