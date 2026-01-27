import express from 'express';
import { query } from '../db.js';

const router = express.Router();

async function resolveUserId(deviceId) {
  // Preferred: user_devices mapping (supports multiple devices per user)
  const byMap = await query(
    `SELECT user_id
     FROM user_devices
     WHERE device_id = $1
     LIMIT 1`,
    [deviceId]
  );

  if (byMap.rows.length) return byMap.rows[0].user_id;

  // Fallback: legacy users.device_id
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

// Get current streak for user (by deviceId -> userId)
router.get('/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;

    const userId = await resolveUserId(deviceId);
    if (!userId) {
      return res.json({ currentStreak: 0, longestStreak: 0 });
    }

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

    // Current streak: count back from today until a miss
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let currentStreak = 0;
    for (let i = 0; i < 3650; i++) { // hard cap for safety
      const check = new Date(today);
      check.setDate(today.getDate() - i);
      check.setHours(0, 0, 0, 0);

      if (dateSet.has(check.getTime())) currentStreak++;
      else break;
    }

    // Longest streak: scan sorted dates
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