# Connectors Monorepo: Design Spec

Date: 2026-09-04
Status: approved for planning

## 1. Goal

A TypeScript monorepo of reusable external-integration connectors. Each connector is implemented once and consumed either:

1. directly as a workspace/npm package inside another application, or
2. through an optional standalone HTTP service that wraps the package.

V1 delivers the monorepo infrastructure, the shared `@connectors/core` contracts, a self-hosted WhatsApp connector built on Baileys, a standalone WhatsApp HTTP service with webhook event delivery, a runnable example, tests, and documentation. Telegram, Gmail, Notion, Slack and other connectors are explicitly out of scope but the structure must let them be added without touching existing packages.

## 2. Decisions taken during brainstorming

| Decision | Choice |
|---|---|
| Sending | Text and media sending are in V1 (`sendText`, `sendMedia`, `POST /instances/:id/messages`). |
| Service instances across restart | Definitions persist via the storage abstraction; on boot the service restores them and reconnects those whose desired state was `connected`. |
| Provider boundary | Internal `WhatsAppClient` interface inside `@connectors/whatsapp`; `BaileysClient` is the only module importing Baileys; tests use a fake client. |
| HTTP framework | Fastify with zod validation. |
| Logging | pino behind `@connectors/observability`, exposing the core `Logger` interface. |
| Build | `tsc` per package, ESM only, declaration files, `exports` limited to `.`. |
| Repo | Initialized as a git repository at the root. |
| Media handles | No decryption material leaves the connector. `MediaRef` carries only metadata and the message id; the connector resolves downloads from an in-memory cache (or from consumer-supplied `raw`). Media of messages received before a restart is not downloadable unless the consumer kept `raw`. |

## 3. Baileys facts the design depends on (verified 2026-09-04)

- Current line is `baileys@7.0.0-rc14` (same package also published as `@whiskeysockets/baileys`). ESM-only, Node >= 20. No stable 7.0.0 exists; v8 (in development) changes the auth-state format. The auth serializer is therefore isolated so a migration can be added later.
- `printQRInTerminal` is a no-op. The `qr` string from `connection.update` must be rendered by us.
- Pairing codes are requested with `requestPairingCode(phoneNumber)` after the socket is up, when the first `qr` update arrives and `creds.registered` is false.
- `SignalDataTypeMap` in v7 includes `pre-key`, `session`, `sender-key`, `sender-key-memory`, `app-state-sync-key`, `app-state-sync-version`, `lid-mapping`, `device-list`, `tctoken`, `identity-key`. Our adapter persists any type requested rather than a hardcoded list.
- After successful pairing WhatsApp closes the socket with 515 (`restartRequired`); a fresh socket must be created. 401/403/419 mean logged out. 440 means another client replaced this session. 500 is `badSession`. Sockets are never reused after close.
- `fetchLatestBaileysVersion()` fetches from `raw.githubusercontent.com`. It is not called unless the consumer opts in.
- Baileys declares `sharp` as a non-optional peer dependency but tolerates its absence at runtime (image thumbnails on send fall back or are skipped). `jimp`, `audio-decode`, `link-preview-js` are optional peers. None are installed by default.
- Senders increasingly appear as `@lid`; the phone-number form is in `remoteJidAlt` / `participantAlt`. `isJidUser` was removed; use `isPnUser` / `isLidUser`.
- Media download: `downloadMediaMessage(msg, 'stream', {}, { reuploadRequest, logger })` or `downloadContentFromMessage({ mediaKey, directPath, url }, type)` returns a decrypted stream. 404/410 from the CDN means the media expired and a re-upload request to the phone is needed.
- Security advisory GHSA-qvv5-jq5g-4cgg is fixed in rc12+. The dependency is pinned to `7.0.0-rc14` or later.

## 4. Repository layout

```text
connectors/
  apps/
    whatsapp-service/           Fastify HTTP wrapper around @connectors/whatsapp, Dockerfile
  packages/
    core/                       @connectors/core: contracts, stores, publishers, errors, utils
    config/                     @connectors/config: zod-based environment loading
    observability/              @connectors/observability: pino logger with redaction
    whatsapp/                   @connectors/whatsapp: Baileys-backed connector
  examples/
    whatsapp-basic/             runnable example using the package directly
  docs/
    privacy.md                  data-flow and storage documentation
    adding-a-connector.md       how to add a new connector package
    whatsapp-service-api.md     HTTP API reference
    superpowers/specs/          this spec
  docker-compose.yml              (Dockerfile lives in apps/whatsapp-service)
  package.json  pnpm-workspace.yaml  turbo.json  tsconfig.base.json
  eslint.config.js  .prettierrc  vitest.workspace.ts  .npmrc  .gitignore
```

### Tooling

- **Package manager:** pnpm workspaces (`apps/*`, `packages/*`, `examples/*`). Workspace deps use `workspace:*`. Third-party versions are pinned once at the root through `pnpm.overrides` so no duplicates exist. `.npmrc` sets `auto-install-peers=false`; `pnpm.peerDependencyRules.ignoreMissing` lists `sharp`, `jimp`, `audio-decode`, `link-preview-js`.
- **Turborepo:** tasks `build` (depends on `^build`), `test` (depends on `build`), `lint`, `typecheck`, `dev` (persistent, no cache). Root scripts: `build`, `test`, `lint`, `dev`, `typecheck`, `format`, `format:check`, `clean`.
- **TypeScript:** `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `module: NodeNext`, `moduleResolution: NodeNext`, `target: ES2022`, `verbatimModuleSyntax`. Each package has `tsconfig.json` (for editor/tests) and `tsconfig.build.json` (emits `dist/` with `.d.ts`). Every `package.json` has `"type": "module"`, `"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }`, and `"files": ["dist"]`.
- **Tests:** Vitest. A root `vitest.workspace.ts` lists every package so `pnpm test` runs everything. Tests live next to code as `*.test.ts` and are excluded from the build.
- **Lint/format:** ESLint flat config with `typescript-eslint` (type-aware rules on `src/`), `eslint-config-prettier`. Prettier for formatting. `pnpm lint` runs ESLint and `prettier --check`.
- **Dev:** `pnpm dev` runs `tsc --watch` in packages and `tsx watch` for the service.
- **Docker:** multi-stage Dockerfile for `apps/whatsapp-service` (install with pnpm, build, `pnpm deploy --prod` to a pruned directory, run on `node:22-alpine` as non-root). `docker-compose.yml` runs the service with a `./data` volume mounted at `DATA_DIR`.
- **Node:** >= 20 (`engines`), developed on Node 26.

## 5. `@connectors/core`

Provider-neutral. Runtime dependencies: none (Node built-ins only).

### 5.1 Lifecycle

```ts
interface Connector {
  readonly name: string;        // e.g. 'whatsapp'
  readonly accountId: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): Promise<ConnectorStatus>;
}

interface EventSource<E extends ConnectorEvent = ConnectorEvent> {
  subscribe(handler: (event: E) => void | Promise<void>): Unsubscribe;
}

interface Pollable<E extends ConnectorEvent = ConnectorEvent> {
  poll(): Promise<E[]>;
}

function isEventSource(c: Connector): c is Connector & EventSource;
function isPollable(c: Connector): c is Connector & Pollable;
```

A connector implements `Connector` and any subset of the capability interfaces. Nothing forces a push connector to implement `poll` or vice versa.

### 5.2 Status and health

```ts
type ConnectorState = 'disconnected' | 'connecting' | 'pairing' | 'connected' | 'reconnecting' | 'logged_out';

interface ConnectorStatus {
  state: ConnectorState;
  since: Date;
  lastError?: { code: string; message: string; retryable: boolean; at: Date };
  detail?: Record<string, unknown>;   // connector-specific, e.g. { phoneNumber, reconnectAttempt }
}

type HealthState = 'healthy' | 'degraded' | 'unhealthy';
function healthFromStatus(status: ConnectorStatus): HealthState;
// connected -> healthy; connecting/pairing/reconnecting -> degraded; disconnected/logged_out -> unhealthy
```

### 5.3 Events

```ts
interface ConnectorEvent<TPayload = unknown> {
  id: string;            // stable dedupe key: `${connector}:${accountId}:${type}:${externalId}`
  connector: string;
  accountId: string;
  externalId: string;    // provider-side id, e.g. WhatsApp message id
  type: string;          // dotted, e.g. 'message.received'
  timestamp: Date;       // provider timestamp
  receivedAt: Date;      // when the connector produced the event
  payload: TPayload;
  raw?: unknown;         // opaque provider payload, only present when consumer opts in
}
```

### 5.4 Storage

```ts
interface KeyValueStore {
  get(key: string): Promise<Uint8Array | undefined>;
  set(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  clear(prefix: string): Promise<void>;
}
type SecretStore = KeyValueStore;   // role: credentials, auth material
type StateStore = KeyValueStore;    // role: non-secret connector state

function namespaced(store: KeyValueStore, prefix: string): KeyValueStore;
class MemoryStore implements KeyValueStore {}
class FileStore implements KeyValueStore { constructor(rootDir: string) }
```

Keys are `/`-separated paths. `FileStore` maps each key to a file under `rootDir` with path-safe encoding of each segment, writes atomically (temp file plus rename), creates directories on demand, and sets `0600` on files and `0700` on directories. Helpers `jsonCodec` (`encode<T>(value): Uint8Array`, `decode<T>(bytes): T`) are provided so consumers do not repeat Buffer/JSON plumbing.

### 5.5 Publishing

```ts
interface EventPublisher {
  publish(event: ConnectorEvent): Promise<void>;
  close?(): Promise<void>;
}

function createWebhookPublisher(options: {
  url: string;
  secret?: string;             // HMAC-SHA256 over the JSON body, header X-Connectors-Signature: sha256=<hex>
  timeoutMs?: number;          // default 10_000
  maxAttempts?: number;        // default 3
  backoff?: BackoffPolicy;
  fetch?: typeof fetch;        // injectable for tests
  logger?: Logger;
}): EventPublisher;
```

Headers sent: `Content-Type: application/json`, `X-Connectors-Event: <type>`, `X-Connectors-Delivery: <uuid>`, `X-Connectors-Signature` when a secret is set. Retries on network errors and 5xx/429; does not retry other 4xx. After the last attempt it throws a `PublishError` (retryable=false) which the caller logs. Dates serialize as ISO strings; `raw` is included only if present on the event.

### 5.6 Errors

```ts
class ConnectorError extends Error {
  constructor(message: string, options: { code: string; retryable: boolean; cause?: unknown; details?: Record<string, unknown> });
  readonly code: string;
  readonly retryable: boolean;
}
class AuthError extends ConnectorError {}          // code 'AUTH_REQUIRED', retryable=false, needs re-pairing
class ConfigError extends ConnectorError {}        // code 'CONFIG_INVALID', retryable=false
class PublishError extends ConnectorError {}
function retryable(message, code, cause?): ConnectorError;
function nonRetryable(message, code, cause?): ConnectorError;
function isRetryable(err: unknown): boolean;       // false for non-ConnectorError values
```

### 5.7 Logging

```ts
interface Logger {
  debug(obj: object, msg?: string): void; debug(msg: string): void;
  info(...); warn(...); error(...);
  child(bindings: Record<string, unknown>): Logger;
}
const noopLogger: Logger;
```

### 5.8 Utilities

- `exponentialBackoff({ initialMs = 1000, maxMs = 60_000, factor = 2, jitter = 0.2 })` returns `delayFor(attempt): number`.
- `EventDeduplicator({ maxEntries = 5000, ttlMs = 10 * 60_000, now? })` with `isDuplicate(id): boolean`: records the id and returns `false` on first sight, returns `true` on any later sight within the TTL. Bounded LRU with TTL, no timers (expiry checked on access).
- `sleep(ms, signal?)`.

## 6. `@connectors/config`

Runtime deps: `zod`.

```ts
function loadConfig<T extends z.ZodTypeAny>(schema: T, env: Record<string, string | undefined> = process.env): z.infer<T>;
```

Throws `ConfigError` with a readable multi-line message listing each invalid variable. Exposes reusable field schemas: `logLevel` (`fatal|error|warn|info|debug|trace|silent`, default `info`), `port` (1–65535 from string), `booleanString` (`true/false/1/0/yes/no`), `optionalUrl`, `nonEmptyString`.

## 7. `@connectors/observability`

Runtime deps: `pino`. Dev dep: `pino-pretty` (only used when `pretty: true`).

```ts
function createLogger(options: { name?: string; level?: LogLevel; pretty?: boolean; redact?: string[] }): Logger;
const DEFAULT_REDACT_PATHS: string[];
```

Default redaction paths cover auth material and secrets: `creds`, `keys`, `authState`, `*.privKey`, `*.private`, `*.public`, `noiseKey`, `pairingEphemeralKeyPair`, `signedIdentityKey`, `signedPreKey`, `advSecretKey`, `mediaKey`, `*.mediaKey`, `secret`, `*.secret`, `apiKey`, `authorization`, `headers.authorization`, `req.headers.authorization`. Redacted values are replaced with `[REDACTED]`. The returned object satisfies the core `Logger` interface and is also pino-compatible so it can be passed to Baileys and Fastify.

## 8. `@connectors/whatsapp`

Runtime deps: `@connectors/core`, `baileys` (>= 7.0.0-rc14), `zod` (option validation). Boom errors from Baileys are read structurally (`error.output.statusCode`) so no extra dependency is needed. No other third-party deps. Optional peers not installed.

### 8.1 Public API

```ts
interface WhatsAppConnectorOptions {
  accountId: string;
  storage: { auth: KeyValueStore };
  logger?: Logger;
  pairing?: { method: 'qr' } | { method: 'code'; phoneNumber: string };   // default qr
  reconnect?: { initialDelayMs?: number; maxDelayMs?: number; maxAttempts?: number | null };  // default 1s, 60s, unlimited
  includeOwnMessages?: boolean;   // default true -> emits message.sent
  includeHistory?: boolean;       // default false -> 'append' upserts ignored
  includeRaw?: boolean;           // default false -> ConnectorEvent.raw omitted
  dedupe?: { maxEntries?: number; ttlMs?: number };
  mediaCache?: { maxEntries?: number; ttlMs?: number };   // default 5000, 24h
  browser?: { os: string; name: string; version?: string };  // defaults to a desktop browser identity
  markOnlineOnConnect?: boolean;  // default false
  fetchLatestVersion?: boolean;   // default false (privacy: avoids a GitHub request)
  waWebVersion?: [number, number, number];
  providerLogLevel?: LogLevel;    // Baileys' logger level, default 'warn'
}

interface WhatsAppConnector extends Connector, EventSource<WhatsAppEvent> {
  readonly name: 'whatsapp';
  onPairing(handler: (pairing: PairingState) => void): Unsubscribe;
  getPairing(): PairingState | null;
  logout(): Promise<void>;                     // unlink device on WhatsApp and clear auth storage
  sendText(chatId: string, text: string, options?: { quotedMessageId?: string }): Promise<SentMessage>;
  sendMedia(chatId: string, media: OutgoingMedia, options?: { quotedMessageId?: string }): Promise<SentMessage>;
  downloadMedia(source: MediaSource): Promise<Readable>;
  downloadMediaToFile(source: MediaSource, filePath: string): Promise<{ path: string; bytes: number }>;
}

type PairingState =
  | { method: 'qr'; qr: string; issuedAt: Date }
  | { method: 'code'; code: string; phoneNumber: string; issuedAt: Date };

type OutgoingMedia =
  | { kind: 'image'; data: Buffer | Readable; mimetype: string; caption?: string }
  | { kind: 'video'; data; mimetype; caption? }
  | { kind: 'audio'; data; mimetype; voiceNote?: boolean }
  | { kind: 'document'; data; mimetype; fileName: string; caption? };

interface SentMessage { messageId: string; chatId: string; timestamp: Date }

// A MediaRef resolves through the connector's in-memory cache. A consumer that opted into
// `includeRaw` and stored `event.raw` itself can download later from that raw payload.
type MediaSource = MediaRef | { raw: unknown };

function createWhatsAppConnector(options: WhatsAppConnectorOptions): WhatsAppConnector;
```

Chat ids passed to `sendText`/`sendMedia` accept a normalized JID (`<number>@s.whatsapp.net`, `<id>@g.us`, `<id>@lid`) or a bare E.164 number without `+`, which is converted to a user JID.

### 8.2 Events

`WhatsAppEvent = ConnectorEvent<WhatsAppMessage> & { type: 'message.received' | 'message.sent' }` or `ConnectorEvent<ConnectorStatus> & { type: 'connection.updated' }`. `externalId` is the WhatsApp message id for messages and an ISO timestamp with a monotonic sequence suffix (`<iso>#<n>`) for connection updates, so two transitions in the same millisecond do not collide. `connector` is always `'whatsapp'`.

### 8.3 Normalized message

```ts
interface WhatsAppMessage {
  messageId: string;
  chatId: string;                     // normalized JID of the chat
  chatType: 'direct' | 'group' | 'broadcast' | 'status' | 'newsletter';
  direction: 'inbound' | 'outbound';
  sender: { id: string; phoneNumber?: string; lid?: string; displayName?: string };  // in groups: the participant
  timestamp: Date;
  content: MessageContent;
  quoted?: { messageId: string; senderId?: string };
  mentions: string[];
  isViewOnce: boolean;
  isEdit: boolean;
  isForwarded: boolean;
  ephemeralExpirationSeconds?: number;
}

type MessageContent =
  | { kind: 'text'; text: string }
  | { kind: 'image'; caption?: string; media: MediaRef }
  | { kind: 'video'; caption?: string; media: MediaRef; isGif: boolean }
  | { kind: 'audio'; media: MediaRef; isVoiceNote: boolean }
  | { kind: 'document'; caption?: string; media: MediaRef }
  | { kind: 'sticker'; media: MediaRef; isAnimated: boolean }
  | { kind: 'contact'; contacts: { displayName: string; vcard: string }[] }
  | { kind: 'location'; latitude: number; longitude: number; name?: string; address?: string; isLive: boolean }
  | { kind: 'reaction'; emoji: string; targetMessageId: string }   // empty emoji means removed
  | { kind: 'unsupported'; providerType: string };

interface MediaRef {
  kind: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  mimetype: string;
  sizeBytes?: number;
  sha256?: string;          // hex
  fileName?: string;
  width?: number; height?: number;
  durationSeconds?: number;
  messageId: string;        // key into the connector's in-memory media cache, see 8.6
}
```

Normalization rules: unwrap ephemeral, view-once (V1/V2/extension), edited and document-with-caption wrappers; take `remoteJid` as `chatId` after `jidNormalizedUser`; in direct chats `sender.id` is the counterpart (or self for outbound); in groups `sender.id` is `participant`; `phoneNumber` is derived from whichever of `remoteJid`/`participant`/`*Alt` is a phone-number JID, `lid` from whichever is a LID; `displayName` from `pushName`. Messages with no `message` body (stub/protocol only) are skipped. Messages with `type: 'append'` are skipped unless `includeHistory` is true. `messages.upsert` with a `requestId` (placeholder resends) are treated the same as notify.

### 8.4 Internal structure (not exported)

```text
packages/whatsapp/src/
  index.ts                 public exports only
  connector.ts             WhatsAppConnectorImpl: wires everything below
  options.ts               zod schema + defaults for WhatsAppConnectorOptions
  client/
    types.ts               WhatsAppClient interface + ClientEvent types + RawMessage alias
    baileys-client.ts      BaileysClient: the ONLY module importing 'baileys'
    fake-client.ts         FakeWhatsAppClient for tests (exported from a test-only entry, not the package)
  auth/
    auth-state.ts          KeyValueStore <-> AuthenticationState adapter
    serializer.ts          BufferJSON-based encode/decode, isolated for future v8 migration
  connection/
    state-machine.ts       ConnectionManager: states, transitions, reconnect policy
    disconnect-reason.ts   status code -> policy mapping
  normalize/
    message.ts             raw -> WhatsAppMessage
    jid.ts                 chat type + phone/lid extraction
  media/
    cache.ts               bounded LRU+TTL cache of raw media messages keyed by message id
    download.ts            resolve source -> descriptor, stream download, reupload retry, temp file cleanup
  send.ts                  outgoing text/media mapping
  dedupe.ts
  errors.ts                Boom/Baileys error -> ConnectorError
```

`WhatsAppClient` interface:

```ts
interface WhatsAppClient {
  start(auth: AuthenticationStateLike): Promise<void>;    // creates a fresh socket
  stop(): Promise<void>;                                   // ends socket, removes listeners
  on(event: 'connection', handler: (u: ClientConnectionUpdate) => void): Unsubscribe;
  on(event: 'qr', handler: (qr: string) => void): Unsubscribe;
  on(event: 'messages', handler: (batch: { messages: RawMessage[]; type: 'notify' | 'append' }) => void): Unsubscribe;
  on(event: 'creds', handler: () => void): Unsubscribe;    // creds changed, persist
  requestPairingCode(phoneNumber: string): Promise<string>;
  sendText(jid: string, text: string, quoted?: RawMessage): Promise<RawMessage>;
  sendMedia(jid: string, media: OutgoingMedia, quoted?: RawMessage): Promise<RawMessage>;
  downloadMedia(descriptor: MediaDescriptor): Promise<Readable>;
  requestReupload(message: RawMessage): Promise<RawMessage>;
  logout(): Promise<void>;
  isRegistered(): boolean;
}
type ClientConnectionUpdate = { status: 'connecting' | 'open' | 'close'; statusCode?: number; error?: Error; isNewLogin?: boolean };
```

### 8.5 Auth state adapter

Keys under the injected store: `creds` and `keys/<type>/<id>`. Values are JSON encoded with Baileys' `BufferJSON.replacer` and decoded with `BufferJSON.reviver`; `app-state-sync-key` values are rehydrated via the proto `fromObject` as `useMultiFileAuthState` does. `keys.set` handles `null` as delete. Writes from a single `set` call run in parallel; `creds` is written on every `creds` client event. `clearAuth()` calls `store.clear('')` on the namespaced auth store. The store passed in is wrapped as `namespaced(store, 'whatsapp/<accountId>/auth')` so several accounts can share one backing store.

### 8.6 Media

- Normalized events never carry decryption material. `MediaRef` holds only public metadata plus `messageId`.
- The connector keeps a bounded in-memory **media cache** of raw messages that contain media, keyed by message id (`mediaCache: { maxEntries = 5000, ttlMs = 24h }` option). Entries are evicted by LRU and TTL and the cache lives only in process memory, so it is empty after a restart.
- `downloadMedia(source)` resolves the raw message either from the cache (when given a `MediaRef`) or from `source.raw` (when the consumer stored the raw payload itself), extracts the media descriptor, and returns the decrypted `Readable` from the client. No buffering into memory. A `MediaRef` whose message is no longer cached throws `MediaUnavailableError` (`code: 'MEDIA_UNAVAILABLE'`, retryable=false) with a message explaining the cache miss.
- On CDN 404/410 the connector calls `requestReupload` once with the raw message and retries. If that fails it throws `MediaUnavailableError`.
- `downloadMediaToFile` streams into `<filePath>.<random>.part` in the same directory, renames on success, and removes the partial file on any error.
- The trade-off is deliberate: media for a message received before a process restart cannot be fetched through the connector unless the consumer kept `raw`. This is documented in the README and in `docs/privacy.md`.

### 8.7 Connection state machine

| Current | Trigger | Next | Action |
|---|---|---|---|
| disconnected | `connect()` | connecting | load auth, start client |
| connecting | client `qr` and not registered | pairing | publish `PairingState` (`qr`), or call `requestPairingCode` once if method is `code` |
| connecting/pairing | client `open` | connected | reset backoff, clear pairing, emit `connection.updated` |
| any | close 515 | reconnecting | restart client immediately (no delay) |
| any | close 401/403/419 | logged_out | clear auth store, emit `connection.updated` with `AuthError`, stop |
| any | close 440 | disconnected | stop, `lastError` = `ConnectionReplacedError` (non-retryable) |
| any | close 500 | logged_out | clear auth, `lastError` = `AuthError` (bad session) |
| any | close other / error | reconnecting | wait `backoff.delayFor(attempt)` then restart; after `maxAttempts` -> disconnected with retryable `lastError` |
| any | `disconnect()` | disconnected | cancel pending reconnect, stop client; no auth change |
| any | `logout()` | logged_out | client logout (best effort), stop, clear auth |
| connecting/pairing | QR timeout (408) with no pairing success | reconnecting | restart client (new QR cycle), counts towards `maxAttempts` |

`getStatus()` returns the current state, `since`, `lastError`, and `detail: { phoneNumber?, reconnectAttempt, pairing: boolean }`.

### 8.8 Dedupe

Every raw message is keyed `${accountId}:${messageId}`; `EventDeduplicator` from core with the configured limits. Duplicates are dropped before normalization and counted in `detail.duplicatesDropped` (debug logging only).

### 8.9 Error mapping

| Source | ConnectorError |
|---|---|
| Boom 401/403/419 | `AuthError` `AUTH_REQUIRED` |
| Boom 500 | `AuthError` `BAD_SESSION` |
| Boom 440 | `ConnectionReplacedError` `CONNECTION_REPLACED` (non-retryable) |
| Boom 408/428/503, network errors, timeouts | `CONNECTION_LOST` retryable |
| Boom 515 | `RESTART_REQUIRED` retryable |
| Media 404/410 | `MediaUnavailableError` `MEDIA_UNAVAILABLE` non-retryable |
| Unknown | `UNKNOWN` retryable=true (the manager backs off and retries) |

### 8.10 Privacy defaults

- No outbound request other than WhatsApp's websocket and media CDN unless the consumer sets `fetchLatestVersion: true` (GitHub) or supplies webhook/send targets.
- `markOnlineOnConnect: false`, `syncFullHistory: false`, `generateHighQualityLinkPreview: false`, `linkPreview: null` on every text send.
- The Baileys logger is `logger.child({ component: 'baileys' })` with level `providerLogLevel` (default `warn`).
- Only auth state is written to storage. Message bodies and media are never persisted by the package.

## 9. `apps/whatsapp-service`

Runtime deps: `@connectors/core`, `@connectors/config`, `@connectors/observability`, `@connectors/whatsapp`, `fastify`, `zod`, `qrcode` (QR data URL for the pairing endpoint).

### 9.1 Configuration (environment)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | listen port |
| `HOST` | `0.0.0.0` | bind address |
| `DATA_DIR` | `./data` | root for `FileStore` (auth + instance definitions) |
| `LOG_LEVEL` | `info` | pino level |
| `LOG_PRETTY` | `false` | human-readable logs |
| `API_KEY` | unset | when set, every route except `/health` requires `Authorization: Bearer <API_KEY>` |
| `WEBHOOK_URL` | unset | default webhook for instances without their own |
| `WEBHOOK_SECRET` | unset | default HMAC secret |
| `WA_FETCH_LATEST_VERSION` | `false` | passthrough to the connector |

### 9.2 Routes

```text
GET    /health                        200 { status: 'ok', instances: { total, connected } }
POST   /instances                     body { id?: string, webhook?: { url, secret? }, pairing?: { method, phoneNumber? }, autoConnect?: boolean }
                                      201 InstanceView; 409 if id exists
GET    /instances/:id                 200 InstanceView; 404
GET    /instances/:id/status          200 ConnectorStatus
POST   /instances/:id/connect         202 ConnectorStatus (connect started)
GET    /instances/:id/pairing         200 { method, qr?: { raw, dataUrl }, code?, issuedAt } ; 204 when no pairing pending
POST   /instances/:id/disconnect      200 ConnectorStatus
DELETE /instances/:id                 204 (logout best effort, clear auth, remove definition)
POST   /instances/:id/messages        body { to, type: 'text', text, quotedMessageId? }
                                        | { to, type: 'image'|'video'|'audio'|'document', mimetype, base64?: string, url?: string, caption?, fileName?, voiceNote? }
                                      201 SentMessage; 409 if instance not connected
GET    /instances/:id/media/:messageId  200 streamed body with Content-Type and Content-Disposition from the cached message; 404 MEDIA_UNAVAILABLE (unknown id, expired cache, or media expired on WhatsApp)
```

`InstanceView = { id, createdAt, webhook?: { url, hasSecret }, pairing: { method, phoneNumber? }, desiredState: 'connected' | 'disconnected', status: ConnectorStatus }`. Errors are `{ error: { code, message, retryable } }` with 400 for validation, 401 for auth, 404, 409, 500.

### 9.3 Internals

```text
apps/whatsapp-service/src/
  index.ts             bootstrap: load config, logger, store, manager, server; graceful shutdown on SIGTERM/SIGINT
  config.ts            zod env schema via @connectors/config
  server.ts            buildServer({ manager, config, logger }) -> FastifyInstance (used by tests)
  routes/instances.ts, routes/messages.ts, routes/media.ts, routes/health.ts
  instance-manager.ts  create/get/list/remove/connect/disconnect; persists definitions at instances/<id>; restore() on boot
  instance.ts          one instance: definition + connector + publisher + event forwarding
  publishers.ts        builds the webhook publisher from definition or env defaults
```

`InstanceManager` accepts a `connectorFactory` so tests inject a fake connector. Definitions are stored as JSON `{ id, createdAt, webhook?, pairing, desiredState }`. Auth for instance `<id>` lives in `namespaced(store, 'instances/<id>')` passed as the connector's auth store. Event forwarding: every connector event is published to the instance's publisher; publish failures are logged at `warn` with the event id and never crash the instance. No durable queue in V1.

### 9.4 Docker

`apps/whatsapp-service/Dockerfile`: stage 1 `node:22-alpine` with corepack pnpm, copy workspace, `pnpm install --frozen-lockfile`, `pnpm --filter @connectors/whatsapp-service... build`, `pnpm --filter @connectors/whatsapp-service deploy --prod /out`; stage 2 `node:22-alpine`, non-root user, copy `/out`, `ENV DATA_DIR=/data`, `VOLUME /data`, `EXPOSE 3000`, `CMD ["node", "dist/index.js"]`. `docker-compose.yml` at the root builds it and mounts `./data:/data`.

## 10. `examples/whatsapp-basic`

Private workspace package (`"private": true`), deps: `@connectors/core`, `@connectors/whatsapp`, `@connectors/observability`, `qrcode-terminal`, `tsx` (dev). `src/main.ts`:

1. Create `FileStore('./data')` and a pretty logger.
2. `createWhatsAppConnector({ accountId: 'example', storage: { auth: store }, pairing: PHONE_NUMBER ? { method: 'code', phoneNumber } : { method: 'qr' } })`.
3. `onPairing`: print the QR with `qrcode-terminal` or print the pairing code.
4. `subscribe`: print each event as indented JSON (without `raw`).
5. For `image` and voice-note `audio` content: `downloadMediaToFile` into `./downloads/<messageId>.<ext>` and print the path.
6. `connect()`; handle SIGINT with `disconnect()`.

README explains: run, scan, send yourself a message, send a voice note, kill and restart to see reconnect without a QR, and delete `./data` to unlink.

## 11. Testing plan

No test contacts WhatsApp. `FakeWhatsAppClient` records calls and lets tests emit `connection`, `qr`, `messages`, `creds` events.

| Area | Package | Cases |
|---|---|---|
| Stores | core | Memory and file: set/get/delete/list/clear, prefix isolation, binary round-trip, atomic write leaves no `.tmp`, file permissions 0600, `namespaced` prefixing |
| Dedupe | core | first sight false, second true, TTL expiry, LRU eviction at `maxEntries` |
| Backoff | core | growth, cap, jitter bounds |
| Errors | core | `isRetryable` on subclasses and non-errors |
| Webhook publisher | core | signature correctness, headers, retry on 500/429/network, no retry on 400, gives up after `maxAttempts`, timeout aborts |
| Config | config | valid env parses with defaults, invalid env throws `ConfigError` listing every failing key, boolean/port coercion |
| Logger | observability | default redaction paths replace secrets, child bindings preserved |
| Auth adapter | whatsapp | creds round-trip with Buffers, keys get/set for every `SignalDataTypeMap` type including unknown types, null deletes, `app-state-sync-key` rehydration, clear removes everything |
| Normalization | whatsapp | fixtures per content kind, group vs direct, LID + phone extraction, quoted, mentions, view-once, edited, ephemeral, forwarded, stub skipped, outbound direction |
| State machine | whatsapp | every row of table 8.7, backoff timing with fake timers, `disconnect()` cancels reconnect, `maxAttempts` exhaustion, pairing code requested once |
| Dedupe integration | whatsapp | same id twice emits once; `append` ignored by default |
| Error mapping | whatsapp | each Boom code and non-Boom error |
| Media | whatsapp | media cache stores/evicts/expires, `downloadMedia` from `MediaRef` hits cache, from `{ raw }` bypasses cache, cache miss throws `MediaUnavailableError`, download returns stream, reupload retry on 404 once, `downloadMediaToFile` cleans partial file on error |
| Send | whatsapp | chatId coercion, text with link preview disabled, media kinds map to the right client call, error when not connected |
| Service | service | every route via `fastify.inject` with fake connector factory; API key enforcement; 404/409; restore-on-boot reconnects `desiredState: connected`; webhook receives events with signature |

## 12. Documentation

- `README.md`: purpose, architecture with Mermaid diagram (consumer app -> `@connectors/whatsapp` -> Baileys -> WhatsApp; service -> webhook consumer), package structure, why connectors are packages, package mode vs service mode, quick start (`pnpm install`, `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm dev`), how pairing works (QR and code, the 515 restart), persistence requirements, privacy summary linking to `docs/privacy.md`, adding a connector linking to `docs/adding-a-connector.md`.
- `docs/privacy.md`: tables for what Baileys stores, what the wrapper stores, outbound connections (host, when, opt-in?), credential location, message/media location, memory-only data (dedupe cache, media cache of raw messages, pairing state), and how to opt into storing messages or media.
- `docs/adding-a-connector.md`: package skeleton, which core interfaces to implement, the client-adapter pattern, test expectations.
- `docs/whatsapp-service-api.md`: endpoint reference with request/response examples and webhook payload/signature verification snippet.

## 13. Out of scope for V1

Other connectors; SQS/Kafka/NATS/EventBridge publishers; durable webhook retry queue; metrics/tracing; sending reactions, polls, stickers, locations or contacts; group management; read receipts and typing indicators; message edits/deletes as events; multi-node coordination; Redis/Postgres/S3 stores (interfaces allow them); Baileys v8 migration helper (serializer is isolated for it).
