import { theme } from "./theme";
import { RecordStore } from "./core/store";
import { localDay, buildPlan, summarize, suggestDailyLoad, validateRecord } from "./core/planner";
import { exportJson, exportCsv, importJson, download } from "./core/exchange";
import { revisionLedger } from "./generated/revision-ledger";
import type { LifeRecord, ItemStatus, RecurrenceType } from "./types";

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

// State for UI filters
const uiState = {
  showCompleted: false,
  searchQuery: "",
  categoryFilter: "all",
  sortBy: "priority",
  dailyCapacity: 120,
  focusMode: false,
};

function highlightMatch(text: string, query: string): string {
  if (!query) return text;
  const regex = new RegExp(`(${query})`, "gi");
  return text.replace(regex, "<mark class=\"search-highlight\">$1</mark>");
}

function getPriorityColor(score: number): string {
  if (score >= 100) return "#9a3434";
  if (score >= 60) return "#b45309";
  if (score >= 30) return "#176b55";
  return "#668078";
}

function calculateNextDueDate(currentDate: string, recurrence: RecurrenceType): string {
  const date = new Date(`${currentDate}T00:00:00Z`);
  switch (recurrence) {
    case "daily":
      date.setUTCDate(date.getUTCDate() + 1);
      break;
    case "weekly":
      date.setUTCDate(date.getUTCDate() + 7);
      break;
    case "monthly":
      date.setUTCMonth(date.getUTCMonth() + 1);
      break;
    default:
      return currentDate;
  }
  return date.toISOString().slice(0, 10);
}

function render() {
  const records = store.all();
  const today = localDay();
  const plan = buildPlan(records, today);
  const stats = summarize(records, today);
  const schedule = suggestDailyLoad(records, uiState.dailyCapacity, today);

  // Apply filters
  let filteredPlan = plan.filter(entry => {
    const matchesStatus = uiState.showCompleted || entry.item.status !== "done";
    const matchesSearch = entry.item.title.toLowerCase().includes(uiState.searchQuery.toLowerCase()) ||
                          entry.item.category.toLowerCase().includes(uiState.searchQuery.toLowerCase());
    const matchesCategory = uiState.categoryFilter === "all" || entry.item.category === uiState.categoryFilter;
    
    if (uiState.focusMode) {
      return matchesStatus && matchesSearch && matchesCategory && (entry.score >= 60 || entry.daysUntilDue < 0);
    }
    
    return matchesStatus && matchesSearch && matchesCategory;
  });

  // Apply sorting
  if (uiState.sortBy === "date") {
    filteredPlan.sort((a, b) => a.item.dueDate.localeCompare(b.item.dueDate));
  } else if (uiState.sortBy === "title") {
    filteredPlan.sort((a, b) => a.item.title.localeCompare(b.item.title));
  } else {
    filteredPlan.sort((a, b) => {
      if (a.item.pinned !== b.item.pinned) return a.item.pinned ? -1 : 1;
      return b.score - a.score || a.item.dueDate.localeCompare(b.item.dueDate);
    });
  }

  const completionRate = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
  const totalEffortAll = records.reduce((sum, r) => sum + r.effort, 0);
  const effortColor = stats.effort > uiState.dailyCapacity * 3 ? "#9a3434" : (stats.effort > uiState.dailyCapacity ? "#b45309" : "inherit");

  const filteredEffortByCategory: Record<string, number> = {};
  filteredPlan.forEach(entry => {
    if (entry.item.status !== "done") {
      filteredEffortByCategory[entry.item.category] = (filteredEffortByCategory[entry.item.category] ?? 0) + entry.item.effort;
    }
  });

  app.innerHTML = `
    <header class="hero ${uiState.focusMode ? 'is-focus' : ''}">
      <div style="display: flex; gap: 2rem; align-items: end">
        <div>
          <div class="eyebrow">${theme.product} ${uiState.focusMode ? '• Focus Mode' : ''}</div>
          <h1 style="${uiState.focusMode ? 'font-size: 2.5rem' : ''}">${theme.product}</h1>
          <p>${uiState.focusMode ? 'Concentrating on high-priority care items.' : theme.tagline}</p>
        </div>
        <div class="hero-stats">
          <div class="stat-chip"><span>Overdue</span><strong>${stats.overdue}</strong></div>
          <div class="stat-chip"><span>Active</span><strong>${stats.total - stats.completed}</strong></div>
          <div class="stat-chip"><span>Done</span><strong>${stats.completed}</strong></div>
        </div>
      </div>
      <div class="revision">
        <span>Revision</span>
        <strong>${revisionLedger.ordinal}</strong>
        <small>${revisionLedger.day}</small>
      </div>
    </header>

    <div class="summary ${uiState.focusMode ? 'hide-focus' : ''}">
      <article><span>Total</span><strong>${stats.total}</strong></article>
      <article><span>Completed</span><strong>${stats.completed}</strong></article>
      <article><span>Overdue</span><strong>${stats.overdue}</strong></article>
      <article><span>Active Effort</span><strong style="color: ${effortColor}">${stats.effort}m</strong></article>
      <article><span>Global Effort</span><strong>${totalEffortAll}m</strong></article>
    </div>

    <div class="progress-container ${uiState.focusMode ? 'hide-focus' : ''}" style="margin: -1.2rem 0 1.2rem 0">
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width: ${completionRate}%"></div>
        <span class="progress-label">${completionRate}% Completed</span>
      </div>
    </div>

    <div class="layout ${uiState.focusMode ? 'is-focus' : ''}">
      <aside class="panel ${uiState.focusMode ? 'hide-focus' : ''}">
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
          <label>Recurrence</label>
          <select name="recurrence">
            <option value="none">None</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <label style="margin-top: 0.75rem">Notes</label>
          <textarea name="notes"></textarea>
          <div id="form-errors" class="errors"></div>
          <div class="form-actions">
            <button type="submit">Add Item</button>
          </div>
        </form>

        <div class="panel-title" style="margin-top: 1.5rem"><h2>Quick-Add</h2></div>
        <div class="exchange" style="flex-wrap: wrap">
          ${theme.categories.map(c => `<button class="ghost q-add" data-category="${c}">${c}</button>`).join("")}
        </div>
        <div class="exchange" style="flex-wrap: wrap; margin-top: 0.5rem">
          ${theme.templates.map((t, i) => `<button class="ghost q-template" data-index="${i}">${t.title}</button>`).join("")}
        </div>

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
            <h2>${uiState.focusMode ? 'High Priority Focus' : 'Active Plan'}</h2>
            <div class="filter-group">
              <input type="text" id="search-input" placeholder="Search..." value="${uiState.searchQuery}" style="width: 120px; margin-right: 0.5rem">
              <select id="category-filter" style="width: 110px; margin-right: 0.5rem">
                <option value="all" ${uiState.categoryFilter === 'all' ? 'selected' : ''}>All Categories</option>
                ${theme.categories.map(c => `<option value="${c}" ${uiState.categoryFilter === c ? 'selected' : ''}>${c}</option>`).join("")}
              </select>
              <select id="sort-select" style="width: 110px; margin-right: 0.5rem">
                <option value="priority" ${uiState.sortBy === 'priority' ? 'selected' : ''}>Priority</option>
                <option value="date" ${uiState.sortBy === 'date' ? 'selected' : ''}>Date</option>
                <option value="title" ${uiState.sortBy === 'title' ? 'selected' : ''}>Title</option>
              </select>
              <label class="checkbox-label">
                <input type="checkbox" id="toggle-done" ${uiState.showCompleted ? 'checked' : ''}>
                <span>Show Completed</span>
              </label>
              <label class="checkbox-label" style="margin-left: 0.5rem">
                <input type="checkbox" id="toggle-focus" ${uiState.focusMode ? 'checked' : ''}>
                <span style="color: #b45309; font-weight: 800">Focus Mode</span>
              </label>
              ${stats.completed > 0 ? `<button class="ghost danger" id="btn-clear-done" style="font-size: 0.7rem; padding: 0.4rem 0.7rem">Clear Done</button>` : ''}
            </div>
          </div>
          
          <div class="bulk-actions" style="margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center">
            <small style="color: #668078">Showing ${filteredPlan.length} of ${plan.length} active items</small>
            <div style="display: flex; gap: 0.5rem">
              ${filteredPlan.length > 0 && !uiState.showCompleted ? `<button class="ghost" id="btn-bulk-done" style="font-size: 0.7rem; padding: 0.4rem 0.7rem">Mark Filtered as Done</button>` : ''}
              ${stats.overdue > 0 ? `<button class="ghost danger" id="btn-clear-overdue" style="font-size: 0.7rem; padding: 0.4rem 0.7rem">Reset Overdue Dates</button>` : ''}
              ${(stats.completed > 0 || stats.overdue > 0) ? `<button class="ghost" id="btn-quick-reset" style="font-size: 0.7rem; padding: 0.4rem 0.7rem">Quick Reset</button>` : ''}
            </div>
          </div>

          <div id="record-list">
            ${filteredPlan.length === 0 ? '<div class="empty">✨ No items matching filters. <br><small>Time to relax or add a new care item!</small></div>' : ''}
            ${filteredPlan.map(entry => `
              <div class="record ${entry.item.status === 'done' ? 'is-done' : ''} ${entry.daysUntilDue < 0 && entry.item.status !== 'done' ? 'is-overdue' : ''} ${entry.item.pinned ? 'is-pinned' : ''}">
                <div style="flex: 1">
                  <div class="badge-group">
                    <div class="badge">${highlightMatch(entry.item.category, uiState.searchQuery)}</div>
                    <div class="badge status-${entry.item.status}">${entry.item.status.charAt(0).toUpperCase() + entry.item.status.slice(1)}</div>
                    ${entry.item.pinned ? '<div class="badge is-pinned">📍 Pinned</div>' : ''}
                    ${entry.daysUntilDue < 0 && entry.item.status !== 'done' ? '<div class="badge is-urgency">🔥 Urgent</div>' : ''}
                    ${entry.item.recurrence && entry.item.recurrence !== 'none' ? `<div class="badge">🔄 ${entry.item.recurrence}</div>` : ''}
                  </div>
                  <h3 style="margin-top: 0.4rem">${highlightMatch(entry.item.title, uiState.searchQuery)}</h3>
                  <p>${entry.reasons.join(", ")} • Due ${entry.item.dueDate}</p>
                </div>
                <div class="record-actions">
                  <div class="actions-inner">
                    <button class="ghost" onclick="togglePin('${entry.item.id}')" title="Pin to Top">${entry.item.pinned ? '📍' : '📌'}</button>
                    <button class="ghost" onclick="duplicateRecord('${entry.item.id}')">Clone</button>
                    <button class="ghost" onclick="editRecord('${entry.item.id}')">Edit</button>
                    <button class="ghost danger" onclick="deleteRecord('${entry.item.id}')">Delete</button>
                  </div>
                  <button class="status-toggle" onclick="toggleStatus('${entry.item.id}')" style="color: ${getPriorityColor(entry.score)}" title="Cycle Status (Enter)">${entry.item.status === 'done' ? '✓' : (entry.item.status === 'active' ? '⚡' : entry.score)}</button>
                </div>
              </div>
            `).join("")}
          </div>
          
          ${Object.keys(filteredEffortByCategory).length > 0 ? `
            <div class="category-breakdown">
              ${Object.entries(filteredEffortByCategory).map(([cat, eff]) => `
                <div class="breakdown-item">
                  <span>${cat}</span>
                  <strong>${eff}m</strong>
                </div>
              `).join("")}
            </div>
          ` : ''}

          ${records.length > 0 ? `<div style="margin-top: 1.5rem; text-align: right"><button class="ghost danger" id="btn-clear-all" style="font-size: 0.7rem; padding: 0.4rem 0.7rem">Clear All Records</button></div>` : ''}
        </div>

        <div class="week-panel panel ${uiState.focusMode ? 'hide-focus' : ''}">
          <div class="panel-title">
            <h2>7-Day Forecast</h2>
            <div class="filter-group" style="font-size: 0.8rem">
              <label style="margin: 0; white-space: nowrap">Daily Capacity (m):</label>
              <input type="number" id="capacity-input" value="${uiState.dailyCapacity}" style="width: 60px; padding: 0.2rem">
            </div>
          </div>
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

    <div id="edit-modal" class="modal" style="display: none">
      <div class="modal-content">
        <h2>Edit ${theme.itemLabel}</h2>
        <form id="edit-form">
          <input type="hidden" name="id">
          <label>${theme.itemLabel}</label>
          <input type="text" name="title" required>
          <div class="form-grid">
            <div>
              <label>${theme.dateLabel}</label>
              <input type="date" name="dueDate" required>
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
              <input type="number" name="effort" min="1" max="480" required>
            </div>
            <div>
              <label>${theme.impactLabel}</label>
              <input type="number" name="impact" min="1" max="5" required>
            </div>
          </div>
          <label>Status</label>
          <select name="status">
            <option value="planned">Planned</option>
            <option value="active">Active</option>
            <option value="done">Done</option>
          </select>
          <label style="margin-top: 0.75rem">Recurrence</label>
          <select name="recurrence">
            <option value="none">None</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <label style="margin-top: 0.75rem">Notes</label>
          <textarea name="notes"></textarea>
          <div id="edit-form-errors" class="errors"></div>
          <div class="form-actions">
            <button type="submit">Save Changes</button>
            <button type="button" class="ghost" onclick="duplicateFromEdit()">Duplicate</button>
            <button type="button" class="ghost" onclick="closeModal()">Cancel</button>
          </div>
        </form>
      </div>
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
        recurrence: data.recurrence as RecurrenceType,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      form.reset();
    };
  }

  document.querySelectorAll(".q-add").forEach(btn => {
    btn.addEventListener("click", () => {
      const category = (btn as HTMLElement).dataset.category;
      if (!category) return;
      const title = prompt(`Quick add ${theme.itemLabel} for ${category}:`);
      if (!title?.trim()) return;
      
      store.upsert({
        id: crypto.randomUUID(),
        title: title.trim(),
        category: category,
        dueDate: localDay(),
        effort: 30,
        impact: 3,
        status: "planned",
        notes: "Quickly added",
        recurrence: "none",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });
  });

  document.querySelectorAll(".q-template").forEach(btn => {
    btn.addEventListener("click", () => {
      const index = parseInt((btn as HTMLElement).dataset.index || "0");
      const template = theme.templates[index];
      if (!template) return;
      
      store.upsert({
        id: crypto.randomUUID(),
        title: template.title,
        category: template.category,
        dueDate: localDay(),
        effort: template.effort,
        impact: template.impact,
        status: "planned",
        notes: "Added from template",
        recurrence: template.recurrence || "none",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });
  });

  const editForm = document.getElementById("edit-form") as HTMLFormElement;
  if (editForm) {
    editForm.onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(editForm);
      const data = Object.fromEntries(fd.entries());
      const id = data.id as string;
      
      const records = store.all();
      const original = records.find(r => r.id === id);
      if (!original) return;

      const record: Partial<LifeRecord> = {
        title: data.title as string,
        category: data.category as string,
        dueDate: data.dueDate as string,
        effort: Number(data.effort),
        impact: Number(data.impact),
      };

      const errors = validateRecord(record, theme);
      if (errors.length > 0) {
        const errDiv = document.getElementById("edit-form-errors");
        if (errDiv) errDiv.textContent = errors[0];
        return;
      }

      store.upsert({
        ...original,
        title: record.title!,
        category: record.category!,
        dueDate: record.dueDate!,
        effort: record.effort!,
        impact: record.impact!,
        status: data.status as ItemStatus,
        recurrence: data.recurrence as RecurrenceType,
        notes: data.notes as string,
        updatedAt: new Date().toISOString(),
      });
      closeModal();
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

  document.getElementById("toggle-done")?.addEventListener("change", (e) => {
    uiState.showCompleted = (e.target as HTMLInputElement).checked;
    render();
  });

  document.getElementById("toggle-focus")?.addEventListener("change", (e) => {
    uiState.focusMode = (e.target as HTMLInputElement).checked;
    render();
  });

  document.getElementById("search-input")?.addEventListener("input", (e) => {
    uiState.searchQuery = (e.target as HTMLInputElement).value;
    render();
  });

  document.getElementById("category-filter")?.addEventListener("change", (e) => {
    uiState.categoryFilter = (e.target as HTMLSelectElement).value;
    render();
  });

  document.getElementById("sort-select")?.addEventListener("change", (e) => {
    uiState.sortBy = (e.target as HTMLSelectElement).value;
    render();
  });

  document.getElementById("capacity-input")?.addEventListener("input", (e) => {
    const val = parseInt((e.target as HTMLInputElement).value);
    uiState.dailyCapacity = isNaN(val) ? 120 : Math.max(1, val);
    render();
  });

  document.getElementById("btn-clear-done")?.addEventListener("click", () => {
    if (confirm("Permanently delete all completed items?")) {
      const remaining = records.filter(r => r.status !== "done");
      store.replace(remaining);
    }
  });

  document.getElementById("btn-clear-all")?.addEventListener("click", () => {
    if (confirm("Permanently delete ALL care items? This cannot be undone.")) {
      const confirmation = prompt("To confirm, please type 'DELETE ALL' below:");
      if (confirmation === "DELETE ALL") {
        store.replace([]);
      } else {
        alert("Deletion cancelled. Confirmation text did not match.");
      }
    }
  });

  document.getElementById("btn-bulk-done")?.addEventListener("click", () => {
    const today = localDay();
    const plan = buildPlan(records, today);
    const filteredItems = plan.filter(entry => {
      const matchesStatus = uiState.showCompleted || entry.item.status !== "done";
      const matchesSearch = entry.item.title.toLowerCase().includes(uiState.searchQuery.toLowerCase()) ||
                            entry.item.category.toLowerCase().includes(uiState.searchQuery.toLowerCase());
      const matchesCategory = uiState.categoryFilter === "all" || entry.item.category === uiState.categoryFilter;
      return matchesStatus && matchesSearch && matchesCategory;
    }).map(e => e.item);

    if (filteredItems.length === 0) return;

    if (confirm(`Mark ${filteredItems.length} item(s) as done?`)) {
      const all = store.all();
      const idsToMark = new Set(filteredItems.map(i => i.id));
      const updated: LifeRecord[] = [];
      const newItems: LifeRecord[] = [];

      all.forEach(item => {
        if (idsToMark.has(item.id)) {
          const doneItem = { ...item, status: "done" as ItemStatus, updatedAt: new Date().toISOString() };
          updated.push(doneItem);
          if (item.recurrence && item.recurrence !== "none") {
            newItems.push({
              ...item,
              id: crypto.randomUUID(),
              dueDate: calculateNextDueDate(item.dueDate, item.recurrence),
              status: "planned" as ItemStatus,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }
        } else {
          updated.push(item);
        }
      });
      store.replace([...updated, ...newItems]);
    }
  });

  document.getElementById("btn-clear-overdue")?.addEventListener("click", () => {
    const today = localDay();
    const all = store.all();
    const overdueItems = all.filter(r => r.status !== "done" && r.dueDate < today);
    
    if (overdueItems.length === 0) return;

    if (confirm(`Move ${overdueItems.length} overdue item(s) to today?`)) {
      const updated = all.map(item => 
        (item.status !== "done" && item.dueDate < today) 
          ? { ...item, dueDate: today, updatedAt: new Date().toISOString() } 
          : item
      );
      store.replace(updated);
    }
  });

  document.getElementById("btn-quick-reset")?.addEventListener("click", () => {
    const today = localDay();
    if (confirm("Quick Reset: Clear all completed items and move all overdue items to today?")) {
      const all = store.all();
      const updated = all
        .filter(r => r.status !== "done")
        .map(item => 
          (item.dueDate < today) 
            ? { ...item, dueDate: today, updatedAt: new Date().toISOString() } 
            : item
        );
      store.replace(updated);
    }
  });
}

(window as any).editRecord = (id: string) => {
  const records = store.all();
  const item = records.find(r => r.id === id);
  if (!item) return;
  
  const modal = document.getElementById("edit-modal");
  const form = document.getElementById("edit-form") as HTMLFormElement;
  if (!modal || !form) return;

  (form.elements.namedItem("id") as HTMLInputElement).value = item.id;
  (form.elements.namedItem("title") as HTMLInputElement).value = item.title;
  (form.elements.namedItem("dueDate") as HTMLInputElement).value = item.dueDate;
  (form.elements.namedItem("category") as HTMLSelectElement).value = item.category;
  (form.elements.namedItem("effort") as HTMLInputElement).value = String(item.effort);
  (form.elements.namedItem("impact") as HTMLInputElement).value = String(item.impact);
  (form.elements.namedItem("status") as HTMLSelectElement).value = item.status;
  (form.elements.namedItem("recurrence") as HTMLSelectElement).value = item.recurrence || "none";
  (form.elements.namedItem("notes") as HTMLTextAreaElement).value = item.notes;

  modal.style.display = "flex";
  (form.elements.namedItem("title") as HTMLInputElement).focus();
};

(window as any).closeModal = () => {
  const modal = document.getElementById("edit-modal");
  if (modal) modal.style.display = "none";
};

(window as any).toggleStatus = (id: string) => {
  const records = store.all();
  const item = records.find(r => r.id === id);
  if (!item) return;
  
  const statusCycle: Record<ItemStatus, ItemStatus> = {
    planned: "active",
    active: "done",
    done: "planned",
  };
  
  const newStatus = statusCycle[item.status];
  
  if (newStatus === "done" && item.recurrence && item.recurrence !== "none") {
    const nextDate = calculateNextDueDate(item.dueDate, item.recurrence);
    store.upsert({ ...item, status: "done", updatedAt: new Date().toISOString() });
    store.upsert({
      ...item,
      id: crypto.randomUUID(),
      dueDate: nextDate,
      status: "planned",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } else {
    store.upsert({ ...item, status: newStatus, updatedAt: new Date().toISOString() });
  }
};

(window as any).togglePin = (id: string) => {
  const records = store.all();
  const item = records.find(r => r.id === id);
  if (!item) return;
  
  store.upsert({ ...item, pinned: !item.pinned, updatedAt: new Date().toISOString() });
};

(window as any).deleteRecord = (id: string) => {
  const records = store.all();
  const item = records.find(r => r.id === id);
  if (!item) return;

  if (confirm(`Are you sure you want to delete "${item.title}"?`)) {
    store.remove(id);
  }
};

(window as any).duplicateRecord = (id: string) => {
  const records = store.all();
  const item = records.find(r => r.id === id);
  if (!item) return;

  store.upsert({
    ...item,
    id: crypto.randomUUID(),
    title: `${item.title} (Copy)`,
    status: "planned",
    pinned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
};

(window as any).duplicateFromEdit = () => {
  const form = document.getElementById("edit-form") as HTMLFormElement;
  if (!form) return;
  const id = (form.elements.namedItem("id") as HTMLInputElement).value;
  if (!id) return;
  
  const records = store.all();
  const item = records.find(r => r.id === id);
  if (!item) return;

  store.upsert({
    ...item,
    id: crypto.randomUUID(),
    title: `${item.title} (Copy)`,
    status: "planned",
    pinned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  
  closeModal();
};

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
  if (e.key === "n" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
    e.preventDefault();
    const titleInput = document.querySelector("#add-form input[name='title']") as HTMLInputElement;
    if (titleInput) titleInput.focus();
  }
});

store.subscribe(render);
