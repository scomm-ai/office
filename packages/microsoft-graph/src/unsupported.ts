import { AuthenticationRequiredError, UnsupportedFeatureError } from "@scomm-office/core";
import type {
  ContactQuery,
  GraphContact,
  GraphMessage,
  MicrosoftGraphClient,
  MicrosoftIdentityProvider,
  MicrosoftUser,
  SearchOptions,
} from "./types.js";

const GRAPH_BOUNDARY_SPEC = "openspec/architecture/002-office-graph-boundary.md";
const GRAPH_AUTH_SPEC = "openspec/microsoft/graph-authentication.md";

export class UnsupportedMicrosoftGraphClient implements MicrosoftGraphClient {
  async getCurrentUser(): Promise<MicrosoftUser> {
    throw new UnsupportedFeatureError(
      `Microsoft Graph client is not configured. See ${GRAPH_BOUNDARY_SPEC}`,
    );
  }

  async getMessageById(_id: string): Promise<GraphMessage | null> {
    throw new UnsupportedFeatureError(
      `Microsoft Graph client is not configured. See ${GRAPH_BOUNDARY_SPEC}`,
    );
  }

  async getConversationMessages(_conversationId: string): Promise<GraphMessage[]> {
    throw new UnsupportedFeatureError(
      `Microsoft Graph client is not configured. See ${GRAPH_BOUNDARY_SPEC}`,
    );
  }

  async searchMessages(_query: string, _options?: SearchOptions): Promise<GraphMessage[]> {
    throw new UnsupportedFeatureError(
      `Microsoft Graph client is not configured. See ${GRAPH_BOUNDARY_SPEC}`,
    );
  }

  async getContacts(_options?: ContactQuery): Promise<GraphContact[]> {
    throw new UnsupportedFeatureError(
      `Microsoft Graph client is not configured. See ${GRAPH_BOUNDARY_SPEC}`,
    );
  }
}

export class UnsupportedMicrosoftIdentityProvider implements MicrosoftIdentityProvider {
  async getUser(): Promise<MicrosoftUser> {
    throw new AuthenticationRequiredError(
      `Microsoft identity provider is not configured. See ${GRAPH_AUTH_SPEC}`,
    );
  }

  async getGraphToken(_scopes: string[]): Promise<string> {
    throw new AuthenticationRequiredError(
      `Microsoft identity provider is not configured. See ${GRAPH_AUTH_SPEC}`,
    );
  }
}
