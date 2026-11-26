import { describe, expect, it, spyOn } from 'bun:test';
import { getEventListeners } from 'node:events';
import { Writable } from 'node:stream';
import { createStdoutBackpressure } from './stdout-backpressure.ts';

function slowStream() {
  const pending: Array<(error?: Error | null) => void> = [];
  const chunks: string[] = [];
  const stream = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      pending.push(callback);
    },
  });
  return {
    stream,
    chunks,
    release() {
      while (pending.length) pending.shift()!();
    },
  };
}

describe('stdout backpressure', () => {
  it('writes once, waits for drain, and does not rely on writableLength', async () => {
    const { stream, chunks, release } = slowStream();
    // Bun stdout may report zero even when write() returned false.
    Object.defineProperty(stream, 'writableLength', { get: () => 0 });
    const output = createStdoutBackpressure(stream);
    output.write('first\n');
    let settled = false;
    const waiting = output.wait().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(chunks).toEqual(['first\n']);
    release();
    await waiting;
    expect(settled).toBe(true);
    expect(chunks).toEqual(['first\n']);
    await output.wait();
  });

  it('remembers drain that occurs before wait starts', async () => {
    const { stream, release } = slowStream();
    const output = createStdoutBackpressure(stream);
    output.write('ready\n');
    release();
    await output.wait();
  });

  it('abort releases only its waiter and keeps later output ordered', async () => {
    const { stream, chunks, release } = slowStream();
    const output = createStdoutBackpressure(stream);
    const stop = new AbortController();
    output.write('delta\n');
    const stopped = output.wait(stop.signal);
    let drained = false;
    const other = output.wait().then(() => { drained = true; });
    expect(getEventListeners(stop.signal, 'abort')).toHaveLength(1);
    stop.abort();
    await stopped;
    expect(drained).toBe(false);
    expect(getEventListeners(stop.signal, 'abort')).toHaveLength(0);
    output.write('agent_end\n');
    await output.wait(stop.signal);
    release();
    await other;
    expect(chunks).toEqual(['delta\n', 'agent_end\n']);
  });

  it('cleans abort listeners on every drain cycle', async () => {
    const { stream, release } = slowStream();
    const output = createStdoutBackpressure(stream);
    const listeners = ['drain', 'error', 'close'].map(name => stream.listenerCount(name));
    const stop = new AbortController();
    for (let i = 0; i < 25; i++) {
      output.write(`${i}\n`);
      const waiting = output.wait(stop.signal);
      expect(getEventListeners(stop.signal, 'abort')).toHaveLength(1);
      release();
      await waiting;
      expect(getEventListeners(stop.signal, 'abort')).toHaveLength(0);
    }
    expect(['drain', 'error', 'close'].map(name => stream.listenerCount(name))).toEqual(listeners);
  });

  it('rejects current and future waits after a stream error and cleans listeners', async () => {
    const { stream } = slowStream();
    const output = createStdoutBackpressure(stream);
    const stop = new AbortController();
    const error = new Error('broken pipe');
    output.write('pending\n');
    const waiting = output.wait(stop.signal).catch(reason => reason);
    stream.emit('error', error);
    expect(await waiting).toBe(error);
    expect(getEventListeners(stop.signal, 'abort')).toHaveLength(0);
    await expect(output.wait()).rejects.toBe(error);
    expect(() => output.write('later\n')).toThrow(error);
  });

  it('records errors even when no caller is waiting', async () => {
    const { stream } = slowStream();
    const output = createStdoutBackpressure(stream);
    const error = new Error('pipe failed while idle');
    expect(() => stream.emit('error', error)).not.toThrow();
    await expect(output.wait()).rejects.toBe(error);
  });

  it('rejects waits on close and on an already closed stream', async () => {
    const { stream } = slowStream();
    const output = createStdoutBackpressure(stream);
    const stop = new AbortController();
    output.write('pending\n');
    const waiting = output.wait(stop.signal).catch(reason => reason);
    stream.destroy();
    expect(await waiting).toBeInstanceOf(Error);
    expect(getEventListeners(stop.signal, 'abort')).toHaveLength(0);
    await expect(output.wait()).rejects.toThrow('closed');
    const alreadyClosed = createStdoutBackpressure(stream);
    await expect(alreadyClosed.wait()).rejects.toThrow('closed');
    expect(() => alreadyClosed.write('late\n')).toThrow('closed');
  });

  it('surfaces synchronous write failures and releases existing waits', async () => {
    const { stream } = slowStream();
    const output = createStdoutBackpressure(stream);
    const error = new Error('write threw');
    output.write('pending\n');
    const waiting = output.wait().catch(reason => reason);
    const write = spyOn(stream, 'write').mockImplementation(() => { throw error; });
    try {
      expect(() => output.write('next\n')).toThrow(error);
      expect(await waiting).toBe(error);
      await expect(output.wait()).rejects.toBe(error);
    } finally {
      write.mockRestore();
    }
  });
});
