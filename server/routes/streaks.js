// server/routes/streaks.js
import express from 'express';
import { query } from '../db.js';
import { resolveUserIdByDevice, getOrCreateUserIdByDevice } from '../utils/userIdentity.js';

const router = express.Router();


async function computeStreak(userId) {
  // All distinct active days
  const result = await query(
    `SELECT COUNT(DISTINCT date)::int AS days_showed_up,
            MAX(date) AS last_activity
     FROM rounds
     WHERE user_id = $1`,
    [userId]
  );

  const daysShowedUp = Number(result.rows?.[0]?.days_showed_up || 0);
  const lastActivityRaw = result.rows?.[0]?.last_activity || null;

  // Normalize lastActivity to a Date at midnight (optional, but consistent)
  let lastActivity = null;
  if (lastActivityRaw) {
    const d = new Date(lastActivityRaw);
    d.setHours(0, 0, 0, 0);
    lastActivity = d;
  }

  // For backwards compatibility with existing frontend fields:
  return {
    currentStreak: daysShowedUp,
    longestStreak: daysShowedUp, // same value (since we're not tracking consecutive chains)
    lastActivity
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