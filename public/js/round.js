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
      // Init camera
      const video = document.getElementById('camera-feed');
      await this.camera.init(video);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log('Video dimensions:', video.videoWidth, 'x', video.videoHeight);
  
      // Init detector
      await this.detector.init();
      await new Promise(resolve => setTimeout(resolve, 500));
  
      // Start detection
      this.startTime = Date.now();
      this.detector.start(video, (count) => {
        this.updatePunchCount(count);
      });
  
      // Start timer
      this.startTimer();
  
      // START RECORDING AFTER RANDOM DELAY (5-30 seconds into round)
      const randomDelay = 5000 + Math.random() * 25000; // 5-30 seconds
      console.log(`📹 Will start recording in ${(randomDelay/1000).toFixed(0)}s`);
      
      setTimeout(() => {
        if (this.detector.isDetecting) {
          console.log('📹 Starting 5-second clip capture...');
          this.startRecording();
          
          // Stop recording after 5 seconds
          setTimeout(() => {
            if (this.recorder && this.recorder.state === 'recording') {
              console.log('✅ 5-second clip captured');
              this.stopRecording();
            }
          }, 5000);
        }
      }, randomDelay);
  
      // Show round active
      document.getElementById('loading').style.display = 'none';
      document.getElementById('round-active').style.display = 'block';
    } catch (error) {
      console.error('Error starting round:', error);
      alert('Failed to start round. Please check camera permissions.');
      this.showLanding();
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
  
    this.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.recordedChunks.push(event.data);
      }
    };
  
    this.recorder.onerror = (e) => {
      console.error('❌ MediaRecorder error:', e);
    };
  
    // Start without timeslice for complete valid blob ✅
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
    // Stop detection
    this.detector.stop();
    clearInterval(this.timerInterval);
  
    const duration = Math.floor((Date.now() - this.startTime) / 1000);
    const punches = this.detector.punchCount;
    
    // Calculate pace and top speed
    const pace = duration > 0 ? ((punches / duration) * 60).toFixed(1) : 0;
    const topSpeedMph = this.detector.fastestPunch 
      ? Math.round(this.detector.fastestPunch * 100) 
      : 0;
  
    // If still recording, wait for it to finish
    if (this.recorder && this.recorder.state === 'recording') {
      console.log('⏸️ Waiting for recording to finish...');
      await this.stopRecording();
    }
  
    // Show processing
    document.getElementById('round-active').style.display = 'none';
    document.getElementById('processing').style.display = 'block';
  
    // Get video if captured
    let videoBlob = null;
    if (this.recordedChunks.length > 0) {
      videoBlob = new Blob(this.recordedChunks, { 
        type: this.recordedChunks[0]?.type || 'video/webm' 
      });
      console.log('📹 Video captured:', (videoBlob.size / 1024 / 1024).toFixed(2), 'MB');
    } else {
      console.log('⚠️ No video captured (round < 5s or recording not started)');
    }
  
    try {
      const round = await this.saveRound(punches, duration, pace, topSpeedMph, videoBlob);
      await this.loadStreak();
      this.showSummary(round);
    } catch (error) {
      console.error('Error saving round:', error);
      alert('Failed to save round. Please try again.');
      this.showLanding();
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

    const mph = round.top_speed_mph ?? 0;

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
    this.detector.reset();
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