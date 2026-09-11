import { useEffect, useMemo, useRef, useState } from "react";
import { Dropdown, makeStyles, mergeClasses, Option, OptionGroup } from "@fluentui/react-components";
import { CloudAiClient, displayNameForProvider, LocalStorageCloudAiKeyStore } from "@scomm-office/byoai";
import { Button, PageTitle, StatusBadge, Text, Textarea, tokens, usePaneStyles } from "../ui/layout";
import { useHostContext } from "../../lib/host-context";
import { defaultProfile, isProfileReady, loadProfiles, saveProfiles } from "../../lib/byoai-profiles";
import { sendChatTurn, type ChatMessage } from "../../lib/byoai-chat";
import { ApplyDraftDialog } from "./ApplyDraftDialog";
import { useAppToast } from "../ui/toast";

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
  emptyState: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    minHeight: "120px",
    padding: tokens.spacingVerticalL,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground3,
  },
  // Fluent's "small" control height (~24px) is below the 44px touch-target
  // guideline; this keeps the icon-only settings button compact in the
  // narrow task pane while still meeting a reasonable minimum hit area.
  iconButton: {
    minWidth: "32px",
    minHeight: "32px",
    padding: 0,
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
  const toast = useAppToast();
  const { mailHost, message, refreshMessage } = useHostContext();
  const [profiles, setProfiles] = useState(() => loadProfiles());
  const readyProfiles = useMemo(() => profiles.filter(isProfileReady), [profiles]);
  const profile = useMemo(() => defaultProfile(profiles), [profiles]);
  const keyStore = useMemo(() => new LocalStorageCloudAiKeyStore(), []);
  const cloudClient = useMemo(() => new CloudAiClient(keyStore), [keyStore]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [applyTarget, setApplyTarget] = useState<{ current: string; proposed: string } | null>(null);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const streamingIdRef = useRef<string | null>(null);

  const isCompose = message?.mode === "compose";
  const otherProfiles = useMemo(
    () => readyProfiles.filter((p) => p.id !== profile?.id),
    [readyProfiles, profile?.id],
  );

  // Live model list for the active provider (mirrors the "Fetch models" list
  // from Setup) so switching models in chat isn't limited to the one model
  // this profile happened to be saved with.
  useEffect(() => {
    if (!profile) {
      setModelOptions([]);
      return;
    }
    let cancelled = false;
    cloudClient
      .listModels(profile)
      .then((models) => {
        if (!cancelled && models.length > 0) {
          setModelOptions(models);
        }
      })
      .catch(() => {
        // Best-effort — keep whatever the profile is already saved with.
      });
    setModelOptions([profile.model]);
    return () => {
      cancelled = true;
    };
  }, [profile, cloudClient]);

  const scrollToEnd = () => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  /** Switches to a different saved provider profile, persisting it as the default. */
  const switchProfile = (id: string) => {
    if (id === profile?.id) {
      return;
    }
    setProfiles((prev) => {
      const next = prev.map((p) => ({ ...p, isDefault: p.id === id }));
      saveProfiles(next);
      return next;
    });
  };

  /** Changes the model used by the current provider profile, persisting it. */
  const changeModel = (model: string) => {
    if (!profile || model === profile.model) {
      return;
    }
    setProfiles((prev) => {
      const next = prev.map((p) => (p.id === profile.id ? { ...p, model } : p));
      saveProfiles(next);
      return next;
    });
  };

  const send = async () => {
    const text = input.trim();
    if (!text || !profile || busy) {
      return;
    }
    setBusy(true);
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
      toast.showError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const openApply = async (proposed: string) => {
    try {
      const compose = await mailHost.getComposeState();
      setApplyTarget({ current: compose.bodyText ?? "", proposed });
    } catch (err) {
      toast.showError(err instanceof Error ? err.message : String(err));
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
      toast.showError(err instanceof Error ? err.message : String(err));
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
      <div className={styles.actions}>
        <StatusBadge tone={isCompose ? "warn" : "ok"}>
          {isCompose ? `Composing: ${message?.subject || "(no subject)"}` : `Reading: ${message?.subject || "(no subject)"}`}
        </StatusBadge>
      </div>

      <div className={styles.stack} style={{ flex: 1, overflow: "auto" }}>
        {messages.length === 0 ? (
          <div className={bubbleStyles.emptyState}>
            <Text size={200}>
              {isCompose
                ? "Ask the assistant to draft, rewrite, or improve this email."
                : "Ask the assistant about this email — summarize it, pull out action items, or answer questions."}
            </Text>
          </div>
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
        <div className={styles.actions} style={{ flexWrap: "nowrap" }}>
          <Dropdown
            size="small"
            style={{ minWidth: "150px", maxWidth: "300px", flex: "0 1 auto" }}
            value={profile ? `${displayNameForProvider(profile.provider)} · ${profile.model}` : ""}
            selectedOptions={profile ? [`model:${profile.model}`] : []}
            onOptionSelect={(_, data) => {
              if (!data.optionValue) {
                return;
              }
              if (data.optionValue.startsWith("model:")) {
                changeModel(data.optionValue.slice("model:".length));
              } else if (data.optionValue.startsWith("profile:")) {
                switchProfile(data.optionValue.slice("profile:".length));
              }
            }}
          >
            {profile ? (
              <OptionGroup label={displayNameForProvider(profile.provider)}>
                {modelOptions.map((m) => (
                  <Option key={m} value={`model:${m}`} text={m}>
                    {m}
                  </Option>
                ))}
              </OptionGroup>
            ) : null}
            {otherProfiles.length > 0 ? (
              <OptionGroup label="Other providers">
                {otherProfiles.map((p) => (
                  <Option
                    key={p.id}
                    value={`profile:${p.id}`}
                    text={`${displayNameForProvider(p.provider)} · ${p.model}`}
                  >
                    {displayNameForProvider(p.provider)} · {p.model}
                  </Option>
                ))}
              </OptionGroup>
            ) : null}
          </Dropdown>
          <Button
            appearance="subtle"
            size="small"
            className={bubbleStyles.iconButton}
            style={{ flexShrink: 0 }}
            onClick={onOpenSetup}
            title="Provider settings"
            aria-label="Provider settings"
          >
            ⚙
          </Button>
          <Button
            appearance="primary"
            size="small"
            style={{ flexShrink: 0 }}
            disabled={busy || !input.trim()}
            onClick={() => void send()}
          >
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
