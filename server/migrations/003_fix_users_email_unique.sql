-- 003_fix_users_email_unique.sql

-- Ensure column exists
ALTER TABLE users
ADD COLUMN IF NOT EXISTS email TEXT;

-- If the old UNIQUE INDEX exists (from the partial index approach), drop it
DROP INDEX IF EXISTS users_email_unique;

-- Now add the proper UNIQUE constraint (needed for ON CONFLICT(email))
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_email_unique'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_email_unique UNIQUE (email);
  END IF;
END$$;