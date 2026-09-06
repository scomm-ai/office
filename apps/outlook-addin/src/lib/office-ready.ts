/** Office.onReady() resolves in a normal browser too; host is only set inside Office. */
export type OfficeReadyInfo = {
  host?: unknown;
};

export type OfficeMailboxGlobal = {
  HostType?: { Outlook?: string };
  context?: {
    mailbox?: { item?: unknown; userProfile?: { emailAddress?: string } } | null;
  };
};

export function isOutlookMailboxSession(
  info: OfficeReadyInfo | null | undefined,
  office: OfficeMailboxGlobal | null | undefined,
): boolean {
  if (!info?.host || !office?.context?.mailbox) {
    return false;
  }
  const outlookHost = office.HostType?.Outlook ?? "Outlook";
  return info.host === outlookHost;
}
