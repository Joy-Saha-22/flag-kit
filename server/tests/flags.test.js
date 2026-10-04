import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { H, makeApp, signUp } from './helpers.js';

const checkout = {
  key: 'checkout',
  name: 'New checkout',
  variations: [
    { key: 'on', name: 'On', value: true },
    { key: 'off', name: 'Off', value: false },
  ],
};
const rollout30 = {
  rollout: [
    { variation: 'on', weight: 30000 },
    { variation: 'off', weight: 70000 },
  ],
};
const config = (overrides = {}) => ({
  enabled: true,
  offVariation: 'off',
  fallthrough: rollout30,
  rules: [],
  ...overrides,
});

const flagsPath = (pid, key = '') => `/api/projects/${pid}/flags${key ? `/${key}` : ''}`;
const envPath = (pid, key, envKey) => `${flagsPath(pid, key)}/environments/${envKey}`;
const createFlag = (agent, pid, body = checkout) => agent.post(flagsPath(pid)).set(H).send(body);
const putConfig = (agent, pid, body, envKey = 'prod', key = 'checkout') =>
  agent.put(envPath(pid, key, envKey)).set(H).send(body);
const evaluateTest = (agent, pid, userContext, envKey = 'prod') =>
  agent.post(`${envPath(pid, 'checkout', envKey)}/evaluate-test`).set(H).send({ userContext });

async function setup(options) {
  const ctx = makeApp(options);
  const owner = await signUp(ctx.app, 'owner@example.com');
  const created = await owner.agent.post('/api/projects').set(H).send({ name: 'Acme', key: 'acme' });
  const pid = created.body.project.id;
  const envIds = Object.fromEntries(created.body.environments.map((e) => [e.key, e.id]));
  return { ...ctx, owner, pid, envIds };
}

const cachedRuleset = (ctx, envKey) => JSON.parse(ctx.cache.store.get(`ruleset:${ctx.envIds[envKey]}`));

describe('creating flags', () => {
  it('creates a disabled config per environment, caches rulesets, and publishes each one', async () => {
    const ctx = await setup();
    const res = await createFlag(ctx.owner.agent, ctx.pid);
    expect(res.status).toBe(201);
    expect(res.body.sync).toBe('ok');
    expect(Object.keys(res.body.flag.environments)).toEqual(['dev', 'staging', 'prod']);
    for (const cfg of Object.values(res.body.flag.environments)) {
      expect(cfg.enabled).toBe(false);
      expect(cfg.offVariation).toBe('off');
      expect(cfg.fallthrough).toEqual({ variation: 'on' });
      expect(cfg.version).toBe(1);
    }

    const prod = cachedRuleset(ctx, 'prod');
    expect(prod.version).toBe(1);
    expect(prod.flags.length).toBe(1);
    expect(prod.flags[0].key).toBe('checkout');
    expect(prod.flags[0].salt).toBe('prod');
    expect(prod.flags[0].enabled).toBe(false);

    expect(ctx.publisher.messages.length).toBe(3);
    for (const { channel, message } of ctx.publisher.messages) {
      expect(channel.startsWith('flag-updates:')).toBe(true);
      expect(message.flagKey).toBe('checkout');
      expect(message.flag.key).toBe('checkout');
    }
    expect(ctx.auditStore.records.find((r) => r.action === 'flag.create').flagKey).toBe('checkout');
  });

  it('rejects invalid flags and duplicate keys', async () => {
    const { owner, pid } = await setup();
    const two = checkout.variations;
    const bad = [
      { ...checkout, key: 'Bad Key' },
      { ...checkout, variations: [two[0]] },
      { ...checkout, variations: [two[0], { ...two[1], key: 'on' }] },
      { ...checkout, defaultVariation: 'nope' },
      { ...checkout, offVariation: 'nope' },
      { ...checkout, isExperiment: true },
      { ...checkout, goalMetricKey: 'signup_completed' },
      { ...checkout, extra: true },
      { ...checkout, variations: [{ ...two[0], value: { nested: true } }, two[1]] },
    ];
    for (const body of bad) {
      const res = await createFlag(owner.agent, pid, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_failed');
    }
    expect((await createFlag(owner.agent, pid)).status).toBe(201);
    const dup = await createFlag(owner.agent, pid);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('conflict');
  });

  it('accepts an experiment with a goal metric and enforces the per-project limit', async () => {
    const { owner, pid } = await setup({ env: { MAX_FLAGS_PER_PROJECT: '2' } });
    const exp = await createFlag(owner.agent, pid, { ...checkout, isExperiment: true, goalMetricKey: 'signup_completed' });
    expect(exp.status).toBe(201);
    expect(exp.body.flag.goalMetricKey).toBe('signup_completed');
    expect((await createFlag(owner.agent, pid, { ...checkout, key: 'second' })).status).toBe(201);
    const third = await createFlag(owner.agent, pid, { ...checkout, key: 'third' });
    expect(third.status).toBe(403);
    expect(third.body.error.code).toBe('limit_reached');
  });
});

describe('roles', () => {
  it('lets viewers read, editors write, and only admins delete', async () => {
    const ctx = await setup();
    const { owner, pid, projectStore } = ctx;
    await createFlag(owner.agent, pid);
    const viewer = await signUp(ctx.app, 'viewer@example.com');
    const editor = await signUp(ctx.app, 'editor@example.com');
    const outsider = await signUp(ctx.app, 'outsider@example.com');
    projectStore.setRole(pid, viewer.userId, 'viewer');
    projectStore.setRole(pid, editor.userId, 'editor');

    expect((await viewer.agent.get(flagsPath(pid))).status).toBe(200);
    expect((await viewer.agent.get(flagsPath(pid, 'checkout'))).status).toBe(200);
    expect((await evaluateTest(viewer.agent, pid, { key: 'u1' })).status).toBe(200);
    expect((await createFlag(viewer.agent, pid, { ...checkout, key: 'other' })).status).toBe(403);
    expect((await viewer.agent.put(flagsPath(pid, 'checkout')).set(H).send({ name: 'x' })).status).toBe(403);
    expect((await putConfig(viewer.agent, pid, config())).status).toBe(403);
    expect((await viewer.agent.delete(flagsPath(pid, 'checkout')).set(H)).status).toBe(403);

    expect((await createFlag(editor.agent, pid, { ...checkout, key: 'other' })).status).toBe(201);
    expect((await putConfig(editor.agent, pid, config())).status).toBe(200);
    expect((await editor.agent.delete(flagsPath(pid, 'checkout')).set(H)).status).toBe(403);

    expect((await outsider.agent.get(flagsPath(pid))).status).toBe(404);
    expect((await request(ctx.app).get(flagsPath(pid))).status).toBe(401);
    expect((await owner.agent.delete(flagsPath(pid, 'checkout')).set(H)).status).toBe(200);
  });
});

describe('environment configs', () => {
  it('saves a config, bumps its version, and publishes the new ruleset', async () => {
    const ctx = await setup();
    await createFlag(ctx.owner.agent, ctx.pid);
    const before = ctx.publisher.messages.length;

    const res = await putConfig(ctx.owner.agent, ctx.pid, config());
    expect(res.status).toBe(200);
    expect(res.body.sync).toBe('ok');
    expect(res.body.flag.environments.prod.enabled).toBe(true);
    expect(res.body.flag.environments.prod.version).toBe(2);
    expect(res.body.flag.environments.dev.version).toBe(1);

    const prod = cachedRuleset(ctx, 'prod');
    expect(prod.version).toBe(2);
    expect(prod.flags[0].salt).toBe('prod');
    expect(prod.flags[0].fallthrough).toEqual(rollout30);
    expect(prod.flags[0].version).toBe(2);
    expect(cachedRuleset(ctx, 'dev').version).toBe(1);

    expect(ctx.publisher.messages.length).toBe(before + 1);
    const last = ctx.publisher.messages.at(-1);
    expect(last.channel).toBe(`flag-updates:${ctx.envIds.prod}`);
    expect(last.message.version).toBe(2);
    expect(last.message.flag.enabled).toBe(true);

    const audit = ctx.auditStore.records.find((r) => r.action === 'flag.env_update');
    expect(audit.envKey).toBe('prod');
    expect(audit.before.enabled).toBe(false);
    expect(audit.after.enabled).toBe(true);
  });

  it('rejects invalid configs', async () => {
    const { owner, pid } = await setup();
    await createFlag(owner.agent, pid);
    const rule = (over = {}) => ({
      id: 'r1',
      conditions: [{ attribute: 'country', operator: 'equals', values: ['IN'] }],
      serve: { variation: 'on' },
      ...over,
    });
    const bad = [
      config({ fallthrough: { rollout: [{ variation: 'on', weight: 30000 }, { variation: 'off', weight: 69999 }] } }),
      config({ fallthrough: { rollout: [{ variation: 'on', weight: 50000 }, { variation: 'on', weight: 50000 }] } }),
      config({ fallthrough: { variation: 'on', rollout: rollout30.rollout } }),
      config({ fallthrough: {} }),
      config({ offVariation: 'nope' }),
      config({ fallthrough: { variation: 'nope' } }),
      config({ fallthrough: { rollout: [{ variation: 'on', weight: 50000 }, { variation: 'nope', weight: 50000 }] } }),
      config({ rules: [rule({ serve: { variation: 'nope' } })] }),
      config({ rules: [rule({ conditions: [] })] }),
      config({ rules: [rule({ conditions: [{ attribute: 'age', operator: 'gt', values: [1, 2] }] })] }),
      config({ rules: [rule({ conditions: [{ attribute: 'age', operator: 'gt', values: [true] }] })] }),
      config({ rules: [rule({ conditions: [{ attribute: 'x', operator: 'matches', values: ['a'] }] })] }),
      config({ rules: [rule({ conditions: [{ attribute: 'x', operator: 'equals', values: [{ $ne: null }] }] })] }),
      config({ rules: [rule(), rule()] }),
      { ...config(), extra: true },
      { ...config(), enabled: 'yes' },
    ];
    for (const body of bad) {
      const res = await putConfig(owner.agent, pid, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_failed');
    }
    expect((await putConfig(owner.agent, pid, config(), 'nope')).status).toBe(404);
    expect((await putConfig(owner.agent, pid, config(), 'prod', 'missing')).status).toBe(404);
  });

  it('enforces the rule limit', async () => {
    const { owner, pid } = await setup({ env: { MAX_RULES_PER_ENV: '1' } });
    await createFlag(owner.agent, pid);
    const rule = (id) => ({
      id,
      conditions: [{ attribute: 'country', operator: 'equals', values: ['IN'] }],
      serve: { variation: 'on' },
    });
    expect((await putConfig(owner.agent, pid, config({ rules: [rule('a')] }))).status).toBe(200);
    expect((await putConfig(owner.agent, pid, config({ rules: [rule('a'), rule('b')] }))).status).toBe(400);
  });

  it('detects edit conflicts through expectedVersion', async () => {
    const { owner, pid } = await setup();
    await createFlag(owner.agent, pid);
    const stale = await putConfig(owner.agent, pid, { ...config(), expectedVersion: 5 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('version_conflict');
    const ok = await putConfig(owner.agent, pid, { ...config(), expectedVersion: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body.flag.environments.prod.version).toBe(2);
    const again = await putConfig(owner.agent, pid, { ...config(), expectedVersion: 1 });
    expect(again.status).toBe(409);
  });

  it('never lets an older ruleset replace a newer one in Redis', async () => {
    const ctx = await setup();
    await createFlag(ctx.owner.agent, ctx.pid);
    const key = `ruleset:${ctx.envIds.prod}`;
    ctx.cache.store.set(key, JSON.stringify({ version: 999, flags: [] }));
    const before = ctx.publisher.messages.length;

    const res = await putConfig(ctx.owner.agent, ctx.pid, config());
    expect(res.status).toBe(200);
    expect(res.body.sync).toBe('ok');
    expect(JSON.parse(ctx.cache.store.get(key)).version).toBe(999);
    expect(ctx.publisher.messages.length).toBe(before);
  });

  it('keeps the change and reports a delayed sync when Redis is down', async () => {
    const ctx = await setup({ cacheFails: true });
    const created = await createFlag(ctx.owner.agent, ctx.pid);
    expect(created.status).toBe(201);
    expect(created.body.sync).toBe('delayed');

    const res = await putConfig(ctx.owner.agent, ctx.pid, config());
    expect(res.status).toBe(200);
    expect(res.body.sync).toBe('delayed');
    const saved = await ctx.owner.agent.get(flagsPath(ctx.pid, 'checkout'));
    expect(saved.body.flag.environments.prod.enabled).toBe(true);

    const failure = ctx.logs.find((l) => l.msg === 'ruleset_sync_failed');
    expect(failure).not.toBe(undefined);
    expect(JSON.stringify(ctx.logs)).not.toContain('user:secret');
  });

  it('reports a delayed sync when publishing fails', async () => {
    const ctx = await setup({ publisherFails: true });
    const created = await createFlag(ctx.owner.agent, ctx.pid);
    expect(created.status).toBe(201);
    expect(created.body.sync).toBe('delayed');
  });
});

describe('evaluate-test', () => {
  it('uses the shared evaluator and the environment key as the rollout salt', async () => {
    const { owner, pid } = await setup();
    await createFlag(owner.agent, pid);
    await putConfig(owner.agent, pid, config());

    // Buckets for flag "checkout", salt "prod": u4 -> 26809 (< 30000), u0 -> 41070.
    const on = await evaluateTest(owner.agent, pid, { key: 'u4' });
    expect(on.status).toBe(200);
    expect(on.body.variation).toBe('on');
    expect(on.body.value).toBe(true);
    expect(on.body.reason.kind).toBe('fallthrough');

    const off = await evaluateTest(owner.agent, pid, { key: 'u0' });
    expect(off.body.variation).toBe('off');
    expect(off.body.value).toBe(false);
  });

  it('returns error reasons as a normal 200, never a 500', async () => {
    const { owner, pid } = await setup();
    await createFlag(owner.agent, pid);
    await putConfig(owner.agent, pid, config());

    const res = await evaluateTest(owner.agent, pid, {});
    expect(res.status).toBe(200);
    expect(res.body.variation).toBe(null);
    expect(res.body.value).toBe(null);
    expect(res.body.reason).toEqual({ kind: 'error', errorKind: 'user_key_missing' });
  });

  it('applies targeting rules and the off state', async () => {
    const { owner, pid } = await setup();
    await createFlag(owner.agent, pid);
    const rule = {
      id: 'india',
      conditions: [{ attribute: 'country', operator: 'equals', values: ['IN'] }],
      serve: { variation: 'on' },
    };
    await putConfig(owner.agent, pid, config({ rules: [rule], fallthrough: { variation: 'off' } }));

    const hit = await evaluateTest(owner.agent, pid, { key: 'x', country: 'IN' });
    expect(hit.body.variation).toBe('on');
    expect(hit.body.reason).toEqual({ kind: 'rule', ruleId: 'india' });
    const miss = await evaluateTest(owner.agent, pid, { key: 'x', country: 'US' });
    expect(miss.body.variation).toBe('off');
    expect(miss.body.reason.kind).toBe('fallthrough');

    const disabled = await evaluateTest(owner.agent, pid, { key: 'x', country: 'IN' }, 'dev');
    expect(disabled.body.variation).toBe('off');
    expect(disabled.body.reason.kind).toBe('off');
  });

  it('rejects unsafe or oversized user contexts', async () => {
    const { owner, pid } = await setup({ env: { MAX_USER_CONTEXT_BYTES: '256' } });
    await createFlag(owner.agent, pid);
    const path = `${envPath(pid, 'checkout', 'prod')}/evaluate-test`;
    const proto = await owner.agent
      .post(path)
      .set(H)
      .set('Content-Type', 'application/json')
      .send('{"userContext":{"key":"u1","__proto__":{"admin":true}}}');
    expect(proto.status).toBe(400);
    expect((await evaluateTest(owner.agent, pid, { key: 'u1', blob: 'x'.repeat(400) })).status).toBe(400);
    expect((await owner.agent.post(path).set(H).send({ userContext: 'u1' })).status).toBe(400);
    expect((await owner.agent.post(path).set(H).send({})).status).toBe(400);
    expect((await evaluateTest(owner.agent, pid, { key: 'u1' }, 'nope')).status).toBe(404);
  });
});

describe('flag details', () => {
  it('republishes only when SDK-visible fields change, and protects variations in use', async () => {
    const ctx = await setup();
    await createFlag(ctx.owner.agent, ctx.pid);
    const base = ctx.publisher.messages.length;
    const put = (body) => ctx.owner.agent.put(flagsPath(ctx.pid, 'checkout')).set(H).send(body);

    const renamed = await put({ name: 'Renamed', tags: ['web'] });
    expect(renamed.status).toBe(200);
    expect(renamed.body.flag.name).toBe('Renamed');
    expect(ctx.publisher.messages.length).toBe(base);

    const removal = await put({ variations: [{ key: 'on', name: 'On', value: true }, { key: 'maybe', name: 'Maybe', value: 'm' }] });
    expect(removal.status).toBe(409);
    expect(removal.body.error.code).toBe('variation_in_use');

    const added = await put({
      variations: [...checkout.variations, { key: 'maybe', name: 'Maybe', value: 'm' }],
    });
    expect(added.status).toBe(200);
    expect(added.body.flag.variations.length).toBe(3);
    expect(ctx.publisher.messages.length).toBe(base + 3);

    expect((await put({ isExperiment: true })).status).toBe(400);
    expect((await put({})).status).toBe(400);
    expect((await put({ unknown: 1 })).status).toBe(400);
    const exp = await put({ isExperiment: true, goalMetricKey: 'signup_completed' });
    expect(exp.status).toBe(200);
    expect(exp.body.flag.goalMetricKey).toBe('signup_completed');
  });

  it('deletes a flag and removes it from every ruleset', async () => {
    const ctx = await setup();
    await createFlag(ctx.owner.agent, ctx.pid);
    const before = ctx.publisher.messages.length;

    const res = await ctx.owner.agent.delete(flagsPath(ctx.pid, 'checkout')).set(H);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect((await ctx.owner.agent.get(flagsPath(ctx.pid, 'checkout'))).status).toBe(404);
    expect((await ctx.owner.agent.delete(flagsPath(ctx.pid, 'checkout')).set(H)).status).toBe(404);

    for (const envKey of ['dev', 'staging', 'prod']) {
      expect(cachedRuleset(ctx, envKey).flags).toEqual([]);
    }
    const sent = ctx.publisher.messages.slice(before);
    expect(sent.length).toBe(3);
    expect(sent.every((m) => m.message.flag === null && m.message.flagKey === 'checkout')).toBe(true);
    expect(ctx.auditStore.records.find((r) => r.action === 'flag.delete').flagKey).toBe('checkout');
  });

  it('lists flags with search, tag, and limit filters', async () => {
    const { owner, pid } = await setup();
    await createFlag(owner.agent, pid, { ...checkout, key: 'alpha', name: 'Alpha', tags: ['web'] });
    await createFlag(owner.agent, pid, { ...checkout, key: 'beta', name: 'Beta flag', tags: ['mobile'] });
    await createFlag(owner.agent, pid, { ...checkout, key: 'gamma', name: 'Gamma', tags: ['web'] });

    const keys = async (query) => (await owner.agent.get(`${flagsPath(pid)}${query}`)).body.flags.map((f) => f.key);
    expect(await keys('')).toEqual(['alpha', 'beta', 'gamma']);
    expect(await keys('?tag=web')).toEqual(['alpha', 'gamma']);
    expect(await keys('?search=BETA')).toEqual(['beta']);
    expect(await keys('?limit=2')).toEqual(['alpha', 'beta']);
    const summary = (await owner.agent.get(flagsPath(pid))).body.flags[0];
    expect(summary.environments.prod).toEqual({ enabled: false, version: 1 });
    expect(summary.variations).toBe(undefined);

    expect((await owner.agent.get(`${flagsPath(pid)}?bogus=1`)).status).toBe(400);
    expect((await owner.agent.get(`${flagsPath(pid)}?limit=0`)).status).toBe(400);
  });
});

describe('audit log', () => {
  it('serves entries to editors and admins only, newest first, with filters', async () => {
    const ctx = await setup();
    const { owner, pid, projectStore } = ctx;
    await createFlag(owner.agent, pid);
    await putConfig(owner.agent, pid, config());
    await createFlag(owner.agent, pid, { ...checkout, key: 'other' });
    const viewer = await signUp(ctx.app, 'viewer@example.com');
    const editor = await signUp(ctx.app, 'editor@example.com');
    projectStore.setRole(pid, viewer.userId, 'viewer');
    projectStore.setRole(pid, editor.userId, 'editor');
    const path = `/api/projects/${pid}/audit`;

    expect((await viewer.agent.get(path)).status).toBe(403);
    const all = await editor.agent.get(path);
    expect(all.status).toBe(200);
    expect(all.body.entries.map((e) => e.action)).toEqual(['flag.create', 'flag.env_update', 'flag.create', 'project.create']);
    expect(all.body.entries[0].flagKey).toBe('other');
    expect(all.body.entries[0].actor.id).toBe(owner.userId);

    const onlyCheckout = await editor.agent.get(`${path}?flag=checkout`);
    expect(onlyCheckout.body.entries.length).toBe(2);
    const onlyProd = await editor.agent.get(`${path}?env=prod`);
    expect(onlyProd.body.entries.map((e) => e.action)).toEqual(['flag.env_update']);

    const page = await editor.agent.get(`${path}?limit=1`);
    expect(page.body.entries.length).toBe(1);
    expect(page.body.nextBefore).not.toBe(null);

    expect((await editor.agent.get(`${path}?bogus=1`)).status).toBe(400);
    expect((await editor.agent.get(`${path}?limit=0`)).status).toBe(400);
    expect((await editor.agent.get(`${path}?before=yesterday`)).status).toBe(400);
  });
});
