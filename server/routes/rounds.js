import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { query } from '../db.js';
import VideoProcessor from '../utils/videoProcessor.js';
import { getOrCreateUserIdByDevice, resolveUserIdByDevice } from '../utils/userIdentity.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const videoProcessor = new VideoProcessor();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../temp');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `upload_${Date.now()}_${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

async function computeCurrentStreak(userId) {
  const result = await query(
    `SELECT COUNT(DISTINCT date)::int AS days_showed_up
     FROM rounds
     WHERE user_id = $1`,
    [userId]
  );

  return Number(result.rows?.[0]?.days_showed_up || 0);
}

router.get('/history', async (req, res) => {
  try {
    const deviceId = req.cookies?.hityourday_device_id;
    const limit = parseInt(req.query.limit) || 30;

    if (!deviceId) return res.json([]);

    const userId = await resolveUserIdByDevice(deviceId);
    if (!userId) return res.json([]);

    const result = await query(
      `SELECT *
       FROM rounds
       WHERE user_id = $1
       ORDER BY completed_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

router.get('/today', async (req, res) => {
  try {
    const deviceId = req.cookies?.hityourday_device_id;

    if (!deviceId) {
      return res.json({ rounds_today: 0, total_punches: 0, avg_pace: 0 });
    }

    const userId = await resolveUserIdByDevice(deviceId);
    if (!userId) {
      return res.json({ rounds_today: 0, total_punches: 0, avg_pace: 0 });
    }

    const result = await query(
      `SELECT
         COUNT(*) as rounds_today,
         COALESCE(SUM(punch_count), 0) as total_punches,
         COALESCE(AVG(punches_per_minute), 0) as avg_pace
       FROM rounds
       WHERE user_id = $1 AND date = CURRENT_DATE`,
      [userId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching today stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

router.post(
  '/',
  // ✅ log request size BEFORE multer consumes the body
  (req, res, next) => {
    const cl = req.headers['content-length'];
    console.log('📦 /api/rounds incoming upload', {
      contentLength: cl ? Number(cl) : null,
      contentType: req.headers['content-type'] || null,
      userAgent: req.headers['user-agent'] || null
    });
    next();
  },

  // ✅ run multer with explicit error handling
  (req, res, next) => {
    upload.single('video')(req, res, (err) => {
      if (err) {
        console.error('❌ Multer error', {
          code: err.code,
          message: err.message
        });

        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'Upload too large' });
        }
        return res.status(400).json({ error: 'Upload failed' });
      }
      next();
    });
  },

  // ✅ your handler (mostly unchanged)
  async (req, res) => {
    let tempVideoPath = null;

    try {
      const deviceId = req.body.deviceId || req.cookies?.hityourday_device_id;

      const punchCount = Number(req.body.punchCount);
      const durationSeconds = Number(req.body.durationSeconds);
      const paceFromClient = Number(req.body.pace);
      const topSpeedMphFromClient = Number(req.body.topSpeedMph);

      if (!deviceId || !Number.isFinite(punchCount) || !Number.isFinite(durationSeconds)) {
        return res.status(400).json({ error: 'Missing/invalid required fields' });
      }

      // ✅ log multer file size if present
      if (req.file) {
        console.log('🎥 Multer received file', {
          fieldname: req.file.fieldname,
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          sizeBytes: req.file.size,
          sizeMB: Number((req.file.size / (1024 * 1024)).toFixed(2)),
          path: req.file.path
        });
      } else {
        console.log('🎥 No file received (req.file is null)');
      }

      const userId = await getOrCreateUserIdByDevice(deviceId);

      const punchesPerMinute = (Number.isFinite(paceFromClient) && paceFromClient > 0)
        ? paceFromClient
        : (durationSeconds > 0 ? (punchCount / durationSeconds) * 60 : 0);

      const topSpeedMph = Number.isFinite(topSpeedMphFromClient) ? topSpeedMphFromClient : 0;

      const roundResult = await query(
        `INSERT INTO rounds (user_id, punch_count, duration_seconds, punches_per_minute)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [userId, punchCount, durationSeconds, punchesPerMinute.toFixed(2)]
      );

      const round = roundResult.rows[0];

      const currentStreak = await computeCurrentStreak(userId);
      round.current_streak = currentStreak;

      // attach for UI even if DB doesn't store them
      round.punches_per_minute = Number(punchesPerMinute.toFixed(2));
      round.top_speed_mph = Number(topSpeedMph.toFixed(1));

      if (req.file) {
        tempVideoPath = req.file.path;

        try {
          const shareVideoUrl = await videoProcessor.processRoundVideo(tempVideoPath, {
            punchCount,
            durationSeconds,
            punchesPerMinute,
            topSpeedMph,
            currentStreak
          });

          await query('UPDATE rounds SET share_video_url = $1 WHERE id = $2', [shareVideoUrl, round.id]);
          round.share_video_url = shareVideoUrl;

          await query(
            `INSERT INTO round_videos (round_id, original_filename, processed_filename, file_size_bytes)
             VALUES ($1, $2, $3, $4)`,
            [round.id, req.file.originalname, shareVideoUrl, req.file.size]
          );
        } catch (videoError) {
          console.error('Video processing error:', videoError);
          console.error('Stack:', videoError.stack);
        } finally {
          if (tempVideoPath && fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        }
      }

      res.json(round);
    } catch (error) {
      console.error('Error saving round:', error);
      if (tempVideoPath && fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
      res.status(500).json({ error: 'Failed to save round' });
    }
  }
);

router.get('/history/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const limit = parseInt(req.query.limit) || 30;

    const userId = await resolveUserIdByDevice(deviceId);
    if (!userId) return res.json([]);

    const result = await query(
      `SELECT *
       FROM rounds
       WHERE user_id = $1
       ORDER BY completed_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

router.get('/today/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;

    const userId = await resolveUserIdByDevice(deviceId);
    if (!userId) {
      return res.json({ rounds_today: 0, total_punches: 0, avg_pace: 0 });
    }

    const result = await query(
      `SELECT
         COUNT(*) as rounds_today,
         COALESCE(SUM(punch_count), 0) as total_punches,
         COALESCE(AVG(punches_per_minute), 0) as avg_pace
       FROM rounds
       WHERE user_id = $1 AND date = CURRENT_DATE`,
      [userId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching today stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;