import express from 'express';
import { query } from '../db.js';

const router = express.Router();

router.post('/link-email', async (req, res) => {
  try {
    const { deviceId, email } = req.body || {};

    if (!deviceId || !email) {
      return res.status(400).json({ error: 'deviceId and email are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    if (!normalizedEmail.includes('@')) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    // 1) Find the existing "device user" (this always exists in your current flow)
    const deviceUserRes = await query(
      `SELECT id FROM users WHERE device_id = $1 LIMIT 1`,
      [deviceId]
    );

    if (!deviceUserRes.rows.length) {
      return res.status(404).json({ error: 'Device user not found' });
    }

    const deviceUserId = deviceUserRes.rows[0].id;

    // 2) Find or create the "email user"
    // IMPORTANT: since users.device_id is UNIQUE NOT NULL, we must give a unique dummy device_id
    // for the email user (temporary workaround until you relax users.device_id).
    let emailUserId = null;

    const emailUserRes = await query(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [normalizedEmail]
    );

    if (emailUserRes.rows.length) {
      emailUserId = emailUserRes.rows[0].id;
    } else {
      const dummyDeviceId = `email_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      const created = await query(
        `INSERT INTO users (device_id, email)
         VALUES ($1, $2)
         RETURNING id`,
        [dummyDeviceId, normalizedEmail]
      );

      emailUserId = created.rows[0].id;
    }

    // 3) Link the current device to the email user in user_devices
    await query(
      `INSERT INTO user_devices (user_id, device_id)
       VALUES ($1, $2)
       ON CONFLICT (device_id) DO UPDATE SET user_id = EXCLUDED.user_id`,
      [emailUserId, deviceId]
    );

    // 4) Move rounds from device user -> email user (so streak/history follows immediately)
    if (deviceUserId !== emailUserId) {
      await query(
        `UPDATE rounds
         SET user_id = $1
         WHERE user_id = $2`,
        [emailUserId, deviceUserId]
      );
    }

    // 5) (Optional) Also store email on the device-user row for convenience (not required)
    // This can fail if email is already taken by another user, so ignore errors safely.
    try {
      await query(`UPDATE users SET email = $1 WHERE id = $2`, [normalizedEmail, deviceUserId]);
    } catch (e) {}

    res.json({ ok: true, userId: emailUserId, email: normalizedEmail });
  } catch (err) {
    console.error('link-email error:', err);
    res.status(500).json({ error: 'Failed to link email' });
  }
});

export default router;