import { z } from 'zod';

// bcrypt only uses the first 72 bytes of a password, so longer ones are rejected
// instead of being silently truncated.
const MAX_PASSWORD_BYTES = 72;
const withinByteLimit = (value) => Buffer.byteLength(value, 'utf8') <= MAX_PASSWORD_BYTES;
const BYTE_LIMIT_MESSAGE = `Password must be at most ${MAX_PASSWORD_BYTES} bytes.`;

const email = z.string().trim().toLowerCase().max(254).email();

export const registerSchema = z
  .object({
    email,
    password: z.string().min(12).refine(withinByteLimit, BYTE_LIMIT_MESSAGE),
    name: z.string().trim().min(1).max(80),
  })
  .strict();

export const loginSchema = z
  .object({
    email,
    password: z.string().min(1).refine(withinByteLimit, BYTE_LIMIT_MESSAGE),
  })
  .strict();
