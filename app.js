const inputs = [
  { key: "atRisk", label: "At-risk TRx / week", min: 100, max: 50000, step: 100, suffix: "", hint: "Weekly volume exposed to the access signal—not total brand volume" },
  { key: "decay", label: "Weekly decay rate", min: 0.5, max: 6, step: 0.5, suffix: "%", hint: "Largest value lever; use brand evidence or an analog" },
  { key: "manualWk", label: "Response time — today", min: 3, max: 10, step: 1, suffix: " wk", hint: "Detect → validate → size → decide → cascade" },
  { key: "aiWk", label: "Response time — AI-enabled", min: 1, max: 6, step: 1, suffix: " wk", hint: "AI accelerates handoffs; humans retain decisions" },
  { key: "dampen", label: "Decay reduction after response", min: 30, max: 100, step: 5, suffix: "%", hint: "100% assumes response fully halts erosion" },
  { key: "netRev", label: "Net revenue / TRx", min: 100, max: 800, step: 10, prefix: "$", suffix: "", hint: "Net—not gross—revenue per prescription" },
  { key: "horizon", label: "Persistence horizon", min: 8, max: 52, step: 2, suffix: " wk", hint: "How long an eroded prescription would have persisted" },
  { key: "events", label: "Material events / year", min: 4, max: 24, step: 1, suffix: "", hint: "Meaningful access changes affecting this brand" },
];

const presets = {
  conservative: { atRisk: 600, decay: 1.5, manualWk: 6, aiWk: 4, dampen: 50, netRev: 250, horizon: 20, events: 8 },
  base: { atRisk: 900, decay: 3, manualWk: 7, aiWk: 2, dampen: 70, netRev: 303, horizon: 26, events: 12 },
  high: { atRisk: 1600, decay: 4, manualWk: 8, aiWk: 3, dampen: 75, netRev: 450, horizon: 32, events: 16 },
  jardiance2027: { atRisk: 5000, decay: 2, manualWk: 7, aiWk: 3, dampen: 55, netRev: 230, horizon: 26, events: 10 },
};

const STORAGE_KEY = "access-signal-value-model.scenarios.v1";
const LAST_STATE_KEY = "access-signal-value-model.last-state.v1";

function readLastState() {
  try {
    const stored = JSON.parse(localStorage.getItem(LAST_STATE_KEY));
    if (stored && inputs.every((item) => Number.isFinite(Number(stored[item.key])))) {
      return Object.fromEntries(inputs.map((item) => [item.key, Number(stored[item.key])]));
    }
  } catch {}
  return { ...presets.base };
}

let state = readLastState();
const sliderRoot = document.querySelector("#sliders");

function currency(n) {
  const sign = n < 0 ? "−" : "";
  const v = Math.abs(n);
  if (v >= 1_000_000) return `${sign}$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 100_000) return `${sign}$${Math.round(v / 1000)}K`;
  return `${sign}$${Math.round(v).toLocaleString()}`;
}
function whole(n) { return Math.round(n).toLocaleString(); }

function erodedTRx(atRisk, weeklyDecay, responseWeek, postDampen, horizon) {
  let remaining = atRisk;
  const weeklyRemaining = [];
  for (let week = 1; week <= horizon; week += 1) {
    const rate = week <= responseWeek ? weeklyDecay : weeklyDecay * (1 - postDampen);
    const weeklyLoss = remaining * rate;
    remaining -= weeklyLoss;
    weeklyRemaining.push(remaining);
  }
  return {
    lostRunRate: atRisk - remaining,
    remaining,
    weeklyRemaining,
  };
}

function calculate(responseWeek = state.aiWk) {
  const decay = state.decay / 100;
  const dampen = state.dampen / 100;
  const manual = erodedTRx(state.atRisk, decay, state.manualWk, dampen, state.horizon);
  const ai = erodedTRx(state.atRisk, decay, responseWeek, dampen, state.horizon);
  const protectedByWeek = ai.weeklyRemaining.map(
    (aiRemaining, index) => aiRemaining - manual.weeklyRemaining[index]
  );
  const protectedRunRate = protectedByWeek.at(-1) || 0;
  const cumulativeProtectedTRx = protectedByWeek.reduce((total, value) => total + value, 0);
  return {
    manualLostRunRate: manual.lostRunRate,
    aiLostRunRate: ai.lostRunRate,
    protectedRunRate,
    cumulativeProtectedTRx,
    avoidedRevenue: cumulativeProtectedTRx * state.netRev,
  };
}

function buildSliders() {
  sliderRoot.innerHTML = inputs.map((item) => `
    <div class="slider-group">
      <div class="slider-head">
        <label for="${item.key}">${item.label}</label>
        <div class="value-entry">
          <span>${item.prefix || ""}</span>
          <input
            id="${item.key}-number"
            class="number-input"
            type="number"
            min="${item.min}"
            max="${item.max}"
            step="${item.step}"
            aria-label="${item.label} exact value"
          />
          <span>${item.suffix}</span>
        </div>
      </div>
      <input id="${item.key}" type="range" min="${item.min}" max="${item.max}" step="${item.step}" aria-describedby="${item.key}-hint" />
      <div id="${item.key}-hint" class="slider-hint">${item.hint}</div>
    </div>
  `).join("");
  inputs.forEach((item) => {
    document.querySelector(`#${item.key}`).addEventListener("input", (event) => {
      state[item.key] = Number(event.target.value);
      setActivePreset(null);
      render();
    });
    document.querySelector(`#${item.key}-number`).addEventListener("change", (event) => {
      const raw = Number(event.target.value);
      if (!Number.isFinite(raw)) {
        render();
        return;
      }
      state[item.key] = Math.min(item.max, Math.max(item.min, raw));
      setActivePreset(null);
      render();
    });
  });
}

function setActivePreset(name) {
  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === name);
  });
  document.querySelector("#scenario-context").hidden = name !== "jardiance2027";
}

function render() {
  inputs.forEach((item) => {
    const control = document.querySelector(`#${item.key}`);
    control.value = state[item.key];
    document.querySelector(`#${item.key}-number`).value = state[item.key];
  });
  try { localStorage.setItem(LAST_STATE_KEY, JSON.stringify(state)); } catch {}

  const result = calculate();
  const isNegative = result.avoidedRevenue < 0;
  const warning = document.querySelector("#input-warning");
  warning.hidden = !isNegative;
  warning.textContent = "The AI-enabled response is slower than today’s process in this scenario, so the model shows added—not avoided—erosion.";

  document.querySelector("#avoided-revenue").textContent = currency(result.avoidedRevenue);
  document.querySelector("#protected-trx").textContent = `≈ ${whole(Math.abs(result.cumulativeProtectedTRx))} cumulative TRx ${isNegative ? "additionally eroded" : "protected"} over ${state.horizon} weeks`;
  document.querySelector("#annual-value").textContent = currency(result.avoidedRevenue * state.events);
  document.querySelector("#annual-note").textContent = `Across ${state.events} material events`;

  const labor = 12_800;
  const ratio = result.avoidedRevenue / labor;
  document.querySelector("#labor-value").textContent = currency(labor);
  document.querySelector("#ratio-copy").innerHTML = ratio > 0
    ? `Illustrative commercial value is <strong>${Math.round(ratio)}×</strong> the labor savings. Efficiency alone understates the case.`
    : "This scenario does not create commercial value; revisit the response-time assumption.";

  const maxLost = Math.max(result.manualLostRunRate, result.aiLostRunRate, 1);
  document.querySelector("#erosion-bars").innerHTML = [
    { label: `Current response · week ${state.manualWk}`, value: result.manualLostRunRate, color: "var(--manual)" },
    { label: `AI-enabled response · week ${state.aiWk}`, value: result.aiLostRunRate, color: "var(--green)" },
  ].map((row) => `
    <div class="bar-row">
      <div class="bar-meta"><span>${row.label}</span><strong>${whole(row.value)} TRx / week</strong></div>
      <div class="track"><div class="fill" style="width:${Math.max(0, row.value / maxLost * 100)}%;background:${row.color}"></div></div>
    </div>
  `).join("");
  document.querySelector("#run-rate-label").textContent = `Protected weekly run-rate at week ${state.horizon}`;
  document.querySelector("#protected-run-rate").textContent = `${whole(result.protectedRunRate)} TRx / week`;
  document.querySelector("#avoided-detail").textContent = `${whole(result.cumulativeProtectedTRx)} cumulative TRx → ${currency(result.avoidedRevenue)}`;

  const sensitivity = [1, 2, 3, 4, 5, 6].map((week) => ({ week, value: calculate(week).avoidedRevenue }));
  const maxSens = Math.max(...sensitivity.map((row) => Math.max(row.value, 0)), 1);
  document.querySelector("#sensitivity").innerHTML = sensitivity.map((row) => `
    <div class="sens-row ${row.week === state.aiWk ? "current" : ""}">
      <span>wk ${row.week}</span>
      <div class="track"><div class="fill" style="width:${Math.max(0, row.value) / maxSens * 100}%;background:${row.week === state.aiWk ? "var(--amber)" : "#d8c08a"}"></div></div>
      <strong>${currency(row.value)}</strong>
    </div>
  `).join("");
}

function readScenarios() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeScenarios(scenarios) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
}

function refreshScenarioSelect(selectedName = "") {
  const select = document.querySelector("#scenario-select");
  const names = Object.keys(readScenarios()).sort((a, b) => a.localeCompare(b));
  select.innerHTML = names.length
    ? `<option value="">Choose a saved scenario</option>${names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}`
    : `<option value="">No saved scenarios</option>`;
  if (selectedName && names.includes(selectedName)) select.value = selectedName;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setDataStatus(message, isError = false) {
  const status = document.querySelector("#data-status");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function safeFileName(value) {
  return value.trim().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "access-assumptions";
}

function exportCsv() {
  const selected = document.querySelector("#scenario-select").value;
  const lines = [
    ["key", "assumption", "value"],
    ...inputs.map((item) => [item.key, item.label, state[item.key]]),
  ];
  const csv = lines.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFileName(selected || "access-assumptions")}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setDataStatus("CSV exported.");
}

function parseCsvLine(line) {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }
  cells.push(value.trim());
  return cells;
}

function importCsv(text) {
  const rows = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim()).map(parseCsvLine);
  if (rows.length < 2) throw new Error("The CSV does not contain assumption rows.");
  const header = rows[0].map((cell) => cell.toLowerCase());
  const keyIndex = header.indexOf("key");
  const assumptionIndex = header.indexOf("assumption");
  const valueIndex = header.indexOf("value");
  if (valueIndex < 0 || (keyIndex < 0 && assumptionIndex < 0)) {
    throw new Error("Use the exported CSV format with key/assumption and value columns.");
  }
  const next = { ...state };
  let imported = 0;
  rows.slice(1).forEach((row) => {
    const identifier = keyIndex >= 0 ? row[keyIndex] : row[assumptionIndex];
    const item = inputs.find((candidate) =>
      candidate.key.toLowerCase() === String(identifier).toLowerCase()
      || candidate.label.toLowerCase() === String(identifier).toLowerCase()
    );
    const value = Number(row[valueIndex]);
    if (item && Number.isFinite(value)) {
      next[item.key] = Math.min(item.max, Math.max(item.min, value));
      imported += 1;
    }
  });
  if (!imported) throw new Error("No recognized assumptions were found.");
  state = next;
  setActivePreset(null);
  render();
  setDataStatus(`${imported} assumptions imported. Review them, then save the scenario if desired.`);
}

buildSliders();
render();
refreshScenarioSelect();

document.querySelectorAll("[data-preset]").forEach((button) => {
  button.addEventListener("click", () => {
    state = { ...presets[button.dataset.preset] };
    setActivePreset(button.dataset.preset);
    render();
  });
});
document.querySelector("#reset").addEventListener("click", () => {
  state = { ...presets.base };
  setActivePreset("base");
  render();
});
document.querySelector("#method-toggle").addEventListener("click", (event) => {
  const detail = document.querySelector("#method-detail");
  const opening = detail.hidden;
  detail.hidden = !opening;
  event.currentTarget.textContent = opening ? "Hide methodology" : "Show methodology";
  event.currentTarget.setAttribute("aria-expanded", String(opening));
});

document.querySelector("#save-scenario").addEventListener("click", () => {
  const nameInput = document.querySelector("#scenario-name");
  const name = nameInput.value.trim();
  if (!name) {
    setDataStatus("Enter a scenario name before saving.", true);
    nameInput.focus();
    return;
  }
  try {
    const scenarios = readScenarios();
    scenarios[name] = { values: { ...state }, updatedAt: new Date().toISOString() };
    writeScenarios(scenarios);
    refreshScenarioSelect(name);
    nameInput.value = "";
    setDataStatus(`Saved “${name}” on this computer.`);
  } catch {
    setDataStatus("This browser did not allow the scenario to be saved.", true);
  }
});

document.querySelector("#load-scenario").addEventListener("click", () => {
  const name = document.querySelector("#scenario-select").value;
  const scenario = readScenarios()[name];
  if (!name || !scenario) {
    setDataStatus("Choose a saved scenario to load.", true);
    return;
  }
  state = { ...scenario.values };
  setActivePreset(null);
  render();
  setDataStatus(`Loaded “${name}”.`);
});

document.querySelector("#delete-scenario").addEventListener("click", () => {
  const select = document.querySelector("#scenario-select");
  const name = select.value;
  if (!name) {
    setDataStatus("Choose a saved scenario to delete.", true);
    return;
  }
  const scenarios = readScenarios();
  delete scenarios[name];
  writeScenarios(scenarios);
  refreshScenarioSelect();
  setDataStatus(`Deleted “${name}”.`);
});

document.querySelector("#export-csv").addEventListener("click", exportCsv);
document.querySelector("#import-csv").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    importCsv(await file.text());
  } catch (error) {
    setDataStatus(error.message || "The CSV could not be imported.", true);
  } finally {
    event.target.value = "";
  }
});
