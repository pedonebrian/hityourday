-- 002_email_and_devices.sql

-- 1) Add email to users
ALTER TABLE users
ADD COLUMN IF NOT EXISTS email TEXT;

-- unique email when provided (works even if email is null)
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique
ON users (email)
WHERE email IS NOT NULL;

-- 2) Create user_devices mapping table (UUID user_id)
CREATE TABLE IF NOT EXISTS user_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 3) Backfill existing users.device_id into user_devices
INSERT INTO user_devices (user_id, device_id)
SELECT id, device_id FROM users
ON CONFLICT (device_id) DO NOTHING;