import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { FileStore } from '@connectors/core';
import { createLogger } from '@connectors/observability';
import { createWhatsAppConnector } from '@connectors/whatsapp';
import qrcode from 'qrcode-terminal';

const DATA_DIR = process.env.DATA_DIR ?? './data';
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR ?? './downloads';
const PHONE_NUMBER = process.env.PHONE_NUMBER; // digits with country code, no '+', enables pairing-code login

const logger = createLogger({ name: 'whatsapp-basic', level: 'info', pretty: true });

// 1. Initialize the connector. Only auth state is persisted (to ./data). Messages stay in memory.
const connector = createWhatsAppConnector({
  accountId: 'example',
  storage: { auth: new FileStore(DATA_DIR) },
  logger,
  pairing: PHONE_NUMBER ? { method: 'code', phoneNumber: PHONE_NUMBER } : { method: 'qr' },
});

// 2. Pairing: render the QR in the terminal, or print the 8-character code to enter on the phone.
connector.onPairing((pairing) => {
  if (pairing.method === 'qr') {
    console.log('\nScan this QR with WhatsApp > Linked devices > Link a device:\n');
    qrcode.generate(pairing.qr, { small: true });
  } else {
    console.log(
      `\nEnter this code on your phone (Linked devices > Link with phone number): ${pairing.code}\n`,
    );
  }
});

// 4. Print every normalized event. 5. Opt in to saving images and voice notes to ./downloads.
connector.subscribe(async (event) => {
  if (event.type === 'connection.updated') {
    console.log(`[connection] ${event.payload.state}`, event.payload.lastError?.code ?? '');
    return;
  }
  console.log(JSON.stringify(event, null, 2));
  const { content } = event.payload;
  const wantsDownload =
    content.kind === 'image' || (content.kind === 'audio' && content.isVoiceNote);
  if (!wantsDownload) return;
  await mkdir(DOWNLOAD_DIR, { recursive: true });
  const ext = content.kind === 'image' ? 'jpg' : 'ogg';
  const target = join(DOWNLOAD_DIR, `${event.payload.messageId}.${ext}`);
  const result = await connector.downloadMediaToFile(content.media, target);
  console.log(`[media] saved ${result.bytes} bytes to ${result.path}`);
});

// 3. Connect. 6. On restart, stored auth state is reused and no QR is shown.
await connector.connect();
console.log('Connector started. Press Ctrl+C to stop.');

const stop = async () => {
  await connector.disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
