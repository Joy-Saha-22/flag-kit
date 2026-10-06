import express, { Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { parseOrigins } from './env.js';
import { AppError, createErrorHandler } from './errors.js';
import { logger as defaultLogger } from './logger.js';
import { createFlagSchemas } from './flags/schemas.js';
import { createRulesetSync } from './flags/rulesetSync.js';
import { createLoadProject } from './middleware/project.js';
import { createRequireAuth } from './middleware/auth.js';
import { requestId } from './middleware/requestId.js';
import { requireCustomHeader } from './middleware/requireCustomHeader.js';
import { createAuditRouter } from './routes/audit.js';
import { createAuthRouter } from './routes/auth.js';
import { createEnvironmentsRouter } from './routes/environments.js';
import { createFlagsRouter } from './routes/flags.js';
import { createProjectsRouter } from './routes/projects.js';
import { createSdkRouter } from './routes/sdk.js';
import { createSdkAuth } from './sdk/auth.js';
import { createRulesetLoader } from './sdk/rulesetLoader.js';
import { createSdkSchemas } from './sdk/schemas.js';
import { createStreamHub } from './sdk/streamHub.js';

/**
 * Build the Express app. It does not connect to anything: stores and the Redis
 * clients are passed in, which is what lets tests run without a database.
 * The stream hub is exposed as app.locals.hub so shutdown can end open streams.
 *
 * @param {{ env: any, userStore: any, projectStore?: any, flagStore?: any, sdkStore?: any, auditStore?: any, cache?: any, publisher?: any, subscriber?: any, logger?: any }} deps
 */
export function createApp({
  env,
  userStore,
  projectStore,
  flagStore,
  sdkStore,
  auditStore,
  cache,
  publisher,
  subscriber,
  logger = defaultLogger,
}) {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(helmet());

  // Dashboard API: only our own dashboard origin may call it from a browser, with cookies.
  const allowedOrigins = new Set(parseOrigins(env.CORS_ORIGINS));
  app.use(
    '/api',
    cors({
      // Requests without an Origin header (same-origin, curl) pass through.
      // Browser requests from any other origin get no CORS headers and are blocked.
      origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-Requested-By'],
      exposedHeaders: ['X-Request-Id', 'Retry-After'],
      maxAge: 600,
    }),
  );
  // SDK API: any website may call it, because it is authenticated by an SDK key in a
  // header and never by cookies, so there is no ambient credential to steal.
  app.use(
    '/sdk',
    cors({
      origin: '*',
      methods: ['GET', 'POST'],
      allowedHeaders: ['Authorization', 'Content-Type', 'If-None-Match'],
      exposedHeaders: ['ETag', 'X-Request-Id', 'Retry-After'],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: env.JSON_BODY_LIMIT }));
  app.use(cookieParser());

  app.get('/healthz', (req, res) => {
    res.json({ status: 'ok' });
  });

  const requireAuth = createRequireAuth({ env, userStore });
  const loadProject = createLoadProject({ projectStore });
  const schemas = createFlagSchemas(env);
  const sync = createRulesetSync({
    flagStore,
    cache,
    publisher,
    logger,
    ttlSeconds: env.RULESET_CACHE_TTL_SECONDS,
  });

  // Dashboard API: cookie auth, so state-changing calls need the custom header.
  app.use('/api', requireCustomHeader);
  app.use('/api/auth', createAuthRouter({ env, userStore }));
  app.use('/api/projects', createProjectsRouter({ env, projectStore, auditStore, requireAuth }));

  // Everything under /api/projects/:pid: signed in, member of the project, role set on req.
  const projectScope = Router();
  projectScope.use('/environments', createEnvironmentsRouter({ env, projectStore, auditStore, cache, logger }));
  projectScope.use('/flags', createFlagsRouter({ env, projectStore, flagStore, auditStore, sync, schemas, logger }));
  projectScope.use('/audit', createAuditRouter({ auditStore, schemas }));
  app.use('/api/projects/:pid', requireAuth, loadProject, projectScope);

  // SDK API: SDK key auth, no cookies, no custom header.
  const hub = createStreamHub({ subscriber, logger });
  app.locals.hub = hub;
  app.use(
    '/sdk/v1',
    createSdkRouter({
      env,
      auth: createSdkAuth({ sdkStore, cache, logger }),
      loadRuleset: createRulesetLoader({ cache, flagStore, logger, ttlSeconds: env.RULESET_CACHE_TTL_SECONDS }),
      hub,
      sdkStore,
      schemas: createSdkSchemas(env),
      logger,
    }),
  );

  app.use((req, res, next) => {
    next(new AppError(404, 'not_found', 'Not found.'));
  });
  app.use(createErrorHandler(logger));

  return app;
}
