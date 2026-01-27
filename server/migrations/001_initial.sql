-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Rounds table
CREATE TABLE IF NOT EXISTS rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    punch_count INTEGER NOT NULL,
    duration_seconds INTEGER NOT NULL,
    punches_per_minute DECIMAL(5,2),
    share_video_url TEXT,
    completed_at TIMESTAMP DEFAULT NOW(),
    date DATE DEFAULT CURRENT_DATE
);

-- Videos table
CREATE TABLE IF NOT EXISTS round_videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id UUID REFERENCES rounds(id) ON DELETE CASCADE,
    original_filename VARCHAR(255),
    processed_filename VARCHAR(255),
    file_size_bytes BIGINT,
    duration_seconds DECIMAL(5,2),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rounds_user_id ON rounds(user_id);
CREATE INDEX IF NOT EXISTS idx_rounds_date ON rounds(date);
CREATE INDEX IF NOT EXISTS idx_rounds_completed_at ON rounds(completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_round_id ON round_videos(round_id);