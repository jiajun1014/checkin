-- =========================================
-- 每日簽到 + 請假系統 D1 Database Schema
-- =========================================


-- =========================================
-- 1. 請假申請
-- =========================================

CREATE TABLE IF NOT EXISTS leave_requests (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    name TEXT NOT NULL,
    reason TEXT NOT NULL,

    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),

    submitted_at TEXT NOT NULL,

    requester_token TEXT NOT NULL,

    reviewed_at TEXT,

    review_note TEXT
);


-- 查詢某個使用者自己的請假紀錄
CREATE INDEX IF NOT EXISTS idx_leave_requests_requester
ON leave_requests (
    requester_token,
    submitted_at
);


-- 管理者依狀態查看請假申請
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

    -- 台灣日期
    -- 例如：2026-09-09
    date TEXT NOT NULL,

    -- 實際簽到時間
    -- ISO 8601 UTC
    -- 例如：2026-09-09T13:30:20.123Z
    checked_at TEXT NOT NULL,

    -- 使用者識別
    requester_token TEXT NOT NULL,

    -- 使用者簽到時的 GPS
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,

    -- 距離指定簽到地點幾公尺
    distance_m INTEGER NOT NULL
);


-- =========================================
-- 3. 限制：
--    每個使用者每天只能簽到一次
-- =========================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_user_date
ON checkins (
    requester_token,
    date
);


-- =========================================
-- 4. 簽到紀錄查詢效能
-- =========================================

CREATE INDEX IF NOT EXISTS idx_checkins_date
ON checkins (
    date
);


CREATE INDEX IF NOT EXISTS idx_checkins_checked_at
ON checkins (
    checked_at
);

-- =========================================
-- 5. 每日心情指數
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
-- 6. 國定假日
-- =========================================

CREATE TABLE IF NOT EXISTS holidays (
    date TEXT PRIMARY KEY
);
