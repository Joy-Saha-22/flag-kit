import mongoose from 'mongoose';

const SDK_KEY_TYPES = ['server', 'client'];

const sdkKeySchema = new mongoose.Schema(
  {
    keyHash: { type: String, required: true },
    prefix: { type: String, required: true },
    type: { type: String, enum: SDK_KEY_TYPES, required: true },
    createdAt: { type: Date, default: Date.now },
    revokedAt: { type: Date, default: null },
  },
  { _id: true },
);

const environmentSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    key: { type: String, required: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    sdkKeys: { type: [sdkKeySchema], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

environmentSchema.index({ projectId: 1, key: 1 }, { unique: true });
environmentSchema.index({ 'sdkKeys.keyHash': 1 }, { unique: true, sparse: true });

export const Environment = mongoose.models.Environment ?? mongoose.model('Environment', environmentSchema);
export { SDK_KEY_TYPES };
