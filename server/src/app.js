import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { parseOrigins } from './env.js';
import { AppError, createErrorHandler } from './errors.js';
import { logger as defaultLogger } from './logger.js';
import { requestId } from './middleware/requestId.js';
import { requireCustomHeader } from './middleware/requireCustomHeader.js';
import { createAuthRouter } from './routes/auth.js';

/**
 * Build the Express app. It does not connect to anything: the database user
 * store is passed in, which is what lets tests run without a database.
 *
 * @param {{ env: any, userStore: any, logger?: any }} deps
 */
export function createApp({ env, userStore, logger = defaultLogger }) {
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

  // Dashboard API: cookie auth, so state-changing calls need the custom header.
  app.use('/api', requireCustomHeader);
  app.use('/api/auth', createAuthRouter({ env, userStore }));
  // Project, environment, and flag routers are added here in the next pieces.

  app.use((req, res, next) => {
    next(new AppError(404, 'not_found', 'Not found.'));
  });
  app.use(createErrorHandler(logger));

  return app;
}
