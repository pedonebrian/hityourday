import express from 'express';
import { query } from '../db.js';
import { getOrCreateUserIdByDevice } from '../utils/userIdentity.js';

const router = express.Router();

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

    // ✅ Ensure cookie exists (server-side source of truth)
    res.cookie('hityourday_device_id', deviceId, {
      maxAge: 1000 * 60 * 60 * 24 * 365, // 1 year
      httpOnly: false,                  // allow client JS to read if you want; set true if not needed
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    });

    // 1) Resolve (or create) the current user for this device
    const deviceUserId = await getOrCreateUserIdByDevice(deviceId);

    // 2) Find or create the email user (schema workaround)
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

    // 4) Move rounds from device user -> email user
    if (deviceUserId !== emailUserId) {
      await query(`UPDATE rounds SET user_id = $1 WHERE user_id = $2`, [emailUserId, deviceUserId]);
      await query(`UPDATE user_devices SET user_id = $1 WHERE user_id = $2`, [emailUserId, deviceUserId]);
    }

    res.json({ ok: true, userId: emailUserId, email: normalizedEmail });
  } catch (err) {
    console.error('link-email error:', err);
    res.status(500).json({ error: 'Failed to link email' });
  }
});

export default router;