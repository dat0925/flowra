// ─────────────────────────────────────
//  sound.js  上品なSE音
// ─────────────────────────────────────

const STORAGE_KEY = 'flowra_sound_enabled';

export const Sound = {

  isEnabled() {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === 'true';
  },

  setEnabled(val) {
    localStorage.setItem(STORAGE_KEY, String(val));
  },

  // 記録保存：2音ハーモニー（E5 + B5）少し豊か
  playSave() {
    if (!this.isEnabled()) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [
      { freq: 659.3, delay: 0,    dur: 0.6, vol: 0.18 },
      { freq: 987.8, delay: 0.07, dur: 0.5, vol: 0.13 },
      { freq: 1318.5,delay: 0.14, dur: 0.4, vol: 0.07 }, // 高音で締め
    ];
    notes.forEach(({ freq, delay, dur, vol }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + delay);
      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(vol, now + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + dur);
    });
    setTimeout(() => ctx.close(), 1500);
  },

  // モーダルを開く・画面遷移：柔らかい単音（A4）
  playOpen() {
    if (!this.isEnabled()) return;
    this._tone(440, 0.09, 0.18, 'sine');
  },

  // モーダルを閉じる・キャンセル：少し低め（E4）
  playClose() {
    if (!this.isEnabled()) return;
    this._tone(329.6, 0.07, 0.15, 'sine');
  },

  // タグ選択・トグル：軽いクリック感（G5）
  playTap() {
    if (!this.isEnabled()) return;
    this._tone(784, 0.06, 0.1, 'sine');
  },

  // エラー・警告：低めの短音（B3）
  playError() {
    if (!this.isEnabled()) return;
    this._tone(246.9, 0.1, 0.2, 'sine');
  },

  // 内部ヘルパー
  _tone(freq, vol, dur, type = 'sine') {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(vol, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + dur);
      setTimeout(() => ctx.close(), dur * 1000 + 200);
    } catch (e) {}
  }
};
