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

    // Ignore any rounds that might have a NULL user_id (schema allows it)
    const activitySql = `
      SELECT
        COUNT(DISTINCT CASE WHEN date = current_date THEN user_id END)::bigint AS dau,
        COUNT(DISTINCT CASE WHEN date >= current_date - 6 THEN user_id END)::bigint AS wau,
        COUNT(DISTINCT CASE WHEN date >= current_date - 29 THEN user_id END)::bigint AS mau
      FROM rounds
      WHERE user_id IS NOT NULL
    `;

    const last7Sql = `
      WITH days AS (
        SELECT generate_series(current_date - 6, current_date, interval '1 day')::date AS day
      ),
      daily AS (
        SELECT
          r.date AS day,
          COUNT(*)::bigint AS rounds,
          COUNT(DISTINCT r.user_id)::bigint AS dau,
          COALESCE(SUM(r.punch_count), 0)::bigint AS punches,
          (AVG(CASE WHEN r.hit_daily_goal THEN 1 ELSE 0 END) * 100)::numeric(5,2) AS goal_hit_rate_pct
        FROM rounds r
        WHERE r.user_id IS NOT NULL
          AND r.date >= current_date - 6
        GROUP BY r.date
      )
      SELECT
        d.day,
        COALESCE(x.dau, 0) AS dau,
        COALESCE(x.rounds, 0) AS rounds,
        COALESCE(x.punches, 0) AS punches,
        COALESCE(x.goal_hit_rate_pct, 0) AS goal_hit_rate_pct
      FROM days d
      LEFT JOIN daily x ON x.day = d.day
      ORDER BY d.day;
    `;

    // "Active days" = distinct dates with >= 1 round (not necessarily consecutive)
    const days10PlusSql = `
      WITH user_days AS (
        SELECT user_id, COUNT(DISTINCT date)::int AS active_days
        FROM rounds
        WHERE user_id IS NOT NULL
        GROUP BY user_id
      )
      SELECT
        COUNT(*) FILTER (WHERE active_days >= 10)::bigint AS users_10_plus_days,
        MAX(active_days)::int AS max_active_days
      FROM user_days;
    `;

    const [
      { rows: totalRows },
      { rows: userRows },
      { rows: activityRows },
      { rows: last7Rows },
      { rows: daysRows },
    ] = await Promise.all([
      query(totalPunchesSql),
      query(userCountsSql),
      query(activitySql),
      query(last7Sql),
      query(days10PlusSql),
    ]);

    const u = userRows?.[0] ?? {};
    const a = activityRows?.[0] ?? {};
    const d = daysRows?.[0] ?? {};

    const totalUsers = Number(u.total_users ?? 0);
    const emailUsers = Number(u.email_users ?? 0);

    res.json({
      totalPunches: Number(totalRows?.[0]?.total_punches ?? 0),

      totalUsers,
      uniqueEmailUsers: emailUsers,
      uniqueUsersNoEmail: Number(u.no_email_users ?? 0),
      emailCaptureRatePct: totalUsers > 0 ? Number(((emailUsers / totalUsers) * 100).toFixed(1)) : 0,

      dau: Number(a.dau ?? 0),
      wau: Number(a.wau ?? 0),
      mau: Number(a.mau ?? 0),

      last7Days: (last7Rows ?? []).map((r) => ({
        day: r.day, // date
        dau: Number(r.dau ?? 0),
        rounds: Number(r.rounds ?? 0),
        punches: Number(r.punches ?? 0),
        goalHitRatePct: Number(r.goal_hit_rate_pct ?? 0),
      })),

      users10PlusDays: Number(d.users_10_plus_days ?? 0),
      maxActiveDays: Number(d.max_active_days ?? 0),
    });
  } catch (err) {
    console.error("admin stats error:", err);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

export default router;