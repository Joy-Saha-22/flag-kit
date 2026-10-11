import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { H, makeApp, signUp } from './helpers.js';
import { computeResults, erfc, twoSidedPValue } from '../src/flags/results.js';

const variations = [
  { key: 'on', name: 'On', value: true },
  { key: 'off', name: 'Off', value: false },
];
const experiment = { key: 'checkout', name: 'Checkout', variations, isExperiment: true, goalMetricKey: 'signup_completed' };
const plain = { key: 'plain', name: 'Plain', variations };

/** Same meaning as the MongoDB aggregation, computed from the fake store's events. */
function attachVariationCounts(sdkStore) {
  sdkStore.variationCounts = async ({ projectId, envKey, flagKey, goalMetricKey }) => {
    const users = new Map();
    for (const e of sdkStore.events) {
      if (e.projectId !== projectId || e.envKey !== envKey || e.flagKey !== flagKey) {
        continue;
      }
      const id = `${e.variation}|${e.userKey}`;
      const user = users.get(id) ?? { variation: e.variation, exposed: false, converted: false };
      if (e.type === 'exposure') {
        user.exposed = true;
      }
      if (e.type === 'conversion' && e.metricKey === goalMetricKey) {
        user.converted = true;
      }
      users.set(id, user);
    }
    const rows = new Map();
    for (const user of users.values()) {
      const row = rows.get(user.variation) ?? { variation: user.variation, exposures: 0, conversions: 0 };
      if (user.exposed) {
        row.exposures += 1;
        if (user.converted) {
          row.conversions += 1;
        }
      }
      rows.set(user.variation, row);
    }
    return [...rows.values()];
  };
}

async function setup() {
  const ctx = makeApp();
  attachVariationCounts(ctx.sdkStore);
  const owner = await signUp(ctx.app, 'owner@example.com');
  const created = await owner.agent.post('/api/projects').set(H).send({ name: 'Acme', key: 'acme' });
  const pid = created.body.project.id;
  for (const flag of [experiment, plain]) {
    await owner.agent.post(`/api/projects/${pid}/flags`).set(H).send(flag);
  }
  const event = (type, variation, userKey, extra = {}) => ({
    projectId: pid,
    envKey: 'prod',
    type,
    flagKey: 'checkout',
    variation,
    userKey,
    metricKey: type === 'conversion' ? 'signup_completed' : null,
    ts: new Date(),
    ...extra,
  });
  const results = (agent, query = '?env=prod', key = 'checkout') =>
    agent.get(`/api/projects/${pid}/flags/${key}/results${query}`);
  return { ...ctx, owner, pid, event, results };
}

describe('experiment statistics', () => {
  // Reference values: two-sided pooled two-proportion z-test, computed with scipy.
  const reference = [
    { control: [100, 10], variant: [100, 20], p: 0.04767038066, significant: true },
    { control: [1000, 100], variant: [1000, 130], p: 0.03548845047, significant: true },
    { control: [50, 0], variant: [50, 0], p: 1, significant: false },
    { control: [40, 4], variant: [45, 9], p: 0.2010658626, significant: false },
    { control: [20, 2], variant: [25, 3], p: 0.8320040286, significant: false },
  ];

  it('matches the reference p-values', () => {
    for (const { control, variant, p, significant } of reference) {
      const result = computeResults({
        flagKey: 'f',
        envKey: 'prod',
        goalMetricKey: 'm',
        variations: ['a', 'b'],
        counts: [
          { variation: 'a', exposures: control[0], conversions: control[1] },
          { variation: 'b', exposures: variant[0], conversions: variant[1] },
        ],
      });
      const row = result.variations[1].vsControl;
      expect(row.pValue).toBeCloseTo(p, 8);
      expect(row.significant).toBe(significant);
    }
  });

  it('flags small samples and handles empty groups', () => {
    const small = computeResults({
      flagKey: 'f',
      envKey: 'prod',
      goalMetricKey: 'm',
      variations: ['a', 'b'],
      counts: [
        { variation: 'a', exposures: 20, conversions: 2 },
        { variation: 'b', exposures: 25, conversions: 3 },
      ],
    });
    expect(small.variations[1].vsControl.sampleSizeOk).toBe(false);

    const empty = computeResults({ flagKey: 'f', envKey: 'prod', goalMetricKey: 'm', variations: ['a', 'b'], counts: [] });
    expect(empty.variations[0]).toMatchObject({ exposures: 0, conversions: 0, rate: null, vsControl: null });
    expect(empty.variations[1].vsControl).toMatchObject({ pValue: null, lift: null, significant: false });
  });

  it('computes the complementary error function accurately', () => {
    expect(erfc(0)).toBe(1);
    expect(erfc(30)).toBe(0);
    expect(erfc(-1.5)).toBeCloseTo(2 - erfc(1.5), 12);
    expect(erfc(1)).toBeCloseTo(0.15729920705028513, 12);
    expect(erfc(4)).toBeCloseTo(1.541725790028002e-8, 20);
    expect(twoSidedPValue(1.959963984540054)).toBeCloseTo(0.05, 10);
  });
});

describe('GET /flags/:key/results', () => {
  it('counts distinct users, needs an exposure before a conversion, and ignores other metrics and environments', async () => {
    const ctx = await setup();
    ctx.sdkStore.events.push(
      ctx.event('exposure', 'on', 'u1'),
      ctx.event('exposure', 'on', 'u1'), // same user again: still one exposure
      ctx.event('exposure', 'on', 'u2'),
      ctx.event('exposure', 'on', 'u3'),
      ctx.event('conversion', 'on', 'u1'),
      ctx.event('conversion', 'on', 'u9'), // converted without being exposed: ignored
      ctx.event('exposure', 'off', 'u4'),
      ctx.event('exposure', 'off', 'u5'),
      ctx.event('conversion', 'off', 'u4', { metricKey: 'other_metric' }), // wrong metric: ignored
      ctx.event('conversion', 'off', 'u5'),
      ctx.event('exposure', 'on', 'u7', { envKey: 'dev' }), // other environment: ignored
    );

    const res = await ctx.results(ctx.owner.agent);
    expect(res.status).toBe(200);
    expect(res.body.flagKey).toBe('checkout');
    expect(res.body.env).toBe('prod');
    expect(res.body.goalMetricKey).toBe('signup_completed');
    expect(res.body.control).toBe('on');
    const [on, off] = res.body.variations;
    expect(on).toMatchObject({ key: 'on', exposures: 3, conversions: 1 });
    expect(on.rate).toBeCloseTo(1 / 3, 10);
    expect(on.vsControl).toBe(null);
    expect(off).toMatchObject({ key: 'off', exposures: 2, conversions: 1, rate: 0.5 });
    expect(typeof off.vsControl.pValue).toBe('number');
    expect(off.vsControl.sampleSizeOk).toBe(false);
    expect(off.vsControl.significant).toBe(false);
  });

  it('returns zero counts when there are no events', async () => {
    const ctx = await setup();
    const res = await ctx.results(ctx.owner.agent);
    expect(res.status).toBe(200);
    expect(res.body.variations.map((v) => [v.key, v.exposures, v.conversions, v.rate])).toEqual([
      ['on', 0, 0, null],
      ['off', 0, 0, null],
    ]);
    expect(res.body.variations[1].vsControl.pValue).toBe(null);
  });

  it('reports significance end to end for a large sample', async () => {
    const ctx = await setup();
    ctx.sdkStore.variationCounts = async () => [
      { variation: 'on', exposures: 1000, conversions: 100 },
      { variation: 'off', exposures: 1000, conversions: 130 },
    ];
    const res = await ctx.results(ctx.owner.agent);
    const row = res.body.variations[1].vsControl;
    expect(row.pValue).toBeCloseTo(0.03548845047, 8);
    expect(row.significant).toBe(true);
    expect(row.sampleSizeOk).toBe(true);
    expect(row.lift).toBeCloseTo(0.3, 10);
    expect(row.ci95[0]).toBeLessThan(row.difference);
    expect(row.ci95[1]).toBeGreaterThan(row.difference);
  });

  it('enforces roles and validates the request', async () => {
    const ctx = await setup();
    const viewer = await signUp(ctx.app, 'viewer@example.com');
    const outsider = await signUp(ctx.app, 'outsider@example.com');
    ctx.projectStore.setRole(ctx.pid, viewer.userId, 'viewer');

    expect((await ctx.results(viewer.agent)).status).toBe(200);
    expect((await ctx.results(outsider.agent)).status).toBe(404);
    expect((await request(ctx.app).get(`/api/projects/${ctx.pid}/flags/checkout/results?env=prod`)).status).toBe(401);

    const notExperiment = await ctx.results(ctx.owner.agent, '?env=prod', 'plain');
    expect(notExperiment.status).toBe(400);
    expect(notExperiment.body.error.code).toBe('not_an_experiment');

    expect((await ctx.results(ctx.owner.agent, '?env=nope')).status).toBe(404);
    expect((await ctx.results(ctx.owner.agent, '?env=prod', 'missing')).status).toBe(404);
    expect((await ctx.results(ctx.owner.agent, '')).status).toBe(400);
    expect((await ctx.results(ctx.owner.agent, '?env=Bad Key')).status).toBe(400);
    expect((await ctx.results(ctx.owner.agent, '?env=prod&extra=1')).status).toBe(400);
  });
});
