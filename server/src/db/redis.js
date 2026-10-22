import Redis from 'ioredis';
import { serializeError } from '../errors.js';

/**
 * @typedef {Object} RedisClients
 * @property {import('ioredis').Redis} cache
 * @property {import('ioredis').Redis} publisher
 * @property {import('ioredis').Redis} subscriber
 */

/**
 * @param {string} url
 * @param {string} name
 * @returns {import('ioredis').Redis}
 */
function createClient(url, name) {
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    connectionName: name,
  });

  client.on('error', (error) => {
    console.error(`Redis (${name}) error:`, serializeError(error));
  });

  return client;
}

/**
 * ioredis requires a dedicated subscriber connection: a client in subscribe
 * mode cannot issue other commands. Publisher is separate so publishes never
 * block on a subscribed connection.
 *
 * @param {string} url
 * @returns {RedisClients}
 */
export function createRedisClients(url) {
  return {
    cache: createClient(url, 'flagkit-cache'),
    publisher: createClient(url, 'flagkit-publisher'),
    subscriber: createClient(url, 'flagkit-subscriber'),
  };
}

/**
 * @param {RedisClients} clients
 * @returns {Promise<void>}
 */
export async function connectRedis(clients) {
  await Promise.all([clients.cache.connect(), clients.publisher.connect(), clients.subscriber.connect()]);
}

/**
 * @param {RedisClients} clients
 * @returns {Promise<void>}
 */
export async function disconnectRedis(clients) {
  await Promise.allSettled([clients.cache.quit(), clients.publisher.quit(), clients.subscriber.quit()]);
}
