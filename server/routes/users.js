import express from 'express';
import { query } from '../db.js';

const router = express.Router();

async function getOrCreateUserIdByDevice(deviceId) {
  const existing = await query(
    `SELECT user_id FROM user_devices WHERE device_id = $1 LIMIT 1`,
    [deviceId]
  );
  if (existing.rows.length) return existing.rows[0].user_id;

  const legacy = await query(
    `SELECT id FROM users WHERE device_id = $1 LIMIT 1`,
    [deviceId]
  );

  let userId;
  if (legacy.rows.length) {
    userId = legacy.rows[0].id;
  } else {
    const created = await query(
      `INSERT INTO users (device_id) VALUES ($1) RETURNING id`,
      [deviceId]
    );
    userId = created.rows[0].id;
  }

  await query(
    `INSERT INTO user_devices (user_id, device_id)
     VALUES ($1, $2)
     ON CONFLICT (device_id) DO UPDATE SET user_id = EXCLUDED.user_id`,
    [userId, deviceId]
  );

  return userId;
}

router.post('/link-email', async (req, res) => {
  try {
    const { deviceId: bodyDeviceId, email } = req.body || {};
    const deviceId = bodyDeviceId || req.cookies?.hityourday_device_id;


    if (!deviceId || !email) {
      return res.status(400).json({ error: 'deviceId and email are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    if (!normalizedEmail.includes('@')) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    // 1) Resolve (or create) the current user for this device
    const deviceUserId = await getOrCreateUserIdByDevice(deviceId);

    // 2) Find or create the email user
    // NOTE: schema workaround: users.device_id is required/unique, so email user gets a dummy device_id
    const dummyDeviceId = `email_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const emailUserRes = await query(
      `INSERT INTO users (device_id, email)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
      [dummyDeviceId, normalizedEmail]
    );

    const emailUserId = emailUserRes.rows[0].id;

    // 3) Map this device to the email user
    await query(
      `INSERT INTO user_devices (user_id, device_id)
       VALUES ($1, $2)
       ON CONFLICT (device_id) DO UPDATE SET user_id = EXCLUDED.user_id`,
      [emailUserId, deviceId]
    );

    // 4) Move rounds from device user -> email user (streak/history follows immediately)
    if (deviceUserId !== emailUserId) {
      await query(
        `UPDATE rounds
         SET user_id = $1
         WHERE user_id = $2`,
        [emailUserId, deviceUserId]
      );

      // 5) Optional but recommended: re-point any devices mapped to the old user onto the email user
      await query(
        `UPDATE user_devices
         SET user_id = $1
         WHERE user_id = $2`,
        [emailUserId, deviceUserId]
      );
    }

    res.json({ ok: true, userId: emailUserId, email: normalizedEmail });
  } catch (err) {
    console.error('link-email error:', err);
    res.status(500).json({ error: 'Failed to link email' });
  }
});

export default router;