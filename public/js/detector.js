// Hand tracking using MediaPipe Hands
class PunchDetector {
    constructor() {
      this.hands = null;
      this.isDetecting = false;
      this.punchCount = 0;
      this.lastPunchTime = { Left: 0, Right: 0 };
      this.punchCooldown = 200; // ms between punches
      this.velocityThreshold = 0.12; // Normalized coordinates (0-1 range)
      this.previousHands = { Left: null, Right: null };

      // Wrist visibility tracking
      this.lastBothWristsSeenAt = Date.now();
      this.wristGraceMs = 1000; // wait 1s before warning
      this.showingWristWarning = false;
      this.visibilityCallback = null;
  
      this.fastestPunch = 0;
      this.fastestPunchHand = '';
  
      // ✅ Track peak moment timing
      this.roundStartMs = 0;
      this.fastestPunchAtMs = 0;
  
      this.canvas = null;
      this.ctx = null;
      this.videoElement = null;
      this.detectionCallback = null;
    }  
  
    async init() {
      console.log('🥊 Loading MediaPipe Hands...');
  
      this.canvas = document.createElement('canvas');
      this.canvas.width = 640;
      this.canvas.height = 480;
      this.ctx = this.canvas.getContext('2d');
  
      this.hands = new Hands({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
      });
  
      this.hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 0,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });
  
      this.hands.onResults((results) => this.onResults(results));
  
      console.log('✅ MediaPipe Hands loaded');
    }
  
    onResults(results) {
      if (!this.isDetecting) return;
    
      const now = Date.now();
    
      const landmarks = results.multiHandLandmarks || [];
      const handedness = results.multiHandedness || [];
    
      let leftWristSeen = false;
      let rightWristSeen = false;
    
      landmarks.forEach((handLandmarks, index) => {
        const label = handedness[index]?.label; // "Left" or "Right"
        const wrist = handLandmarks[0];
    
        if (label === 'Left') leftWristSeen = true;
        if (label === 'Right') rightWristSeen = true;
    
        this.checkForPunch(wrist, label);
      });
    
      const bothWristsVisible = leftWristSeen && rightWristSeen;
    
      if (bothWristsVisible) {
        this.lastBothWristsSeenAt = now;
    
        if (this.showingWristWarning) {
          this.showingWristWarning = false;
          this.visibilityCallback?.(false); // hide banner
        }
      } else {
        const timeMissing = now - this.lastBothWristsSeenAt;
    
        if (timeMissing > this.wristGraceMs && !this.showingWristWarning) {
          this.showingWristWarning = true;
          this.visibilityCallback?.(true); // show banner
        }
      }
    }
    

    setVisibilityCallback(callback) {
      this.visibilityCallback = callback;
    }  
  
    checkForPunch(wrist, handedness) {
      const now = Date.now();
      if (now - this.lastPunchTime[handedness] < this.punchCooldown) return;
  
      const previous = this.previousHands[handedness];
  
      if (previous) {
        const dx = wrist.x - previous.x;
        const dy = wrist.y - previous.y;
        const dz = wrist.z - previous.z;
        const velocity = Math.sqrt(dx * dx + dy * dy + dz * dz);
  
        const isExtending =
          (handedness === 'Right' && dx > 0) ||
          (handedness === 'Left' && dx < 0);
  
        if (velocity > this.velocityThreshold && isExtending && Math.abs(dx) > 0.08) {
          this.punchCount++;
          this.lastPunchTime[handedness] = now;
  
          // ✅ Track fastest punch + when it happened
          if (velocity > this.fastestPunch) {
            this.fastestPunch = velocity;
            this.fastestPunchHand = handedness;
            this.fastestPunchAtMs = now;
          }
  
          console.log(`🥊 PUNCH ${this.punchCount}! ${handedness} hand - velocity: ${velocity.toFixed(3)}`);
  
          if (this.detectionCallback) {
            this.detectionCallback(this.punchCount);
          }
        }
      }
  
      this.previousHands[handedness] = {
        x: wrist.x,
        y: wrist.y,
        z: wrist.z
      };
    }
  
    async detectPunches(video, callback) {
      if (!this.isDetecting) return;
  
      this.videoElement = video;
      this.detectionCallback = callback;
  
      try {
        this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
        await this.hands.send({ image: this.canvas });
        requestAnimationFrame(() => this.detectPunches(video, callback));
      } catch (error) {
        console.error('Detection error:', error);
        requestAnimationFrame(() => this.detectPunches(video, callback));
      }
    }
  
    start(video, callback) {
      console.log('👊 Starting hand tracking...');
      this.isDetecting = true;
  
      this.punchCount = 0;
      this.previousHands = { Left: null, Right: null };
      this.lastPunchTime = { Left: 0, Right: 0 };
  
      this.fastestPunch = 0;
      this.fastestPunchHand = '';
      this.roundStartMs = Date.now();
      this.fastestPunchAtMs = 0;

      this.lastBothWristsSeenAt = Date.now();
      this.showingWristWarning = false;

  
      this.detectPunches(video, callback);
    }
  
    stop() {
      console.log('Stopping hand tracking');
      this.isDetecting = false;
    }
  
    reset() {
      this.punchCount = 0;
      this.previousHands = { Left: null, Right: null };
      this.lastPunchTime = { Left: 0, Right: 0 };
      this.fastestPunch = 0;
      this.fastestPunchHand = '';
      this.roundStartMs = 0;
      this.fastestPunchAtMs = 0;
    }
  
    // ✅ Peak moment seconds since round start (null if none)
    getPeakMomentSeconds() {
      if (!this.roundStartMs || !this.fastestPunchAtMs) return null;
      return (this.fastestPunchAtMs - this.roundStartMs) / 1000;
    }
  }
  
  export default PunchDetector;
  