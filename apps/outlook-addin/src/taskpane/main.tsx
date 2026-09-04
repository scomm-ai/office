import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { FluentApp } from "./ui/fluent-app";
import "./styles.css";

/**
 * Mount the task pane. `taskpane.html` calls `Office.onReady` first so Outlook
 * does not time out while Vite/Fluent are still loading.
 */
export function mountTaskPane(): void {
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

mountTaskPane();
