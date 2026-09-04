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
    expect(res.headers['content-disposition']).toBe('attachment; filename="a.pdf"');
    expect(res.body).toBe('media-bytes');
  });

  it('404s when media is unavailable', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/instances/main/media/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'MEDIA_UNAVAILABLE' } });
  });
});
