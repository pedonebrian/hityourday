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
    // Assumptions (adjust if your schema differs):
    // - rounds.punch_count exists
    // - users.email exists (nullable)
    const totalPunchesSql = `
      SELECT COALESCE(SUM(punch_count), 0)::bigint AS total_punches
      FROM rounds
    `;

    const emailUsersSql = `
      SELECT COUNT(*)::bigint AS email_users
      FROM users
      WHERE email IS NOT NULL AND TRIM(email) <> ''
    `;

    const [{ rows: totalRows }, { rows: emailRows }] = await Promise.all([
      query(totalPunchesSql),
      query(emailUsersSql),
    ]);

    res.json({
      totalPunches: Number(totalRows?.[0]?.total_punches ?? 0),
      uniqueEmailUsers: Number(emailRows?.[0]?.email_users ?? 0),
    });
  } catch (err) {
    console.error("admin stats error:", err);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

export default router;