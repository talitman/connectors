import { describe, expect, it } from 'vitest';
import { buildEventId } from './events.js';

describe('buildEventId', () => {
  it('joins connector, account, type and external id', () => {
    expect(
      buildEventId({
        connector: 'whatsapp',
        accountId: 'a1',
        type: 'message.received',
        externalId: 'X',
      }),
    ).toBe('whatsapp:a1:message.received:X');
  });
});
