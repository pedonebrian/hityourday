import { query } from '../db.js';
import { sendEmail } from './sendEmail.js'; // implement with SendGrid/Nodemailer/etc

export async function maybeSendStreakMilestoneEmail(userId, currentStreak) {
    // Only trigger on multiples of 10
    if (!currentStreak || currentStreak < 10) return;
    if (currentStreak % 10 !== 0) return;
  
    const milestone = currentStreak;
  
    // 1) Do we have an email?
    const u = await query(`SELECT email FROM users WHERE id = $1`, [userId]);
    const email = u.rows?.[0]?.email || null;
  
    if (!email) return;
  
    // 2) Atomically claim milestone (prevents duplicates forever)
    const ins = await query(
      `INSERT INTO user_milestones (user_id, milestone)
       VALUES ($1, $2)
       ON CONFLICT (user_id, milestone) DO NOTHING
       RETURNING user_id`,
      [userId, milestone]
    );
  
    if (ins.rowCount === 0) return; // already sent
  
    // 3) Send dynamic email
    await sendEmail({
      to: email,
      subject: `${milestone}-day streak 🔥 Keep going.`,
      text: [
        `${milestone} days in a row.`,
        ``,
        `That’s not motivation.`,
        `That’s identity.`,
        ``,
        `Tomorrow is day ${milestone + 1}.`,
        `Keep the chain alive.`,
        ``,
        `👊 — Brian Pedone`
      ].join('\n'),
    });
  }  
