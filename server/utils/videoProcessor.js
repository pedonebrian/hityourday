import ffmpeg from 'fluent-ffmpeg';
ffmpeg.setFfmpegPath('/opt/homebrew/bin/ffmpeg');

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas } from 'canvas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Using ffmpeg at:', ffmpeg._getFfmpegPath?.() || '(unknown)');

class VideoProcessor {
  constructor() {
    this.uploadsDir = path.join(__dirname, '../../public/uploads');
    this.ensureUploadDir();
  }

  ensureUploadDir() {
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
  }

  // ✅ Get duration via ffprobe (reliable random)
  async getDurationSeconds(inputPath) {
    return new Promise((resolve) => {
      ffmpeg.ffprobe(inputPath, (err, meta) => {
        if (err) return resolve(null);
        const d = Number(meta?.format?.duration);
        resolve(Number.isFinite(d) ? d : null);
      });
    });
  }

  // ✅ Extract a clip starting at a specific time (or 0)
  async extractClipAt(inputPath, outputPath, startSeconds = 0, durationSeconds = 5) {
    const start = Number.isFinite(Number(startSeconds)) ? Math.max(0, Number(startSeconds)) : 0;
    const dur = Number.isFinite(Number(durationSeconds)) ? Number(durationSeconds) : 5;

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(start)
        .outputOptions([
          '-map 0:v:0?',
          '-map 0:a:0?',
          `-t ${dur}`,
          '-preset fast',
          '-crf 23',
          '-movflags +faststart'
        ])
        .videoCodec('libx264')
        .output(outputPath)
        .on('end', () => resolve(outputPath))
        .on('error', reject)
        .run();
    });
  }

  // ✅ Overlay PNG with punches, total time, pace, top speed, streak (if >1), @hityourday
async createOverlayPng(outputPath, { punches, roundSeconds, pace, topSpeedMph, streak }) {
  const W = 1080;
  const H = 1920;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const pad = 60;

  const fmtPunches = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return '--';
    if (v < 1000) return `${v}`;
    if (v < 10000) return `${(v / 1000).toFixed(1)}K`;
    return `${Math.round(v / 1000)}K`;
  };  

  const fmtTime = (s) => {
    const n = Number.isFinite(Number(s)) ? Math.max(0, Math.round(Number(s))) : 0;
    const m = Math.floor(n / 60);
    const r = n % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  };

  const num = (v, digits = 1) => {
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(digits) : '--';
  };

  // TOP CARD (taller to fit streak line)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.58)';
  const cardY = 60;
  const cardH = 560; // taller than before
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(pad, cardY, W - pad * 2, cardH, 40);
  else ctx.rect(pad, cardY, W - pad * 2, cardH);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Big punches
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 110px Arial';
  ctx.fillText(`${fmtPunches(punches)} PUNCHES`, W / 2, cardY + 120);

  // Total round time
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '800 52px Arial';
  ctx.fillText(`${fmtTime(roundSeconds)} ROUND`, W / 2, cardY + 215);

  // Divider
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(pad + 40, cardY + 265);
  ctx.lineTo(W - pad - 40, cardY + 265);
  ctx.stroke();

  // Stats
  const leftX = W / 2 - 260;
  const rightX = W / 2 + 260;

  const labelY = cardY + 355;
  const valueY = cardY + 425;

  ctx.font = '800 40px Arial';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText('PACE', leftX, labelY);
  ctx.fillText('TOP SPEED', rightX, labelY);

  ctx.font = '900 62px Arial';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(`${num(pace, 1)}`, leftX, valueY);
  ctx.fillText(`${num(topSpeedMph, 1)}`, rightX, valueY);

  ctx.font = '700 28px Arial';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText('punches/min', leftX, valueY + 60);
  ctx.fillText('mph (est.)', rightX, valueY + 60);

  // Streak line (only if > 1)
  const s = Number(streak);
  if (Number.isFinite(s) && s > 1) {
    ctx.font = '900 46px Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillText(`🔥 ${s} DAY STREAK`, W / 2, cardY + 525);
  }

  // BOTTOM BRAND
  ctx.fillStyle = 'rgba(0, 0, 0, 0.58)';
  const barH = 200;
  const barY = H - barH - 80;

  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(pad, barY, W - pad * 2, barH, 40);
  else ctx.rect(pad, barY, W - pad * 2, barH);
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '900 62px Arial';
  ctx.fillText('HIT YOUR DAY', W / 2, barY + 75);

  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '900 44px Arial';
  ctx.fillText('@hityourday', W / 2, barY + 145);

  fs.writeFileSync(outputPath, canvas.toBuffer('image/png'));
  return outputPath;
}

  // ✅ Burn overlay + export vertical social format
  async burnOverlayAndFormat(inputVideoPath, overlayPngPath, outputPath) {
    return new Promise((resolve, reject) => {
      const filter = [
        { filter: 'scale', options: '1080:1920:force_original_aspect_ratio=increase', inputs: '0:v', outputs: 'scaled' },
        { filter: 'crop', options: '1080:1920:(in_w-1080)/2:(in_h-1920)/2', inputs: 'scaled', outputs: 'base' },
        { filter: 'scale', options: '1080:1920', inputs: '1:v', outputs: 'ovl' },
        { filter: 'overlay', options: '0:0', inputs: ['base', 'ovl'], outputs: 'outv' }
      ];

      ffmpeg()
        .input(inputVideoPath)
        .input(overlayPngPath)
        .complexFilter(filter, 'outv')
        .outputOptions([
          '-map 0:a:0?',
          '-c:v libx264',
          '-pix_fmt yuv420p',
          '-c:a aac',
          '-b:a 128k',
          '-movflags +faststart',
          '-preset fast',
          '-crf 23'
        ])
        .output(outputPath)
        .on('start', (cmd) => console.log('ffmpeg cmd:', cmd))
        .on('stderr', (line) => console.log('[ffmpeg]', line))
        .on('end', () => resolve(outputPath))
        .on('error', reject)
        .run();
    });
  }

  // ✅ Full pipeline: random 5 seconds
  async processRoundVideo(inputPath, roundData) {
    const timestamp = Date.now();

    const rawClipPath = path.join(this.uploadsDir, `clip_${timestamp}.mp4`);
    const overlayPath = path.join(this.uploadsDir, `overlay_${timestamp}.png`);
    const finalPath = path.join(this.uploadsDir, `final_${timestamp}.mp4`);

    const clipSeconds = 5;

    const punches = Number(roundData?.punchCount ?? 0);
    const roundSeconds = Number(roundData?.durationSeconds ?? 0);
    const pace = Number(roundData?.punchesPerMinute ?? 0);
    const topSpeedMph = Number(roundData?.topSpeedMph ?? 0);
    const streak = Number(roundData?.currentStreak ?? roundData?.streak ?? 0);

    try {
      const duration = await this.getDurationSeconds(inputPath);

      // Random start in [0, duration-clipSeconds]
      let start = 0;
      if (Number.isFinite(duration) && duration > clipSeconds) {
        const maxStart = Math.max(0, duration - clipSeconds);
        start = Math.random() * maxStart;
      }

      // Extract random 5 seconds
      await this.extractClipAt(inputPath, rawClipPath, start, clipSeconds);

      // Overlay using full-round stats
      await this.createOverlayPng(overlayPath, { punches, roundSeconds, pace, topSpeedMph, streak });

      // Burn overlay + vertical export
      await this.burnOverlayAndFormat(rawClipPath, overlayPath, finalPath);

      // cleanup
      if (fs.existsSync(rawClipPath)) fs.unlinkSync(rawClipPath);
      if (fs.existsSync(overlayPath)) fs.unlinkSync(overlayPath);

      return `/uploads/final_${timestamp}.mp4`;
    } catch (error) {
      [rawClipPath, overlayPath, finalPath].forEach(p => {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      });
      throw error;
    }
  }
}

export default VideoProcessor;