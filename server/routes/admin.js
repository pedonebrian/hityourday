import express from "express";
import { query } from "../db.js";

const router = express.Router();

/**
 * Super simple guard:
 * - set ADMIN_TOKEN in env
 * - call with header: x-admin-token: <token>
 */
function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (!process.env.ADMIN_TOKEN) {
    return res.status(500).json({ error: "ADMIN_TOKEN not configured" });
  }
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

router.get("/stats", requireAdmin, async (req, res) => {
  try {
    const totalPunchesSql = `
      SELECT COALESCE(SUM(punch_count), 0)::bigint AS total_punches
      FROM rounds
    `;

    const userCountsSql = `
      SELECT
        COUNT(*)::bigint AS total_users,
        COUNT(*) FILTER (WHERE email IS NOT NULL AND TRIM(email) <> '')::bigint AS email_users,
        COUNT(*) FILTER (WHERE email IS NULL OR TRIM(email) = '')::bigint AS no_email_users
      FROM users
    `;

    const [{ rows: totalRows }, { rows: userRows }] = await Promise.all([
      query(totalPunchesSql),
      query(userCountsSql),
    ]);

    const u = userRows?.[0] ?? {};

    res.json({
      totalPunches: Number(totalRows?.[0]?.total_punches ?? 0),
      totalUsers: Number(u.total_users ?? 0),
      uniqueEmailUsers: Number(u.email_users ?? 0),
      uniqueUsersNoEmail: Number(u.no_email_users ?? 0),
    });
  } catch (err) {
    console.error("admin stats error:", err);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

export default router;