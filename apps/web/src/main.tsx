import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./fonts.css";
import "@voyalier/ui/tokens.css";
import "./styles.css";
import { App } from "./App";
import { applyThemeChoice, readThemeChoice } from "./app/theme";

// Apply the saved theme before first paint to avoid a flash of the wrong palette.
applyThemeChoice(readThemeChoice());
const savedMotion = globalThis.localStorage?.getItem("voyalier.motion");
if (savedMotion === "reduced" || savedMotion === "full") {
  document.documentElement.dataset.voyMotion = savedMotion;
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Voyalier root element was not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
