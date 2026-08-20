/**
 * app.js
 * ---------------------------------------------------------------------------
 * Wires everything together: datasource -> store -> tiles / flags / chart /
 * connection status / clock. This is the only file that touches multiple
 * modules — everything else is self-contained.
 * ---------------------------------------------------------------------------
 */

(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    const config = window.DASHBOARD_CONFIG;
    if (!config) {
      console.error("DASHBOARD_CONFIG missing — check js/config.js is loaded before app.js");
      return;
    }

    const store = window.createStore(config);
    const tiles = window.createTiles(config, store, document.getElementById("tile-grid"));
    const historyChart = window.createHistoryChart(config, store, {
      canvasEl: document.getElementById("history-canvas"),
      legendEl: document.getElementById("history-legend")
    });

    const flagEls = buildFlagRow(config, document.getElementById("flags-row"));

    const statusDotEl = document.getElementById("status-dot");
    const statusTextEl = document.getElementById("status-text");
    const statusAgeEl = document.getElementById("status-age");
    const clockEl = document.getElementById("clock");

    let currentConnectionStatus = "reconnecting";
    let lastGoodMs = null;

    function setConnectionStatus(status) {
      currentConnectionStatus = status;
      statusDotEl.className = "status-dot status-dot--" + status;
      statusTextEl.textContent = status.toUpperCase();
      statusTextEl.className = "status-text status-text--" + status;
    }

    function renderFlags(flags) {
      flags.forEach((f) => {
        const el = flagEls[f.id];
        if (!el) return;
        const cfg = config.flags.find((c) => c.id === f.id) || {};
        const trueLabel = cfg.trueLabel || "ON";
        const falseLabel = cfg.falseLabel || "OFF";

        let text = "—";
        let cls = "unknown";
        if (f.state !== null) {
          text = f.state ? trueLabel : falseLabel;
          cls = f.abnormal ? "abnormal" : "normal";
        }
        el.dot.className = "flag-dot flag-dot--" + cls;
        el.state.textContent = text;
        el.state.className = "flag-state flag-state--" + cls;
      });
    }

    function onData(payload) {
      try {
        const snapshot = store.ingest(payload);
        lastGoodMs = snapshot.timestampMs;
        tiles.update(snapshot);
        renderFlags(snapshot.flags);
        historyChart.update(snapshot.timestampMs);
      } catch (err) {
        // Defensive: a malformed payload or a rendering bug should never
        // take the whole page down. Log it and keep polling.
        console.error("Failed to process incoming data:", err);
      }
    }

    function onStatusChange(status) {
      setConnectionStatus(status);
    }

    const dataSource = window.createDataSource(config, { onData, onStatusChange });
    dataSource.start();

    // ---- screenshot panel -----------------------------------------------
    const screenshotPanelEl = document.getElementById("screenshot-panel");
    if (!config.screenshot || !config.screenshot.enabled) {
      screenshotPanelEl.style.display = "none";
      document.querySelector(".dashboard-layout").style.gridTemplateColumns = "1fr";
    }
    const screenshotEls = {
      status: document.getElementById("screenshot-status"),
      img: document.getElementById("screenshot-img"),
      placeholder: document.getElementById("screenshot-placeholder"),
      filename: document.getElementById("screenshot-filename"),
      timestamp: document.getElementById("screenshot-timestamp")
    };
    let lastScreenshotFilename = null;
    let lastScreenshotChangeMs = null;

    function onScreenshotUpdate(data) {
      if (!data || !data.found) {
        screenshotEls.placeholder.style.display = "flex";
        screenshotEls.img.style.display = "none";
        screenshotEls.filename.textContent = "";
        screenshotEls.placeholder.textContent = (data && data.folderExists === false)
          ? "Screenshot folder not found — check screenshot.php"
          : "No screenshot yet";
        screenshotEls.timestamp.textContent = "—";
        screenshotEls.timestamp.classList.remove("stale");
        return;
      }

      if (data.filename !== lastScreenshotFilename) {
        lastScreenshotFilename = data.filename;
        lastScreenshotChangeMs = Date.now();
        const cacheBustUrl = data.url + (data.url.indexOf("?") >= 0 ? "&" : "?") + "_=" + Date.now();
        screenshotEls.img.onload = () => {
          screenshotEls.img.style.display = "block";
          screenshotEls.placeholder.style.display = "none";
        };
        screenshotEls.img.onerror = () => {
          screenshotEls.img.style.display = "none";
          screenshotEls.placeholder.style.display = "flex";
          screenshotEls.placeholder.textContent = "Couldn't load the screenshot file";
        };
        screenshotEls.img.src = cacheBustUrl;
      }
      screenshotEls.filename.textContent = data.filename;
    }

    function onScreenshotStatus(status) {
      const ok = status === "ok";
      screenshotEls.status.textContent = ok ? "WATCHING" : "ERROR";
      screenshotEls.status.className = "status-text " + (ok ? "status-text--live" : "status-text--disconnected");
    }

    const screenshotSource = window.createScreenshotSource(config, {
      onUpdate: onScreenshotUpdate,
      onStatusChange: onScreenshotStatus
    });
    screenshotSource.start();

    // ---- clock + "last updated" age tickers, independent of poll cadence -
    function tick() {
      const now = new Date();
      clockEl.textContent = now.toLocaleTimeString(undefined, { hour12: false });

      if (lastGoodMs === null) {
        statusAgeEl.textContent = "no data yet";
      } else {
        const ageSec = (Date.now() - lastGoodMs) / 1000;
        const staleThresholdSec = (config.staleAfterPolls * config.pollIntervalMs) / 1000;
        if (ageSec < 1.5) {
          statusAgeEl.textContent = "updated just now";
          statusAgeEl.classList.remove("status-age--stale");
        } else {
          statusAgeEl.textContent = "updated " + ageSec.toFixed(1) + "s ago";
          statusAgeEl.classList.toggle("status-age--stale", ageSec >= staleThresholdSec);
        }
      }

      if (lastScreenshotChangeMs !== null && config.screenshot && config.screenshot.enabled) {
        const ageSec = (Date.now() - lastScreenshotChangeMs) / 1000;
        screenshotEls.timestamp.textContent = "captured " + ageSec.toFixed(0) + "s ago";
        screenshotEls.timestamp.classList.toggle("stale", (ageSec * 1000) >= config.screenshot.staleAfterMs);
      }
    }
    tick();
    setInterval(tick, 250);

    // Expose for debugging from devtools without polluting the module scope.
    window.__dashboard = {
      config, store, dataSource, tiles, historyChart, renderFlags, setConnectionStatus,
      screenshotSource, onScreenshotUpdate, onScreenshotStatus
    };
  }

  function buildFlagRow(config, containerEl) {
    containerEl.innerHTML = "";
    const els = {};
    config.flags.forEach((f) => {
      const wrap = document.createElement("div");
      wrap.className = "flag";
      wrap.innerHTML = `
        <span class="flag-dot flag-dot--unknown"></span>
        <span class="flag-label">${f.label}</span>
        <span class="flag-state flag-state--unknown">—</span>
      `;
      containerEl.appendChild(wrap);
      els[f.id] = {
        dot: wrap.querySelector(".flag-dot"),
        state: wrap.querySelector(".flag-state")
      };
    });
    return els;
  }
})();
