import CameraManager from './camera.js';
import PunchDetector from './detector.js';
import { DAILY_TARGET_PUNCHES } from './config.js';

function fakeMphFromSpeed(speed) {
  // Tuned for MediaPipe wrist movement
  const MIN_MPH = 8;    // slow punch
  const MAX_MPH = 42;   // elite human punch
  const SCALE = 18;     // feel-good multiplier

  let mph = speed * SCALE;

  // Soft floor + ceiling
  mph = Math.max(mph, MIN_MPH);
  mph = Math.min(mph, MAX_MPH);

  return Math.round(mph);
}

class RoundManager {
  constructor() {
    this.camera = new CameraManager();
    this.detector = new PunchDetector();
    this.recorder = null;
    this.recordedChunks = [];
    this.startTime = null;
    this.timerInterval = null;
    this.deviceId = this.getDeviceIdFromCookie(); // may be null on new device
    this.todayTarget = DAILY_TARGET_PUNCHES;

  }

  setRecoverUI(state, text = '') {
    const btn = document.getElementById('recover-email-btn');
    const msg = document.getElementById('recover-msg');
  
    if (btn) btn.disabled = state === 'loading';
  
    if (msg) {
      msg.classList.remove('success', 'error');
      if (state === 'success') msg.classList.add('success');
      if (state === 'error') msg.classList.add('error');
      msg.textContent = text;
    }
  }
  
  bindRecovery() {
    const card = document.getElementById('recover-card');
    const btn = document.getElementById('recover-email-btn');
    const input = document.getElementById('recover-email-input');
  
    if (!card || !btn || !input) return;
  
    // If they already saved an email, prefill it
    const existing = localStorage.getItem('hityourday_email');
    if (existing) input.value = existing;
  
    btn.addEventListener('click', async () => {
      const email = input.value.trim().toLowerCase();
      if (!email || !email.includes('@')) {
        this.setRecoverUI('error', 'Please enter a valid email.');
        input.focus();
        return;
      }
  
      // Make sure this device has an ID cookie now
      this.ensureDeviceId();
  
      this.setRecoverUI('loading', 'Loading…');
  
      try {
        // ✅ Reuse your existing link-email endpoint
        // It already maps device -> email user and moves rounds.
        const res = await fetch('/api/users/link-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ deviceId: this.deviceId, email })
        });
  
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Failed');
  
        localStorage.setItem('hityourday_email', email);
  
        // Hide the card + refresh UI
        card.setAttribute('hidden', 'true');
        this.setRecoverUI('success', 'Loaded ✅');
  
        await this.loadStreak();
      } catch (e) {
        this.setRecoverUI('error', 'Could not load. Try again.');
      }
    });
  }
  

  getDailyGoal(currentStreak) {
    const base = DAILY_TARGET_PUNCHES;   // your config base (e.g., 100)
    const extraPerDay = 10;
    const streak = Number(currentStreak || 0);
    return base + Math.max(0, (streak - 1) * extraPerDay);
  }
  

  setProcessing(stepText, percent = null, detail = '') {
    const statusEl = document.getElementById('processing-status');
    const barEl = document.getElementById('processing-bar');
    const detailEl = document.getElementById('processing-detail');
    const progressWrap = document.querySelector('#processing .progress');
  
    if (statusEl) statusEl.textContent = stepText;
    if (detailEl) detailEl.textContent = detail;
  
    if (barEl && percent !== null) {
      const p = Math.max(0, Math.min(100, percent));
      barEl.style.width = `${p}%`;
      if (progressWrap) progressWrap.setAttribute('aria-valuenow', String(p));
    }
  }
  

  getDeviceIdFromCookie() {
    const KEY = 'hityourday_device_id';
  
    const m = document.cookie.match(new RegExp('(?:^|; )' + KEY + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  
  ensureDeviceId() {
    if (this.deviceId) return this.deviceId;
  
    const KEY = 'hityourday_device_id';
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  
    const id = 'device_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
  
    document.cookie = `${KEY}=${encodeURIComponent(id)}; Max-Age=31536000; Path=/; SameSite=Lax${secure}`;
    this.deviceId = id;
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

      this.ensureDeviceId();

      try {
        const res = await fetch('/api/users/link-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
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

      this.ensureDeviceId();

      await this.loadStreak();
  
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
    const target = this.todayTarget ?? DAILY_TARGET_PUNCHES;

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
      ? fakeMphFromSpeed(this.detector.fastestPunch)
      : 0;

  
    // Show processing
    document.getElementById('round-active').style.display = 'none';
    document.getElementById('processing').style.display = 'block';

    this.setProcessing('Finalizing…', 5, 'Stopping detection + saving stats');

    if (this.recorder && this.recorder.state === 'recording') {
      this.setProcessing(
        'Finalizing clip…',
        15,
        'Wrapping up your 5-second video'
      );
  
      await this.stopRecording();
    }
  
    // Build video blob
    this.setProcessing('Packaging…', 25, 'Preparing upload');
  
    // Get video if captured
    let videoBlob = null;
    if (this.recordedChunks.length > 0) {
      videoBlob = new Blob(this.recordedChunks, { 
        type: this.recordedChunks[0]?.type || 'video/webm' 
      });

      this.setProcessing(
        'Packaging…',
        35,
        `Clip ready (${(videoBlob.size / 1024 / 1024).toFixed(1)}MB)`
      );

      console.log('📹 Video captured:', (videoBlob.size / 1024 / 1024).toFixed(2), 'MB');
    } else {
      console.log('⚠️ No video captured (round < 5s or recording not started)');
      this.setProcessing('Packaging…', 35, 'No clip captured this round');
    }
  
    try {
      this.setProcessing('Uploading…', 40, 'Starting upload…');

      const round = await this.saveRound(punches, duration, pace, topSpeedMph, videoBlob);

      this.setProcessing('Finishing…', 92, 'Updating streak…');

      await this.loadStreak();

      this.setProcessing('Done…', 100, 'Loading summary…');

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

  saveRound(punchCount, durationSeconds, pace, topSpeedMph, videoBlob) {
    this.ensureDeviceId();

    const formData = new FormData();
    formData.append('deviceId', this.deviceId);
    formData.append('punchCount', punchCount);
    formData.append('durationSeconds', durationSeconds);
    formData.append('pace', pace);
    formData.append('topSpeedMph', topSpeedMph);
  
    if (videoBlob) formData.append('video', videoBlob, 'round.webm');
  
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/rounds');
      xhr.withCredentials = true;

  
      // Real upload progress
      xhr.upload.onprogress = (evt) => {
        if (!evt.lengthComputable) return;
  
        const pct = Math.round((evt.loaded / evt.total) * 100);
  
        // Map upload to 40% -> 90% so earlier steps feel real
        const mapped = 40 + Math.round(pct * 0.5);
  
        const mbLoaded = (evt.loaded / 1024 / 1024).toFixed(1);
        const mbTotal = (evt.total / 1024 / 1024).toFixed(1);
  
        this.setProcessing('Uploading…', mapped, `${mbLoaded}MB / ${mbTotal}MB`);
      };
  
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error('Failed to save round'));
          return;
        }
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('Bad server response'));
        }
      };
  
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(formData);
    });
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
      const response = await fetch(`/api/streaks/${this.deviceId}`, {
        credentials: 'include'
      });      
      const data = await response.json();

      const streak = Number(data.currentStreak || 0);
      document.getElementById('current-streak').textContent = streak;

      // 🔥 dynamic goal
      this.todayTarget = this.getDailyGoal(streak);

      const targetEl = document.getElementById('punch-target-value');
      if (targetEl) targetEl.textContent = this.todayTarget;

      const landingEl = document.getElementById('landing-goal-value');
      if (landingEl) landingEl.textContent = this.todayTarget;

      const roundActiveVisible = document.getElementById('round-active')?.style.display === 'block';
      if (roundActiveVisible) {
        this.updatePunchCount(this.detector?.punchCount || 0);
      }

    } catch (error) {
      console.error('Error loading streak:', error);
    }
  }

  async maybeShowRecovery() {
    const savedEmail = localStorage.getItem('hityourday_email');
    const card = document.getElementById('recover-card');
  
    if (!card) return;
  
    // Show recover if:
    // - no device cookie yet (new device)
    // - AND we have a saved email (so we can suggest continuing)
    if (!this.deviceId && savedEmail) {
      card.removeAttribute('hidden');
  
      const input = document.getElementById('recover-email-input');
      if (input && !input.value) input.value = savedEmail;
    }
  }
  
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  const manager = new RoundManager();

  manager.bindEmailSave();
  manager.bindRecovery();

  // Only loads streak if we already have a device cookie
  if (manager.deviceId) {
    manager.loadStreak();
  }

  manager.maybeShowRecovery();

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