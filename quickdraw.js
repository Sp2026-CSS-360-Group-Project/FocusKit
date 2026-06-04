// quickdraw.js — skeleton for the QuickDraw RSVP reader
// TODO: add your logic here

const inputScreen = document.getElementById("inputScreen");
const readerScreen = document.getElementById("readerScreen");
const doneScreen = document.getElementById("doneScreen");
const textInput = document.getElementById("textInput");
const currentWord = document.getElementById("currentWord");
const pauseBtn = document.getElementById("pauseBtn");

// TODO: wire up Go button
document.getElementById("goBtn").addEventListener("click", () => {
  const text = textInput.value.trim();
  if (!text) return;
  // TODO: split text into words and start showing them
  showScreen(readerScreen);
});

// TODO: wire up Pause button
pauseBtn.addEventListener("click", () => {
  // TODO: pause or resume the reader
});

// TODO: wire up Restart button
document.getElementById("restartBtn").addEventListener("click", () => {
  // TODO: restart from the first word
});

// TODO: wire up Back button
document.getElementById("backBtn").addEventListener("click", () => {
  showScreen(inputScreen);
});

// TODO: wire up New Text button
document.getElementById("newTextBtn").addEventListener("click", () => {
  showScreen(inputScreen);
});

// Helper to switch screens
function showScreen(screen) {
  inputScreen.classList.add("hidden");
  readerScreen.classList.add("hidden");
  doneScreen.classList.add("hidden");
  screen.classList.remove("hidden");
}
