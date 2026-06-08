/* global FocusKitEisenhowerState, requestAnimationFrame, cancelAnimationFrame */
// eisenhower.js - FocusKit Eisenhower Matrix tool popup UI.

const eisenhowerStateHelpers =
  typeof FocusKitEisenhowerState !== "undefined"
    ? FocusKitEisenhowerState
    : require("./eisenhowerState.js");

const {
  EISENHOWER_STORAGE_KEY,
  TASK_SIZES,
  createTask,
  isValidTask,
  validateDueDate,
  addTask,
  removeTask,
  updateTask,
  moveTask,
  toggleTaskExpanded,
  sortTasks,
  getBacklogTasks,
  getQuadrantTasks,
} = eisenhowerStateHelpers;

// Mutable popup session state.
let eisenhowerTasks = [];
let sortField = "name";
let sortAscending = true;
let autoScrollRafId = null;

const QUADRANT_META = {
  q1: { title: "Do First", hint: "Urgent & Important" },
  q2: { title: "Schedule", hint: "Important, Not Urgent" },
  q3: { title: "Delegate", hint: "Urgent, Not Important" },
  q4: { title: "Eliminate", hint: "Not Urgent or Important" },
};

// Open the Eisenhower panel.
function openEisenhowerPanel() {
  const toolsList = document.getElementById("toolsList");
  const panel = getEisenhowerPanel();
  toolsList.hidden = true;
  panel.hidden = false;
  loadEisenhowerTasks();
}

// Close the panel and return to tools list.
function closeEisenhowerPanel() {
  stopAutoScroll();
  document.getElementById("eisenhowerPanel").hidden = true;
  document.getElementById("toolsList").hidden = false;
}

// Lazily create the panel.
function getEisenhowerPanel() {
  let panel = document.getElementById("eisenhowerPanel");
  if (panel) return panel;

  panel = document.createElement("div");
  panel.id = "eisenhowerPanel";
  panel.className = "eisenhower-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="eisenhower-header">
      <div>
        <p class="section-label">EISENHOWER</p>
        <h2 class="eisenhower-title">Prioritize Tasks</h2>
      </div>
      <button class="eisenhower-close" type="button" id="eisenhowerClose">Close</button>
    </div>

    <div class="eisenhower-matrix-wrap">
      <!-- Vertical axis label: Importance -->

      <div class="eisenhower-grid" id="eisenhowerGrid">
        <!-- Horizontal axis labels: Urgency -->
        <div class="eisenhower-axis eisenhower-axis-top">Urgent</div>
        <div class="eisenhower-axis eisenhower-axis-top">Not Urgent</div>
        <div class="eisenhower-quadrant" data-quadrant="q1"></div>
        <div class="eisenhower-quadrant" data-quadrant="q2"></div>
        <div class="eisenhower-quadrant" data-quadrant="q3"></div>
        <div class="eisenhower-quadrant" data-quadrant="q4"></div>
      </div>
    </div>

    <div class="eisenhower-backlog-section">
      <div class="eisenhower-backlog-controls">
        <span class="eisenhower-backlog-label">Backlog</span>
        <div class="eisenhower-sort">
          <select id="eisenhowerSortField" class="eisenhower-select" aria-label="Sort field">
            <option value="name">Name</option>
            <option value="dueDate">Due date</option>
            <option value="size">Size</option>
          </select>
          <button class="eisenhower-sort-dir" type="button" id="eisenhowerSortDir" aria-label="Toggle sort direction">↑</button>
        </div>
      </div>
      <div class="eisenhower-backlog" id="eisenhowerBacklog" data-quadrant="backlog"></div>
      <button class="eisenhower-add-btn" type="button" id="eisenhowerAddBtn">+ Add task</button>
    </div>
  `;

  document.getElementById("tab-tools").appendChild(panel);

  panel.querySelector("#eisenhowerClose").addEventListener("click", closeEisenhowerPanel);
  panel.querySelector("#eisenhowerAddBtn").addEventListener("click", () => openTaskForm(null));
  panel.querySelector("#eisenhowerSortField").addEventListener("change", handleSortFieldChange);
  panel.querySelector("#eisenhowerSortDir").addEventListener("click", handleSortDirToggle);

  panel.querySelectorAll("[data-quadrant]").forEach((zone) => {
    zone.addEventListener("dragover", handleDragOver);
    zone.addEventListener("drop", handleDrop);
    zone.addEventListener("dragleave", handleDragLeave);
  });

  return panel;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function loadEisenhowerTasks() {
  chrome.storage.local.get([EISENHOWER_STORAGE_KEY], (data) => {
    const stored = data[EISENHOWER_STORAGE_KEY];
    eisenhowerTasks = Array.isArray(stored) ? stored : [];
    renderEisenhower();
  });
}

function persistEisenhowerTasks() {
  chrome.storage.local.set({ [EISENHOWER_STORAGE_KEY]: eisenhowerTasks });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderEisenhower() {
  getEisenhowerPanel();

  ["q1", "q2", "q3", "q4"].forEach((quadrant) => {
    const zone = document.querySelector(`[data-quadrant="${quadrant}"]`);
    zone.replaceChildren();

    const label = document.createElement("div");
    label.className = "eisenhower-quadrant-label";
    label.textContent = QUADRANT_META[quadrant].title;
    zone.appendChild(label);

    getQuadrantTasks(eisenhowerTasks, quadrant).forEach((task) => {
      zone.appendChild(buildTaskCard(task));
    });
  });

  const backlog = document.getElementById("eisenhowerBacklog");
  backlog.replaceChildren();

  const sorted = sortTasks(getBacklogTasks(eisenhowerTasks), sortField, sortAscending);

  if (sorted.length === 0) {
    const empty = document.createElement("p");
    empty.className = "eisenhower-empty";
    empty.textContent = "No tasks yet. Add one to get started.";
    backlog.appendChild(empty);
  } else {
    sorted.forEach((task) => backlog.appendChild(buildTaskCard(task)));
  }
}

// Build a draggable task card with edit button for backlog tasks.
function buildTaskCard(task) {
  const card = document.createElement("div");
  card.className = "eisenhower-task";
  card.draggable = true;
  card.dataset.taskId = task.id;

  card.addEventListener("dragstart", handleDragStart);
  card.addEventListener("dragend", handleDragEnd);

  const topRow = document.createElement("div");
  topRow.className = "eisenhower-task-top";

  const name = document.createElement("span");
  name.className = "eisenhower-task-name";
  name.textContent = task.name;

  const meta = document.createElement("div");
  meta.className = "eisenhower-task-meta";

  const size = document.createElement("span");
  size.className = "eisenhower-task-size";
  size.textContent = task.size;
  meta.appendChild(size);

  if (task.dueDate) {
    const due = document.createElement("span");
    due.className = "eisenhower-task-due";
    due.textContent = task.dueDate;
    meta.appendChild(due);
  }

  // Edit button - only shown for backlog tasks
  if (task.location === "backlog") {
    const editBtn = document.createElement("button");
    editBtn.className = "eisenhower-task-edit";
    editBtn.type = "button";
    editBtn.textContent = "✎";
    editBtn.setAttribute("aria-label", `Edit ${task.name}`);
    editBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      openTaskForm(task);
    });
    meta.appendChild(editBtn);
  }

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "eisenhower-task-delete";
  deleteBtn.type = "button";
  deleteBtn.textContent = "×";
  deleteBtn.setAttribute("aria-label", `Delete ${task.name}`);
  deleteBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    eisenhowerTasks = removeTask(eisenhowerTasks, task.id);
    persistEisenhowerTasks();
    renderEisenhower();
  });
  meta.appendChild(deleteBtn);

  topRow.append(name, meta);
  card.appendChild(topRow);

  if (task.description) {
    const showMore = document.createElement("button");
    showMore.className = "eisenhower-task-showmore";
    showMore.type = "button";
    showMore.textContent = task.expanded ? "Show less" : "Show more";
    showMore.addEventListener("click", (event) => {
      event.stopPropagation();
      eisenhowerTasks = toggleTaskExpanded(eisenhowerTasks, task.id);
      persistEisenhowerTasks();
      renderEisenhower();
    });
    card.appendChild(showMore);

    if (task.expanded) {
      const desc = document.createElement("p");
      desc.className = "eisenhower-task-desc";
      desc.textContent = task.description;
      card.appendChild(desc);
    }
  }

  return card;
}

// ---------------------------------------------------------------------------
// Drag and drop
// ---------------------------------------------------------------------------

function handleDragStart(event) {
  event.dataTransfer.setData("text/plain", event.currentTarget.dataset.taskId);
  event.currentTarget.classList.add("dragging");
  document.addEventListener("dragover", handleAutoScroll);
}

function handleDragEnd(event) {
  event.currentTarget.classList.remove("dragging");
  document.removeEventListener("dragover", handleAutoScroll);
  stopAutoScroll();
}

function handleDragOver(event) {
  event.preventDefault();
  event.currentTarget.classList.add("drop-active");
}

function handleDragLeave(event) {
  event.currentTarget.classList.remove("drop-active");
}

function handleDrop(event) {
  event.preventDefault();
  event.currentTarget.classList.remove("drop-active");

  const taskId = event.dataTransfer.getData("text/plain");
  const location = event.currentTarget.dataset.quadrant;

  if (taskId && location) {
    eisenhowerTasks = moveTask(eisenhowerTasks, taskId, location);
    persistEisenhowerTasks();
    renderEisenhower();
  }
}

function handleAutoScroll(event) {
  const threshold = 60;
  const speed = 8;
  const viewportHeight = window.innerHeight;
  const y = event.clientY;

  let direction = 0;
  if (y < threshold) direction = -1;
  else if (y > viewportHeight - threshold) direction = 1;

  if (direction === 0) { stopAutoScroll(); return; }
  if (autoScrollRafId) return;

  const step = () => {
    window.scrollBy(0, direction * speed);
    autoScrollRafId = requestAnimationFrame(step);
  };
  autoScrollRafId = requestAnimationFrame(step);
}

function stopAutoScroll() {
  if (autoScrollRafId) {
    cancelAnimationFrame(autoScrollRafId);
    autoScrollRafId = null;
  }
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

function handleSortFieldChange(event) {
  sortField = event.currentTarget.value;
  renderEisenhower();
}

function handleSortDirToggle(event) {
  sortAscending = !sortAscending;
  event.currentTarget.textContent = sortAscending ? "↑" : "↓";
  renderEisenhower();
}

// ---------------------------------------------------------------------------
// Task form (create + edit)
// ---------------------------------------------------------------------------

// Opens the form. Pass null to create a new task, or a task object to edit.
function openTaskForm(existingTask) {
  const existing = document.getElementById("eisenhowerTaskForm");
  if (existing) existing.remove();

  const isEditing = existingTask !== null;

  const overlay = document.createElement("div");
  overlay.id = "eisenhowerTaskForm";
  overlay.className = "eisenhower-form-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", isEditing ? "Edit task" : "New task");

  const form = document.createElement("div");
  form.className = "eisenhower-form";

  const title = document.createElement("div");
  title.className = "eisenhower-form-title";
  title.textContent = isEditing ? "Edit task" : "New task";

  const nameInput = document.createElement("input");
  nameInput.className = "eisenhower-form-input";
  nameInput.type = "text";
  nameInput.maxLength = 60;
  nameInput.placeholder = "Task name";
  nameInput.setAttribute("aria-label", "Task name");
  if (isEditing) nameInput.value = existingTask.name;

  const descInput = document.createElement("textarea");
  descInput.className = "eisenhower-form-input eisenhower-form-textarea";
  descInput.maxLength = 300;
  descInput.placeholder = "Description (optional)";
  descInput.setAttribute("aria-label", "Task description");
  if (isEditing) descInput.value = existingTask.description;

  const dueInput = document.createElement("input");
  dueInput.className = "eisenhower-form-input";
  dueInput.type = "date";
  dueInput.setAttribute("aria-label", "Due date");
  if (isEditing) dueInput.value = existingTask.dueDate;

  // Warn user if they pick a past date
  const dueDateWarning = document.createElement("p");
  dueDateWarning.className = "eisenhower-form-warning";
  dueDateWarning.hidden = true;
  dueDateWarning.textContent = "⚠ Due date cannot be in the past.";

  dueInput.addEventListener("change", () => {
    const warning = validateDueDate(dueInput.value);
    dueDateWarning.hidden = !warning;
  });

  const sizeSelect = document.createElement("select");
  sizeSelect.className = "eisenhower-form-input";
  sizeSelect.setAttribute("aria-label", "Task size");
  TASK_SIZES.forEach((size) => {
    const option = document.createElement("option");
    option.value = size;
    option.textContent = size;
    sizeSelect.appendChild(option);
  });
  sizeSelect.value = isEditing ? existingTask.size : "M";

  // ---------------------------------------------------------------------------
  // Reminders section
  // ---------------------------------------------------------------------------
  const remindersLabel = document.createElement("p");
  remindersLabel.className = "eisenhower-form-section-label";
  remindersLabel.textContent = "Reminders";

  const remindersList = document.createElement("div");
  remindersList.className = "eisenhower-reminders-list";
  remindersList.id = "eisenhowerRemindersList";

  // Populate existing reminders if editing
  const initialReminders = isEditing ? [...existingTask.reminders] : [];
  initialReminders.forEach((r) => addReminderRow(remindersList, r.minutesBefore));

  const addReminderBtn = document.createElement("button");
  addReminderBtn.className = "eisenhower-add-reminder-btn";
  addReminderBtn.type = "button";
  addReminderBtn.textContent = "+ Add reminder";
  addReminderBtn.addEventListener("click", () => addReminderRow(remindersList, 60));

  // ---------------------------------------------------------------------------
  // Save / Cancel
  // ---------------------------------------------------------------------------
  const error = document.createElement("p");
  error.className = "eisenhower-form-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const buttons = document.createElement("div");
  buttons.className = "eisenhower-form-buttons";

  const saveBtn = document.createElement("button");
  saveBtn.className = "eisenhower-form-save";
  saveBtn.type = "button";
  saveBtn.textContent = isEditing ? "Save" : "Add";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "eisenhower-form-cancel";
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => overlay.remove());

  saveBtn.addEventListener("click", () => {
    const fields = {
      name: nameInput.value,
      description: descInput.value,
      dueDate: dueInput.value,
      size: sizeSelect.value,
      reminders: collectReminders(remindersList),
    };

    if (!isValidTask(fields)) {
      error.textContent = "Task name is required.";
      error.hidden = false;
      nameInput.focus();
      return;
    }

    const dueDateError = validateDueDate(fields.dueDate);
    if (dueDateError) {
      error.textContent = dueDateError;
      error.hidden = false;
      return;
    }

    if (isEditing) {
      eisenhowerTasks = updateTask(eisenhowerTasks, existingTask.id, fields);
    } else {
      const task = createTask(fields);
      eisenhowerTasks = addTask(eisenhowerTasks, task);
    }

    persistEisenhowerTasks();
    overlay.remove();
    renderEisenhower();
  });

  buttons.append(saveBtn, cancelBtn);
  form.append(
    title,
    nameInput,
    descInput,
    dueInput,
    dueDateWarning,
    sizeSelect,
    remindersLabel,
    remindersList,
    addReminderBtn,
    error,
    buttons
  );
  overlay.appendChild(form);
  document.getElementById("tab-tools").appendChild(overlay);
  nameInput.focus();
}

// Add a single reminder row with a minutes-before input and remove button.
function addReminderRow(container, minutesBefore = 60) {
  const row = document.createElement("div");
  row.className = "eisenhower-reminder-row";

  const input = document.createElement("input");
  input.className = "eisenhower-reminder-input";
  input.type = "number";
  input.min = "1";
  input.max = "43200";
  input.value = minutesBefore;
  input.setAttribute("aria-label", "Minutes before due date");

  const label = document.createElement("span");
  label.className = "eisenhower-reminder-label";
  label.textContent = "min before due";

  const removeBtn = document.createElement("button");
  removeBtn.className = "eisenhower-reminder-remove";
  removeBtn.type = "button";
  removeBtn.textContent = "×";
  removeBtn.setAttribute("aria-label", "Remove reminder");
  removeBtn.addEventListener("click", () => row.remove());

  row.append(input, label, removeBtn);
  container.appendChild(row);
}

// Collect all reminder values from the reminders list.
function collectReminders(container) {
  const rows = container.querySelectorAll(".eisenhower-reminder-row");
  const reminders = [];
  rows.forEach((row) => {
    const val = parseInt(row.querySelector(".eisenhower-reminder-input").value, 10);
    if (!isNaN(val) && val > 0) {
      reminders.push({ minutesBefore: val });
    }
  });
  return reminders;
}

// Expose the launcher for tools.js in the browser runtime.
if (typeof window !== "undefined") {
  window.FocusKitEisenhower = {
    open: openEisenhowerPanel,
  };
}

// Export pure helpers for Jest.
if (typeof module !== "undefined") {
  module.exports = eisenhowerStateHelpers;
}

// ---------------------------------------------------------------------------
// CSS for new Eisenhower features - injected at runtime to keep styles
// scoped to the Eisenhower panel without touching popup.css
// ---------------------------------------------------------------------------
(function injectEisenhowerStyles() {
  if (document.getElementById("eisenhowerDynamicStyles")) return;

  const style = document.createElement("style");
  style.id = "eisenhowerDynamicStyles";
  style.textContent = `
    /* Vertical axis label */
    .eisenhower-matrix-wrap {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .eisenhower-axis-y {
      display: flex;
      align-items: center;
      justify-content: center;
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      font-size: 9px;
      letter-spacing: 0.08em;
      color: var(--muted);
      text-transform: uppercase;
      min-width: 14px;
      height: 100%;
    }

    /* Edit button on task cards */
    .eisenhower-task-edit {
      background: transparent;
      border: none;
      color: var(--muted);
      cursor: pointer;
      font-size: 13px;
      padding: 0 3px;
      transition: color 0.15s;
    }

    .eisenhower-task-edit:hover {
      color: var(--accent2);
    }

    /* Due date warning */
    .eisenhower-form-warning {
      font-size: 11px;
      color: #f59e0b;
      margin-top: -4px;
    }

    /* Reminders section */
    .eisenhower-form-section-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin-top: 4px;
    }

    .eisenhower-reminders-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .eisenhower-reminder-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .eisenhower-reminder-input {
      width: 70px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-family: "Sora", sans-serif;
      font-size: 12px;
      padding: 4px 8px;
      outline: none;
    }

    .eisenhower-reminder-label {
      font-size: 12px;
      color: var(--muted);
      flex: 1;
    }

    .eisenhower-reminder-remove {
      background: transparent;
      border: none;
      color: var(--muted);
      cursor: pointer;
      font-size: 16px;
      padding: 0 4px;
      transition: color 0.15s;
    }

    .eisenhower-reminder-remove:hover {
      color: var(--danger);
    }

    .eisenhower-add-reminder-btn {
      background: transparent;
      border: 1px dashed var(--border);
      border-radius: 6px;
      color: var(--muted);
      font-family: "Sora", sans-serif;
      font-size: 12px;
      padding: 6px 10px;
      cursor: pointer;
      transition: color 0.15s, border-color 0.15s;
      text-align: left;
    }

    .eisenhower-add-reminder-btn:hover {
      color: var(--text);
      border-color: var(--accent);
    }
  `;

  document.head.appendChild(style);
})();