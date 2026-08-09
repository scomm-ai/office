export class ScommError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ScommError";
    this.code = code;
  }
}

export class UnsupportedFeatureError extends ScommError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("unsupported_feature", message, options);
    this.name = "UnsupportedFeatureError";
  }
}

export class CapabilityUnavailableError extends ScommError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("capability_unavailable", message, options);
    this.name = "CapabilityUnavailableError";
  }
}

export class AuthenticationRequiredError extends ScommError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("authentication_required", message, options);
    this.name = "AuthenticationRequiredError";
  }
}

export class PubkeyLookupError extends ScommError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("pubkey_lookup", message, options);
    this.name = "PubkeyLookupError";
  }
}

export class IdrConnectionError extends ScommError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("idr_connection", message, options);
    this.name = "IdrConnectionError";
  }
}

export class MicrosoftGraphError extends ScommError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("microsoft_graph", message, options);
    this.name = "MicrosoftGraphError";
  }
}

export class SemanticParseError extends ScommError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("semantic_parse", message, options);
    this.name = "SemanticParseError";
  }
}

export class PolicyEvaluationError extends ScommError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("policy_evaluation", message, options);
    this.name = "PolicyEvaluationError";
  }
}

export class ConfigurationError extends ScommError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("configuration", message, options);
    this.name = "ConfigurationError";
  }
}
