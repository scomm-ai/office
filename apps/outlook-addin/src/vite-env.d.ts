/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SCOMM_SERVER_URL?: string;
  readonly VITE_PUBKEY_SERVER_URL?: string;
  readonly VITE_PUBKEY_READ_BASE_URL?: string;
  readonly VITE_PUBKEY_WRITE_BASE_URL?: string;
  readonly VITE_BILLING_ORIGIN?: string;
  readonly VITE_BILLING_PORTAL_URL?: string;
  readonly VITE_IDR_HOST?: string;
  readonly VITE_IDR_SERVICE?: string;
  readonly VITE_AZURE_CLIENT_ID?: string;
  readonly VITE_AZURE_TENANT_ID?: string;
  readonly VITE_AZURE_AUTHORITY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
