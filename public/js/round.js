import CameraManager from './camera.js';
import PunchDetector from './detector.js';
import { DAILY_TARGET_PUNCHES } from './config.js';

class RoundManager {
  constructor() {
    this.camera = new CameraManager();
    this.detector = new PunchDetector();
    this.recorder = null;
    this.recordedChunks = [];
    this.startTime = null;
    this.timerInterval = null;
    this.deviceId = this.getOrCreateDeviceId();
  }

  getOrCreateDeviceId() {
    let id = localStorage.getItem('hityourday_device_id');
    if (!id) {
      id = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('hityourday_device_id', id);
    }
    return id;
  }

  // --- mph estimate (tunable) ---
  estimateTopSpeedMph() {
    // detector.fastestPunch is a normalized MediaPipe velocity scalar
    const v = Number(this.detector.fastestPunch || 0);

    // IMPORTANT: This is a game-y estimate, not real mph. Keep it sane.
    // If you were seeing 194mph, your multiplier is too high.
    // Start here and tune after observing typical values.
    const mph = v * 12;

    return Math.max(0, mph);
  }

  // Email UI helper
  setEmailUI(state, text = '') {
    const btn = document.getElementById('email-save-btn');
    const msg = document.getElementById('email-save-msg');

    if (btn) btn.disabled = state === 'saving' || state === 'saved';

    if (msg) {
      msg.classList.remove('success', 'error');
      if (state === 'saved') msg.classList.add('success');
      if (state === 'error') msg.classList.add('error');
      msg.textContent = text;
    }
  }

  bindEmailSave() {
    const btn = document.getElementById('email-save-btn');
    const input = document.getElementById('email-input');

    if (!btn || !input) return;

    const existing = localStorage.getItem('hityourday_email');
    if (existing) input.value = existing;

    btn.addEventListener('click', async () => {
      const email = input.value.trim().toLowerCase();

      if (!email || !email.includes('@')) {
        this.setEmailUI('error', 'Please enter a valid email.');
        input.focus();
        return;
      }

      this.setEmailUI('saving', 'Saving…');

      try {
        const res = await fetch('/api/users/link-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: this.deviceId, email })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Failed');

        localStorage.setItem('hityourday_email', email);
        this.setEmailUI('saved', 'Saved ✅ Your streak will follow you on any device.');
      } catch (e) {
        this.setEmailUI('error', 'Could not save. Try again.');
      }
    });
  }

  async startRound() {
    try {
      const video = document.getElementById('camera-feed');
      await this.camera.init(video);

      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('Video dimensions:', video.videoWidth, 'x', video.videoHeight);

      // Set goal UI (if present)
      const goalValueEl = document.getElementById('punch-target-value');
      if (goalValueEl) goalValueEl.textContent = DAILY_TARGET_PUNCHES;

      const goalStatus = document.getElementById('goal-status');
      if (goalStatus) goalStatus.textContent = 'Keep going 👊';

      // Start recording + detection
      this.startRecording();

      await this.detector.init();
      await new Promise(resolve => setTimeout(resolve, 500));

      this.startTime = Date.now();
      this.detector.start(video, (count) => {
        this.updatePunchCount(count);
      });

      this.startTimer();

      document.getElementById('landing').style.display = 'none';
      document.getElementById('loading').style.display = 'none';
      document.getElementById('round-active').style.display = 'block';
    } catch (error) {
      alert(error.message);
      document.getElementById('loading').style.display = 'none';
      document.getElementById('landing').style.display = 'block';
    }
  }

  startRecording() {
    this.recordedChunks = [];
    const stream = this.camera.stream;
  
    // Try formats in order of preference
    const formats = [
      { mimeType: 'video/mp4', videoBitsPerSecond: 1500000 },
      { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 1500000 },
      { mimeType: 'video/webm', videoBitsPerSecond: 1500000 },
      { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 1500000 }
    ];
  
    let options = formats[0]; // default
    for (const format of formats) {
      if (MediaRecorder.isTypeSupported(format.mimeType)) {
        options = format;
        console.log('✅ Using format:', format.mimeType);
        break;
      }
    }
  
    this.recorder = new MediaRecorder(stream, options);
  
    // Collect chunks
    this.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.recordedChunks.push(event.data);
      }
    };
  
    this.recorder.onerror = (e) => {
      console.error('❌ MediaRecorder error:', e);
    };
  
    // Start without timeslice for complete valid blob
    this.recorder.start();
    console.log('📹 Recording started');
  }

  startTimer() {
    const timerEl = document.getElementById('timer');
    this.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      timerEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }, 1000);
  }

  updatePunchCount(count) {
    const el = document.getElementById('punch-count');
    if (el) el.textContent = count;

    const wrap = document.getElementById('goal-wrap');
    const status = document.getElementById('goal-status');
    const target = DAILY_TARGET_PUNCHES;

    if (count >= target) {
      el?.classList.add('hit-target');
      wrap?.classList.add('goal-hit');
      if (status) status.textContent = 'Goal hit ✅ Streak locked';
    } else {
      el?.classList.remove('hit-target');
      wrap?.classList.remove('goal-hit');
      if (status) status.textContent = `Only ${target - count} to go 👊`;
    }
  }

  async endRound() {
    // Stop everything
    this.detector.stop();
    clearInterval(this.timerInterval);

    const duration = Math.floor((Date.now() - this.startTime) / 1000);
    const punches = this.detector.punchCount;

    const pace = duration > 0 ? (punches / duration) * 60 : 0;
    const topSpeedMph = this.estimateTopSpeedMph();

    // Stop recording and flush final chunk
    await this.stopRecording();

    // Show processing state
    document.getElementById('round-active').style.display = 'none';
    document.getElementById('processing').style.display = 'block';

    // Save even if no video
    if (!this.recordedChunks.length) {
      console.warn('No recorded chunks available; saving round without video.');
      try {
        const roundData = await this.saveRound(punches, duration, pace, topSpeedMph, null);
        this.showSummary(roundData);
      } catch (error) {
        console.error('Error saving round:', error);
        this.showSummary({
          punch_count: punches,
          duration_seconds: duration,
          punches_per_minute: pace,
          top_speed_mph: topSpeedMph
        });
      } finally {
        this.camera.stop();
      }
      return;
    }

    const clipBlob = new Blob(this.recordedChunks, {
      type: this.recordedChunks[0]?.type || 'video/webm'
    });

    try {
      // server now chooses a random 5 seconds, so no clipStart needed
      const roundData = await this.saveRound(punches, duration, pace, topSpeedMph, clipBlob);
      this.showSummary(roundData);
    } catch (error) {
      console.error('Error saving round:', error);
      this.showSummary({
        punch_count: punches,
        duration_seconds: duration,
        punches_per_minute: pace,
        top_speed_mph: topSpeedMph
      });
    } finally {
      this.camera.stop();
    }
  }

  stopRecording() {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') {
        resolve();
        return;
      }

      this.recorder.onstop = resolve;

      // Force a final data chunk flush
      try { this.recorder.requestData(); } catch (e) {}

      setTimeout(() => {
        this.recorder.stop();
      }, 200);
    });
  }

  async saveRound(punchCount, durationSeconds, pace, topSpeedMph, videoBlob) {
    const formData = new FormData();
    formData.append('deviceId', this.deviceId);
    formData.append('punchCount', punchCount);
    formData.append('durationSeconds', durationSeconds);
    formData.append('pace', pace);
    formData.append('topSpeedMph', topSpeedMph);

    if (videoBlob) {
      formData.append('video', videoBlob, 'round.webm');
    }

    const response = await fetch('/api/rounds', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error('Failed to save round');
    }

    return await response.json();
  }

  showSummary(round) {
    const punchCount = Number(round.punch_count ?? 0);
    const durationSeconds = Number(round.duration_seconds ?? 0);

    const pace = round.punches_per_minute ??
      (durationSeconds > 0 ? ((punchCount / durationSeconds) * 60).toFixed(1) : '0.0');

    const mph = round.top_speed_mph ?? this.estimateTopSpeedMph();

    document.getElementById('processing').style.display = 'none';
    document.getElementById('summary').style.display = 'block';

    document.getElementById('summary-punches').textContent = punchCount;
    document.getElementById('summary-time').textContent =
      `${Math.floor(durationSeconds / 60)}:${(durationSeconds % 60).toString().padStart(2, '0')}`;

    document.getElementById('summary-pace').textContent =
      Number.isFinite(Number(pace)) ? `${Number(pace).toFixed(1)}` : `${pace}`;

    document.getElementById('summary-speed').textContent =
      Number.isFinite(Number(mph)) ? `${Number(mph).toFixed(1)}` : '--';

    // If you have the email card, reset UI state on each summary show
    this.setEmailUI('idle', '');

    if (round.share_video_url) {
      document.getElementById('share-section').style.display = 'block';
      document.getElementById('share-video-preview').src = round.share_video_url;
      document.getElementById('download-video').href = round.share_video_url;
      document.getElementById('download-video').download = `hityourday-${punchCount}-punches.mp4`;
    }

    this.loadStreak();
  }

  async loadStreak() {
    try {
      const response = await fetch(`/api/streaks/${this.deviceId}`);
      const data = await response.json();
      document.getElementById('current-streak').textContent = data.currentStreak;
    } catch (error) {
      console.error('Error loading streak:', error);
    }
  }
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  const manager = new RoundManager();
  manager.bindEmailSave();

  document.getElementById('start-round').addEventListener('click', () => {
    document.getElementById('landing').style.display = 'none';
    document.getElementById('loading').style.display = 'block';
    manager.startRound();
  });

  document.getElementById('end-round').addEventListener('click', () => {
    manager.endRound();
  });

  document.getElementById('new-round').addEventListener('click', () => {
    location.reload();
  });
});