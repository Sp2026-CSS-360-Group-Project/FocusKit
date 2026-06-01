// eisenhowerState.test.js - unit tests for the Eisenhower Matrix pure logic.

const {
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
} = require("./eisenhowerState.js");

describe("createTask", () => {
  test("creates a task with defaults and a unique id", () => {
    const task = createTask({ name: "Write report" }, 1000);
    expect(task.name).toBe("Write report");
    expect(task.size).toBe("M");
    expect(task.location).toBe(BACKLOG);
    expect(task.expanded).toBe(false);
    expect(task.id).toMatch(/^task-1000-/);
  });

  test("trims name and description", () => {
    const task = createTask({ name: "  Clean  ", description: "  desc  " });
    expect(task.name).toBe("Clean");
    expect(task.description).toBe("desc");
  });

  test("falls back to M for an invalid size", () => {
    const task = createTask({ name: "X", size: "ZZ" });
    expect(task.size).toBe("M");
  });

  test("accepts a valid size", () => {
    const task = createTask({ name: "X", size: "XL" });
    expect(task.size).toBe("XL");
  });
});

describe("isValidTask", () => {
  test("true when a name is present", () => {
    expect(isValidTask({ name: "Hi" })).toBe(true);
  });

  test("false for empty or missing name", () => {
    expect(isValidTask({ name: "  " })).toBe(false);
    expect(isValidTask({})).toBe(false);
    expect(isValidTask(null)).toBe(false);
  });
});

describe("addTask and removeTask", () => {
  test("addTask appends without mutating the original", () => {
    const tasks = [];
    const task = createTask({ name: "A" });
    const next = addTask(tasks, task);
    expect(next).toHaveLength(1);
    expect(tasks).toHaveLength(0);
  });

  test("removeTask removes by id", () => {
    const a = createTask({ name: "A" }, 1);
    const b = createTask({ name: "B" }, 2);
    const next = removeTask([a, b], a.id);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe(b.id);
  });
});

describe("moveTask", () => {
  test("changes a task's location", () => {
    const a = createTask({ name: "A" }, 1);
    const next = moveTask([a], a.id, "q1");
    expect(next[0].location).toBe("q1");
  });

  test("leaves other tasks untouched", () => {
    const a = createTask({ name: "A" }, 1);
    const b = createTask({ name: "B" }, 2);
    const next = moveTask([a, b], a.id, "q2");
    expect(next[1].location).toBe(BACKLOG);
  });
});

describe("toggleTaskExpanded", () => {
  test("flips the expanded flag", () => {
    const a = createTask({ name: "A" }, 1);
    const next = toggleTaskExpanded([a], a.id);
    expect(next[0].expanded).toBe(true);
    const back = toggleTaskExpanded(next, a.id);
    expect(back[0].expanded).toBe(false);
  });
});

describe("sortTasks", () => {
  const tasks = [
    { id: "1", name: "Banana", dueDate: "2026-03-01", size: "L" },
    { id: "2", name: "Apple", dueDate: "2026-01-01", size: "S" },
    { id: "3", name: "Cherry", dueDate: "", size: "XL" },
  ];

  test("sorts by name ascending", () => {
    const sorted = sortTasks(tasks, "name", true);
    expect(sorted.map((t) => t.name)).toEqual(["Apple", "Banana", "Cherry"]);
  });

  test("sorts by name descending", () => {
    const sorted = sortTasks(tasks, "name", false);
    expect(sorted.map((t) => t.name)).toEqual(["Cherry", "Banana", "Apple"]);
  });

  test("sorts by due date with empty dates last", () => {
    const sorted = sortTasks(tasks, "dueDate", true);
    expect(sorted.map((t) => t.name)).toEqual(["Apple", "Banana", "Cherry"]);
  });

  test("sorts by size ascending using the size order", () => {
    const sorted = sortTasks(tasks, "size", true);
    expect(sorted.map((t) => t.size)).toEqual(["S", "L", "XL"]);
  });

  test("does not mutate the input array", () => {
    const copy = [...tasks];
    sortTasks(tasks, "name", true);
    expect(tasks).toEqual(copy);
  });
});

describe("getBacklogTasks and getQuadrantTasks", () => {
  test("splits tasks by location", () => {
    const a = { id: "1", name: "A", location: BACKLOG };
    const b = { id: "2", name: "B", location: "q1" };
    const c = { id: "3", name: "C", location: "q1" };
    expect(getBacklogTasks([a, b, c])).toHaveLength(1);
    expect(getQuadrantTasks([a, b, c], "q1")).toHaveLength(2);
  });
});

describe("TASK_SIZES", () => {
  test("contains the four expected sizes in order", () => {
    expect(TASK_SIZES).toEqual(["S", "M", "L", "XL"]);
  });
});