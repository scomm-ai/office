import { IdrClient, type IdrConnectionState as SdkConnectionState } from "@idrto/idr_browser_sdk";
import { IdrConnectionError } from "@scomm-office/core";
import type {
  IdrAuthOptions,
  IdrConnectOptions,
  IdrRequest,
  IdrResponse,
  IdrTarget,
  IdrTransport,
  IdrConnectionState,
} from "./transport.js";

function mapResponse(response: {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  json(): Promise<unknown>;
  text(): Promise<string>;
}): IdrResponse {
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.ok ? "OK" : "Error",
    headers: response.headers,
    json: () => response.json(),
    text: () => response.text(),
  };
}

function mapState(state: SdkConnectionState): IdrConnectionState {
  switch (state) {
    case "idle":
    case "connecting":
    case "connected":
    case "failed":
      return state;
    case "reconnecting":
      return "connecting";
    case "closed":
      return "idle";
    default:
      return "idle";
  }
}

function wrapError(error: unknown, message: string): IdrConnectionError {
  if (error instanceof IdrConnectionError) {
    return error;
  }
  return new IdrConnectionError(message, { cause: error });
}

function toIdrBody(
  body: BodyInit | null | undefined,
): string | ArrayBuffer | Uint8Array | undefined {
  if (body === null || body === undefined) {
    return undefined;
  }
  if (typeof body === "string" || body instanceof ArrayBuffer || body instanceof Uint8Array) {
    return body;
  }
  throw new IdrConnectionError("IDR fetch body type is not supported in browser transport");
}

export class IdrBrowserTransport implements IdrTransport {
  private client: IdrClient | null = null;
  private readonly service: string;
  private authenticated = false;

  constructor(service: string) {
    this.service = service;
  }

  private getClient(): IdrClient {
    if (!this.client) {
      this.client = IdrClient.forService(this.service);
    }
    return this.client;
  }

  async authenticate(options?: IdrAuthOptions): Promise<void> {
    await this.ensureSession(options);
  }

  async ensureSession(options?: IdrAuthOptions): Promise<void> {
    try {
      const client = this.getClient();
      await client.ensureSession({
        interactive: options?.interactive ?? true,
        mount: options?.mount,
      });
      this.authenticated = client.isAuthenticated();
    } catch (error) {
      throw wrapError(error, "IDR authentication failed");
    }
  }

  async connect(target: IdrTarget, options?: IdrConnectOptions): Promise<void> {
    try {
      const client = this.getClient();
      await client.connect({
        host: target.host,
        signal: options?.signal,
        timeoutMs: options?.timeoutMs ?? 60_000,
      });
    } catch (error) {
      throw wrapError(error, "IDR connection failed");
    }
  }

  async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      await this.client.close();
      this.client = null;
      this.authenticated = false;
    } catch (error) {
      throw wrapError(error, "IDR disconnect failed");
    }
  }

  async close(): Promise<void> {
    await this.disconnect();
  }

  async fetch(request: IdrRequest): Promise<IdrResponse> {
    try {
      const client = this.getClient();
      const response = await client.fetch(request.path, {
        method: request.method,
        headers: request.headers,
        body: toIdrBody(request.body),
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
      return mapResponse(response);
    } catch (error) {
      throw wrapError(error, `IDR fetch failed for ${request.path}`);
    }
  }

  getState(): IdrConnectionState {
    if (!this.client) {
      return "idle";
    }
    return mapState(this.client.connectionState());
  }

  isAuthenticated(): boolean {
    if (!this.client) {
      return this.authenticated;
    }
    return this.client.isAuthenticated();
  }
}
