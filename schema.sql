-- =========================================
-- 1. 請假申請
-- =========================================

CREATE TABLE IF NOT EXISTS leave_requests (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    reason TEXT NOT NULL,

    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),

    submitted_at TEXT NOT NULL,
    requester_token TEXT NOT NULL,
    reviewed_at TEXT,
    review_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_requester
ON leave_requests (
    requester_token,
    submitted_at
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_status
ON leave_requests (
    status,
    submitted_at
);


-- =========================================
-- 2. 每日簽到
-- =========================================

CREATE TABLE IF NOT EXISTS checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    checked_at TEXT NOT NULL,
    requester_token TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    distance_m INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_user_date
ON checkins (
    requester_token,
    date
);

CREATE INDEX IF NOT EXISTS idx_checkins_date
ON checkins (date);

CREATE INDEX IF NOT EXISTS idx_checkins_checked_at
ON checkins (checked_at);


-- =========================================
-- 3. 每日心情指數
-- =========================================

CREATE TABLE IF NOT EXISTS daily_moods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    requester_token TEXT NOT NULL,
    score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
    reason TEXT,
    submitted_at TEXT NOT NULL,
    UNIQUE (requester_token, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_moods_date
ON daily_moods (date);


-- =========================================
-- 4. 國定假日
-- =========================================

CREATE TABLE IF NOT EXISTS holidays (
    date TEXT PRIMARY KEY
);
