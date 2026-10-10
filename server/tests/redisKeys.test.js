import { describe, expect, it } from 'vitest';
import {
  SDK_KEY_CACHE_TTL_SECONDS,
  flagUpdatesChannel,
  rateLimitKey,
  rulesetKey,
  sdkKeyCacheKey,
} from '../src/lib/redisKeys.js';

describe('redisKeys', () => {
  it('uses the documented key layout', () => {
    expect(rulesetKey('env123')).toBe('ruleset:env123');
    expect(sdkKeyCacheKey('abc')).toBe('sdkkey:abc');
    expect(flagUpdatesChannel('env123')).toBe('flag-updates:env123');
    expect(rateLimitKey.authIp('127.0.0.1')).toBe('ratelimit:auth:ip:127.0.0.1');
    expect(SDK_KEY_CACHE_TTL_SECONDS).toBe(60);
  });
});

describe('redisKeys', () => {
  it('uses the documented key layout', () => {
    expect(rulesetKey('env123')).toBe('ruleset:env123');
    expect(sdkKeyCacheKey('abc')).toBe('sdkkey:abc');
    expect(flagUpdatesChannel('env123')).toBe('flag-updates:env123');
    expect(SDK_KEY_CACHE_TTL_SECONDS).toBe(60);
  });
});
