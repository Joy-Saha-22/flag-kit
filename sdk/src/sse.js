/**
 * Parse server-sent events from a WHATWG ReadableStream reader.
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 */
export async function* parseSse(reader) {
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';
  let data = [];
  let retry;

  const parseLine = (line) => {
    if (line === '') {
      if (data.length === 0 && retry === undefined) {
        eventName = '';
        return null;
      }
      const frame = { event: eventName || 'message', data: data.join('\n'), retry };
      eventName = '';
      data = [];
      retry = undefined;
      return frame;
    }
    if (line.startsWith(':')) {
      return null;
    }

    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }

    if (field === 'event') {
      eventName = value;
    } else if (field === 'data') {
      data.push(value);
    } else if (field === 'retry' && /^\d+$/.test(value)) {
      retry = Number(value);
    }
    return null;
  };

  const takeLine = (final = false) => {
    for (let index = 0; index < buffer.length; index += 1) {
      const character = buffer[index];
      if (character !== '\n' && character !== '\r') {
        continue;
      }
      if (character === '\r' && index === buffer.length - 1 && !final) {
        return null;
      }
      const line = buffer.slice(0, index);
      const newlineLength = character === '\r' && buffer[index + 1] === '\n' ? 2 : 1;
      buffer = buffer.slice(index + newlineLength);
      return line;
    }
    return null;
  };

  const dispatchAtEof = () => {
    if (data.length === 0 && retry === undefined) {
      return null;
    }
    const frame = { event: eventName || 'message', data: data.join('\n'), retry };
    eventName = '';
    data = [];
    retry = undefined;
    return frame;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let line = takeLine(done);
      while (line !== null) {
        const frame = parseLine(line);
        if (frame) {
          yield frame;
        }
        line = takeLine(done);
      }
      if (done) {
        if (buffer.length > 0) {
          const frame = parseLine(buffer);
          buffer = '';
          if (frame) {
            yield frame;
          }
        }
        const frame = dispatchAtEof();
        if (frame) {
          yield frame;
        }
        return;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream may already have been aborted by close().
    }
    reader.releaseLock();
  }
}
