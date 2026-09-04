export interface ConnectorErrorOptions {
  code: string;
  retryable: boolean;
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class ConnectorError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(message: string, options: ConnectorErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.retryable = options.retryable;
    this.details = options.details;
  }
}

type SubclassOptions = Partial<Omit<ConnectorErrorOptions, 'retryable'>>;

export class AuthError extends ConnectorError {
  constructor(message: string, options: SubclassOptions = {}) {
    super(message, { ...options, code: options.code ?? 'AUTH_REQUIRED', retryable: false });
  }
}

export class ConfigError extends ConnectorError {
  constructor(message: string, options: SubclassOptions = {}) {
    super(message, { ...options, code: options.code ?? 'CONFIG_INVALID', retryable: false });
  }
}

export class PublishError extends ConnectorError {
  constructor(message: string, options: SubclassOptions = {}) {
    super(message, { ...options, code: options.code ?? 'PUBLISH_FAILED', retryable: false });
  }
}

export function retryable(message: string, code: string, cause?: unknown): ConnectorError {
  return new ConnectorError(message, { code, retryable: true, cause });
}

export function nonRetryable(message: string, code: string, cause?: unknown): ConnectorError {
  return new ConnectorError(message, { code, retryable: false, cause });
}

export function isRetryable(err: unknown): boolean {
  return err instanceof ConnectorError && err.retryable;
}
