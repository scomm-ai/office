import type { ReactNode } from "react";
import { Toast, ToastBody, ToastTitle, Toaster, useToastController } from "@fluentui/react-components";

/** Single app-wide toaster id — one <Toaster> is mounted in FluentApp; every
 * view dispatches into it via useAppToast() rather than mounting its own. */
export const APP_TOASTER_ID = "scomm-app-toaster";

export function AppToaster() {
  return <Toaster toasterId={APP_TOASTER_ID} position="top-end" pauseOnHover />;
}

type ToastIntent = "success" | "error" | "warning" | "info";

/** Dispatches a toast into the app-wide <Toaster> instead of an inline banner. */
export function useAppToast() {
  const { dispatchToast } = useToastController(APP_TOASTER_ID);

  const show = (intent: ToastIntent, title: string, body?: ReactNode) => {
    dispatchToast(
      <Toast>
        <ToastTitle>{title}</ToastTitle>
        {body ? <ToastBody>{body}</ToastBody> : null}
      </Toast>,
      { intent, timeout: intent === "error" ? 8000 : 4000 },
    );
  };

  return {
    showError: (message: ReactNode) => show("error", "Error", message),
    showSuccess: (message: ReactNode) => show("success", "Success", message),
    showWarning: (message: ReactNode) => show("warning", "Warning", message),
    showInfo: (message: ReactNode) => show("info", "Info", message),
  };
}
