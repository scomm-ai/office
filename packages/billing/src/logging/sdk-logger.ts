export type BillingSdkLogLevel = "info" | "warning" | "error" | "success";

export interface BillingSdkLogger {
  log(level: BillingSdkLogLevel, message: string, detail?: string): void;
}

const consoleLogger: BillingSdkLogger = {
  log(level, message, detail) {
    const line = detail ? `${message} ${detail}` : message;
    if (level === "error") {
      console.error(`[BillingSdk] ${line}`);
    } else if (level === "warning") {
      console.warn(`[BillingSdk] ${line}`);
    } else {
      console.info(`[BillingSdk] ${line}`);
    }
  },
};

let activeLogger: BillingSdkLogger = consoleLogger;

export const BillingSdkLog = {
  setLogger(logger: BillingSdkLogger): void {
    activeLogger = logger;
  },
  info(message: string, detail?: string): void {
    activeLogger.log("info", message, detail);
  },
  warning(message: string, detail?: string): void {
    activeLogger.log("warning", message, detail);
  },
  error(message: string, detail?: string): void {
    activeLogger.log("error", message, detail);
  },
  success(message: string, detail?: string): void {
    activeLogger.log("success", message, detail);
  },
};
