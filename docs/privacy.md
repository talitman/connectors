# Privacy and data flow

This document describes exactly what `@talitman/whatsapp` and `apps/whatsapp-service` store, keep in memory, and send over the network. Default behaviour is the most private option; everything else is opt-in.

## What is stored

| Data                                                                                              | Stored by                    | Where                                                             | Default                                                                                |
| ------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| WhatsApp credentials (identity keys, noise key, registration, account info)                       | Baileys via our auth adapter | `KeyValueStore` you supply, key `whatsapp/<accountId>/auth/creds` | Always (required for the session)                                                      |
| Signal keys (pre-keys, sessions, sender keys, app-state keys, LID mappings, device lists, tokens) | Baileys via our auth adapter | same store, keys `whatsapp/<accountId>/auth/keys/<type>/<id>`     | Always (required for decryption)                                                       |
| Instance definitions (id, webhook URL and secret, pairing method, desired state)                  | whatsapp-service             | same store, key `instances/<id>/definition`                       | Always in service mode                                                                 |
| Message bodies                                                                                    | nobody                       |                                                                   | Never; your subscriber may store them                                                  |
| Media files                                                                                       | nobody                       |                                                                   | Never; `downloadMedia` streams to you, `downloadMediaToFile` writes only where you ask |

In service mode the store is namespaced per instance, so the same credential and key entries live at `instances/<id>/whatsapp/<id>/auth/creds` and `instances/<id>/whatsapp/<id>/auth/keys/<type>/<id>` (the instance id is also the account id), alongside `instances/<id>/definition`. `DELETE /instances/:id` clears the whole `instances/<id>/` prefix.

`FileStore` writes files with mode 0600 in directories with mode 0700. The directory contains everything needed to act as your WhatsApp linked device. Back it up encrypted and never commit it.

## What is kept only in memory

| Data                               | Purpose                                           | Bound                                                       |
| ---------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| Raw recent messages (media cache)  | Media download, reply quoting, re-upload requests | `mediaCache.maxEntries` (5000) and `mediaCache.ttlMs` (24h) |
| Message id set (dedupe)            | Drop duplicate deliveries                         | `dedupe.maxEntries` (5000), `dedupe.ttlMs` (10 min)         |
| Pairing state (current QR or code) | Expose to `getPairing()`                          | Cleared on connect                                          |
| Signal key cache                   | Baileys performance                               | 5 minutes, inside Baileys                                   |

Everything above is lost on restart. Media for messages received before a restart cannot be fetched through the connector unless you opted into `includeRaw` and kept the raw payload.

## Network connections

| Destination                                                                 | When                                      | Opt-in?                 |
| --------------------------------------------------------------------------- | ----------------------------------------- | ----------------------- |
| `wss://web.whatsapp.com/ws/chat`                                            | Always while connected                    | No (required)           |
| WhatsApp media hosts (`mmg.whatsapp.net` and hosts announced by the server) | Downloading or sending media              | No (required for media) |
| `raw.githubusercontent.com` (Baileys version file)                          | Only if `fetchLatestVersion: true`        | Yes, default off        |
| Your webhook URL                                                            | Every event, service mode                 | Yes, you configure it   |
| Arbitrary URL you pass to `POST /instances/:id/messages` with `url`         | That request only                         | Yes, per request        |
| Link preview targets                                                        | Never; link previews are disabled on send |                         |

No analytics, telemetry, crash reporting or hosted logging exist in this codebase. Logs go to stdout only.

## Logging

The logger from `@talitman/observability` redacts credentials, signal keys, media keys, secrets and authorization headers by default. Baileys receives a child logger at `warn` level (`providerLogLevel`); raise it only when debugging and be aware that Baileys debug output can include message content.

## Opting into storing messages or media

- Subscribe to events and persist `event.payload` (normalized) or `event.raw` (provider payload, requires `includeRaw: true`) yourself.
- Call `downloadMediaToFile` or pipe `downloadMedia` into your own storage.
- In service mode, your webhook receives the normalized payload; fetch media through `GET /instances/:id/media/:messageId` while the message is still cached.
