# Microsoft Graph Authentication

## Status

**Proposed**

## Context

SComm Office uses **Microsoft Graph** for mailbox-wide operations (conversation threads, user profile, message lookup). Authentication from Office add-ins should use **Nested App Authentication (NAA)** with MSAL.js where supported, avoiding pop-up OAuth flows and parent-frame token forwarding.

Microsoft docs: [Nested app authentication](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/nested-app-authentication-overview).

## Problem

Graph access requires OAuth2 tokens. Naive approaches (popup login, token relay through server, scraping parent frame tokens) are insecure or poor UX. Platform support for NAA varies.

## Goals

- **`MicrosoftIdentityProvider`** abstraction isolating MSAL
- Nested App Authentication when `NestedAppAuth 1.1` supported
- Least-privilege Graph scopes for MVP operations
- Fallback interface for unsupported hosts (explicit, not insecure)
- Document admin consent requirements

## Non-goals

- Confidential client flows in browser (forbidden)
- Broad `Mail.ReadWrite` unless required
- Token caching in SComm server

## Constraints

- NAA requires Entra app registration with "Allow public client flows" and add-in redirect URIs
- SPA client secret must **never** ship in add-in bundle
- Some hosts (Outlook.com consumer, Gmail connector) may not support NAA
- Admin consent required for org-wide permission grants

## Proposed design

### Identity provider interface

```typescript
interface MicrosoftIdentityProvider {
  getUser(): Promise<MicrosoftUser>;
  getGraphToken(scopes: string[]): Promise<string>;
  signOut(): Promise<void>;
  getAuthMode(): "naa" | "fallback-unavailable" | "not-configured";
}
```

### NAA implementation (primary)

```typescript
class NestedAppAuthProvider implements MicrosoftIdentityProvider {
  async getGraphToken(scopes: string[]): Promise<string> {
    // MSAL.js acquireTokenNested with Office.auth bridge
    // Uses createNestablePublicClientApplication
  }
}
```

Configuration via environment / manifest:

- `AZURE_CLIENT_ID` (Entra application ID)
- Authority: `https://login.microsoftonline.com/{tenant}` or `common` for multi-tenant dev

### MVP Graph scopes (least privilege)

| Operation | Scope | Justification |
|-----------|-------|---------------|
| Read signed-in user | `User.Read` | Profile display |
| Read messages in conversation | `Mail.Read` | Thread semantics |
| Search mailbox (future) | `Mail.Read` | Same |
| Read contacts (future) | `Contacts.Read` | Recipient enrichment |

**Avoid for MVP:** `Mail.ReadWrite`, `Mail.Send`, `full_access_as_app`.

Expand scopes only with OpenSpec update and security review.

### Fallback interface

When NAA unavailable:

```typescript
class UnavailableGraphAuthProvider implements MicrosoftIdentityProvider {
  async getGraphToken(): Promise<string> {
    throw new AuthenticationRequiredError(
      "Microsoft Graph requires Nested App Authentication on this Outlook client. " +
      "Conversation features are disabled."
    );
  }
}
```

**Do not implement:**

- Hidden iframe token theft from Outlook parent
- Username/password resource owner grant
- Server-stored refresh tokens from add-in

Future fallback options (deferred):

- Device code flow with explicit user action outside add-in
- Organization SSO broker

### Capability gating

```typescript
if (!capabilities.nestedAppAuthentication) {
  useUnavailableGraphAuthProvider();
}
```

Task pane shows: "Graph features unavailable — NAA not supported on this client."

### Token handling

- Tokens in memory only for session
- Never log access tokens
- Never send Graph tokens to SComm server (unless future federation explicitly designed)
- `AbortSignal` + timeout on token acquisition

## Alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Popup OAuth | Poor UX in embedded task pane |
| On-behalf-of via SComm server | Requires server secret management; deferred |
| Full `Mail.ReadWrite` | Excessive privilege |

## Security considerations

- Least privilege scopes reduce blast radius
- Admin consent audit trail for enterprise deployment
- PKCE required for public client flows
- Validate JWT audience and expiry before Graph calls

## Compatibility

| Host | NAA expected |
|------|--------------|
| Outlook Web | Yes* |
| New Outlook Windows | Yes* |
| Classic Outlook | Varies by build |
| Mac | Varies |
| Mobile | No |

*Runtime detection required.

Graph operations degrade to Office.js-only when Graph unavailable.

## Open questions

- Multi-tenant vs single-tenant Entra app for initial deployment
- Whether `Mail.Read` requires admin consent in target enterprises
- Token silent refresh behavior across long compose sessions

## Decision

**MVP uses MSAL Nested App Authentication with `User.Read` + `Mail.Read` when `NestedAppAuth 1.1` detected. Unsupported hosts get explicit error — no insecure fallback. Graph adapter stubbed until Milestone 7.**

## Implementation status

| Item | Status |
|------|--------|
| `MicrosoftIdentityProvider` interface | Planned |
| NAA MSAL integration | Planned (Milestone 7) |
| Fallback stub | Planned |
| Entra app registration docs | Planned (README) |

## Deferred work

- On-behalf-of server flow for backend Graph access
- Admin consent deployment guide
- Conditional Access / MFA interaction testing
