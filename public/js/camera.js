class CameraManager {
    constructor() {
      this.stream = null;
      this.video = null;
    }
  
    async init(videoElement) {
      this.video = videoElement;
  
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'user'
          },
          audio: false
        });
  
        this.video.srcObject = this.stream;
        
        return new Promise((resolve) => {
          this.video.onloadedmetadata = () => {
            this.video.play();
            
            // ADD THIS: Wait for video to actually be playing
            setTimeout(() => {
              console.log('Video ready:', {
                width: this.video.videoWidth,
                height: this.video.videoHeight,
                playing: !this.video.paused
              });
              resolve();
            }, 500);
          };
        });
      } catch (error) {
        console.error('Camera access error:', error);
        throw new Error('Could not access camera. Please allow camera permissions.');
      }
    }
  
    stop() {
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
      }
    }
  }
  
  export default CameraManager;