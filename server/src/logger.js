function write(level, entry) {
  const line = JSON.stringify({ level, time: new Date().toISOString(), ...entry });
  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

/** Structured JSON logger. Full error details go here, never to clients. */
export const logger = {
  info: (entry) => write('info', entry),
  warn: (entry) => write('warn', entry),
  error: (entry) => write('error', entry),
};

/** Logger that discards everything. Used in tests. */
export const silentLogger = {
  info() {},
  warn() {},
  error() {},
};
