import { loadEnv } from '../env.js';
import { connectMongo, disconnectMongo } from './mongoose.js';
import { connectRedis, createRedisClients, disconnectRedis } from './redis.js';

/**
 * Load env, connect MongoDB and Redis. Used by future HTTP bootstrap.
 *
 * @returns {Promise<{
 *   env: ReturnType<typeof loadEnv>,
 *   cache: import('ioredis').Redis,
 *   publisher: import('ioredis').Redis,
 *   subscriber: import('ioredis').Redis,
 * }>}
 */
export async function initDataLayer() {
  const env = loadEnv();
  await connectMongo(env.MONGODB_URI);
  const clients = createRedisClients(env.REDIS_URL);
  await connectRedis(clients);
  return { env, ...clients };
}

/**
 * @param {{ cache: import('ioredis').Redis, publisher: import('ioredis').Redis, subscriber: import('ioredis').Redis }} clients
 * @returns {Promise<void>}
 */
export async function shutdownDataLayer(clients) {
  await disconnectRedis(clients);
  await disconnectMongo();
}
