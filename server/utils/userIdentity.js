// server/utils/userIdentity.js
import { query } from '../db.js';

/**
 * Canonical "device -> user_id" resolver.
 * - uses user_devices mapping (preferred)
 * - falls back to legacy users.device_id
 * - creates an anonymous user if missing
 * - upserts the mapping so it stays consistent
 */
export async function getOrCreateUserIdByDevice(deviceId) {
  if (!deviceId) throw new Error('deviceId is required');

  // 1) If this device is already mapped, use that user_id
  const existing = await query(
    `SELECT user_id
     FROM user_devices
     WHERE device_id = $1
     LIMIT 1`,
    [deviceId]
  );
  if (existing.rows.length) return existing.rows[0].user_id;

  // 2) Legacy fallback: users.device_id
  const legacy = await query(
    `SELECT id
     FROM users
     WHERE device_id = $1
     LIMIT 1`,
    [deviceId]
  );

  let userId;
  if (legacy.rows.length) {
    userId = legacy.rows[0].id;
  } else {
    // 3) Create anonymous user
    const created = await query(
      `INSERT INTO users (device_id)
       VALUES ($1)
       RETURNING id`,
      [deviceId]
    );
    userId = created.rows[0].id;
  }

  // 4) Ensure mapping exists (device_id should be UNIQUE in user_devices)
  await query(
    `INSERT INTO user_devices (user_id, device_id)
     VALUES ($1, $2)
     ON CONFLICT (device_id) DO UPDATE SET user_id = EXCLUDED.user_id`,
    [userId, deviceId]
  );

  return userId;
}

/**
 * "Soft" resolver that does NOT create rows.
 * Use for read-only endpoints if you don't want side effects.
 */
export async function resolveUserIdByDevice(deviceId) {
  if (!deviceId) return null;

  const byMap = await query(
    `SELECT user_id
     FROM user_devices
     WHERE device_id = $1
     LIMIT 1`,
    [deviceId]
  );
  if (byMap.rows.length) return byMap.rows[0].user_id;

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