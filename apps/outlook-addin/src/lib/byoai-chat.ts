import type { MailHost } from "@scomm-office/office";
import {
  buildEmailContextMessage,
  extractProposedDraft,
  type CloudAiClient,
  type CloudAiProfile,
  type CloudChatMessage,
} from "@scomm-office/byoai";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Present on an assistant message that proposed a full draft replacement. */
  proposedDraft?: string | null;
}

function nextId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Sends one chat turn. Re-reads the live message/compose state from `mailHost`
 * at call time (never a cached snapshot) so the AI always sees what's on screen now.
 */
export async function sendChatTurn(params: {
  mailHost: MailHost;
  cloudClient: CloudAiClient;
  profile: CloudAiProfile;
  history: ChatMessage[];
  userText: string;
}): Promise<{ userMessage: ChatMessage; assistantMessage: ChatMessage; mode: "read" | "compose" }> {
  const mode = params.mailHost.getMode();
  const contextInput =
    mode === "compose"
      ? await (async () => {
          const compose = await params.mailHost.getComposeState();
          return { mode, subject: compose.subject, bodyText: compose.bodyText, to: compose.to };
        })()
      : await (async () => {
          const current = await params.mailHost.getCurrentMessage();
          return {
            mode,
            subject: current.subject,
            bodyText: current.bodyText,
            from: current.from,
            to: current.to,
          };
        })();

  const systemMessage = buildEmailContextMessage(contextInput);
  const priorTurns: CloudChatMessage[] = params.history.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const userMessage: ChatMessage = { id: nextId(), role: "user", content: params.userText };

  const result = await params.cloudClient.chat({
    profile: params.profile,
    messages: [systemMessage, ...priorTurns, { role: "user", content: params.userText }],
  });

  const proposedDraft = mode === "compose" ? extractProposedDraft(result.content) : null;
  const assistantMessage: ChatMessage = {
    id: nextId(),
    role: "assistant",
    content: result.content,
    proposedDraft,
  };

  return { userMessage, assistantMessage, mode };
}
