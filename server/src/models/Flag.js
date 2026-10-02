import mongoose from 'mongoose';

export const TARGETING_OPERATORS = [
  'equals',
  'notEquals',
  'in',
  'contains',
  'startsWith',
  'gt',
  'lt',
];

const rolloutBucketSchema = new mongoose.Schema(
  {
    variation: { type: String, required: true },
    weight: { type: Number, required: true, min: 0, max: 100000 },
  },
  { _id: false },
);

/**
 * Either `{ variation }` or `{ rollout: [{ variation, weight }] }`.
 * Weights for a rollout must sum to 100000 (enforced in application code).
 */
const serveSchema = new mongoose.Schema(
  {
    variation: { type: String },
    rollout: { type: [rolloutBucketSchema] },
  },
  { _id: false },
);

const conditionSchema = new mongoose.Schema(
  {
    attribute: { type: String, required: true },
    operator: { type: String, required: true, enum: TARGETING_OPERATORS },
    values: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { _id: false },
);

const ruleSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    conditions: { type: [conditionSchema], default: [] },
    serve: { type: serveSchema, required: true },
  },
  { _id: false },
);

const envConfigSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    offVariation: { type: String, required: true },
    fallthrough: { type: serveSchema, required: true },
    rules: { type: [ruleSchema], default: [] },
    version: { type: Number, default: 1, min: 1 },
  },
  { _id: false },
);

const variationSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { _id: false },
);

const flagSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    key: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    tags: { type: [String], default: [] },
    variations: { type: [variationSchema], required: true },
    isExperiment: { type: Boolean, default: false },
    goalMetricKey: { type: String, default: null },
    environments: {
      type: Map,
      of: envConfigSchema,
      default: () => new Map(),
    },
  },
  { timestamps: true },
);

flagSchema.index({ projectId: 1, key: 1 }, { unique: true });

export const Flag = mongoose.models.Flag ?? mongoose.model('Flag', flagSchema);
