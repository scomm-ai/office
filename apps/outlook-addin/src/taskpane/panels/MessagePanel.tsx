import { useHostContext } from "../../lib/host-context";
import { formatAddresses } from "../../lib/settings";

export function MessagePanel() {
  const { message, refreshMessage } = useHostContext();

  if (!message) {
    return <p className="empty">No message loaded.</p>;
  }

  return (
    <section>
      <h2>Message</h2>
      <dl className="meta-grid">
        <dt>Subject</dt>
        <dd>{message.subject ?? "—"}</dd>
        <dt>From</dt>
        <dd>{formatAddresses(message.from ? [message.from] : undefined)}</dd>
        <dt>To</dt>
        <dd>{formatAddresses(message.to)}</dd>
        <dt>Mode</dt>
        <dd>
          <span className={`status ${message.mode === "compose" ? "warn" : "ok"}`}>
            {message.mode}
          </span>
        </dd>
        <dt>Attachments</dt>
        <dd>{message.attachments?.length ?? 0}</dd>
      </dl>
      <div className="actions">
        <button type="button" className="secondary" onClick={() => void refreshMessage()}>
          Refresh
        </button>
      </div>
    </section>
  );
}
