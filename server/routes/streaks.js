// server/routes/streaks.js
import express from 'express';
import { query } from '../db.js';
import { resolveUserIdByDevice, getOrCreateUserIdByDevice } from '../utils/userIdentity.js';

const router = express.Router();

/**
 * Pure streak calculator (no side effects)
 */
async function computeStreak(userId) {
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
    return { currentStreak: 0, longestStreak: 0 };
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

  // Longest streak (walk sorted DESC list)
  let longestStreak = 1;
  let tempStreak = 1;

  for (let i = 0; i < dates.length - 1; i++) {
    const dayDiff = Math.round(
      (dates[i].getTime() - dates[i + 1].getTime()) / (1000 * 60 * 60 * 24)
    );

    if (dayDiff === 1) {
      tempStreak++;
      longestStreak = Math.max(longestStreak, tempStreak);
    } else {
      tempStreak = 1;
    }
  }

  longestStreak = Math.max(longestStreak, currentStreak, longestStreak);

  return {
    currentStreak,
    longestStreak,
    lastActivity: dates[0]
  };
}

/**
 * ✅ NEW: cookie-first streak endpoint for homepage
 * GET /api/streaks
 * - Uses hityourday_device_id cookie
 * - No side effects (won’t create users for random visitors)
 */
router.get('/', async (req, res) => {
  try {
    const deviceId = req.cookies?.hityourday_device_id;
    if (!deviceId) return res.json({ currentStreak: 0, longestStreak: 0 });

    const userId = await resolveUserIdByDevice(deviceId);
    if (!userId) return res.json({ currentStreak: 0, longestStreak: 0 });

    res.json(await computeStreak(userId));
  } catch (error) {
    console.error('Error calculating streak:', error);
    res.status(500).json({ error: 'Failed to calculate streak' });
  }
});

/**
 * (Backwards compatible) GET /api/streaks/:deviceId
 * - Uses param OR cookie fallback
 * - Creates mapping if missing (matches your current behavior)
 */
router.get('/:deviceId', async (req, res) => {
  try {
    const paramId = req.params.deviceId;
    const cookieId = req.cookies?.hityourday_device_id;

    const deviceId =
      (paramId && paramId !== 'undefined' && paramId !== 'null') ? paramId : cookieId;

    if (!deviceId) {
      return res.json({ currentStreak: 0, longestStreak: 0 });
    }

    // ✅ Create mapping if missing (your existing behavior)
    const userId = await getOrCreateUserIdByDevice(deviceId);

    res.json(await computeStreak(userId));
  } catch (error) {
    console.error('Error calculating streak:', error);
    res.status(500).json({ error: 'Failed to calculate streak' });
  }
});

export default router;