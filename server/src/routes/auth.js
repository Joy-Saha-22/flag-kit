import { Router } from 'express';
import { AppError, CONFLICT_MESSAGE, asyncHandler } from '../errors.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';
import { signSessionToken } from '../auth/tokens.js';
import { clearSessionCookie, setSessionCookie } from '../auth/cookies.js';
import { loginSchema, registerSchema } from '../auth/schemas.js';
import { validate } from '../middleware/validate.js';
import { createRequireAuth } from '../middleware/auth.js';

const publicUser = (user) => ({ id: user.id, email: user.email, name: user.name });

/**
 * @param {{ env: any, userStore: any }} deps
 */
export function createAuthRouter({ env, userStore }) {
  const router = Router();
  const requireAuth = createRequireAuth({ env, userStore });

  // Used so a login for an unknown email takes about as long as a real one.
  let dummyHash;
  const getDummyHash = () => {
    dummyHash ??= hashPassword('not-a-real-password', env.BCRYPT_COST);
    return dummyHash;
  };

  const startSession = (res, user) => {
    const token = signSessionToken(user.id, { secret: env.JWT_SECRET, ttlSeconds: env.JWT_TTL_SECONDS });
    setSessionCookie(res, token, env);
  };

  router.post(
    '/register',
    validate({ body: registerSchema }),
    asyncHandler(async (req, res) => {
      const { email, password, name } = req.valid.body;
      const existing = await userStore.findByEmail(email);
      if (existing) {
        throw new AppError(409, 'conflict', CONFLICT_MESSAGE);
      }
      const passwordHash = await hashPassword(password, env.BCRYPT_COST);
      // A race between the check above and this insert is caught by the unique
      // index and mapped to the same 409 by the error handler.
      const user = await userStore.create({ email, name, passwordHash });
      startSession(res, user);
      res.status(201).json({ user: publicUser(user) });
    }),
  );

  router.post(
    '/login',
    validate({ body: loginSchema }),
    asyncHandler(async (req, res) => {
      const { email, password } = req.valid.body;
      const user = await userStore.findByEmail(email);
      const hash = user ? user.passwordHash : await getDummyHash();
      const passwordOk = await verifyPassword(password, hash);
      if (!user || !passwordOk) {
        // Same status and message for unknown email and wrong password.
        throw new AppError(401, 'invalid_credentials', 'Invalid email or password.');
      }
      startSession(res, user);
      res.json({ user: publicUser(user) });
    }),
  );

  router.post('/logout', (req, res) => {
    clearSessionCookie(res, env);
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}
