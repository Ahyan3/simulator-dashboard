/**
 * store.js
 * ---------------------------------------------------------------------------
 * Everything about "what do we currently know, and what happened recently."
 *
 * - RingBuffer: fixed-length circular buffer. This is the single decision
 *   that keeps hour-long sessions memory-safe — it never grows, it only
 *   overwrites. No push() on an unbounded array anywhere in this app.
 *
 * - evaluateState(): pure threshold logic. Critical beats warning beats
 *   normal. Any subset of warnMin/warnMax/critMin/critMax is valid.
 *
 * - createStore(): defensively maps an incoming payload onto the
 *   configured parameters/flags. Missing or malformed fields never throw —
 *   they become "unknown" (rendered as a dash, never as a zero). Fields in
 *   the payload that aren't in config.js are silently ignored.
 * ---------------------------------------------------------------------------
 */

(function () {
  "use strict";

  // State codes stored per history point (kept numeric — cheap to store,
  // cheap to compare, and it's what lets the sparkline redraw a breach
  // "scar" after the value itself has recovered).
  const STATE = { UNKNOWN: -1, NORMAL: 0, WARNING: 1, CRITICAL: 2 };

  function evaluateState(value, thresholds) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return STATE.UNKNOWN;
    }
    const t = thresholds || {};
    if (t.critMin !== undefined && value <= t.critMin) return STATE.CRITICAL;
    if (t.critMax !== undefined && value >= t.critMax) return STATE.CRITICAL;
    if (t.warnMin !== undefined && value <= t.warnMin) return STATE.WARNING;
    if (t.warnMax !== undefined && value >= t.warnMax) return STATE.WARNING;
    return STATE.NORMAL;
  }

  function stateName(code) {
    switch (code) {
      case STATE.CRITICAL: return "critical";
      case STATE.WARNING: return "warning";
      case STATE.NORMAL: return "normal";
      default: return "unknown";
    }
  }

  /** Fixed-length circular buffer of {t, v, s} points. Never grows. */
  class RingBuffer {
    constructor(capacity) {
      this.capacity = Math.max(1, capacity | 0);
      this.buf = new Array(this.capacity).fill(null);
      this.writeIndex = 0;
      this.length = 0;
    }
    push(point) {
      this.buf[this.writeIndex] = point;
      this.writeIndex = (this.writeIndex + 1) % this.capacity;
      this.length = Math.min(this.length + 1, this.capacity);
    }
    /** Chronological (oldest -> newest) snapshot as a plain array. */
    toArray() {
      if (this.length < this.capacity) {
        return this.buf.slice(0, this.length);
      }
      // Buffer is full: oldest entry is at writeIndex (about to be overwritten).
      return this.buf.slice(this.writeIndex).concat(this.buf.slice(0, this.writeIndex));
    }
    /** Points with t >= sinceMs, chronological order. */
    since(sinceMs) {
      return this.toArray().filter((p) => p && p.t >= sinceMs);
    }
  }

  function safeNumber(v) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
    return null;
  }

  function createStore(config) {
    const maxPoints = Math.max(
      1,
      Math.round((config.historySeconds * 1000) / config.pollIntervalMs)
    );

    const buffers = {};
    config.parameters.forEach((p) => {
      buffers[p.id] = new RingBuffer(maxPoints);
    });
    const flagBuffers = {};
    config.flags.forEach((f) => {
      flagBuffers[f.id] = new RingBuffer(maxPoints);
    });

    let lastGoodTimestampMs = null;

    /** Defensively ingest a raw payload. Never throws. Returns a render-ready snapshot. */
    function ingest(rawPayload) {
      const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
      const incomingParams = Array.isArray(payload.parameters) ? payload.parameters : [];
      const incomingFlags = Array.isArray(payload.flags) ? payload.flags : [];

      const paramById = {};
      incomingParams.forEach((entry) => {
        if (entry && typeof entry === "object" && typeof entry.id === "string") {
          paramById[entry.id] = entry;
        }
      });
      const flagById = {};
      incomingFlags.forEach((entry) => {
        if (entry && typeof entry === "object" && typeof entry.id === "string") {
          flagById[entry.id] = entry;
        }
      });

      let tMs = Date.now();
      if (typeof payload.timestamp === "string") {
        const parsed = Date.parse(payload.timestamp);
        if (!Number.isNaN(parsed)) tMs = parsed;
      }
      lastGoodTimestampMs = tMs;

      const parameters = config.parameters.map((p) => {
        const entry = paramById[p.id]; // unknown ids in payload are simply never looked up
        const value = entry ? safeNumber(entry.value) : null;
        const stateCode = evaluateState(value, p.thresholds);
        buffers[p.id].push({ t: tMs, v: value, s: stateCode });
        return {
          id: p.id,
          label: p.label,
          unit: p.unit,
          decimals: p.decimals,
          value,
          state: stateName(stateCode),
          stateCode
        };
      });

      const flags = config.flags.map((f) => {
        const entry = flagById[f.id];
        const state = entry && typeof entry.state === "boolean" ? entry.state : null;
        flagBuffers[f.id].push({ t: tMs, v: state === null ? null : (state ? 1 : 0) });
        const abnormal = state !== null && (
          (f.sense === "normal-true" && state === false) ||
          (f.sense === "normal-false" && state === true)
        );
        return {
          id: f.id,
          label: f.label,
          state,
          abnormal
        };
      });

      return { timestampMs: tMs, parameters, flags };
    }

    return {
      ingest,
      getHistory(id, windowSeconds) {
        const rb = buffers[id];
        if (!rb) return [];
        if (!windowSeconds) return rb.toArray().filter(Boolean);
        const since = (lastGoodTimestampMs || Date.now()) - windowSeconds * 1000;
        return rb.since(since);
      },
      getLastGoodTimestampMs() {
        return lastGoodTimestampMs;
      },
      STATE,
      stateName
    };
  }

  window.evaluateState = evaluateState;
  window.RingBuffer = RingBuffer;
  window.createStore = createStore;
  window.STORE_STATE = STATE;
})();
