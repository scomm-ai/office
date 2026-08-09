export type IdrConnectionState =
  | "idle"
  | "authenticating"
  | "connecting"
  | "connected"
  | "failed"
  | "unsupported";

export interface IdrTarget {
  host: string;
  service: string;
}

export interface IdrAuthOptions {
  interactive?: boolean;
  mount?: HTMLElement;
}

export interface IdrConnectOptions {
  transport?: "auto" | "webrtc" | "https";
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface IdrRequest {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface IdrResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface IdrTransport {
  authenticate(options?: IdrAuthOptions): Promise<void>;
  ensureSession?(options?: IdrAuthOptions): Promise<void>;
  connect(target: IdrTarget, options?: IdrConnectOptions): Promise<void>;
  disconnect(): Promise<void>;
  close?(): Promise<void>;
  fetch(request: IdrRequest): Promise<IdrResponse>;
  getState(): IdrConnectionState;
  isAuthenticated(): boolean;
}

export interface IdrRuntimeSupport {
  webRtc: boolean;
  webCryptoEd25519: boolean;
  status: "supported" | "unsupported" | "blocked";
}
