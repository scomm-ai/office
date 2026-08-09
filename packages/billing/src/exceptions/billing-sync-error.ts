export type BillingSyncErrorKind =
  | "unauthorized"
  | "forbidden"
  | "notFound"
  | "rateLimited"
  | "invalidResponse"
  | "network"
  | "unknown";

export interface BillingSyncError {
  kind: BillingSyncErrorKind;
  userMessage: string;
  technicalDetail?: string;
}

export function billingSyncErrorFromHttp(options: {
  statusCode: number;
  operation: string;
  responseBody?: string;
}): BillingSyncError {
  const { statusCode, operation, responseBody } = options;
  if (statusCode === 401) {
    return {
      kind: "unauthorized",
      userMessage: "Session expired. Sign in again.",
      technicalDetail: `${operation}: HTTP 401`,
    };
  }
  if (statusCode === 403) {
    return {
      kind: "forbidden",
      userMessage: "You do not have access to this billing account.",
      technicalDetail: `${operation}: HTTP 403`,
    };
  }
  if (statusCode === 404) {
    return {
      kind: "notFound",
      userMessage: "Billing context not found.",
      technicalDetail: `${operation}: HTTP 404`,
    };
  }
  if (statusCode === 429) {
    return {
      kind: "rateLimited",
      userMessage: "Too many requests. Try again shortly.",
      technicalDetail: `${operation}: HTTP 429`,
    };
  }
  return {
    kind: "unknown",
    userMessage: "Billing server error. Try again later.",
    technicalDetail: `${operation}: HTTP ${statusCode}${responseBody ? ` body=${responseBody.slice(0, 200)}` : ""}`,
  };
}

export function billingSyncErrorFromNetwork(
  error: unknown,
  operation: string,
): BillingSyncError {
  return {
    kind: "network",
    userMessage: "Could not reach the billing server. Check your connection.",
    technicalDetail: `${operation}: ${error instanceof Error ? error.message : String(error)}`,
  };
}
