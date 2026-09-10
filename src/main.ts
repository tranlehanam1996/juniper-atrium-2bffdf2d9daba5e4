import { theme } from "./theme";
import { RecordStore } from "./core/store";
import { localDay, buildPlan, summarize, suggestDailyLoad, validateRecord } from "./core/planner";
import { exportJson, exportCsv, importJson, download } from "./core/exchange";
import { revisionLedger } from "./generated/revision-ledger";
import type { LifeRecord } from "./types";

const store = new RecordStore(`pca_data_${theme.id}`, theme.seeds.map(([title, category, effort, impact]) => ({
  id: crypto.randomUUID(),
  title,
  category,
  dueDate: localDay(),
  effort,
  impact,
  status: "planned",
  notes: "",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})));

const app = document.getElementById("app");
if (!app) throw new Error("App root not found");

function render() {
  const records = store.all();
  const today = localDay();
  const plan = buildPlan(records, today);
  const stats = summarize(records, today);
  const schedule = suggestDailyLoad(records, 120, today);

  app.innerHTML = `
    <header class="hero">
      <div>
        <div class="eyebrow">${theme.product}</div>
        <h1>${theme.product}</h1>
        <p>${theme.tagline}</p>
      </div>
      <div class="revision">
        <span>Revision</span>
        <strong>${revisionLedger.ordinal}</strong>
        <small>${revisionLedger.day}</small>
      </div>
    </header>

    <div class="summary">
      <article><span>Total</span><strong>${stats.total}</strong></article>
      <article><span>Completed</span><strong>${stats.completed}</strong></article>
      <article><span>Overdue</span><strong>${stats.overdue}</strong></article>
      <article><span>Effort</span><strong>${stats.effort}m</strong></article>
    </div>

    <div class="layout">
      <aside class="panel">
        <div class="panel-title"><h2>Add ${theme.itemLabel}</h2></div>
        <form id="add-form">
          <label>${theme.itemLabel}</label>
          <input type="text" name="title" required>
          <div class="form-grid">
            <div>
              <label>${theme.dateLabel}</label>
              <input type="date" name="dueDate" value="${today}" required>
            </div>
            <div>
              <label>Category</label>
              <select name="category">
                ${theme.categories.map(c => `<option value="${c}">${c}</option>`).join("")}
              </select>
            </div>
          </div>
          <div class="form-grid">
            <div>
              <label>${theme.effortLabel}</label>
              <input type="number" name="effort" value="30" min="1" max="480" required>
            </div>
            <div>
              <label>${theme.impactLabel}</label>
              <input type="number" name="impact" value="3" min="1" max="5" required>
            </div>
          </div>
          <label>Notes</label>
          <textarea name="notes"></textarea>
          <div id="form-errors" class="errors"></div>
          <div class="form-actions">
            <button type="submit">Add Item</button>
          </div>
        </form>

        <div class="panel-title" style="margin-top: 2rem"><h2>Data</h2></div>
        <div class="exchange">
          <button class="ghost" id="btn-export-json">JSON</button>
          <button class="ghost" id="btn-export-csv">CSV</button>
          <label class="file">
            Import JSON
            <input type="file" id="file-import" accept=".json">
          </label>
        </div>
      </aside>

      <main>
        <div class="panel">
          <div class="panel-title">
            <h2>Active Plan</h2>
            <div class="filter-group">
              <label class="checkbox-label">
                <input type="checkbox" id="toggle-done">
                <span>Show Completed</span>
              </label>
            </div>
          </div>
          <div id="record-list">
            ${plan.length === 0 ? '<div class="empty">No active tasks planned.</div>' : ''}
            ${plan.map(entry => `
              <div class="record ${entry.item.status === 'done' ? 'is-done' : ''}">
                <div>
                  <div class="badge">${entry.item.category}</div>
                  <h3>${entry.item.title}</h3>
                  <p>${entry.reasons.join(", ")} • Due ${entry.item.dueDate}</p>
                </div>
                <div class="record-actions">
                  <button class="ghost" onclick="editRecord('${entry.item.id}')">Edit</button>
                  <strong>${entry.item.status === 'done' ? '✓' : entry.score}</strong>
                </div>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="week-panel panel">
          <div class="panel-title"><h2>7-Day Forecast</h2></div>
          <div class="week">
            ${schedule.map(day => `
              <div class="day ${day.overloaded ? 'over' : ''}">
                <small>${day.date}</small>
                <strong>${day.used}m</strong>
                <small>${day.entries.length} items</small>
              </div>
            `).join("")}
          </div>
        </div>
      </main>
    </div>
  `;

  setupEventListeners(records);
}

function setupEventListeners(records: readonly LifeRecord[]) {
  const form = document.getElementById("add-form") as HTMLFormElement;
  if (form) {
    form.onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const data = Object.fromEntries(fd.entries());
      
      const record: Partial<LifeRecord> = {
        title: data.title as string,
        category: data.category as string,
        dueDate: data.dueDate as string,
        effort: Number(data.effort),
        impact: Number(data.impact),
      };

      const errors = validateRecord(record, theme);
      if (errors.length > 0) {
        const errDiv = document.getElementById("form-errors");
        if (errDiv) errDiv.textContent = errors[0];
        return;
      }

      store.upsert({
        id: crypto.randomUUID(),
        title: record.title!,
        category: record.category!,
        dueDate: record.dueDate!,
        effort: record.effort!,
        impact: record.impact!,
        status: "planned",
        notes: data.notes as string,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      form.reset();
    };
  }

  document.getElementById("btn-export-json")?.addEventListener("click", () => {
    download("backup.json", exportJson(records), "application/json");
  });

  document.getElementById("btn-export-csv")?.addEventListener("click", () => {
    download("export.csv", exportCsv(records), "text/csv");
  });

  document.getElementById("file-import")?.addEventListener("change", (e) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const content = ev.target?.result as string;
        store.replace(importJson(content, theme));
      } catch (err) {
        alert(err instanceof Error ? err.message : "Import failed");
      }
    };
    reader.readAsText(file);
  });

  document.getElementById("toggle-done")?.addEventListener("change", () => render());
}

(window as any).editRecord = (id: string) => {
  const records = store.all();
  const item = records.find(r => r.id === id);
  if (!item) return;
  const newStatus = item.status === "done" ? "planned" : "done";
  store.upsert({ ...item, status: newStatus, updatedAt: new Date().toISOString() });
};

store.subscribe(render);
