import { z } from 'zod';

// Same pattern as flag and environment keys.
export const SLUG = /^[a-z0-9][a-z0-9-_]{1,63}$/;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const slug = z.string().regex(SLUG, 'Must be 2-64 characters: lowercase letters, digits, hyphen, underscore.');

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    key: slug,
  })
  .strict();

export const envParamsSchema = z.object({ envKey: slug });

export const sdkKeyParamsSchema = z.object({
  envKey: slug,
  keyId: z.string().regex(OBJECT_ID, 'Invalid key id.'),
});

export const createSdkKeySchema = z.object({ type: z.enum(['server', 'client']) }).strict();
