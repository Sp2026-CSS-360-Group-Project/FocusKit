// eisenhowerState.js - pure state helpers for the Eisenhower Matrix tool.
// Kept free of DOM and chrome APIs so the logic is unit-testable in Jest.
(() => {
  // Storage key for the whole Eisenhower tool (tasks + their placement).
  const EISENHOWER_STORAGE_KEY = "eisenhowerTasks";

  // Valid task sizes, ordered so size sorting is meaningful.
  const TASK_SIZES = ["S", "M", "L", "XL"];

  // Quadrant ids for the 2x2 grid plus the backlog holding area.
  const QUADRANTS = ["q1", "q2", "q3", "q4"];
  const BACKLOG = "backlog";

  // Build a fresh task object with a unique id and sensible defaults.
  function createTask(fields = {}, now = Date.now()) {
    const name = (fields.name || "").trim();

    return {
      id: "task-" + now + "-" + Math.floor(Math.random() * 100000),
      name,
      description: (fields.description || "").trim(),
      dueDate: fields.dueDate || "",
      size: TASK_SIZES.includes(fields.size) ? fields.size : "M",
      location: BACKLOG,
      expanded: false,
      createdAt: now,
      // Reminders: array of { minutesBefore: number }
      reminders: Array.isArray(fields.reminders) ? fields.reminders : [],
    };
  }

  // Validate a task has at least a name before it can be added.
  function isValidTask(fields) {
    return Boolean(
      fields && typeof fields.name === "string" && fields.name.trim()
    );
  }

  // Validate that a due date is not in the past.
  // Returns null if valid, or an error string if invalid.
  function validateDueDate(dueDate) {
    if (!dueDate) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate);
    if (due < today) {
      return "Due date cannot be in the past.";
    }
    return null;
  }

  // Return a new array with the task added.
  function addTask(tasks, task) {
    return [...tasks, task];
  }

  // Return a new array with the task removed by id.
  function removeTask(tasks, taskId) {
    return tasks.filter((task) => task.id !== taskId);
  }

  // Update an existing task by id with new fields.
  function updateTask(tasks, taskId, fields) {
    return tasks.map((task) =>
      task.id === taskId ? { ...task, ...fields } : task
    );
  }

  // Move a task to a new location (a quadrant id or the backlog).
  function moveTask(tasks, taskId, location) {
    return tasks.map((task) =>
      task.id === taskId ? { ...task, location } : task
    );
  }

  // Toggle a task's expanded (show more) flag.
  function toggleTaskExpanded(tasks, taskId) {
    return tasks.map((task) =>
      task.id === taskId ? { ...task, expanded: !task.expanded } : task
    );
  }

  // Sort a list of tasks by a field, ascending or descending.
  // Supported fields: "name", "dueDate", "size".
  function sortTasks(tasks, field, ascending = true) {
    const sorted = [...tasks].sort((a, b) => {
      let comparison = 0;

      if (field === "name") {
        comparison = a.name.localeCompare(b.name);
      } else if (field === "dueDate") {
        if (!a.dueDate && !b.dueDate) {
          comparison = 0;
        } else if (!a.dueDate) {
          return 1;
        } else if (!b.dueDate) {
          return -1;
        } else {
          comparison = a.dueDate.localeCompare(b.dueDate);
        }
      } else if (field === "size") {
        comparison = TASK_SIZES.indexOf(a.size) - TASK_SIZES.indexOf(b.size);
      }

      return ascending ? comparison : -comparison;
    });

    return sorted;
  }

  // Return only the tasks currently in the backlog.
  function getBacklogTasks(tasks) {
    return tasks.filter((task) => task.location === BACKLOG);
  }

  // Return only the tasks in a given quadrant.
  function getQuadrantTasks(tasks, quadrant) {
    return tasks.filter((task) => task.location === quadrant);
  }

  const FocusKitEisenhowerState = {
    EISENHOWER_STORAGE_KEY,
    TASK_SIZES,
    QUADRANTS,
    BACKLOG,
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
  };

  if (typeof globalThis !== "undefined") {
    globalThis.FocusKitEisenhowerState = FocusKitEisenhowerState;
  }

  if (typeof module !== "undefined") {
    module.exports = FocusKitEisenhowerState;
  }
})();
