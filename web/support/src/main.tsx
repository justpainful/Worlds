import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setIconRenderer } from "../../admin/src/ui";
import { App } from "./App";
import { lucideIcon } from "./icons";
import "../../admin/src/styles.css";
import "./support.css";

setIconRenderer(lucideIcon);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
