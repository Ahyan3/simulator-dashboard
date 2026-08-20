/**
 * datasource.js
 * ---------------------------------------------------------------------------
 * Owns the connection to the data feed: mock generation, or polling the
 * real endpoint. Nothing in here knows about the DOM. It reports events to
 * whoever created it via callbacks:
 *
 *   onData(payload)                 - a parsed JSON payload arrived
 *   onStatusChange(status, detail)  - "live" | "reconnecting" | "disconnected"
 *
 * Connection status model:
 *   - "live"          the most recent poll succeeded.
 *   - "reconnecting"  a poll just failed and we're retrying, backoff still
 *                      ramping up (hasn't hit the cap yet).
 *   - "disconnected"  a poll failed and backoff has hit its cap — we're
 *                      still trying, just slowly, so we don't hammer a
 *                      server that's already struggling. Recovers to
 *                      "live" automatically the moment a poll succeeds.
 *
 * Polling never overlaps itself: each cycle waits for the previous
 * request to settle (success or failure) before scheduling the next one,
 * so a slow or hung server can't cause requests to pile up.
 * ---------------------------------------------------------------------------
 */

(function () {
  "use strict";

  const FETCH_TIMEOUT_MS = 8000;

  function createDataSource(config, { onData, onStatusChange }) {
    let timerId = null;
    let stopped = true;
    let backoffIndex = 0;
    let lastStatus = null;
    let abortController = null;

    function reportStatus(status, detail) {
      if (status !== lastStatus) {
        lastStatus = status;
        onStatusChange(status, detail || {});
      }
    }

    function scheduleNext(delayMs) {
      if (stopped) return;
      clearTimeout(timerId);
      timerId = setTimeout(runOnce, delayMs);
    }

    function currentBackoffDelay() {
      const schedule = config.retryBackoffMs && config.retryBackoffMs.length
        ? config.retryBackoffMs
        : [1000, 2000, 5000, 10000];
      const idx = Math.min(backoffIndex, schedule.length - 1);
      return { delay: schedule[idx], atCap: idx === schedule.length - 1 };
    }

    function handleSuccess(payload) {
      backoffIndex = 0;
      reportStatus("live");
      onData(payload);
      scheduleNext(config.pollIntervalMs);
    }

    function handleFailure(reason) {
      const { delay, atCap } = currentBackoffDelay();
      reportStatus(atCap ? "disconnected" : "reconnecting", { reason });
      backoffIndex = Math.min(backoffIndex + 1, (config.retryBackoffMs || []).length - 1);
      scheduleNext(delay);
    }

    // ---- MOCK MODE ---------------------------------------------------

    const mockState = {};

    function initMockState() {
      config.parameters.forEach((p) => {
        const t = p.thresholds || {};
        const lo = t.warnMin !== undefined ? t.warnMin : (t.critMin !== undefined ? t.critMin : 0);
        const hi = t.warnMax !== undefined ? t.warnMax : (t.critMax !== undefined ? t.critMax : lo + 100);
        const mid = (lo + hi) / 2 || 1;
        mockState[p.id] = {
          value: mid,
          target: mid,
          range: [lo, hi]
        };
      });
    }

    function stepMock() {
      const params = config.parameters.map((p) => {
        const s = mockState[p.id];
        const [lo, hi] = s.range;
        const span = Math.max(hi - lo, 1);

        // Occasionally pick a new wander target; sometimes deliberately
        // aim outside the range to demonstrate threshold states.
        if (Math.random() < 0.02) {
          const excursion = Math.random() < 0.15;
          if (excursion) {
            s.target = Math.random() < 0.5
              ? lo - span * (0.05 + Math.random() * 0.15)
              : hi + span * (0.05 + Math.random() * 0.15);
          } else {
            s.target = lo + Math.random() * span;
          }
        }

        // Ease toward target, add small noise.
        s.value += (s.target - s.value) * 0.08 + (Math.random() - 0.5) * span * 0.01;

        return {
          id: p.id,
          label: p.label,
          value: Math.round(s.value * 1000) / 1000,
          unit: p.unit
        };
      });

      const flags = config.flags.map((f) => {
        const prev = mockState["_flag_" + f.id];
        let state = prev === undefined ? false : prev;
        const flipChance = f.id === "fault_latch" ? 0.003 : 0.01;
        if (Math.random() < flipChance) state = !state;
        mockState["_flag_" + f.id] = state;
        return { id: f.id, label: f.label, state };
      });

      return {
        timestamp: new Date().toISOString(),
        parameters: params,
        flags
      };
    }

    function runMockOnce() {
      // Simulate an occasional dropout even in mock mode so the
      // disconnected/reconnecting states are easy to demo.
      if (Math.random() < 0.01) {
        handleFailure("simulated dropout");
        return;
      }
      handleSuccess(stepMock());
    }

    // ---- LIVE MODE -----------------------------------------------------

    async function runLiveOnce() {
      abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(config.endpoint, { signal: abortController.signal, cache: "no-store" });
        clearTimeout(timeout);
        if (!res.ok) {
          handleFailure("http " + res.status);
          return;
        }
        let payload;
        try {
          payload = await res.json();
        } catch (parseErr) {
          handleFailure("invalid json");
          return;
        }
        if (!payload || typeof payload !== "object") {
          handleFailure("empty payload");
          return;
        }
        handleSuccess(payload);
      } catch (err) {
        clearTimeout(timeout);
        handleFailure(err && err.name === "AbortError" ? "timeout" : (err && err.message) || "network error");
      }
    }

    function runOnce() {
      if (stopped) return;
      if (config.mode === "live") {
        runLiveOnce();
      } else {
        runMockOnce();
      }
    }

    return {
      start() {
        if (!stopped) return;
        stopped = false;
        backoffIndex = 0;
        if (config.mode === "mock") initMockState();
        runOnce();
      },
      stop() {
        stopped = true;
        clearTimeout(timerId);
        if (abortController) abortController.abort();
      }
    };
  }

  window.createDataSource = createDataSource;
})();
