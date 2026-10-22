import { flagUpdatesChannel } from '../lib/redisKeys.js';
import { serializeError } from '../errors.js';

const PREFIX = flagUpdatesChannel('');

/**
 * Fans Redis pub/sub change messages out to open SSE connections.
 * One Redis subscription per environment per server instance, shared by all
 * streams on that instance, so several server instances all hear every change.
 *
 * A client is { deliver(message), close() }.
 *
 * @param {{ subscriber: any, logger: any }} deps
 */
export function createStreamHub({ subscriber, logger }) {
  /** @type {Map<string, Set<{ deliver: Function, close: Function }>>} */
  const byEnv = new Map();
  const subscribed = new Set();
  let attached = false;
  let chain = Promise.resolve();

  // Subscribe and unsubscribe calls run one at a time, so a quick disconnect and
  // reconnect cannot leave the subscription in the wrong state.
  const enqueue = (task) => {
    const run = chain.then(task);
    chain = run.catch(() => {});
    return run;
  };

  function attach() {
    if (attached) {
      return;
    }
    attached = true;
    subscriber.on('message', (channel, raw) => {
      if (!channel.startsWith(PREFIX)) {
        return;
      }
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        logger.warn({ msg: 'stream_bad_message', channel });
        return;
      }
      // Only well-formed change messages are forwarded: { version, flagKey, flag }.
      if (message === null || typeof message !== 'object' || !Number.isInteger(message.version) || typeof message.flagKey !== 'string') {
        logger.warn({ msg: 'stream_bad_message', channel });
        return;
      }
      for (const client of [...(byEnv.get(channel.slice(PREFIX.length)) ?? [])]) {
        client.deliver(message);
      }
    });
  }

  return {
    /** Rejects if Redis cannot subscribe, so the caller can refuse the stream. */
    async add(envId, client) {
      attach();
      let clients = byEnv.get(envId);
      if (!clients) {
        clients = new Set();
        byEnv.set(envId, clients);
      }
      clients.add(client);
      try {
        await enqueue(async () => {
          if (byEnv.get(envId)?.size && !subscribed.has(envId)) {
            await subscriber.subscribe(flagUpdatesChannel(envId));
            subscribed.add(envId);
          }
        });
      } catch (err) {
        this.remove(envId, client);
        throw err;
      }
    },

    remove(envId, client) {
      const clients = byEnv.get(envId);
      if (!clients) {
        return;
      }
      clients.delete(client);
      if (clients.size > 0) {
        return;
      }
      byEnv.delete(envId);
      enqueue(async () => {
        if (!byEnv.has(envId) && subscribed.has(envId)) {
          await subscriber.unsubscribe(flagUpdatesChannel(envId));
          subscribed.delete(envId);
        }
      }).catch((err) => logger.warn({ msg: 'stream_unsubscribe_failed', envId, err: serializeError(err) }));
    },

    /** End every open stream, so a server shutdown is not held up by them. */
    closeAll() {
      for (const clients of byEnv.values()) {
        for (const client of [...clients]) {
          client.close();
        }
      }
    },

    connectionCount() {
      let total = 0;
      for (const clients of byEnv.values()) {
        total += clients.size;
      }
      return total;
    },
  };
}
