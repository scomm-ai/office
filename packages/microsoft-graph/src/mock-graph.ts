import type {
  ContactQuery,
  GraphContact,
  GraphMessage,
  MicrosoftGraphClient,
  MicrosoftUser,
  SearchOptions,
} from "./types.js";

export class MockMicrosoftGraph implements MicrosoftGraphClient {
  private user: MicrosoftUser = {
    id: "user-001",
    displayName: "Alice Example",
    mail: "alice@example.com",
    userPrincipalName: "alice@example.com",
  };

  private messages = new Map<string, GraphMessage>();
  private conversations = new Map<string, GraphMessage[]>();
  private contacts: GraphContact[] = [
    {
      id: "contact-001",
      displayName: "Bob Partner",
      emailAddresses: [{ address: "bob@partner.org", name: "Bob Partner" }],
    },
  ];

  setCurrentUser(user: MicrosoftUser): void {
    this.user = user;
  }

  addMessage(message: GraphMessage): void {
    this.messages.set(message.id, message);
    if (message.conversationId) {
      const thread = this.conversations.get(message.conversationId) ?? [];
      thread.push(message);
      this.conversations.set(message.conversationId, thread);
    }
  }

  setContacts(contacts: GraphContact[]): void {
    this.contacts = contacts;
  }

  async getCurrentUser(): Promise<MicrosoftUser> {
    return { ...this.user };
  }

  async getMessageById(id: string): Promise<GraphMessage | null> {
    const message = this.messages.get(id);
    return message ? { ...message } : null;
  }

  async getConversationMessages(conversationId: string): Promise<GraphMessage[]> {
    return [...(this.conversations.get(conversationId) ?? [])].map((message) => ({ ...message }));
  }

  async searchMessages(query: string, options: SearchOptions = {}): Promise<GraphMessage[]> {
    const needle = query.toLowerCase();
    const matches = [...this.messages.values()].filter((message) => {
      const subject = message.subject?.toLowerCase() ?? "";
      const preview = message.bodyPreview?.toLowerCase() ?? "";
      return subject.includes(needle) || preview.includes(needle);
    });
    const skip = options.skip ?? 0;
    const top = options.top ?? matches.length;
    return matches.slice(skip, skip + top).map((message) => ({ ...message }));
  }

  async getContacts(options: ContactQuery = {}): Promise<GraphContact[]> {
    const search = options.search?.toLowerCase();
    let results = this.contacts;
    if (search) {
      results = results.filter(
        (contact) =>
          contact.displayName.toLowerCase().includes(search) ||
          contact.emailAddresses.some((email) => email.address.toLowerCase().includes(search)),
      );
    }
    const top = options.top ?? results.length;
    return results.slice(0, top).map((contact) => ({ ...contact }));
  }
}

export function createFixtureConversation(): GraphMessage[] {
  return [
    {
      id: "msg-001",
      conversationId: "conv-001",
      subject: "Project update",
      bodyPreview: "Here is the latest status.",
      body: { contentType: "text", content: "Here is the latest status." },
      from: { address: "alice@example.com", name: "Alice Example" },
      toRecipients: [{ address: "bob@partner.org", name: "Bob Partner" }],
      receivedDateTime: "2026-01-15T09:00:00.000Z",
      hasAttachments: false,
    },
    {
      id: "msg-002",
      conversationId: "conv-001",
      subject: "Re: Project update",
      bodyPreview: "Thanks, looks good.",
      body: { contentType: "text", content: "Thanks, looks good." },
      from: { address: "bob@partner.org", name: "Bob Partner" },
      toRecipients: [{ address: "alice@example.com", name: "Alice Example" }],
      receivedDateTime: "2026-01-15T10:30:00.000Z",
      hasAttachments: false,
    },
  ];
}
