class CameraManager {
  constructor() {
    this.stream = null;
    this.video = null;
  }

  async init(videoElement) {
    this.video = videoElement;

    try {
      const constraints = {
        video: {
          facingMode: 'user',
          width: { ideal: 640, max: 640 },
          height: { ideal: 480, max: 480 },
          frameRate: { ideal: 30, max: 30 }
        },
        audio: false
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;

      return new Promise((resolve) => {
        this.video.onloadedmetadata = async () => {
          await this.video.play();

          // Give the browser a moment to apply constraints
          setTimeout(() => {
            const track = this.stream.getVideoTracks()[0];
            const settings = track?.getSettings?.() || {};

            console.log('Video ready:', {
              requested: constraints.video,
              actual: {
                width: settings.width,
                height: settings.height,
                frameRate: settings.frameRate
              },
              element: {
                videoWidth: this.video.videoWidth,
                videoHeight: this.video.videoHeight
              }
            });

            resolve();
          }, 300);
        };
      });
    } catch (error) {
      console.error('Camera access error:', error);
      throw new Error('Could not access camera. Please allow camera permissions.');
    }
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }
}

export default CameraManager;