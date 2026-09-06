import type { ReactNode } from "react";
import { FluentProvider, webLightTheme, tokens } from "@fluentui/react-components";

/**
 * Outlook task pane Fluent v9 shell. webLightTheme matches New Outlook / WinUI.
 */
export function FluentApp({ children }: { children: ReactNode }) {
  return (
    <FluentProvider
      theme={webLightTheme}
      style={{
        minHeight: "100%",
        height: "100%",
        backgroundColor: tokens.colorNeutralBackground2,
        color: tokens.colorNeutralForeground1,
      }}
    >
      {children}
    </FluentProvider>
  );
}
