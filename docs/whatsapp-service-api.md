# whatsapp-service HTTP API

Base URL: `http://<host>:3000`. When `API_KEY` is set, every request except `GET /health` needs `Authorization: Bearer <API_KEY>`.

Errors are `{ "error": { "code": string, "message": string, "retryable": boolean } }` with status 400 (validation), 401, 404, 409 (conflict or not connected) or 500.

## Endpoints

| Method | Path                              | Body                                                                                                               | Response                                                                                                                                   |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/health`                         |                                                                                                                    | `200 { status: 'ok', instances: { total, connected } }`                                                                                    |
| POST   | `/instances`                      | `{ id?, webhook?: { url, secret? }, pairing?: { method: 'qr' } \| { method: 'code', phoneNumber }, autoConnect? }` | `201 InstanceView`                                                                                                                         |
| GET    | `/instances/:id`                  |                                                                                                                    | `200 InstanceView`                                                                                                                         |
| GET    | `/instances/:id/status`           |                                                                                                                    | `200 ConnectorStatus`                                                                                                                      |
| POST   | `/instances/:id/connect`          |                                                                                                                    | `202 ConnectorStatus`                                                                                                                      |
| GET    | `/instances/:id/pairing`          |                                                                                                                    | `200 { method: 'qr', qr: { raw, dataUrl }, issuedAt }` or `{ method: 'code', code, phoneNumber, issuedAt }`; `204` when nothing is pending |
| POST   | `/instances/:id/disconnect`       |                                                                                                                    | `200 ConnectorStatus`                                                                                                                      |
| DELETE | `/instances/:id`                  |                                                                                                                    | `204` (logs out, clears auth, removes the definition)                                                                                      |
| POST   | `/instances/:id/messages`         | see below                                                                                                          | `201 { messageId, chatId, timestamp }`                                                                                                     |
| GET    | `/instances/:id/media/:messageId` |                                                                                                                    | `200` file stream with `Content-Type`; `404 MEDIA_UNAVAILABLE`                                                                             |

`InstanceView = { id, createdAt, webhook?: { url, hasSecret }, pairing, desiredState, status }`.

### Sending

```json
{ "to": "972501234567", "type": "text", "text": "hello", "quotedMessageId": "optional" }
{ "to": "1234-5678@g.us", "type": "image", "mimetype": "image/jpeg", "base64": "...", "caption": "optional" }
{ "to": "972501234567", "type": "document", "mimetype": "application/pdf", "url": "https://files.example/a.pdf", "fileName": "a.pdf" }
{ "to": "972501234567", "type": "audio", "mimetype": "audio/ogg; codecs=opus", "base64": "...", "voiceNote": true }
```

`to` is a bare number with country code or a JID (`...@s.whatsapp.net`, `...@g.us`, `...@lid`). Exactly one of `base64` or `url` is required for media; the service fetches `url` itself.

## Security

Media `url` is fetched by the service itself, from wherever the service is running: it is a server-side request forgery surface, so treat the ability to call `POST /instances/:id/messages` as the ability to make the service issue arbitrary outbound HTTP requests. Only `http:` and `https:` urls are accepted (anything else is `400 MEDIA_FETCH_FAILED`), and the fetched body is capped at 64 MiB — rejected both when `Content-Length` declares more and when the stream itself exceeds the cap. There is no allowlist or private-address filter; put the service behind a network boundary you trust, or do not expose the `url` form.

Always set `API_KEY` unless the service is bound to loopback (`HOST=127.0.0.1`). With no `API_KEY`, every endpoint except `GET /health` is unauthenticated; the service logs a startup warning when it is not bound to loopback and no key is set.

## Webhook delivery

Each event is POSTed as JSON to the instance webhook (or `WEBHOOK_URL`). Headers:

- `X-Connectors-Event`: event type (`message.received`, `message.sent`, `connection.updated`)
- `X-Connectors-Delivery`: unique id per event, generated once per publish and repeated across the retries of that event, so consumers can use it as an idempotency key
- `X-Connectors-Signature`: `sha256=<hex HMAC-SHA256 of the raw body>` when a secret is set

Delivery is best effort: three attempts with backoff on network errors and 5xx/429, then the event is logged and dropped. Verify signatures like this:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
const ok = timingSafeEqual(
  Buffer.from(expected),
  Buffer.from(req.headers['x-connectors-signature'] ?? ''),
);
```

Event body: `{ id, connector: 'whatsapp', accountId, externalId, type, timestamp, receivedAt, payload }`. For messages, `payload` is the normalized `WhatsAppMessage`; media content carries `media.messageId` to use with the media endpoint while the message is cached (24h by default, memory only).
