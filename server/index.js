import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';

import roundsRouter from './routes/rounds.js';
import streaksRouter from './routes/streaks.js';
import usersRouter from './routes/users.js';
import VideoProcessor from './utils/videoProcessor.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const videoProcessor = new VideoProcessor();

// Run once on server boot
videoProcessor.cleanupOldVideos(24).catch(console.error);

// Run every hour
setInterval(() => {
  videoProcessor.cleanupOldVideos(24).catch(console.error);
}, 60 * 60 * 1000);

// ✅ (Recommended) Canonical host redirect so cookies/origin stay consistent
// Set CANONICAL_HOST to your chosen one, e.g. "hityourday.com"
if (process.env.CANONICAL_HOST) {
  app.use((req, res, next) => {
    const host = req.headers.host;
    if (host && host !== process.env.CANONICAL_HOST) {
      return res.redirect(301, `https://${process.env.CANONICAL_HOST}${req.originalUrl}`);
    }
    next();
  });
}

// ✅ CORS: if frontend and backend are same domain, you can actually remove cors() entirely.
// If you keep it, set credentials true so cookies are allowed.
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
  credentials: true
}));

app.use(cookieParser());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Serve uploaded videos
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// Routes
app.use('/api/rounds', roundsRouter);
app.use('/api/streaks', streaksRouter);
app.use('/api/users', usersRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

app.listen(PORT, () => {
  console.log(`🥊 HitYourDay running on port ${PORT}`);
});