const fs = require('fs');

/**
 * Creates a lightweight buffered file logger that batches formatting and writes asynchronously.
 *
 * Options:
 * - filePath: absolute file path to append to
 * - formatRecord: function(record) => string (single line, must include trailing \n if desired)
 * - flushIntervalMs: maximum delay before a scheduled flush runs (default 25)
 * - maxBatchSize: max number of records per flush (default 1000)
 * - highWatermark: when queue length reaches this, schedule an immediate flush (default 1000)
 * - maxBufferedRecords: hard cap on queued records to protect memory (default 20000)
 */
function createBufferedFileLogger(options) {
  const {
    filePath,
    formatRecord,
    flushIntervalMs = 25,
    maxBatchSize = 1000,
    highWatermark = 1000,
    maxBufferedRecords = 20000,
  } = options;

  if (!filePath) {
    throw new Error('createBufferedFileLogger: filePath is required');
  }
  if (typeof formatRecord !== 'function') {
    throw new Error('createBufferedFileLogger: formatRecord must be a function');
  }

  /** @type {Array<any>} */
  const queue = [];
  let flushTimer = null;
  let isFlushing = false;
  let droppedRecords = 0;

  function scheduleFlush(immediate = false) {
    if (isFlushing) return;
    if (flushTimer) return;
    if (immediate) {
      // Schedule on next tick to yield back to hot path
      flushTimer = setImmediate(() => doFlush());
      return;
    }
    flushTimer = setTimeout(() => doFlush(), flushIntervalMs);
    // Unref so timer doesn't keep process alive
    if (typeof flushTimer.unref === 'function') flushTimer.unref();
  }

  function doFlush() {
    flushTimer = null;
    if (isFlushing) return;
    if (queue.length === 0) return;
    isFlushing = true;

    // Drain up to maxBatchSize
    const batch = queue.splice(0, maxBatchSize);
    let payload = '';
    try {
      for (let i = 0; i < batch.length; i += 1) {
        payload += formatRecord(batch[i]);
      }
    } catch (formatError) {
      // If formatting fails for any reason, drop the whole batch to avoid blocking
      console.error('BufferedFileLogger: formatRecord error, dropping batch:', formatError?.message || formatError);
      isFlushing = false;
      // If there are remaining items, schedule another flush
      if (queue.length > 0) scheduleFlush(true);
      return;
    }

    // Append in one write
    fs.appendFile(filePath, payload, (err) => {
      isFlushing = false;
      if (err) {
        console.error('BufferedFileLogger: appendFile error:', err?.message || err);
      }
      // If more remain, schedule another flush immediately (yield to I/O first)
      if (queue.length > 0) scheduleFlush(true);
    });
  }

  function enqueue(record) {
    // Fast path: guard against unbounded growth
    if (queue.length >= maxBufferedRecords) {
      droppedRecords += 1;
      // Once in a while, emit a diagnostic line so we notice drops
      if (droppedRecords % 1000 === 1) {
        console.warn('BufferedFileLogger: dropping records due to backpressure; dropped so far =', droppedRecords);
      }
      return;
    }

    queue.push(record);
    // If queue is large, flush ASAP; otherwise within flushIntervalMs
    if (queue.length >= highWatermark) {
      scheduleFlush(true);
    } else {
      scheduleFlush(false);
    }
  }

  // Attempt to flush when process is exiting
  function flushSyncOnExit() {
    if (isFlushing || queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    let payload = '';
    try {
      for (let i = 0; i < batch.length; i += 1) {
        payload += formatRecord(batch[i]);
      }
      // Use appendFileSync as we are exiting
      fs.appendFileSync(filePath, payload);
    } catch (err) {
      // Best effort only
    }
  }

  // Register exit hooks once
  const onExit = () => flushSyncOnExit();
  process.once('beforeExit', onExit);
  process.once('SIGINT', onExit);
  process.once('SIGTERM', onExit);
  process.once('uncaughtException', onExit);

  return { enqueue };
}

module.exports = { createBufferedFileLogger };

