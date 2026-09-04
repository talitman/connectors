# whatsapp-basic

Minimal consumer of `@connectors/whatsapp` in package mode (no HTTP service).

## Run

```bash
pnpm install && pnpm build
cd examples/whatsapp-basic
pnpm start                       # QR pairing
PHONE_NUMBER=972501234567 pnpm start   # pairing-code login instead
```

1. A QR (or pairing code) is printed. Link the device from WhatsApp on your phone.
2. WhatsApp closes the socket once after pairing (code 515); the connector reconnects automatically.
3. Send yourself a text: the normalized event prints as JSON.
4. Send an image or a voice note: it is downloaded to `./downloads/<messageId>.<ext>`. This is the explicit opt-in to storing media; the connector never stores media on its own.
5. Press Ctrl+C, then run `pnpm start` again: it reconnects from `./data` without a QR.
6. To unlink, delete `./data` (or call `connector.logout()`).

`./data` contains the WhatsApp session keys. Treat it like a password.
