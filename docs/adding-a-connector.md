# Adding a connector

1. **Create the package** `packages/<name>` by copying `packages/config`'s `package.json`, `tsconfig.json`, `tsconfig.build.json` and `vitest.config.ts`. Name it `@talitman/<name>`, depend on `@talitman/core` with `workspace:*`, export only from `src/index.ts`.
2. **Implement the contracts** from `@talitman/core`:
   - `Connector` (`name`, `accountId`, `connect`, `disconnect`, `getStatus`).
   - `EventSource` if the provider pushes events, `Pollable` if you must poll, both if needed. Do not implement what you do not need.
   - Emit `ConnectorEvent` objects built with `buildEventId`; keep `payload` normalized and provider-neutral, put the provider shape in `raw` only when the consumer asks.
3. **Hide the provider library** behind an internal `client/` interface, exactly like `packages/whatsapp/src/client/types.ts`. One file imports the SDK; everything else uses your structural types. Write a `testing/fake-client.ts` for tests.
4. **Persist through `KeyValueStore`.** Wrap the store the consumer passes in with `namespaced(store, '<name>/<accountId>/...')`. Persist only what the session needs.
5. **Map errors** to `ConnectorError` with a stable `code` and the right `retryable` flag; use `AuthError` when re-authentication is required.
6. **Reuse core utilities**: `exponentialBackoff` for reconnects, `EventDeduplicator` for duplicate suppression, `createWebhookPublisher` if you add a service.
7. **Tests** (no real accounts): normalization fixtures, state transitions with the fake client, error mapping, storage round-trips, config validation.
8. **Service (optional)**: copy `apps/whatsapp-service`; keep the instance manager and routes, swap the connector factory.
9. **Document** the data flow in `docs/privacy.md`: what is stored, what stays in memory, which hosts are contacted.
