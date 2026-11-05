import { initDataLayer, shutdownDataLayer } from './db/index.js';
import { createApp } from './app.js';
import { mongoUserStore } from './auth/userStore.js';
import { mongoFlagStore } from './flags/mongoFlagStore.js';
import { mongoSdkStore } from './sdk/mongoSdkStore.js';
import { mongoAuditStore } from './projects/mongoAuditStore.js';
import { mongoProjectStore } from './projects/mongoProjectStore.js';
import { serializeError } from './errors.js';
import { logger } from './logger.js';
import dns from 'node:dns';

dns.setServers(['8.8.8.8', '1.1.1.1']);

// Existing imports and server code below

async function main() {
  const clients = await initDataLayer();
  const app = createApp({
    env: clients.env,
    userStore: mongoUserStore,
    projectStore: mongoProjectStore,
    flagStore: mongoFlagStore,
    sdkStore: mongoSdkStore,
    auditStore: mongoAuditStore,
    cache: clients.cache,
    publisher: clients.publisher,
    subscriber: clients.subscriber,
    logger,
  });

  const server = app.listen(clients.env.PORT, () => {
    logger.info({ msg: 'server_listening', port: clients.env.PORT });
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ msg: 'shutdown_started', signal });
    const forceExit = setTimeout(() => process.exit(1), 10_000);
    forceExit.unref();
    // Open event streams never finish on their own, so end them or close() would wait.
    app.locals.hub.closeAll();
    server.close(async () => {
      await shutdownDataLayer(clients);
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ msg: 'startup_failed', err: serializeError(err) });
  process.exit(1);
});
