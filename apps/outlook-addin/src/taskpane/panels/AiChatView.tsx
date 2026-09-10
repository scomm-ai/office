import { useMemo, useRef, useState } from "react";
import { makeStyles, mergeClasses } from "@fluentui/react-components";
import { CloudAiClient, LocalStorageCloudAiKeyStore } from "@scomm-office/byoai";
import { Button, Note, PageTitle, StatusBadge, Text, Textarea, tokens, usePaneStyles } from "../ui/layout";
import { useHostContext } from "../../lib/host-context";
import { defaultProfile, loadProfiles } from "../../lib/byoai-profiles";
import { sendChatTurn, type ChatMessage } from "../../lib/byoai-chat";
import { ApplyDraftDialog } from "./ApplyDraftDialog";

const useBubbleStyles = makeStyles({
  bubble: {
    borderRadius: "16px",
    boxShadow: tokens.shadow2,
  },
  userBubble: {
    borderBottomRightRadius: "4px",
  },
  assistantBubble: {
    borderBottomLeftRadius: "4px",
  },
  cursor: {
    display: "inline-block",
    width: "0.5em",
    height: "1em",
    marginLeft: "2px",
    verticalAlign: "text-bottom",
    backgroundColor: tokens.colorNeutralForeground3,
    animationName: {
      "0%, 49%": { opacity: 1 },
      "50%, 100%": { opacity: 0 },
    },
    animationDuration: "1s",
    animationIterationCount: "infinite",
  },
});

export function AiChatView({ onOpenSetup }: { onOpenSetup: () => void }) {
  const styles = usePaneStyles();
  const bubbleStyles = useBubbleStyles();
  const { mailHost, message, refreshMessage } = useHostContext();
  const [profiles] = useState(() => loadProfiles());
  const profile = useMemo(() => defaultProfile(profiles), [profiles]);
  const keyStore = useMemo(() => new LocalStorageCloudAiKeyStore(), []);
  const cloudClient = useMemo(() => new CloudAiClient(keyStore), [keyStore]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyTarget, setApplyTarget] = useState<{ current: string; proposed: string } | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const streamingIdRef = useRef<string | null>(null);

  const isCompose = message?.mode === "compose";

  const scrollToEnd = () => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  const send = async () => {
    const text = input.trim();
    if (!text || !profile || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setInput("");
    try {
      const { assistantMessage } = await sendChatTurn({
        mailHost,
        cloudClient,
        profile,
        history: messages,
        userText: text,
        onStart: (userMessage, assistantMessageId) => {
          streamingIdRef.current = assistantMessageId;
          setMessages((prev) => [
            ...prev,
            userMessage,
            { id: assistantMessageId, role: "assistant", content: "" },
          ]);
          scrollToEnd();
        },
        onDelta: (delta) => {
          const id = streamingIdRef.current;
          setMessages((prev) =>
            prev.map((m) => (m.id === id ? { ...m, content: m.content + delta } : m)),
          );
          scrollToEnd();
        },
      });
      streamingIdRef.current = null;
      setMessages((prev) => prev.map((m) => (m.id === assistantMessage.id ? assistantMessage : m)));
      scrollToEnd();
    } catch (err) {
      const failedId = streamingIdRef.current;
      streamingIdRef.current = null;
      if (failedId) {
        setMessages((prev) => prev.filter((m) => m.id !== failedId || m.content));
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const openApply = async (proposed: string) => {
    try {
      const compose = await mailHost.getComposeState();
      setApplyTarget({ current: compose.bodyText ?? "", proposed });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmApply = async () => {
    if (!applyTarget) {
      return;
    }
    try {
      await mailHost.setBody({ text: applyTarget.proposed });
      setApplyTarget(null);
      await refreshMessage("byoai-apply");
      setMessages((prev) => [
        ...prev,
        { id: `applied-${Date.now()}`, role: "assistant", content: "Applied to the draft." },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!profile) {
    return (
      <>
        <PageTitle title="AI Chat" description="No cloud provider is ready yet." />
        <Button appearance="primary" size="small" onClick={onOpenSetup}>
          Go to setup
        </Button>
      </>
    );
  }

  return (
    <>
      <div className={styles.actions} style={{ justifyContent: "space-between" }}>
        <StatusBadge tone={isCompose ? "warn" : "ok"}>
          {isCompose ? `Composing: ${message?.subject || "(no subject)"}` : `Reading: ${message?.subject || "(no subject)"}`}
        </StatusBadge>
        <Button appearance="subtle" size="small" onClick={onOpenSetup}>
          ⚙ Provider settings
        </Button>
      </div>

      <div className={styles.stack} style={{ flex: 1, overflow: "auto" }}>
        {messages.length === 0 ? (
          <Note>
            {isCompose
              ? "Ask the assistant to draft, rewrite, or improve this email."
              : "Ask the assistant about this email — summarize it, pull out action items, or answer questions."}
          </Note>
        ) : null}
        {messages.map((m) => {
          const isStreaming = busy && streamingIdRef.current === m.id;
          return (
          <div
            key={m.id}
            className={mergeClasses(
              styles.card,
              bubbleStyles.bubble,
              m.role === "user" ? bubbleStyles.userBubble : bubbleStyles.assistantBubble,
            )}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              backgroundColor:
                m.role === "user" ? tokens.colorBrandBackground2 : tokens.colorNeutralBackground1,
              border: m.role === "user" ? "none" : `1px solid ${tokens.colorNeutralStroke2}`,
              maxWidth: "90%",
            }}
          >
            <Text size={200}>
              {m.content}
              {isStreaming ? <span className={bubbleStyles.cursor} /> : null}
            </Text>
            {m.proposedDraft ? (
              <Button
                appearance="primary"
                size="small"
                onClick={() => void openApply(m.proposedDraft!)}
                style={{ alignSelf: "flex-start", marginTop: tokens.spacingVerticalXS }}
              >
                Apply to draft
              </Button>
            ) : null}
          </div>
          );
        })}
        <div ref={transcriptEndRef} />
      </div>

      {error ? <Note>{error}</Note> : null}

      <div className={styles.stack}>
        <Textarea
          placeholder={isCompose ? "e.g. Rewrite this more concisely" : "e.g. Summarize this email"}
          value={input}
          rows={2}
          resize="vertical"
          onChange={(_, data) => setInput(data.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className={styles.actions}>
          <Button appearance="primary" size="small" disabled={busy || !input.trim()} onClick={() => void send()}>
            {busy ? "Thinking…" : "Send"}
          </Button>
        </div>
      </div>

      {applyTarget ? (
        <ApplyDraftDialog
          open
          currentBody={applyTarget.current}
          proposedBody={applyTarget.proposed}
          onConfirm={() => void confirmApply()}
          onCancel={() => setApplyTarget(null)}
        />
      ) : null}
    </>
  );
}
