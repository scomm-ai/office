import type { AlertKind } from "./action-alert-types";
import { MessageBar, MessageBarBody } from "@fluentui/react-components";

export type { AlertKind } from "./action-alert-types";

const INTENT: Record<AlertKind, "success" | "warning" | "error" | "info"> = {
  ok: "success",
  warn: "warning",
  error: "error",
  pending: "info",
};

/**
 * Inline result of the action the user just took — rendered next to that control.
 */
export function ActionAlert({
  id,
  kind,
  message,
}: {
  id?: string;
  kind: AlertKind;
  message: string;
}) {
  return (
    <MessageBar id={id} intent={INTENT[kind]} role="status">
      <MessageBarBody>{message}</MessageBarBody>
    </MessageBar>
  );
}
