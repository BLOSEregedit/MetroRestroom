const AUDIO_SRC = "/audio/station-tick.wav";
const THROTTLE_MS = 140;

function hasWxApi(name) {
  return typeof wx !== "undefined" && typeof wx[name] === "function";
}

function createStationFeedback(options) {
  const preferences = options || {};
  let soundEnabled = preferences.soundEnabled !== false;
  let vibrationEnabled = preferences.vibrationEnabled !== false;
  let audioContext = null;
  let destroyed = false;
  let lastPlayedAt = 0;

  function updatePreferences(nextOptions) {
    const next = nextOptions || {};
    if (typeof next.soundEnabled === "boolean") {
      soundEnabled = next.soundEnabled;
    }
    if (typeof next.vibrationEnabled === "boolean") {
      vibrationEnabled = next.vibrationEnabled;
    }
    return { soundEnabled, vibrationEnabled };
  }

  function ensureAudioContext() {
    if (audioContext || !soundEnabled || !hasWxApi("createInnerAudioContext")) {
      return audioContext;
    }

    try {
      audioContext = wx.createInnerAudioContext();
      audioContext.src = AUDIO_SRC;
      audioContext.volume = 0.18;
      if (typeof audioContext.onError === "function") {
        audioContext.onError(() => {});
      }
    } catch (error) {
      audioContext = null;
    }
    return audioContext;
  }

  function play() {
    if (destroyed) return false;

    const now = Date.now();
    if (now - lastPlayedAt < THROTTLE_MS) return false;
    lastPlayedAt = now;

    if (vibrationEnabled && hasWxApi("vibrateShort")) {
      try {
        wx.vibrateShort({ type: "light", fail: () => {} });
      } catch (error) {
        // 设备不支持触感反馈时静默降级。
      }
    }

    if (soundEnabled) {
      const context = ensureAudioContext();
      if (context && typeof context.play === "function") {
        try {
          context.play();
        } catch (error) {
          // 本地音频缺失或播放失败时不影响页面交互。
        }
      }
    }
    return true;
  }

  function destroy() {
    destroyed = true;
    if (audioContext && typeof audioContext.destroy === "function") {
      try {
        audioContext.destroy();
      } catch (error) {
        // 音频上下文销毁失败时静默处理。
      }
    }
    audioContext = null;
  }

  return { updatePreferences, play, destroy };
}

module.exports = { createStationFeedback };
