// ─────────────────────────────────────
//  sound.js  上品なSE音
// ─────────────────────────────────────

const STORAGE_KEY = 'flowra_sound_enabled';

export const Sound = {

  // 設定読み込み（デフォルトON）
  isEnabled() {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === 'true';
  },

  setEnabled(val) {
    localStorage.setItem(STORAGE_KEY, String(val));
  },

  // 上品なチャイム（記録保存時）
  playSave() {
    if (!this.isEnabled()) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    // 2音のハーモニー（ペンタトニック系：E5 + B5）
    const notes = [
      { freq: 659.3, delay: 0,    dur: 0.6 },
      { freq: 987.8, delay: 0.08, dur: 0.5 },
    ];

    notes.forEach(({ freq, delay, dur }) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      const now  = ctx.currentTime;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + delay);

      // フェードイン → 緩やかなフェードアウト
      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(0.18, now + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + dur);
    });

    // 後始末
    setTimeout(() => ctx.close(), 1200);
  },

  // 軽いタップ音（任意のインタラクション用）
  playTap() {
    if (!this.isEnabled()) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    const now  = ctx.currentTime;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);

    setTimeout(() => ctx.close(), 300);
  }
};
