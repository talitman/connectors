import { describe, expect, it, vi } from 'vitest';
import { sleep } from './sleep.js';

describe('sleep', () => {
  it('resolves after the given delay', async () => {
    vi.useFakeTimers();
    const done = vi.fn();
    void sleep(100).then(done);
    await vi.advanceTimersByTimeAsync(99);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('rejects when the signal aborts', async () => {
    const controller = new AbortController();
    const promise = sleep(10_000, controller.signal);
    controller.abort();
    await expect(promise).rejects.toThrow('aborted');
  });
});
