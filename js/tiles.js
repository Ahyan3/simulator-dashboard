/**
 * tiles.js
 * ---------------------------------------------------------------------------
 * Renders the parameter tile grid: readout, unit, state label, and the
 * sparkline signature element.
 *
 * DOM nodes are created once (createTiles) and mutated in place on every
 * update() — no re-creating elements every tick. That keeps this cheap
 * enough to run at 1Hz indefinitely without layout thrash.
 *
 * Sparklines are drawn with plain canvas 2D (not Chart.js) — a tile grid
 * redrawing 5-20 tiny charts every second is exactly the case Chart.js
 * instances are too heavy for. Each point in the trace is colour-coded by
 * the threshold state it was recorded at, so a breach leaves a visible
 * "scar" in the trace even once the value has recovered.
 * ---------------------------------------------------------------------------
 */

(function () {
  "use strict";

  const STATE_COLOR_VAR = {
    normal: "--normal",
    warning: "--warn",
    critical: "--crit",
    unknown: "--text-dim"
  };

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function fmtValue(value, decimals) {
    if (value === null || value === undefined) return "—"; // em dash, never a zero
    return value.toFixed(decimals !== undefined ? decimals : 1);
  }

  function stateNameFromCode(code, store) {
    return store.stateName(code);
  }

  function drawSparkline(canvas, points, windowSeconds, nowMs) {
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || canvas.parentElement.clientWidth;
    const cssHeight = canvas.clientHeight || 44;
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);

    const finiteVals = points.filter((p) => p && typeof p.v === "number");
    if (finiteVals.length < 2) return;

    let min = Math.min(...finiteVals.map((p) => p.v));
    let max = Math.max(...finiteVals.map((p) => p.v));
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const padY = (max - min) * 0.12;
    min -= padY;
    max += padY;

    const t0 = nowMs - windowSeconds * 1000;
    const xFor = (t) => ((t - t0) / (windowSeconds * 1000)) * w;
    const yFor = (v) => h - ((v - min) / (max - min)) * h;

    const colors = {
      normal: cssVar(STATE_COLOR_VAR.normal),
      warning: cssVar(STATE_COLOR_VAR.warning),
      critical: cssVar(STATE_COLOR_VAR.critical),
      unknown: cssVar(STATE_COLOR_VAR.unknown)
    };

    ctx.lineWidth = Math.max(1.5, 1.5 * dpr);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    let started = false;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const cur = points[i];
      if (!prev || !cur || typeof prev.v !== "number" || typeof cur.v !== "number") {
        started = false;
        continue;
      }
      const stateKey = cur.s === 2 ? "critical" : cur.s === 1 ? "warning" : cur.s === 0 ? "normal" : "unknown";
      ctx.strokeStyle = colors[stateKey] || colors.normal;
      ctx.beginPath();
      ctx.moveTo(xFor(prev.t), yFor(prev.v));
      ctx.lineTo(xFor(cur.t), yFor(cur.v));
      ctx.stroke();
      started = true;
    }

    // Current-value dot at the right edge.
    const last = finiteVals[finiteVals.length - 1];
    if (last) {
      const stateKey = last.s === 2 ? "critical" : last.s === 1 ? "warning" : last.s === 0 ? "normal" : "unknown";
      ctx.fillStyle = colors[stateKey] || colors.normal;
      ctx.beginPath();
      ctx.arc(xFor(last.t), yFor(last.v), Math.max(2, 2 * dpr), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function createTiles(config, store, containerEl) {
    const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const els = {};

    containerEl.innerHTML = "";
    config.parameters.forEach((p) => {
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.dataset.state = "unknown";
      tile.setAttribute("role", "group");
      tile.setAttribute("aria-label", p.label);

      tile.innerHTML = `
        <div class="tile-label">${p.label}</div>
        <div class="tile-readout">
          <span class="tile-value">—</span>
          <span class="tile-unit">${p.unit || ""}</span>
        </div>
        <div class="tile-state" aria-live="polite">UNKNOWN</div>
        <canvas class="tile-sparkline" aria-hidden="true"></canvas>
      `;

      containerEl.appendChild(tile);
      els[p.id] = {
        tile,
        value: tile.querySelector(".tile-value"),
        unit: tile.querySelector(".tile-unit"),
        stateLabel: tile.querySelector(".tile-state"),
        canvas: tile.querySelector(".tile-sparkline")
      };
    });

    function update(snapshot) {
      snapshot.parameters.forEach((p) => {
        const el = els[p.id];
        if (!el) return;

        el.value.textContent = fmtValue(p.value, p.decimals);
        el.unit.style.visibility = p.value === null ? "hidden" : "visible";
        el.stateLabel.textContent = p.state.toUpperCase();

        const prevState = el.tile.dataset.state;
        if (prevState !== p.state) {
          el.tile.dataset.state = p.state;
          if (p.state === "critical" && !reducedMotion) {
            el.tile.classList.remove("pulse-critical");
            // eslint-disable-next-line no-unused-expressions
            void el.tile.offsetWidth; // restart animation
            el.tile.classList.add("pulse-critical");
          }
        }

        const history = store.getHistory(p.id, config.sparklineSeconds);
        drawSparkline(el.canvas, history, config.sparklineSeconds, snapshot.timestampMs);
      });
    }

    // Sparklines depend on element width; redraw on resize.
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        config.parameters.forEach((p) => {
          const el = els[p.id];
          const history = store.getHistory(p.id, config.sparklineSeconds);
          drawSparkline(el.canvas, history, config.sparklineSeconds, store.getLastGoodTimestampMs() || Date.now());
        });
      }, 150);
    });

    return { update };
  }

  window.createTiles = createTiles;
})();
