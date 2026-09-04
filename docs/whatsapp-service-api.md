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

## Webhook delivery

Each event is POSTed as JSON to the instance webhook (or `WEBHOOK_URL`). Headers:

- `X-Connectors-Event`: event type (`message.received`, `message.sent`, `connection.updated`)
- `X-Connectors-Delivery`: unique id per attempt
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
