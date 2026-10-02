const C1 = 0xcc9e2d51;
const C2 = 0x1b873593;
const encoder = new TextEncoder();

/**
 * Mix a 32-bit block (MurmurHash3 x86_32 body).
 * @param {number} k1
 * @returns {number}
 */
function mixK1(k1) {
  k1 = Math.imul(k1, C1);
  k1 = (k1 << 15) | (k1 >>> 17);
  return Math.imul(k1, C2);
}

/**
 * MurmurHash3 x86 32-bit over UTF-8 bytes of `input`.
 *
 * The algorithm is a pure function of the bytes: the same string always
 * produces the same uint32, on every process and language that implements
 * this variant. That stability is what makes percentage rollouts
 * deterministic instead of rolling the dice on each evaluate() call.
 *
 * @param {string} input
 * @param {number} [seed=0]
 * @returns {number} unsigned 32-bit hash
 */
export function murmur3_32(input, seed = 0) {
  const bytes = encoder.encode(String(input));
  const len = bytes.length;
  const nblocks = (len / 4) | 0;
  let h1 = seed | 0;

  for (let i = 0; i < nblocks; i += 1) {
    const j = i * 4;
    let k1 =
      bytes[j] |
      (bytes[j + 1] << 8) |
      (bytes[j + 2] << 16) |
      (bytes[j + 3] << 24);
    k1 = mixK1(k1);
    h1 ^= k1;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1 = Math.imul(h1, 5) + 0xe6546b64;
  }

  const tail = nblocks * 4;
  let k1 = 0;
  switch (len & 3) {
    case 3:
      k1 ^= bytes[tail + 2] << 16;
    // fall through
    case 2:
      k1 ^= bytes[tail + 1] << 8;
    // fall through
    case 1:
      k1 ^= bytes[tail];
      h1 ^= mixK1(k1);
      break;
    default:
      break;
  }

  h1 ^= len;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;

  return h1 >>> 0;
}

/** Inclusive bucket space used by percentage rollouts. */
export const ROLLOUT_BUCKETS = 100000;

/**
 * Map a user onto a stable bucket in `[0, 99999]`.
 *
 * Input is `flagKey:salt:userKey` so changing the flag or environment salt
 * reshuffles traffic independently, while the same triple always lands in
 * the same bucket.
 *
 * @param {string} flagKey
 * @param {string} salt
 * @param {string} userKey
 * @returns {number}
 */
export function bucketForUser(flagKey, salt, userKey) {
  const hash = murmur3_32(`${flagKey}:${salt}:${userKey}`);
  return hash % ROLLOUT_BUCKETS;
}
