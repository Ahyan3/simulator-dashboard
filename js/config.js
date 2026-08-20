/**
 * config.js
 * ---------------------------------------------------------------------------
 * THIS IS THE ONLY FILE YOU SHOULD NEED TO EDIT.
 *
 * Everything here controls what the dashboard shows: where the data comes
 * from, which parameters exist, their units and thresholds, and a few
 * timing knobs. Save the file and reload the page (or the browser tab
 * auto-reloads if you're using a static file server with live reload) to
 * see changes.
 *
 * See README.md for a walkthrough of adding a new parameter.
 * ---------------------------------------------------------------------------
 */

window.DASHBOARD_CONFIG = {

  // ---------------------------------------------------------------------
  // DATA SOURCE
  // ---------------------------------------------------------------------

  // "mock"  -> generates plausible fake data in the browser. Use this for
  //            development, demos, and to show threshold states on command.
  // "live"  -> polls the real endpoint below.
  mode: "mock",

  // REST endpoint the dashboard polls in "live" mode. Must return JSON
  // shaped like the mock payload documented in README.md.
  endpoint: "/api/status",

  // How often to poll, in milliseconds. 1000ms (1Hz) is the design target.
  // If your real poll rate needs to go much above ~5Hz, this dashboard's
  // chart layer (Chart.js) will start to struggle — talk to your developer
  // about switching the charts.js/tiles.js rendering to uPlot before
  // pushing the rate up.
  pollIntervalMs: 1000,

  // Retry backoff schedule (ms) used after a failed poll. The dashboard
  // steps through this list on consecutive failures and holds at the last
  // value; it resets to the first value as soon as a poll succeeds again.
  retryBackoffMs: [1000, 2000, 5000, 10000],

  // How long a successful update can age before the UI calls it "stale"
  // and warns the viewer, expressed as a multiple of pollIntervalMs.
  staleAfterPolls: 2,

  // ---------------------------------------------------------------------
  // HISTORY
  // ---------------------------------------------------------------------

  // How much history to keep in memory, per parameter, in seconds.
  // This is a hard cap — older points are discarded as new ones arrive.
  // Increasing this increases memory use linearly; it does not affect the
  // sparklines (those always show the most recent 60s regardless).
  historySeconds: 300,

  // Window shown inside each tile's sparkline, in seconds.
  sparklineSeconds: 60,

  // ---------------------------------------------------------------------
  // PARAMETERS
  // ---------------------------------------------------------------------
  // id     - must be unique, must match the "id" field in the JSON payload
  // label  - shown on the tile and in the chart legend
  // unit   - shown next to the value, dimmed
  // decimals - digits after the decimal point in the readout
  // thresholds - any subset of warnMin/warnMax/critMin/critMax. Omit the
  //              whole object (or leave it {}) for a parameter with no
  //              alarm limits — it will only ever show as "normal".
  // showInHistoryChart - whether it's selectable in the full history chart
  // ---------------------------------------------------------------------

  parameters: [
    {
      id: "temp_core",
      label: "Core Temperature",
      unit: "°C",
      decimals: 1,
      thresholds: { warnMin: 20, warnMax: 85, critMin: 5, critMax: 95 },
      showInHistoryChart: true
    },
    {
      id: "pressure_in",
      label: "Inlet Pressure",
      unit: "bar",
      decimals: 2,
      thresholds: { warnMin: 2.5, warnMax: 5.5, critMin: 1.0, critMax: 6.5 },
      showInHistoryChart: true
    },
    {
      id: "rpm",
      label: "Shaft Speed",
      unit: "rpm",
      decimals: 0,
      thresholds: { warnMax: 4200, critMax: 4800 },
      showInHistoryChart: true
    },
    {
      id: "flow_rate",
      label: "Flow Rate",
      unit: "L/min",
      decimals: 1,
      thresholds: { warnMin: 10, critMin: 5 },
      showInHistoryChart: true
    },
    {
      id: "voltage_bus",
      label: "Bus Voltage",
      unit: "V",
      decimals: 1,
      thresholds: { warnMin: 21, warnMax: 26, critMin: 19, critMax: 28 },
      showInHistoryChart: true
    }
  ],

  // ---------------------------------------------------------------------
  // BOOLEAN FLAGS
  // ---------------------------------------------------------------------
  // id        - must match the "id" field in the payload's "flags" array
  // label     - shown next to the indicator
  // sense     - "normal-true" if state:true is the nominal/expected state
  //             (e.g. "Pump" running is normal), or "normal-false" if
  //             state:true is the abnormal one (e.g. "Fault" being true is bad)
  // trueLabel / falseLabel - text shown for each state (optional, default ON/OFF)
  // ---------------------------------------------------------------------

  flags: [
    { id: "pump_active", label: "Pump", sense: "normal-true", trueLabel: "ON", falseLabel: "OFF" },
    { id: "fault_latch", label: "Fault", sense: "normal-false", trueLabel: "ACTIVE", falseLabel: "CLEAR" }
  ],

  // ---------------------------------------------------------------------
  // SCREENSHOT PANEL
  // ---------------------------------------------------------------------
  // Shows the newest screenshot your simulator saves to a folder on this
  // PC, next to the live parameters. A browser can't read your filesystem
  // directly, so this needs a small server-side helper — screenshot.php,
  // included in this project — running under an actual PHP server. See
  // README.md ("Screenshot panel setup") for the one-time setup steps.
  //
  // The folder path itself is configured in screenshot.php, NOT here —
  // that's server-side config, this is browser-side config. Two files,
  // two different things: this section just controls how the browser
  // polls it.
  screenshot: {
    enabled: true,             // set false to hide the panel entirely (e.g. no PHP available)
    endpoint: "screenshot.php",
    pollIntervalMs: 3000,      // checking every 3s is plenty given screenshots save every ~30s
    staleAfterMs: 60000,       // flag as stale if no new screenshot appears within this long
    retryBackoffMs: [2000, 5000, 10000, 20000]
  }
};
