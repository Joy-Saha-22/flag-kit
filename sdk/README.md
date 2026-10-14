# FlagKit SDK

The SDK evaluates flags locally and can keep its ruleset current through server-sent events or polling. It runs on Node.js 18+ and in browsers with `fetch`, `ReadableStream`, and `AbortController`.

## Install

This SDK is a private package in the FlagKit npm-workspaces monorepo. From the repository root, install the workspace dependencies with:

```sh
npm install
```

The SDK depends on the workspace package `@flagkit/evaluator`. Import it from a workspace consumer as `flagkit-sdk`.

## Node usage

```js
import { createClient } from 'flagkit-sdk';

const client = createClient({
  sdkKey: process.env.FLAGKIT_SDK_KEY,
  baseUrl: process.env.FLAGKIT_URL ?? 'http://localhost:3000',
});

await client.waitForInit();

const user = { key: 'user-123', plan: 'pro' };
const enabled = client.variation('checkout', user, false);
console.log('checkout enabled:', enabled);

client.track('signup_completed', user);

await client.close();
```

## Browser usage

Bundle the workspace package with your browser application. Keep the key in the browser configuration only if it is a **client SDK key**:

```js
import { createClient } from 'flagkit-sdk';

const client = createClient({
  sdkKey: import.meta.env.VITE_FLAGKIT_SDK_KEY,
  baseUrl: import.meta.env.VITE_FLAGKIT_URL,
});

await client.waitForInit();

const user = { key: currentUser.id, plan: currentUser.plan };
const buttonVariant = client.variation('checkout_button', user, 'default');

client.track('signup_completed', user);

window.addEventListener('pagehide', () => {
  void client.close();
}, { once: true });
```

The SDK automatically attempts an event flush on `pagehide` and when the document becomes hidden. Those requests use `fetch` with `keepalive` and the normal Authorization header; the SDK does not use `sendBeacon`.

## Client options

| Option | Default | Description |
| --- | --- | --- |
| `sdkKey` | Required | SDK key sent in the `Authorization` header. |
| `baseUrl` | Required | HTTP(S) server base URL, without credentials, query, or fragment. |
| `streaming` | `true` | Connect to the live ruleset stream; after repeated stream failures the SDK falls back to polling. |
| `pollIntervalMs` | `30000` | Poll interval in milliseconds; used directly when streaming is disabled and during fallback. |
| `flushIntervalMs` | `5000` | Maximum wait in milliseconds before queued events are sent. |
| `events` | `true` | Set to `false` to disable event collection and transmission. |
| `logger` | — | Optional object with `info`, `warn`, and/or `error` methods. Messages never include the SDK key or event bodies. |
| `fetch` | `globalThis.fetch` | Optional Fetch-compatible function, useful for custom runtimes and testing. |

`waitForInit({ timeoutMs = 5000 })` resolves when the first ruleset has loaded, and rejects if initialization times out or the key is unauthorized. `isReady()` reports whether the client is usable. `onChange(callback)` subscribes to ruleset updates and returns an unsubscribe function; callbacks receive `{ flagKey, version }` (`flagKey` is `null` for a full ruleset replacement). `variationDetail(flagKey, userContext, defaultValue)` returns `{ value, variationKey, reason }`; `variation()` returns only the value. Both return the default value for unavailable flags, missing user keys, or evaluation errors.

## Events

Calling `variation()` or `variationDetail()` queues an exposure only when the flag is an experiment and a valid variation was served. An exposure contains the flag key, variation **key**, user key, and an SDK-clock ISO timestamp. Each `(flagKey, userKey, variationKey)` exposure is deduplicated for the lifetime of the client, with a bounded 10,000-entry LRU.

Call `track(metricKey, userContext)` to queue a conversion for each current experiment whose goal metric matches. The conversion uses the variation most recently served to that user. If the user has not yet been evaluated for a matching flag, the SDK evaluates it and queues the exposure before that flag's conversion. Calls without a valid `userContext.key` are ignored. Tracking methods do not throw.

Events are sent in batches of up to 100, flushed on the configured timer, at 50 queued events, or by `flush()`. The in-memory queue is capped at 1,000 events; overflow drops the oldest event. Only experiment events are stored by the server; unknown flags and events that no longer match the current flag configuration may be dropped.

`await client.flush()` attempts to send queued events. `await client.close()` makes one final flush attempt, then aborts outstanding requests and stops timers/listeners. A malformed/oversized batch is dropped; transient network, 429, and 5xx failures are retried with backoff (respecting `Retry-After`). An unauthorized response stops the client.

## Client-key security

A client SDK key is public by design: it is embedded in browser traffic and must not be treated as a secret. Client SDK keys can read the environment's full targeting rules, which are evaluated locally. **Do not put secrets, credentials, private tokens, or other sensitive values in flag rule values or targeting configuration.** Use a server SDK key only in trusted server-side code and never expose it to a browser.
