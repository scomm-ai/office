import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { FluentApp } from "./ui/fluent-app";
import "./styles.css";

function mountTaskPane(): void {
  const root = document.getElementById("root");
  if (!root) {
    return;
  }
  createRoot(root).render(
    <StrictMode>
      <FluentApp>
        <App />
      </FluentApp>
    </StrictMode>,
  );
}

if (typeof Office !== "undefined" && Office.onReady) {
  Office.onReady(() => {
    mountTaskPane();
  });
} else {
  mountTaskPane();
}
