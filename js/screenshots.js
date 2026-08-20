/**
 * screenshots.js
 * ---------------------------------------------------------------------------
 * Polls screenshot.php for the newest simulator screenshot. Same shape as
 * datasource.js — polling with capped exponential backoff, three status
 * states — kept as a separate module because it's an independent feed
 * from the parameter data (different endpoint, different cadence, and one
 * can be working while the other is down).
 *
 * If config.screenshot.enabled is false, this is a no-op — the panel
 * simply isn't wired up, so a dashboard-only deployment with no PHP
 * server still works exactly as before.
 * ---------------------------------------------------------------------------
 */

(function () {
  "use strict";

  function createScreenshotSource(config, { onUpdate, onStatusChange }) {
    const sc = config.screenshot;
    if (!sc || !sc.enabled) {
      return { start() {}, stop() {} };
    }

    let timerId = null;
    let stopped = true;
    let backoffIndex = 0;
    let lastStatus = null;
    let abortController = null;

    function reportStatus(status) {
      if (status !== lastStatus) {
        lastStatus = status;
        onStatusChange(status);
      }
    }

    function scheduleNext(delayMs) {
      if (stopped) return;
      clearTimeout(timerId);
      timerId = setTimeout(runOnce, delayMs);
    }

    function backoffSchedule() {
      return sc.retryBackoffMs && sc.retryBackoffMs.length
        ? sc.retryBackoffMs
        : [2000, 5000, 10000, 20000];
    }

    async function runOnce() {
      if (stopped) return;
      abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), 8000);
      try {
        const res = await fetch(
          sc.endpoint + "?action=latest&_=" + Date.now(),
          { signal: abortController.signal, cache: "no-store" }
        );
        clearTimeout(timeout);
        if (!res.ok) throw new Error("http " + res.status);
        let data;
        try {
          data = await res.json();
        } catch (e) {
          throw new Error("invalid json");
        }
        backoffIndex = 0;
        reportStatus("ok");
        onUpdate(data && typeof data === "object" ? data : { found: false });
        scheduleNext(sc.pollIntervalMs);
      } catch (err) {
        clearTimeout(timeout);
        const schedule = backoffSchedule();
        const idx = Math.min(backoffIndex, schedule.length - 1);
        reportStatus("error");
        backoffIndex = Math.min(backoffIndex + 1, schedule.length - 1);
        scheduleNext(schedule[idx]);
      }
    }

    return {
      start() {
        if (!stopped) return;
        stopped = false;
        backoffIndex = 0;
        runOnce();
      },
      stop() {
        stopped = true;
        clearTimeout(timerId);
        if (abortController) abortController.abort();
      }
    };
  }

  window.createScreenshotSource = createScreenshotSource;
})();
