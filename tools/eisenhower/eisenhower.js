// eisenhower.js - FocusKit Eisenhower Matrix tool popup UI.
// Mirrors the Pomodoro panel pattern: lazily build a panel, swap it in over the
// tools list, persist all state to chrome.storage, and keep pure logic separate.

const eisenhowerStateHelpers =
  typeof FocusKitEisenhowerState !== "undefined"
    ? FocusKitEisenhowerState
    : require("./eisenhowerState.js");

const {
  EISENHOWER_STORAGE_KEY,
  TASK_SIZES,
  BACKLOG,
  createTask,
  isValidTask,
  addTask,
  removeTask,
  moveTask,
  toggleTaskExpanded,
  sortTasks,
  getBacklogTasks,
  getQuadrantTasks,
} = eisenhowerStateHelpers;

// Mutable popup session state. Persisted to storage after each change.
let eisenhowerTasks = [];
let sortField = "name";
let sortAscending = true;
let autoScrollRafId = null;

// Labels and helper copy for each quadrant of the matrix.
const QUADRANT_META = {
  q1: { title: "Do First", hint: "Urgent & Important" },
  q2: { title: "Schedule", hint: "Important, Not Urgent" },
  q3: { title: "Delegate", hint: "Urgent, Not Important" },
  q4: { title: "Eliminate", hint: "Not Urgent or Important" },
};

// Swap the Tools list for the Eisenhower panel and load saved tasks.
function openEisenhowerPanel() {
  const toolsList = document.getElementById("toolsList");
  const panel = getEisenhowerPanel();

  toolsList.hidden = true;
  panel.hidden = false;
  loadEisenhowerTasks();
}

// Hide the panel and return to the tools list.
function closeEisenhowerPanel() {
  stopAutoScroll();
  document.getElementById("eisenhowerPanel").hidden = true;
  document.getElementById("toolsList").hidden = false;
}

// Lazily create the panel the first time the tool is launched.
function getEisenhowerPanel() {
  let panel = document.getElementById("eisenhowerPanel");

  if (panel) {
    return panel;
  }

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

    <div class="eisenhower-grid" id="eisenhowerGrid">
      <div class="eisenhower-axis eisenhower-axis-top">Urgent</div>
      <div class="eisenhower-axis eisenhower-axis-top">Not Urgent</div>
      <div class="eisenhower-quadrant" data-quadrant="q1"></div>
      <div class="eisenhower-quadrant" data-quadrant="q2"></div>
      <div class="eisenhower-quadrant" data-quadrant="q3"></div>
      <div class="eisenhower-quadrant" data-quadrant="q4"></div>
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

  panel
    .querySelector("#eisenhowerClose")
    .addEventListener("click", closeEisenhowerPanel);
  panel
    .querySelector("#eisenhowerAddBtn")
    .addEventListener("click", openTaskForm);
  panel
    .querySelector("#eisenhowerSortField")
    .addEventListener("change", handleSortFieldChange);
  panel
    .querySelector("#eisenhowerSortDir")
    .addEventListener("click", handleSortDirToggle);

  // Wire each quadrant and the backlog as drop targets.
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

// Load saved tasks from storage and render. Defaults to an empty list.
function loadEisenhowerTasks() {
  chrome.storage.local.get([EISENHOWER_STORAGE_KEY], (data) => {
    const stored = data[EISENHOWER_STORAGE_KEY];
    eisenhowerTasks = Array.isArray(stored) ? stored : [];
    renderEisenhower();
  });
}

// Persist the full task list to storage.
function persistEisenhowerTasks() {
  chrome.storage.local.set({ [EISENHOWER_STORAGE_KEY]: eisenhowerTasks });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// Render both the matrix quadrants and the backlog from current state.
function renderEisenhower() {
  getEisenhowerPanel();

  // Render each quadrant.
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

  // Render the backlog with current sort applied.
  const backlog = document.getElementById("eisenhowerBacklog");
  backlog.replaceChildren();

  const sorted = sortTasks(
    getBacklogTasks(eisenhowerTasks),
    sortField,
    sortAscending
  );

  if (sorted.length === 0) {
    const empty = document.createElement("p");
    empty.className = "eisenhower-empty";
    empty.textContent = "No tasks yet. Add one to get started.";
    backlog.appendChild(empty);
  } else {
    sorted.forEach((task) => backlog.appendChild(buildTaskCard(task)));
  }
}

// Build a draggable task card with optional expandable description.
function buildTaskCard(task) {
  const card = document.createElement("div");
  card.className = "eisenhower-task";
  card.draggable = true;
  card.dataset.taskId = task.id;

  card.addEventListener("dragstart", handleDragStart);
  card.addEventListener("dragend", handleDragEnd);

  // Top row: name, size badge, delete.
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

  // Show more / description, only when a description exists.
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

// Remember which task is being dragged.
function handleDragStart(event) {
  event.dataTransfer.setData("text/plain", event.currentTarget.dataset.taskId);
  event.currentTarget.classList.add("dragging");
  // Auto-scroll listens to pointer position during the drag.
  document.addEventListener("dragover", handleAutoScroll);
}

// Clean up after a drag finishes.
function handleDragEnd(event) {
  event.currentTarget.classList.remove("dragging");
  document.removeEventListener("dragover", handleAutoScroll);
  stopAutoScroll();
}

// Allow dropping by preventing the default and highlighting the zone.
function handleDragOver(event) {
  event.preventDefault();
  event.currentTarget.classList.add("drop-active");
}

// Remove the highlight when the pointer leaves a zone.
function handleDragLeave(event) {
  event.currentTarget.classList.remove("drop-active");
}

// Move the dragged task into the drop zone (quadrant or backlog).
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

// Auto-scroll the popup when dragging near the top or bottom edge.
function handleAutoScroll(event) {
  const threshold = 60; // px from edge that triggers scrolling
  const speed = 8; // px per frame
  const viewportHeight = window.innerHeight;
  const y = event.clientY;

  let direction = 0;
  if (y < threshold) {
    direction = -1;
  } else if (y > viewportHeight - threshold) {
    direction = 1;
  }

  if (direction === 0) {
    stopAutoScroll();
    return;
  }

  if (autoScrollRafId) {
    return;
  }

  const step = () => {
    window.scrollBy(0, direction * speed);
    autoScrollRafId = requestAnimationFrame(step);
  };
  autoScrollRafId = requestAnimationFrame(step);
}

// Stop any running auto-scroll loop.
function stopAutoScroll() {
  if (autoScrollRafId) {
    cancelAnimationFrame(autoScrollRafId);
    autoScrollRafId = null;
  }
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

// Update the active sort field and re-render.
function handleSortFieldChange(event) {
  sortField = event.currentTarget.value;
  renderEisenhower();
}

// Flip ascending/descending and update the arrow.
function handleSortDirToggle(event) {
  sortAscending = !sortAscending;
  event.currentTarget.textContent = sortAscending ? "↑" : "↓";
  renderEisenhower();
}

// ---------------------------------------------------------------------------
// Task creation form
// ---------------------------------------------------------------------------

// Open an inline overlay form for creating a new task.
function openTaskForm() {
  const existing = document.getElementById("eisenhowerTaskForm");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "eisenhowerTaskForm";
  overlay.className = "eisenhower-form-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "New task");

  const form = document.createElement("div");
  form.className = "eisenhower-form";

  const title = document.createElement("div");
  title.className = "eisenhower-form-title";
  title.textContent = "New task";

  const nameInput = document.createElement("input");
  nameInput.className = "eisenhower-form-input";
  nameInput.type = "text";
  nameInput.maxLength = 60;
  nameInput.placeholder = "Task name";
  nameInput.setAttribute("aria-label", "Task name");

  const descInput = document.createElement("textarea");
  descInput.className = "eisenhower-form-input eisenhower-form-textarea";
  descInput.maxLength = 300;
  descInput.placeholder = "Description (optional)";
  descInput.setAttribute("aria-label", "Task description");

  const dueInput = document.createElement("input");
  dueInput.className = "eisenhower-form-input";
  dueInput.type = "date";
  dueInput.setAttribute("aria-label", "Due date");

  const sizeSelect = document.createElement("select");
  sizeSelect.className = "eisenhower-form-input";
  sizeSelect.setAttribute("aria-label", "Task size");
  TASK_SIZES.forEach((size) => {
    const option = document.createElement("option");
    option.value = size;
    option.textContent = size;
    sizeSelect.appendChild(option);
  });
  sizeSelect.value = "M";

  const error = document.createElement("p");
  error.className = "eisenhower-form-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const buttons = document.createElement("div");
  buttons.className = "eisenhower-form-buttons";

  const saveBtn = document.createElement("button");
  saveBtn.className = "eisenhower-form-save";
  saveBtn.type = "button";
  saveBtn.textContent = "Add";

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
    };

    if (!isValidTask(fields)) {
      error.textContent = "Task name is required.";
      error.hidden = false;
      nameInput.focus();
      return;
    }

    const task = createTask(fields);
    eisenhowerTasks = addTask(eisenhowerTasks, task);
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
    sizeSelect,
    error,
    buttons
  );
  overlay.appendChild(form);
  document.getElementById("tab-tools").appendChild(overlay);
  nameInput.focus();
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
