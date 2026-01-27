import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { query } from '../db.js';
import VideoProcessor from '../utils/videoProcessor.js';

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

// Resolve user_id from deviceId (supports email-linked devices + legacy fallback)
async function resolveUserId(deviceId) {
  // Preferred: user_devices mapping
  const byMap = await query(
    `SELECT user_id
     FROM user_devices
     WHERE device_id = $1
     LIMIT 1`,
    [deviceId]
  );

  if (byMap.rows.length) return byMap.rows[0].user_id;

  // Fallback: legacy users.device_id (for old rows / before linking)
  const legacy = await query(
    `SELECT id as user_id
     FROM users
     WHERE device_id = $1
     LIMIT 1`,
    [deviceId]
  );

  if (legacy.rows.length) return legacy.rows[0].user_id;

  return null;
}

async function computeCurrentStreak(userId) {
  const result = await query(
    `SELECT DISTINCT date
     FROM rounds
     WHERE user_id = $1
     ORDER BY date DESC`,
    [userId]
  );

  if (!result.rows.length) return 0;

  const dates = result.rows.map(r => {
    const d = new Date(r.date);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  });

  const dateSet = new Set(dates);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let streak = 0;
  for (let i = 0; i < 3650; i++) {
    const check = new Date(today);
    check.setDate(today.getDate() - i);
    check.setHours(0, 0, 0, 0);

    if (dateSet.has(check.getTime())) streak++;
    else break;
  }

  return streak;
}

async function getOrCreateUserIdByDevice(deviceId) {
  // 1) If this device is already mapped, use that user_id
  const existing = await query(
    `SELECT user_id FROM user_devices WHERE device_id = $1 LIMIT 1`,
    [deviceId]
  );
  if (existing.rows.length) return existing.rows[0].user_id;

  // 2) If a legacy user exists with users.device_id = deviceId, use it
  const legacy = await query(
    `SELECT id FROM users WHERE device_id = $1 LIMIT 1`,
    [deviceId]
  );

  let userId;
  if (legacy.rows.length) {
    userId = legacy.rows[0].id;
  } else {
    // 3) Otherwise create a new anonymous user row with device_id (required by schema)
    const created = await query(
      `INSERT INTO users (device_id) VALUES ($1) RETURNING id`,
      [deviceId]
    );
    userId = created.rows[0].id;
  }

  // 4) Ensure mapping exists
  await query(
    `INSERT INTO user_devices (user_id, device_id)
     VALUES ($1, $2)
     ON CONFLICT (device_id) DO UPDATE SET user_id = EXCLUDED.user_id`,
    [userId, deviceId]
  );

  return userId;
}

router.post('/', upload.single('video'), async (req, res) => {
  let tempVideoPath = null;

  try {
    const deviceId = req.body.deviceId;

    const punchCount = Number(req.body.punchCount);
    const durationSeconds = Number(req.body.durationSeconds);
    const paceFromClient = Number(req.body.pace);
    const topSpeedMphFromClient = Number(req.body.topSpeedMph);

    const clipStartRaw = req.body.clipStart;
    const clipStart = (clipStartRaw === '' || clipStartRaw == null) ? null : Number(clipStartRaw);

    if (!deviceId || !Number.isFinite(punchCount) || !Number.isFinite(durationSeconds)) {
      return res.status(400).json({ error: 'Missing/invalid required fields' });
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
          clipStart,
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
});

router.get('/history/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const limit = parseInt(req.query.limit) || 30;

    const userId = await resolveUserId(deviceId);
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

    const userId = await resolveUserId(deviceId);
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