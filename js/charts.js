/**
 * charts.js
 * ---------------------------------------------------------------------------
 * The full-history chart at the bottom of the dashboard: selectable
 * parameters, last `historySeconds` of data, drawn with Chart.js.
 *
 * Chart.js is loaded from CDN in index.html with a local vendor fallback
 * (vendor/chart.min.js) if the CDN is unreachable — this dashboard has to
 * keep working on an internal network with no internet access.
 *
 * No date adapter is bundled (keeps the dependency list to "Chart.js,
 * nothing else"), so the x-axis is plotted as seconds-ago on a plain
 * linear scale rather than Chart.js's time scale.
 *
 * Animation is fully disabled — this is an instrument, not a motion demo,
 * and per the design spec nothing here should compete with the tiles for
 * attention. The chart re-renders in place every poll (chart.update("none")).
 *
 * Y-axis: parameters live on wildly different scales (rpm in the
 * thousands, bar in single digits) so plotting raw values on one shared
 * linear axis makes the small-scale ones flatten invisibly at the bottom.
 * Instead every series is normalized to its own operating envelope — the
 * union of its configured warn/crit thresholds and whatever's currently
 * visible in the window — onto a shared 0-1 axis. That means the trace's
 * vertical position actually means something (how close to its own alarm
 * boundary) instead of being dominated by whichever parameter has the
 * biggest raw numbers. Exact values are still available on hover, and
 * always on the tiles above.
 *
 * Series colors: a validated categorical palette, not hand-picked. The
 * previous palette (muted blue/violet/seafoam/rose/steel/olive) looked
 * calm but was too desaturated and too close in hue to survive contact
 * with actual color-vision testing — one adjacent pair measured ΔE 2.3
 * under protanopia (effectively identical). These five are the first five
 * slots of a validated 8-hue categorical order (fixed order, never
 * cycled), re-stepped for this dark surface: worst adjacent pair clears
 * ΔE 8.4 under simulated colorblindness and 19.3 for normal vision. Each
 * line also carries a distinct dash pattern as a second identity channel
 * — the two lines that could theoretically sit closest in hue are also
 * the two most different in pattern — so identity never rests on hue
 * alone even where two lines visually cross.
 * ---------------------------------------------------------------------------
 */

(function () {
  "use strict";

  const SERIES_COLORS = [
    "#3987e5", // blue
    "#d95926", // orange
    "#199e70", // aqua
    "#c98500", // yellow
    "#d55181"  // magenta
  ];

  // Dash pattern per slot — identity's second channel, independent of hue.
  const SERIES_DASH = [
    [],           // solid
    [7, 4],       // dashed
    [1, 3],       // dotted
    [9, 3, 2, 3], // dash-dot
    [3, 3]        // fine dash
  ];

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function secondsAgoLabel(sAgo) {
    const s = Math.round(Math.abs(sAgo));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `-${m}:${String(r).padStart(2, "0")}`;
  }

  function createHistoryChart(config, store, { canvasEl, legendEl }) {
    const chartables = config.parameters.filter((p) => p.showInHistoryChart);
    const visible = new Set(chartables.map((p) => p.id));

    // ---- legend / selection checkboxes --------------------------------
    // A legend is always present for 2+ series (never make the reader
    // color-match unaided) — each swatch is a short stroke in the
    // series's exact color AND dash pattern, mirroring the line itself
    // rather than a plain box, so the legend teaches both identity
    // channels at once.
    legendEl.innerHTML = "";
    chartables.forEach((p, i) => {
      const color = SERIES_COLORS[i % SERIES_COLORS.length];
      const dash = SERIES_DASH[i % SERIES_DASH.length];
      const id = "hist-toggle-" + p.id;
      const wrap = document.createElement("label");
      wrap.className = "chart-toggle";
      wrap.style.setProperty("--series-color", color);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = id;
      checkbox.checked = true;

      const swatch = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      swatch.setAttribute("class", "swatch");
      swatch.setAttribute("viewBox", "0 0 20 8");
      swatch.setAttribute("aria-hidden", "true");
      const swatchLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
      swatchLine.setAttribute("x1", "0");
      swatchLine.setAttribute("y1", "4");
      swatchLine.setAttribute("x2", "20");
      swatchLine.setAttribute("y2", "4");
      swatchLine.setAttribute("stroke", color);
      swatchLine.setAttribute("stroke-width", "2");
      swatchLine.setAttribute("stroke-linecap", "round");
      if (dash.length) swatchLine.setAttribute("stroke-dasharray", dash.join(","));
      swatch.appendChild(swatchLine);

      const labelText = document.createElement("span");
      labelText.textContent = p.label; // untrusted-ish config data -> textContent, never innerHTML

      wrap.appendChild(checkbox);
      wrap.appendChild(swatch);
      wrap.appendChild(labelText);
      legendEl.appendChild(wrap);

      checkbox.addEventListener("change", (e) => {
        if (e.target.checked) visible.add(p.id); else visible.delete(p.id);
        chart.data.datasets.forEach((ds) => {
          if (ds._paramId === p.id) ds.hidden = !visible.has(p.id);
        });
        chart.update("none");
      });
    });

    const textDim = cssVar("--text-dim");
    const line = cssVar("--line");
    const paramById = {};
    chartables.forEach((p) => { paramById[p.id] = p; });

    // ---- crosshair: a vertical hairline tracking the pointer's nearest X ---
    // "Readers aim at a date, never at a 2px line" — this is what makes
    // hovering a dense multi-line chart actually usable.
    const crosshairPlugin = {
      id: "crosshair",
      afterDatasetsDraw(c) {
        const active = c.tooltip && c.tooltip.getActiveElements ? c.tooltip.getActiveElements() : [];
        if (!active || !active.length) return;
        const x = active[0].element.x;
        const { top, bottom } = c.chartArea;
        const ctx = c.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.lineWidth = 1;
        ctx.strokeStyle = textDim;
        ctx.setLineDash([]);
        ctx.stroke();
        ctx.restore();
      }
    };

    // ---- custom HTML tooltip -------------------------------------------
    // One tooltip, every visible series, at that X — the pointer never
    // has to land on a specific line. Value leads (bold, high-contrast),
    // series name follows (secondary ink) — the legend's hierarchy
    // inverted, because here the reader already knows which line they're
    // near and wants the number. Each row keys with a short dashed stroke
    // matching the line, not a filled box.
    const tooltipEl = document.createElement("div");
    tooltipEl.className = "chart-tooltip";
    canvasEl.parentElement.appendChild(tooltipEl);

    function externalTooltip(context) {
      const tt = context.tooltip;
      if (!tt || tt.opacity === 0) {
        tooltipEl.style.opacity = "0";
        return;
      }

      const rows = (tt.dataPoints || []).map((dp) => {
        const p = paramById[dp.dataset._paramId];
        const raw = dp.raw && typeof dp.raw.raw === "number" ? dp.raw.raw : null;
        const idx = chartables.indexOf(p);
        const color = SERIES_COLORS[idx % SERIES_COLORS.length];
        const dash = SERIES_DASH[idx % SERIES_DASH.length];
        const valueText = (p && raw !== null)
          ? raw.toFixed(p.decimals !== undefined ? p.decimals : 1) + " " + (p.unit || "")
          : "—";
        return { color, dash, label: p ? p.label : dp.dataset.label, valueText };
      });

      tooltipEl.replaceChildren();

      const titleEl = document.createElement("div");
      titleEl.className = "chart-tooltip-title";
      titleEl.textContent = tt.dataPoints && tt.dataPoints.length
        ? secondsAgoLabel(tt.dataPoints[0].parsed.x) + " ago"
        : "";
      tooltipEl.appendChild(titleEl);

      rows.forEach((r) => {
        const rowEl = document.createElement("div");
        rowEl.className = "chart-tooltip-row";

        const key = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        key.setAttribute("viewBox", "0 0 16 8");
        key.setAttribute("class", "chart-tooltip-key");
        const keyLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        keyLine.setAttribute("x1", "0");
        keyLine.setAttribute("y1", "4");
        keyLine.setAttribute("x2", "16");
        keyLine.setAttribute("y2", "4");
        keyLine.setAttribute("stroke", r.color);
        keyLine.setAttribute("stroke-width", "2");
        keyLine.setAttribute("stroke-linecap", "round");
        if (r.dash.length) keyLine.setAttribute("stroke-dasharray", r.dash.join(","));
        key.appendChild(keyLine);

        const valueEl = document.createElement("span");
        valueEl.className = "chart-tooltip-value";
        valueEl.textContent = r.valueText;

        const labelEl = document.createElement("span");
        labelEl.className = "chart-tooltip-label";
        labelEl.textContent = r.label;

        rowEl.appendChild(key);
        rowEl.appendChild(valueEl);
        rowEl.appendChild(labelEl);
        tooltipEl.appendChild(rowEl);
      });

      const wrapRect = canvasEl.parentElement.getBoundingClientRect();
      const canvasRect = canvasEl.getBoundingClientRect();
      const offsetX = canvasRect.left - wrapRect.left;
      const offsetY = canvasRect.top - wrapRect.top;

      let left = offsetX + tt.caretX + 14;
      const maxLeft = wrapRect.width - tooltipEl.offsetWidth - 8;
      if (left > maxLeft) left = offsetX + tt.caretX - tooltipEl.offsetWidth - 14;
      if (left < 4) left = 4;

      let top = offsetY + tt.caretY - tooltipEl.offsetHeight / 2;
      top = Math.max(4, Math.min(top, wrapRect.height - tooltipEl.offsetHeight - 4));

      tooltipEl.style.left = left + "px";
      tooltipEl.style.top = top + "px";
      tooltipEl.style.opacity = "1";
    }

    const chart = new Chart(canvasEl.getContext("2d"), {
      type: "line",
      plugins: [crosshairPlugin],
      data: {
        datasets: chartables.map((p, i) => ({
          _paramId: p.id,
          label: p.label,
          data: [],
          borderColor: SERIES_COLORS[i % SERIES_COLORS.length],
          borderDash: SERIES_DASH[i % SERIES_DASH.length],
          backgroundColor: "transparent",
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHitRadius: 12,
          spanGaps: false,
          hidden: !visible.has(p.id),
          parsing: false
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false, axis: "x" },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false, external: externalTooltip }
        },
        scales: {
          x: {
            type: "linear",
            min: -config.historySeconds,
            max: 0,
            grid: { color: line },
            ticks: { color: textDim, callback: (v) => secondsAgoLabel(v) }
          },
          y: {
            min: 0,
            max: 1,
            grid: { color: line },
            ticks: { display: false },
            title: {
              display: true,
              text: "position within each parameter's alarm envelope — hover for exact values",
              color: textDim,
              font: { size: 10 }
            }
          }
        }
      }
    });

    // Per-parameter normalization envelope: the union of the configured
    // warn/crit thresholds (whichever are defined) and whatever's
    // currently visible in the window. Recomputed fresh every update
    // (not sticky), so an old excursion that ages out of the window
    // stops distorting the scale once it's gone.
    function envelopeFor(p, points) {
      const t = p.thresholds || {};
      let min = t.critMin !== undefined ? t.critMin : t.warnMin;
      let max = t.critMax !== undefined ? t.critMax : t.warnMax;
      points.forEach((pt) => {
        if (typeof pt.v !== "number") return;
        if (min === undefined || pt.v < min) min = pt.v;
        if (max === undefined || pt.v > max) max = pt.v;
      });
      if (min === undefined) min = 0;
      if (max === undefined) max = min + 1;
      if (min === max) { min -= 1; max += 1; }
      const pad = (max - min) * 0.08;
      return { min: min - pad, max: max + pad };
    }

    function update(nowMs) {
      chartables.forEach((p) => {
        const ds = chart.data.datasets.find((d) => d._paramId === p.id);
        if (!ds) return;
        const rawPoints = store.getHistory(p.id).filter((pt) => pt && typeof pt.v === "number");
        const env = envelopeFor(p, rawPoints);
        const span = env.max - env.min || 1;
        ds.data = rawPoints.map((pt) => ({
          x: (pt.t - nowMs) / 1000,
          y: (pt.v - env.min) / span,
          raw: pt.v
        }));
      });
      chart.update("none");
    }

    return { update };
  }

  window.createHistoryChart = createHistoryChart;
})();
