// Handle native share when available
document.addEventListener('DOMContentLoaded', () => {
    const shareBtn = document.getElementById('share-native');
    const videoPreview = document.getElementById('share-video-preview');
  
    if (!shareBtn) return;
  
    shareBtn.addEventListener('click', async () => {
      try {
        if (navigator.share) {
          const videoUrl = videoPreview.src;
          const response = await fetch(videoUrl);
          const blob = await response.blob();
          const file = new File([blob], 'hityourday.mp4', { type: 'video/mp4' });
  
          const punchCount = document.getElementById('summary-punches').textContent;
          
          await navigator.share({
            title: 'Hit Your Day',
            text: `I just threw ${punchCount} punches! 🥊`,
            files: [file]
          });
        } else {
          // Fallback: copy link
          const videoUrl = window.location.origin + videoPreview.src;
          await navigator.clipboard.writeText(videoUrl);
          alert('Video link copied to clipboard!');
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Share failed:', error);
        }
      }
    });
  });