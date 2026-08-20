const AUDIO_SRC = '/audio/station-tick.wav';
const AUDIO_POOL_SIZE = 2;
const SOUND_INTERVAL_MS = 48;
const HAPTIC_INTERVAL_MS = 90;
const MAX_BATCH_PULSES = 3;

function hasWxApi(name) {
  return typeof wx !== "undefined" && typeof wx[name] === "function";
}

function createStationFeedback(options) {
  const preferences = options || {};
  let soundEnabled = preferences.soundEnabled !== false;
  let vibrationEnabled = preferences.vibrationEnabled !== false;
  let destroyed = false;
  let audioCursor = 0;
  let lastSoundAt = 0;
  let lastHapticAt = 0;
  let audioPool = [];
  let pendingTimers = [];

  function createAudioContext() {
    if (!hasWxApi('createInnerAudioContext')) return null;
    try {
      const context = wx.createInnerAudioContext({ useWebAudioImplement: true });
      context.src = AUDIO_SRC;
      context.volume = 0.18;
      if (typeof context.onError === 'function') context.onError(() => {});
      return context;
    } catch (error) {
      return null;
    }
  }

  function ensureAudioPool() {
    if (destroyed || !soundEnabled || audioPool.length) return audioPool;
    audioPool = Array.from({ length: AUDIO_POOL_SIZE }, createAudioContext).filter(Boolean);
    return audioPool;
  }

  function playSound(now) {
    if (!soundEnabled || now - lastSoundAt < SOUND_INTERVAL_MS) return false;
    const pool = ensureAudioPool();
    if (!pool.length) return false;
    const context = pool[audioCursor % pool.length];
    audioCursor = (audioCursor + 1) % pool.length;
    lastSoundAt = now;
    try {
      context.play();
      return true;
    } catch (error) {
      return false;
    }
  }

  function playHaptic(now) {
    if (!vibrationEnabled || now - lastHapticAt < HAPTIC_INTERVAL_MS) return false;
    if (!hasWxApi('vibrateShort')) return false;
    lastHapticAt = now;
    try {
      wx.vibrateShort({ type: 'light', fail: () => {} });
      return true;
    } catch (error) {
      return false;
    }
  }

  function pulse() {
    if (destroyed) return false;
    const now = Date.now();
    const soundPlayed = playSound(now);
    const hapticPlayed = playHaptic(now);
    return soundPlayed || hapticPlayed;
  }

  function clearPendingTimers() {
    pendingTimers.forEach((timer) => clearTimeout(timer));
    pendingTimers = [];
  }

  function playDetents(count) {
    if (destroyed) return false;
    const pulseCount = Math.min(
      Math.max(Math.floor(Number(count) || 0), 0),
      MAX_BATCH_PULSES,
    );
    if (!pulseCount) return false;

    pulse();
    for (let index = 1; index < pulseCount; index += 1) {
      const timer = setTimeout(() => {
        pendingTimers = pendingTimers.filter((item) => item !== timer);
        pulse();
      }, SOUND_INTERVAL_MS * index);
      pendingTimers.push(timer);
    }
    return true;
  }

  function updatePreferences(nextOptions) {
    const next = nextOptions || {};
    if (typeof next.soundEnabled === 'boolean') soundEnabled = next.soundEnabled;
    if (typeof next.vibrationEnabled === 'boolean') vibrationEnabled = next.vibrationEnabled;
    if (soundEnabled) ensureAudioPool();
    return { soundEnabled, vibrationEnabled };
  }

  function reset() {
    clearPendingTimers();
    lastSoundAt = 0;
    lastHapticAt = 0;
  }

  function destroy() {
    destroyed = true;
    clearPendingTimers();
    audioPool.forEach((context) => {
      if (context && typeof context.destroy === 'function') {
        try {
          context.destroy();
        } catch (error) {
          // 音频上下文销毁失败时静默处理。
        }
      }
    });
    audioPool = [];
  }

  ensureAudioPool();

  return {
    updatePreferences,
    play: () => playDetents(1),
    playDetents,
    reset,
    destroy,
  };
}

module.exports = { createStationFeedback };
