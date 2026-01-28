import express from 'express';
import { query } from '../db.js';

const router = express.Router();

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
    // 3) Otherwise create a new anonymous user row
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

// Get current streak for user (by deviceId -> userId)
router.get('/:deviceId', async (req, res) => {
  try {
    const deviceId = req.params.deviceId || req.cookies?.hityourday_device_id;

    // ✅ Create mapping if missing
    const userId = await getOrCreateUserIdByDevice(deviceId);

    // Grab distinct active dates for this user
    const result = await query(
      `SELECT DISTINCT date
       FROM rounds
       WHERE user_id = $1
       ORDER BY date DESC`,
      [userId]
    );

    const dates = result.rows.map(r => {
      const d = new Date(r.date);
      d.setHours(0, 0, 0, 0);
      return d;
    });

    if (dates.length === 0) {
      return res.json({ currentStreak: 0, longestStreak: 0 });
    }

    const dateSet = new Set(dates.map(d => d.getTime()));

    // Current streak
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let currentStreak = 0;
    for (let i = 0; i < 3650; i++) {
      const check = new Date(today);
      check.setDate(today.getDate() - i);
      check.setHours(0, 0, 0, 0);

      if (dateSet.has(check.getTime())) currentStreak++;
      else break;
    }

    // Longest streak
    let longestStreak = 1;
    let tempStreak = 1;

    for (let i = 0; i < dates.length - 1; i++) {
      const dayDiff = Math.round((dates[i].getTime() - dates[i + 1].getTime()) / (1000 * 60 * 60 * 24));
      if (dayDiff === 1) {
        tempStreak++;
        longestStreak = Math.max(longestStreak, tempStreak);
      } else {
        tempStreak = 1;
      }
    }

    longestStreak = Math.max(longestStreak, currentStreak, longestStreak);

    res.json({
      currentStreak,
      longestStreak,
      lastActivity: dates[0]
    });
  } catch (error) {
    console.error('Error calculating streak:', error);
    res.status(500).json({ error: 'Failed to calculate streak' });
  }
});

export default router;