import mongoose from 'mongoose';
import { User } from '../models/User.js';

/**
 * @typedef {{ id: string, email: string, name: string, passwordHash: string }} UserRecord
 */

/**
 * @param {any} doc
 * @returns {UserRecord}
 */
function toRecord(doc) {
  return { id: String(doc._id), email: doc.email, name: doc.name, passwordHash: doc.passwordHash };
}

/**
 * MongoDB-backed user store. The API depends on this small interface instead of
 * Mongoose directly, so tests can supply an in-memory store.
 */
export const mongoUserStore = {
  /** @param {string} email @returns {Promise<UserRecord | null>} */
  async findByEmail(email) {
    console.log("Database:", User.db.name);
    console.log("Collection:", User.collection.name);
    console.log("Email being searched:", JSON.stringify(email));
    const doc = await User.findOne({ email }).lean();
    return doc ? toRecord(doc) : null;
  },

  /** @param {string} id @returns {Promise<UserRecord | null>} */
  async findById(id) {
    if (!mongoose.isValidObjectId(id)) {
      return null;
    }
    const doc = await User.findById(id).lean();
    return doc ? toRecord(doc) : null;
  },

  /** @param {{ email: string, name: string, passwordHash: string }} data @returns {Promise<UserRecord>} */
  async create({ email, name, passwordHash }) {
    const doc = await User.create({ email, name, passwordHash });
    return toRecord(doc);
  },
};
