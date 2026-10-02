import mongoose from 'mongoose';

const ROLES = ['admin', 'editor', 'viewer'];

/**
 * @typedef {Object} ProjectMember
 * @property {mongoose.Types.ObjectId} userId
 * @property {'admin'|'editor'|'viewer'} role
 */

const memberSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ROLES, required: true },
  },
  { _id: false },
);

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    key: { type: String, required: true, unique: true, trim: true, lowercase: true },
    members: { type: [memberSchema], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

projectSchema.index({ 'members.userId': 1 });

export const Project = mongoose.models.Project ?? mongoose.model('Project', projectSchema);
export { ROLES };
