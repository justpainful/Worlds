import "./dev/mockTauri";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource/ibm-plex-sans-arabic/300.css";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./glass/glass.css";
import "./styles/ui.css";
import "./styles/shell.css";
import "./styles/views.css";
import "./styles/claude.css";
import "./styles/profile.css";
import "./styles/settings.css";
import "./styles/pages.css";
import "./styles/editor.css";
import "./styles/system.css";
import { installSpringTokens } from "./motion/spring";
import { App } from "./App";

installSpringTokens();

// Surface webview errors in the dev log (the webview console is not visible there).
if ("__TAURI_INTERNALS__" in window) {
  const report = (msg: string) => import("@tauri-apps/api/core").then(({ invoke }) => invoke("client_log", { message: msg }).catch(() => {}));
  window.addEventListener("error", (e) => report(`${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => report(`unhandled: ${e.reason instanceof Error ? e.reason.stack ?? e.reason.message : String(e.reason)}`));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
