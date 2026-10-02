import mongoose from 'mongoose';

/**
 * Connect to MongoDB. The URI is never logged.
 *
 * @param {string} uri
 * @returns {Promise<typeof mongoose>}
 */
export async function connectMongo(uri) {
  mongoose.set('strictQuery', true);
  try {
    await mongoose.connect(uri);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    throw new Error(`MongoDB connection failed: ${message}`);
  }
  return mongoose;
}

/**
 * @returns {Promise<void>}
 */
export async function disconnectMongo() {
  await mongoose.disconnect();
}

export { mongoose };
