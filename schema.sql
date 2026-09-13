-- =========================================
-- 每日簽到 + 請假 + 心情 + 國定假日
-- Cloudflare D1 Database Schema
-- =========================================

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

CREATE INDEX IF NOT EXISTS idx_leave_requests_date
ON leave_requests (date);


-- =========================================
-- 2. 成功簽到紀錄
-- source:
--   checkin = 一般 GPS 簽到
--   leave   = 請假核准後視為成功簽到
-- =========================================
CREATE TABLE IF NOT EXISTS checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    checked_at TEXT NOT NULL,
    requester_token TEXT NOT NULL,

    -- 一般簽到才有 GPS；請假核准時為 NULL
    latitude REAL,
    longitude REAL,
    distance_m INTEGER,

    source TEXT NOT NULL DEFAULT 'checkin'
        CHECK (source IN ('checkin', 'leave'))
);

-- 每個使用者每天最多只有一筆成功出勤
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_user_date
ON checkins (
    requester_token,
    date
);

CREATE INDEX IF NOT EXISTS idx_checkins_date
ON checkins (date);

CREATE INDEX IF NOT EXISTS idx_checkins_checked_at
ON checkins (checked_at);

CREATE INDEX IF NOT EXISTS idx_checkins_source
ON checkins (source);


-- =========================================
-- 3. 每日心情指數
-- score 1~5
-- 1~2 分由後端要求 reason 不可為空
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

CREATE INDEX IF NOT EXISTS idx_daily_moods_requester
ON daily_moods (
    requester_token,
    date
);


-- =========================================
-- 4. 國定假日
-- 國定假日當天不允許一般簽到，也不列入成功簽到
-- =========================================
CREATE TABLE IF NOT EXISTS holidays (
    date TEXT PRIMARY KEY
);
