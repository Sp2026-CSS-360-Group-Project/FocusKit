// tools.js - FocusKit runtime registry for popup-rendered productivity tools.

// Shared launch affordance for tools that update their button after activation.
function markToolLaunched(button, label) {
  button.classList.add("active-tool");
  button.textContent = label;
  button.setAttribute("aria-pressed", "true");
}

// Registry consumed by popup.js when building the Tools tab.
const TOOLS = [
  {
    id: "pomodoro",
    name: "Pomodoro",
    icon: "P",
    desc: "Start a focused work sprint with intentional breaks.",
    launch(button) {
      markToolLaunched(button, "Ready");
      chrome.storage.local.set({ activeTool: "pomodoro" });

      if (window.FocusKitPomodoro) {
        window.FocusKitPomodoro.open();
      }
    },
  },
  {
    id: "iris",
    name: "Iris",
    icon: "I",
    desc: "Reduce visual clutter for calmer reading sessions.",
    launch(button) {
      markToolLaunched(button, "Ready");
      chrome.storage.local.set({ activeTool: "iris" });
    },
  },
  {
    id: "eisenhower",
    name: "Eisenhower",
    icon: "E",
    desc: "Sort tasks by urgency and importance before starting.",
    launch(button) {
      markToolLaunched(button, "Ready");
      chrome.storage.local.set({ activeTool: "eisenhower" });
    },
  },
];

// Registry consumed by popup.js when building the Focus tab.
const FOCUS_MODES = [
  {
    id: "deep-work",
    name: "Deep Work",
    icon: "D",
    desc: "Long, distraction-light sessions for complex work.",
  },
  {
    id: "study",
    name: "Study",
    icon: "S",
    desc: "Structured review mode for notes, reading, and practice.",
  },
  {
    id: "break",
    name: "Break",
    icon: "B",
    desc: "A softer mode for resetting before the next session.",
  },
];

// Attach registries for popup scripts loaded directly by popup.html.
if (typeof window !== "undefined") {
  window.TOOLS = TOOLS;
  window.FOCUS_MODES = FOCUS_MODES;
}

// Export registries and helpers for Jest.
if (typeof module !== "undefined") {
  module.exports = { TOOLS, FOCUS_MODES, markToolLaunched };
}
