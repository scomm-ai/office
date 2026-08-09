export interface MicrosoftUser {
  id: string;
  displayName: string;
  mail?: string;
  userPrincipalName: string;
}

export interface GraphMessageAddress {
  name?: string;
  address: string;
}

export interface GraphMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType: "text" | "html"; content: string };
  from?: GraphMessageAddress;
  toRecipients?: GraphMessageAddress[];
  ccRecipients?: GraphMessageAddress[];
  receivedDateTime?: string;
  hasAttachments?: boolean;
}

export interface GraphContact {
  id: string;
  displayName: string;
  emailAddresses: Array<{ address: string; name?: string }>;
}

export interface SearchOptions {
  top?: number;
  skip?: number;
}

export interface ContactQuery {
  search?: string;
  top?: number;
}

export interface MicrosoftIdentityProvider {
  getUser(): Promise<MicrosoftUser>;
  getGraphToken(scopes: string[]): Promise<string>;
}

export interface MicrosoftGraphClient {
  getCurrentUser(): Promise<MicrosoftUser>;
  getMessageById(id: string): Promise<GraphMessage | null>;
  getConversationMessages(conversationId: string): Promise<GraphMessage[]>;
  searchMessages(query: string, options?: SearchOptions): Promise<GraphMessage[]>;
  getContacts(options?: ContactQuery): Promise<GraphContact[]>;
}
