import { MicrosoftGraphError } from "@scomm-office/core";
import type {
  ContactQuery,
  GraphContact,
  GraphMessage,
  GraphMessageAddress,
  MicrosoftGraphClient,
  MicrosoftUser,
  SearchOptions,
} from "./types.js";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

/** Least-privilege delegated scopes for each Graph operation this client performs. */
export const GRAPH_SCOPES = {
  profile: ["User.Read"],
  readMail: ["Mail.Read"],
  sendMail: ["Mail.ReadWrite", "Mail.Send"],
  readContacts: ["Contacts.Read"],
} as const;

export interface GraphTokenProvider {
  getGraphToken(scopes: string[]): Promise<string>;
}

interface RawGraphAddress {
  emailAddress?: { name?: string; address?: string };
}

interface RawGraphMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  from?: RawGraphAddress;
  toRecipients?: RawGraphAddress[];
  receivedDateTime?: string;
  hasAttachments?: boolean;
}

function toAddress(raw: RawGraphAddress | undefined): GraphMessageAddress | undefined {
  const address = raw?.emailAddress?.address;
  if (!address) return undefined;
  return { address, name: raw?.emailAddress?.name };
}

function toGraphMessage(raw: RawGraphMessage): GraphMessage {
  return {
    id: raw.id,
    conversationId: raw.conversationId,
    subject: raw.subject,
    bodyPreview: raw.bodyPreview,
    body: raw.body?.content !== undefined
      ? { contentType: raw.body.contentType === "text" ? "text" : "html", content: raw.body.content }
      : undefined,
    from: toAddress(raw.from),
    toRecipients: (raw.toRecipients ?? [])
      .map(toAddress)
      .filter((a): a is GraphMessageAddress => a !== undefined),
    receivedDateTime: raw.receivedDateTime,
    hasAttachments: raw.hasAttachments,
  };
}

/**
 * Production `MicrosoftGraphClient` backed by `fetch` against Graph v1.0.
 *
 * Tokens are requested per-call with the least-privilege scope for that operation
 * (see `GRAPH_SCOPES`), rather than one broad token for the client's lifetime.
 */
export class HttpMicrosoftGraphClient implements MicrosoftGraphClient {
  constructor(private readonly tokens: GraphTokenProvider) {}

  private async request(
    path: string,
    scopes: readonly string[],
    init: RequestInit = {},
  ): Promise<Response> {
    const token = await this.tokens.getGraphToken([...scopes]);
    const response = await fetch(`${GRAPH_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new MicrosoftGraphError(
        `Graph request failed: ${init.method ?? "GET"} ${path} -> ${response.status} ${detail}`.trim(),
      );
    }
    return response;
  }

  async getCurrentUser(): Promise<MicrosoftUser> {
    const response = await this.request("/me", GRAPH_SCOPES.profile);
    return (await response.json()) as MicrosoftUser;
  }

  async getMessageById(id: string): Promise<GraphMessage | null> {
    const token = await this.tokens.getGraphToken([...GRAPH_SCOPES.readMail]);
    const response = await fetch(`${GRAPH_BASE_URL}/me/messages/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new MicrosoftGraphError(`Graph request failed: GET /me/messages/${id} -> ${response.status} ${detail}`);
    }
    return toGraphMessage((await response.json()) as RawGraphMessage);
  }

  async getConversationMessages(conversationId: string): Promise<GraphMessage[]> {
    const filter = encodeURIComponent(`conversationId eq '${conversationId.replace(/'/g, "''")}'`);
    const response = await this.request(`/me/messages?$filter=${filter}`, GRAPH_SCOPES.readMail);
    const payload = (await response.json()) as { value?: RawGraphMessage[] };
    return (payload.value ?? []).map(toGraphMessage);
  }

  async searchMessages(query: string, options: SearchOptions = {}): Promise<GraphMessage[]> {
    const params = new URLSearchParams();
    params.set("$search", `"${query.replace(/"/g, '\\"')}"`);
    if (options.top !== undefined) params.set("$top", String(options.top));
    if (options.skip !== undefined) params.set("$skip", String(options.skip));
    const response = await this.request(`/me/messages?${params.toString()}`, GRAPH_SCOPES.readMail, {
      headers: { ConsistencyLevel: "eventual" },
    });
    const payload = (await response.json()) as { value?: RawGraphMessage[] };
    return (payload.value ?? []).map(toGraphMessage);
  }

  async getContacts(options: ContactQuery = {}): Promise<GraphContact[]> {
    const params = new URLSearchParams();
    if (options.search) params.set("$search", `"${options.search.replace(/"/g, '\\"')}"`);
    if (options.top !== undefined) params.set("$top", String(options.top));
    const query = params.toString();
    const response = await this.request(
      `/me/contacts${query ? `?${query}` : ""}`,
      GRAPH_SCOPES.readContacts,
    );
    const payload = (await response.json()) as { value?: GraphContact[] };
    return payload.value ?? [];
  }

  /**
   * Creates a draft from raw MIME (Graph parses envelope headers from the content
   * itself) and immediately sends it. This is the only Graph path that preserves an
   * exact Content-Type such as multipart/encrypted — Office.js compose APIs cannot.
   */
  async sendMimeMessage(mime: Uint8Array): Promise<void> {
    const createResponse = await this.request("/me/messages", GRAPH_SCOPES.sendMail, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: mime as BodyInit,
    });
    const draft = (await createResponse.json()) as { id: string };
    await this.request(`/me/messages/${encodeURIComponent(draft.id)}/send`, GRAPH_SCOPES.sendMail, {
      method: "POST",
    });
  }
}
