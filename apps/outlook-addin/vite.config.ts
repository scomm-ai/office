import { execFileSync } from "node:child_process";
import type http from "node:http";
import net from "node:net";
import tls from "node:tls";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin, type PreviewServer, type ViteDevServer } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(rootDir, "../..");
const packagesDir = path.resolve(rootDir, "../../packages");
const defaultAddinPort = 5173;
const defaultAddinOrigin = `https://localhost:${defaultAddinPort}`;
const sourceManifestPath = path.join(rootDir, "manifest", "manifest.xml");
const localManifestPath = path.join(rootDir, "manifest", "manifest.local.xml");
/** Same-origin prefix used by resolvePubkeyWriteBaseUrl on localhost. */
const pubkeyWriteProxyPath = "/pubkey-write";
const pubkeyReadProxyPath = "/pubkey-read";
const hopByHop = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "origin",
  "alt-svc",
]);

function parseAddinPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return defaultAddinPort;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ADDIN_PORT: ${JSON.stringify(raw)}`);
  }
  return port;
}

/** Production write host. api.pubkey.scomm.ai is not in DNS. */
function rewriteLegacyPubkeyWriteHost(raw: string): string {
  const trimmed = raw.replace(/\/+$/, "");
  try {
    if (new URL(trimmed).hostname === "api.pubkey.scomm.ai") {
      return "https://pubkey.scomm.ai";
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

/**
 * Self-signed cert with SAN localhost / 127.0.0.1.
 * @vitejs/plugin-basic-ssl uses CN=example.org, which Outlook WebView rejects.
 */
function localhostHttps(): { key: Buffer; cert: Buffer } {
  const dir = path.join(rootDir, ".certs");
  const keyFile = path.join(dir, "localhost-key.pem");
  const certFile = path.join(dir, "localhost-cert.pem");
  if (!existsSync(keyFile) || !existsSync(certFile)) {
    mkdirSync(dir, { recursive: true });
    execFileSync("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-days",
      "365",
      "-nodes",
      "-keyout",
      keyFile,
      "-out",
      certFile,
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1",
    ]);
  }
  return { key: readFileSync(keyFile), cert: readFileSync(certFile) };
}

type UpstreamHeaders = Record<string, string | string[]>;

type UpstreamResult = {
  status: number;
  headers: UpstreamHeaders;
  body: Buffer;
  localPort?: number;
};

/**
 * One raw HTTP/1.1 TLS socket to the write API.
 *
 * Dart/Dio pins the decrypt challenge to that client session (keep-alive
 * socket + HttpClient cookie jar). Node's `http.request` + a reused socket
 * can drop `Set-Cookie` / desync the parser, and forwarding Outlook headers
 * can make nginx treat us unlike Dio. Speak HTTP/1.1 ourselves and only send
 * the headers Dio sends.
 */
function pubkeyWriteStickyProxy(targetBase: string): Plugin {
  const target = new URL(targetBase.endsWith("/") ? targetBase : `${targetBase}/`);
  const useTls = target.protocol === "https:";
  const port = target.port ? Number(target.port) : useTls ? 443 : 80;
  let stickySocket: net.Socket | tls.TLSSocket | null = null;
  const cookieJar = new Map<string, string>();
  let queue: Promise<void> = Promise.resolve();

  function dropSticky(socket: net.Socket | tls.TLSSocket): void {
    if (stickySocket === socket) stickySocket = null;
  }

  function cookieHeader(): string | undefined {
    if (cookieJar.size === 0) return undefined;
    return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  function rememberSetCookie(raw: string | string[] | undefined): void {
    const lines = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
    for (const line of lines) {
      const pair = line.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      cookieJar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  function mergeBrowserCookies(raw: string | undefined): void {
    if (!raw) return;
    for (const part of raw.split(";")) {
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      const name = part.slice(0, eq).trim();
      if (!name || cookieJar.has(name)) continue;
      cookieJar.set(name, part.slice(eq + 1).trim());
    }
  }

  function requestPath(url: string): string {
    const pathAndQuery =
      url.startsWith("http://") || url.startsWith("https://")
        ? new URL(url).pathname + new URL(url).search
        : url;
    return pathAndQuery.slice(pubkeyWriteProxyPath.length) || "/";
  }

  function readBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work, work);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function connectSocket(): Promise<net.Socket | tls.TLSSocket> {
    return new Promise((resolve, reject) => {
      if (useTls) {
        const socket = tls.connect({
          host: target.hostname,
          port,
          servername: target.hostname,
          ALPNProtocols: ["http/1.1"],
        });
        stickySocket = socket;
        socket.setNoDelay(true);
        socket.setKeepAlive(true, 30_000);
        socket.once("secureConnect", () => resolve(socket));
        socket.once("error", (error) => {
          dropSticky(socket);
          reject(error);
        });
        socket.once("close", () => dropSticky(socket));
        return;
      }
      const socket = net.connect({ host: target.hostname, port });
      stickySocket = socket;
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 30_000);
      socket.once("connect", () => resolve(socket));
      socket.once("error", (error) => {
        dropSticky(socket);
        reject(error);
      });
      socket.once("close", () => dropSticky(socket));
    });
  }

  async function ensureSocket(): Promise<net.Socket | tls.TLSSocket> {
    if (stickySocket && !stickySocket.destroyed) {
      return stickySocket;
    }
    return connectSocket();
  }

  function consumeChunked(buf: Buffer): { body: Buffer; rest: Buffer } | null {
    let offset = 0;
    const parts: Buffer[] = [];
    while (true) {
      const nl = buf.indexOf("\r\n", offset);
      if (nl < 0) return null;
      const size = Number.parseInt(buf.subarray(offset, nl).toString("ascii"), 16);
      if (Number.isNaN(size)) {
        throw new Error("pubkey-write: invalid chunked encoding");
      }
      const dataStart = nl + 2;
      if (size === 0) {
        if (buf.length < dataStart + 2) return null;
        return { body: Buffer.concat(parts), rest: buf.subarray(dataStart + 2) };
      }
      if (buf.length < dataStart + size + 2) return null;
      parts.push(buf.subarray(dataStart, dataStart + size));
      offset = dataStart + size + 2;
    }
  }

  function readHttpResponse(socket: net.Socket | tls.TLSSocket): Promise<UpstreamResult> {
    return new Promise((resolve, reject) => {
      let buf = Buffer.alloc(0);
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onEnd = () => {
        cleanup();
        reject(new Error("pubkey-write: upstream closed before the response finished"));
      };
      const cleanup = () => {
        socket.off("data", onData);
        socket.off("error", onError);
        socket.off("end", onEnd);
      };
      const finish = (result: UpstreamResult) => {
        cleanup();
        resolve(result);
      };
      const onData = (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        const split = buf.indexOf("\r\n\r\n");
        if (split < 0) return;
        const head = buf.subarray(0, split).toString("latin1");
        const lines = head.split("\r\n");
        const status = Number(lines[0]?.split(" ")[1] ?? 502);
        const headers: UpstreamHeaders = {};
        for (const line of lines.slice(1)) {
          const colon = line.indexOf(":");
          if (colon <= 0) continue;
          const name = line.slice(0, colon).trim().toLowerCase();
          const value = line.slice(colon + 1).trim();
          if (name === "set-cookie") {
            const prev = headers[name];
            headers[name] = prev == null ? [value] : Array.isArray(prev) ? [...prev, value] : [prev, value];
          } else {
            headers[name] = value;
          }
        }
        const rest = buf.subarray(split + 4);
        const encoding = String(headers["transfer-encoding"] ?? "")
          .toLowerCase()
          .includes("chunked");
        if (encoding) {
          try {
            const parsed = consumeChunked(rest);
            if (!parsed) return;
            finish({ status, headers, body: parsed.body, localPort: socket.localPort });
          } catch (error) {
            cleanup();
            reject(error);
          }
          return;
        }
        const length = Number(headers["content-length"] ?? 0);
        if (!Number.isFinite(length) || length < 0) {
          cleanup();
          reject(new Error("pubkey-write: invalid content-length"));
          return;
        }
        if (rest.length < length) return;
        finish({
          status,
          headers,
          body: rest.subarray(0, length),
          localPort: socket.localPort,
        });
      };
      socket.on("data", onData);
      socket.once("error", onError);
      socket.once("end", onEnd);
    });
  }

  async function upstreamRequest(
    method: string,
    pathName: string,
    body: Buffer,
    extraCookie?: string,
  ): Promise<UpstreamResult> {
    mergeBrowserCookies(extraCookie);
    const socket = await ensureSocket();
    const headers: string[] = [
      `${method} ${pathName} HTTP/1.1`,
      `Host: ${target.host}`,
      "Connection: keep-alive",
      "Accept: application/json",
      "Accept-Encoding: identity",
      "User-Agent: scomm-pubkey-js/1.0",
      `Content-Length: ${body.length}`,
    ];
    if (body.length > 0) {
      headers.push("Content-Type: application/json");
    }
    const jar = cookieHeader();
    if (jar) {
      headers.push(`Cookie: ${jar}`);
    }
    const pending = readHttpResponse(socket);
    socket.write(`${headers.join("\r\n")}\r\n\r\n`);
    if (body.length > 0) {
      socket.write(body);
    }
    const result = await pending;
    rememberSetCookie(result.headers["set-cookie"]);
    return result;
  }

  function headerNames(headers: UpstreamHeaders): string {
    return Object.keys(headers).sort().join(",");
  }

  function setCookieCount(headers: UpstreamHeaders): number {
    const raw = headers["set-cookie"];
    if (raw == null) return 0;
    return Array.isArray(raw) ? raw.length : 1;
  }

  function bodyFlag(payload: Buffer, token: string): boolean {
    return payload.includes(token);
  }

  function errorCode(payload: Buffer): string {
    try {
      const parsed: unknown = JSON.parse(payload.toString("utf8"));
      if (!parsed || typeof parsed !== "object") return "";
      const record = parsed as { error?: unknown; code?: unknown };
      const value = record.error ?? record.code;
      return typeof value === "string" ? value : "";
    } catch {
      return "";
    }
  }

  function writeClientResponse(
    res: ServerResponse,
    status: number,
    headers: UpstreamHeaders,
    payload: Buffer,
  ): void {
    const outHeaders: http.OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(headers)) {
      if (hopByHop.has(name) || name === "content-length") continue;
      outHeaders[name] = value;
    }
    outHeaders["content-length"] = payload.length;
    if (!res.headersSent) {
      res.writeHead(status, outHeaders);
    }
    if (!res.writableEnded) {
      res.end(payload);
    }
  }

  function attach(server: ViteDevServer | PreviewServer): void {
    server.config.logger.info(
      `Pubkey write proxy ${pubkeyWriteProxyPath} → ${target.origin} (raw sticky HTTP/1.1)`,
    );
    server.middlewares.use((req: IncomingMessage, res: ServerResponse, next) => {
      const url = req.url ?? "";
      if (!url.startsWith(`${pubkeyWriteProxyPath}/`) && url !== pubkeyWriteProxyPath) {
        next();
        return;
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": req.headers.origin ?? "*",
          "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE",
          "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "*",
        });
        res.end();
        return;
      }
      const method = req.method ?? "GET";
      const pathName = requestPath(url);
      void enqueue(async () => {
        const body = await readBody(req);
        const result = await upstreamRequest(method, pathName, body, req.headers.cookie);
        const cookieNames = [...cookieJar.keys()].join(",") || "-";
        server.config.logger.info(
          `pubkey-write ${method} ${pathName} → ${result.status} (http1 port=${result.localPort ?? "?"} set-cookie=${setCookieCount(result.headers)} jar=${cookieNames} proof=${bodyFlag(body, "decrypt_proof")} err=${errorCode(result.body) || "-"} hdr=${headerNames(result.headers)})`,
        );
        writeClientResponse(res, result.status, result.headers, result.body);
      }).catch((error) => {
        if (stickySocket) {
          stickySocket.destroy();
          stickySocket = null;
        }
        if (!res.headersSent) {
          res.statusCode = 502;
          res.setHeader("content-type", "text/plain");
        }
        if (!res.writableEnded) {
          res.end(error instanceof Error ? error.message : "pubkey write proxy failed");
        }
      });
    });
  }

  return {
    name: "pubkey-write-sticky-proxy",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

function writeLocalManifestPlugin(port: number): Plugin {
  const origin = `https://localhost:${port}`;
  return {
    name: "scomm-local-manifest",
    configureServer(server) {
      const rendered = readFileSync(sourceManifestPath, "utf8").replaceAll(
        defaultAddinOrigin,
        origin,
      );
      writeFileSync(localManifestPath, rendered, "utf8");
      server.config.logger.info(`Outlook sideload: ${localManifestPath} (${origin})`);
    },
  };
}

const workspacePackages = [
  "core",
  "office",
  "semantics",
  "protocol",
  "pubkeys",
  "identity",
  "idr",
  "policy",
  "config",
  "storage",
  "byoai",
  "observability",
  "microsoft-graph",
  "crypto",
  "message-core",
  "mime",
  "crypto-openpgp",
  "crypto-smime",
  "semantic-signatures",
  "capability-negotiation",
  "mail-security",
] as const;

function workspaceAliases(): Record<string, string> {
  const aliases = Object.fromEntries(
    workspacePackages.map((name) => [
      `@scomm-office/${name}`,
      path.join(packagesDir, name, "src", "index.ts"),
    ]),
  );
  aliases["@scomm-office/testkit"] = path.resolve(rootDir, "src/stubs/testkit-browser.ts");
  aliases["node:crypto"] = path.resolve(rootDir, "src/stubs/node-crypto.ts");
  return aliases;
}

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, repoRoot, "ADDIN_");
  const viteEnv = loadEnv(mode, repoRoot, "VITE_");
  const addinPort = parseAddinPort(process.env.ADDIN_PORT ?? fileEnv.ADDIN_PORT);
  const billingProxyTarget = (
    process.env.VITE_BILLING_ORIGIN ||
    viteEnv.VITE_BILLING_ORIGIN ||
    "http://localhost:3000"
  ).replace(/\/+$/, "");
  const pubkeyWriteTarget = rewriteLegacyPubkeyWriteHost(
    process.env.VITE_PUBKEY_WRITE_BASE_URL ||
      viteEnv.VITE_PUBKEY_WRITE_BASE_URL ||
      "https://pubkey.scomm.ai",
  );
  const pubkeyReadTarget = rewriteLegacyPubkeyWriteHost(
    process.env.VITE_PUBKEY_READ_BASE_URL ||
      viteEnv.VITE_PUBKEY_READ_BASE_URL ||
      process.env.VITE_PUBKEY_SERVER_URL ||
      viteEnv.VITE_PUBKEY_SERVER_URL ||
      "https://pubkey.scomm.ai",
  );

  return {
    envDir: repoRoot,
    plugins: [
      react(),
      writeLocalManifestPlugin(addinPort),
      pubkeyWriteStickyProxy(pubkeyWriteTarget),
      {
        name: "scomm-pubkey-read-proxy-log",
        configureServer(server) {
          server.config.logger.info(
            `Pubkey read proxy ${pubkeyReadProxyPath} → ${pubkeyReadTarget}`,
          );
        },
      },
    ],
    resolve: {
      alias: workspaceAliases(),
    },
    server: {
      host: true,
      port: addinPort,
      strictPort: true,
      https: localhostHttps(),
      proxy: {
        // HTTPS task pane cannot fetch HTTP billing (mixed content). Same-origin poll.
        "/oauth-office-handoff": {
          target: billingProxyTarget,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/oauth-office-handoff/, "/oauth/office-handoff"),
        },
        // HTTPS task pane cannot fetch HTTP pubkey (mixed content). Same-origin reads.
        [pubkeyReadProxyPath]: {
          target: pubkeyReadTarget,
          changeOrigin: true,
          rewrite: (p) => p.replace(new RegExp(`^${pubkeyReadProxyPath}`), "") || "/",
        },
      },
    },
    preview: {
      port: addinPort,
      strictPort: true,
      https: localhostHttps(),
    },
    optimizeDeps: {
      include: ["@fluentui/react-components", "@fluentui/react-icons", "@griffel/core"],
    },
    build: {
      rollupOptions: {
        input: {
          taskpane: path.resolve(rootDir, "taskpane.html"),
          commands: path.resolve(rootDir, "commands.html"),
        },
      },
    },
  };
});
