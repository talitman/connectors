import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../testing/test-app.js';

async function setup() {
  const { app, manager, connectors } = buildTestApp();
  await manager.create({ id: 'main' });
  return { app, connector: connectors.get('main')! };
}

describe('GET /instances/:id/media/:messageId', () => {
  it('streams media with content headers', async () => {
    const { app, connector } = await setup();
    connector.media.set('M1', {
      kind: 'document',
      mimetype: 'application/pdf',
      fileName: 'a.pdf',
      messageId: 'M1',
    });
    const res = await app.inject({ method: 'GET', url: '/instances/main/media/M1' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="a.pdf"; filename*=UTF-8''a.pdf`,
    );
    expect(res.body).toBe('media-bytes');
  });

  it('encodes non-Latin-1 file names instead of failing on the header', async () => {
    const { app, connector } = await setup();
    connector.media.set('M2', {
      kind: 'document',
      mimetype: 'application/pdf',
      fileName: 'קובץ.pdf',
      messageId: 'M2',
    });
    const res = await app.inject({ method: 'GET', url: '/instances/main/media/M2' });
    expect(res.statusCode).toBe(200);
    const disposition = res.headers['content-disposition'];
    expect(disposition).toBe(
      `attachment; filename="____.pdf"; filename*=UTF-8''%D7%A7%D7%95%D7%91%D7%A5.pdf`,
    );
    expect(res.body).toBe('media-bytes');
  });

  it('strips quotes, backslashes and control characters from the ascii fallback', async () => {
    const { app, connector } = await setup();
    connector.media.set('M3', {
      kind: 'document',
      mimetype: 'application/pdf',
      fileName: 'a"b\\c\r\nd.pdf',
      messageId: 'M3',
    });
    const res = await app.inject({ method: 'GET', url: '/instances/main/media/M3' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="abcd.pdf"; filename*=UTF-8''a%22b%5Ccd.pdf`,
    );
  });

  it('404s when media is unavailable', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/instances/main/media/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'MEDIA_UNAVAILABLE' } });
  });
});
