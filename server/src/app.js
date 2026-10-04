import express, { Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { parseOrigins } from './env.js';
import { AppError, createErrorHandler } from './errors.js';
import { logger as defaultLogger } from './logger.js';
import { createLoadProject } from './middleware/project.js';
import { createRequireAuth } from './middleware/auth.js';
import { requestId } from './middleware/requestId.js';
import { requireCustomHeader } from './middleware/requireCustomHeader.js';
import { createAuthRouter } from './routes/auth.js';
import { createEnvironmentsRouter } from './routes/environments.js';
import { createProjectsRouter } from './routes/projects.js';

/**
 * Build the Express app. It does not connect to anything: stores and the Redis
 * client are passed in, which is what lets tests run without a database.
 *
 * @param {{ env: any, userStore: any, projectStore?: any, auditStore?: any, cache?: any, logger?: any }} deps
 */
export function createApp({ env, userStore, projectStore, auditStore, cache, logger = defaultLogger }) {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(helmet());

  const allowedOrigins = new Set(parseOrigins(env.CORS_ORIGINS));
  app.use(
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

  app.use(express.json({ limit: env.JSON_BODY_LIMIT }));
  app.use(cookieParser());

  app.get('/healthz', (req, res) => {
    res.json({ status: 'ok' });
  });

  const requireAuth = createRequireAuth({ env, userStore });
  const loadProject = createLoadProject({ projectStore });

  // Dashboard API: cookie auth, so state-changing calls need the custom header.
  app.use('/api', requireCustomHeader);
  app.use('/api/auth', createAuthRouter({ env, userStore }));
  app.use('/api/projects', createProjectsRouter({ env, projectStore, auditStore, requireAuth }));

  // Everything under /api/projects/:pid: signed in, member of the project, role set on req.
  const projectScope = Router();
  projectScope.use('/environments', createEnvironmentsRouter({ env, projectStore, auditStore, cache, logger }));
  // Flag routes are added to projectScope in the next piece.
  app.use('/api/projects/:pid', requireAuth, loadProject, projectScope);

  app.use((req, res, next) => {
    next(new AppError(404, 'not_found', 'Not found.'));
  });
  app.use(createErrorHandler(logger));

  return app;
}
