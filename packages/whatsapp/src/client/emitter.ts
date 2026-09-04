import type { Unsubscribe } from '@connectors/core';

type Handler<T> = (payload: T) => void;

export class TypedEmitter<Map extends Record<string, unknown>> {
  private readonly handlers = new Map<keyof Map, Set<Handler<never>>>();
  private readonly onError: (err: unknown) => void;

  constructor(onError: (err: unknown) => void = () => undefined) {
    this.onError = onError;
  }

  on<E extends keyof Map>(event: E, handler: Handler<Map[E]>): Unsubscribe {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- store heterogeneous handlers under a single erased type
    set.add(handler as Handler<never>);
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- store heterogeneous handlers under a single erased type
      set.delete(handler as Handler<never>);
    };
  }

  emit<E extends keyof Map>(event: E, payload: Map[E]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        (handler as Handler<Map[E]>)(payload);
      } catch (err) {
        this.onError(err);
      }
    }
  }

  removeAll(): void {
    this.handlers.clear();
  }
}
