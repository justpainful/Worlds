import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { sfIcon } from "./sfIcons";
import { setIconRenderer } from "./ui";
import "./styles.css";

setIconRenderer(sfIcon);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
