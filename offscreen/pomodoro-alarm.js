// pomodoro-alarm.js - MV3 offscreen audio playback for Pomodoro completion.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.action !== "pomodoro:playAlarmSound") {
    return false;
  }

  playAlarmSound(message.soundPath)
    .then(() => sendResponse({ success: true }))
    .catch((error) =>
      sendResponse({
        success: false,
        error: error.message || "Unable to play Pomodoro alarm sound",
      })
    );

  return true;
});

async function playAlarmSound(soundPath) {
  if (typeof soundPath !== "string" || !soundPath) {
    return;
  }

  const audio = new window.Audio(soundPath);
  audio.volume = 0.8;
  await audio.play();
}
