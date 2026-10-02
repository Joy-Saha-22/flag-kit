import mongoose from 'mongoose';

export const EVENT_TYPES = ['exposure', 'conversion'];

/** 30 days */
export const EVENT_TTL_SECONDS = 30 * 24 * 60 * 60;

const eventSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    envKey: { type: String, required: true },
    type: { type: String, required: true, enum: EVENT_TYPES },
    flagKey: { type: String, required: true },
    variation: { type: String, required: true },
    userKey: { type: String, required: true },
    metricKey: { type: String, default: null },
    ts: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false },
);

eventSchema.index({ envKey: 1, flagKey: 1, type: 1, variation: 1 });
eventSchema.index({ ts: 1 }, { expireAfterSeconds: EVENT_TTL_SECONDS });
eventSchema.index({ projectId: 1, envKey: 1, flagKey: 1 });

export const Event = mongoose.models.Event ?? mongoose.model('Event', eventSchema);
