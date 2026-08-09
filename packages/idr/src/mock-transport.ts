import type {
  IdrAuthOptions,
  IdrConnectOptions,
  IdrRequest,
  IdrResponse,
  IdrTarget,
  IdrTransport,
  IdrConnectionState,
} from "./transport.js";

type FetchHandler = (request: IdrRequest) => Promise<IdrResponse>;

export class MockIdrTransport implements IdrTransport {
  private state: IdrConnectionState = "idle";
  private authenticated = false;
  private fetchHandler: FetchHandler | null = null;

  setFetchHandler(handler: FetchHandler | null): void {
    this.fetchHandler = handler;
  }

  setAuthenticated(value: boolean): void {
    this.authenticated = value;
  }

  setState(state: IdrConnectionState): void {
    this.state = state;
  }

  async authenticate(_options?: IdrAuthOptions): Promise<void> {
    this.state = "authenticating";
    this.authenticated = true;
    this.state = "idle";
  }

  async ensureSession(_options?: IdrAuthOptions): Promise<void> {
    await this.authenticate(_options);
  }

  async connect(_target: IdrTarget, _options?: IdrConnectOptions): Promise<void> {
    this.state = "connecting";
    this.state = "connected";
  }

  async disconnect(): Promise<void> {
    this.state = "idle";
  }

  async close(): Promise<void> {
    this.state = "idle";
    this.authenticated = false;
  }

  async fetch(request: IdrRequest): Promise<IdrResponse> {
    if (this.fetchHandler) {
      return this.fetchHandler(request);
    }

    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      json: async () => ({ models: [] }),
      text: async () => JSON.stringify({ models: [] }),
    };
  }

  getState(): IdrConnectionState {
    return this.state;
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }
}

export function jsonResponse(body: unknown, status = 200): IdrResponse {
  const payload = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "content-type": "application/json" },
    json: async () => body,
    text: async () => payload,
  };
}
