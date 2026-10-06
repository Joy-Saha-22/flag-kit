import { z } from 'zod';
import { METRIC_KEY, VARIATION_KEY } from '../flags/schemas.js';
import { SLUG } from '../projects/schemas.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_MS = 30 * DAY_MS; // matches the events TTL; older events would expire at once
const MAX_FUTURE_MS = 5 * 60 * 1000; // a far-future timestamp would dodge the TTL for ages

/** @param {any} env */
export function createSdkSchemas(env) {
  const event = z
    .object({
      type: z.enum(['exposure', 'conversion']),
      flagKey: z.string().regex(SLUG),
      variation: z.string().regex(VARIATION_KEY),
      userKey: z.string().min(1).max(200),
      metricKey: z.string().regex(METRIC_KEY).nullable().optional(),
      ts: z.union([z.string().datetime(), z.number().int()]).optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.type === 'conversion' && !value.metricKey) {
        ctx.addIssue({ code: 'custom', path: ['metricKey'], message: 'A conversion needs a metricKey.' });
      }
      if (value.type === 'exposure' && value.metricKey) {
        ctx.addIssue({ code: 'custom', path: ['metricKey'], message: 'An exposure has no metricKey.' });
      }
      if (value.ts !== undefined) {
        const ms = typeof value.ts === 'number' ? value.ts : Date.parse(value.ts);
        const now = Date.now();
        if (!Number.isFinite(ms) || ms < now - MAX_AGE_MS || ms > now + MAX_FUTURE_MS) {
          ctx.addIssue({ code: 'custom', path: ['ts'], message: 'Timestamp is outside the accepted range.' });
        }
      }
    });

  return {
    eventsBatch: z
      .object({ events: z.array(event).min(1).max(env.MAX_EVENTS_PER_BATCH) })
      .strict(),
  };
}
