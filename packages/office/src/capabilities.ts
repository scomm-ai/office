export interface OutlookCapabilities {
  mailboxRequirementSet: string;
  internetHeaders: boolean;
  eventBasedActivation: boolean;
  onMessageCompose: boolean;
  onMessageSend: boolean;
  smartAlerts: boolean;
  onMessageDecrypt: boolean;
  attachments: boolean;
  signatureApi: boolean;
  nestedAppAuthentication: boolean;
  webRtc: boolean;
  webCryptoEd25519: boolean;
}

const MAILBOX_VERSIONS = [
  "1.15",
  "1.14",
  "1.13",
  "1.12",
  "1.11",
  "1.10",
  "1.9",
  "1.8",
  "1.7",
  "1.6",
  "1.5",
  "1.4",
  "1.3",
  "1.2",
  "1.1",
] as const;

type OfficeGlobal = {
  context?: {
    requirements?: {
      isSetSupported?: (setName: string, minVersion: string) => boolean;
    };
  };
};

function probeWebRtc(): boolean {
  return typeof RTCPeerConnection !== "undefined";
}

function probeWebCryptoEd25519(): boolean {
  return typeof globalThis.crypto?.subtle !== "undefined";
}

function highestMailboxVersion(isSetSupported: (set: string, ver: string) => boolean): string {
  for (const version of MAILBOX_VERSIONS) {
    if (isSetSupported("Mailbox", version)) {
      return version;
    }
  }
  return "0";
}

function detectFromOffice(office: OfficeGlobal): OutlookCapabilities {
  const isSetSupported = office.context?.requirements?.isSetSupported;
  const isSet = (set: string, ver: string): boolean =>
    isSetSupported ? isSetSupported(set, ver) : false;

  const mailboxRequirementSet = isSetSupported
    ? highestMailboxVersion(isSet)
    : "0";

  const mailboxAtLeast = (ver: string): boolean => isSet("Mailbox", ver);

  return {
    mailboxRequirementSet,
    internetHeaders: mailboxAtLeast("1.8"),
    eventBasedActivation: mailboxAtLeast("1.12"),
    onMessageCompose: mailboxAtLeast("1.1"),
    onMessageSend: mailboxAtLeast("1.12"),
    smartAlerts: mailboxAtLeast("1.12"),
    onMessageDecrypt: mailboxAtLeast("1.12"),
    attachments: mailboxAtLeast("1.8"),
    signatureApi: mailboxAtLeast("1.10"),
    nestedAppAuthentication: isSet("NestedAppAuth", "1.1"),
    webRtc: probeWebRtc(),
    webCryptoEd25519: false,
  };
}

export function detectOutlookCapabilities(office?: {
  Office?: {
    context?: {
      requirements?: {
        isSetSupported?: (name: string, version: string) => boolean;
      };
    };
  };
}): OutlookCapabilities {
  const webRtc = probeWebRtc();
  const webCryptoEd25519 = probeWebCryptoEd25519();

  if (!office?.Office?.context?.requirements?.isSetSupported) {
    return {
      mailboxRequirementSet: "0",
      internetHeaders: false,
      eventBasedActivation: false,
      onMessageCompose: false,
      onMessageSend: false,
      smartAlerts: false,
      onMessageDecrypt: false,
      attachments: false,
      signatureApi: false,
      nestedAppAuthentication: false,
      webRtc,
      webCryptoEd25519,
    };
  }

  const caps = detectFromOffice(office.Office);
  return { ...caps, webRtc, webCryptoEd25519 };
}
