import { describe, expect, it } from 'vitest';
import { flagShouldRevalidate } from '../src/routes';

const baseArgs = {
  formMethod: undefined,
  formAction: undefined,
  actionResult: undefined,
};

describe('flagShouldRevalidate', () => {
  it('skips the flag loader when moving between its tabs', () => {
    expect(flagShouldRevalidate({
      ...baseArgs,
      currentUrl: 'http://localhost/p/project-1/flags/feature?env=prod',
      nextUrl: 'http://localhost/p/project-1/flags/feature/settings?env=prod',
    })).toBe(false);
  });

  it('reloads for a new flag or selected environment', () => {
    expect(flagShouldRevalidate({
      ...baseArgs,
      currentUrl: 'http://localhost/p/project-1/flags/feature?env=prod',
      nextUrl: 'http://localhost/p/project-1/flags/other?env=prod',
    })).toBe(true);
    expect(flagShouldRevalidate({
      ...baseArgs,
      currentUrl: 'http://localhost/p/project-1/flags/feature?env=prod',
      nextUrl: 'http://localhost/p/project-1/flags/feature?env=staging',
    })).toBe(true);
  });

  it('reloads after a successful flag write but not after evaluation or a conflict', () => {
    const currentUrl = 'http://localhost/p/project-1/flags/feature?env=prod';
    expect(flagShouldRevalidate({
      currentUrl,
      nextUrl: currentUrl,
      formMethod: 'POST',
      formAction: '/p/project-1/flags/feature',
      actionResult: { ok: true },
    })).toBe(true);
    expect(flagShouldRevalidate({
      currentUrl,
      nextUrl: currentUrl,
      formMethod: 'POST',
      formAction: '/p/project-1/flags/feature/evaluate',
      actionResult: { ok: true, result: {} },
    })).toBe(false);
    expect(flagShouldRevalidate({
      currentUrl,
      nextUrl: currentUrl,
      formMethod: 'POST',
      formAction: '/p/project-1/flags/feature',
      actionResult: { ok: false },
    })).toBe(false);
  });
});
