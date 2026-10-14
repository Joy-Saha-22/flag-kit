import { createClient } from 'flagkit-sdk';

const sdkKey = process.env.FLAGKIT_SDK_KEY;
const flagKey = process.env.FLAGKIT_FLAG;

if (!sdkKey) {
  throw new Error('Set FLAGKIT_SDK_KEY before starting the example.');
}
if (!flagKey) {
  throw new Error('Set FLAGKIT_FLAG before starting the example.');
}

const client = createClient({
  sdkKey,
  baseUrl: process.env.FLAGKIT_URL ?? 'http://localhost:3000',
});
const userContext = { key: 'demo-user' };
let closing = false;
const shutdown = async () => {
  if (closing) {
    return;
  }
  closing = true;
  await client.close();
  process.exitCode = 0;
};

const printFlagValue = () => {
  const value = client.variation(flagKey, userContext, null);
  console.log(`${flagKey}:`, value);
};

client.onChange(printFlagValue);
process.once('SIGINT', () => {
  void shutdown();
});

try {
  await client.waitForInit();
  printFlagValue();
  client.variation(flagKey, userContext, null);
  client.track('signup_completed', userContext);
} catch (error) {
  await client.close();
  if (!closing) {
    console.error('FlagKit SDK example failed:', error.message);
    process.exitCode = 1;
  }
}
