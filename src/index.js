const JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store"
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders
    }
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function corsHeaders(request) {
  return {
    "Access-Control-Allow-Origin": new URL(request.url).origin,
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password, X-User-Token",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS"
  };
}

function isAdmin(request, env) {
  const password = request.headers.get("X-Admin-Password");
  return Boolean(env.ADMIN_PASSWORD) && password === env.ADMIN_PASSWORD;
}

// ===== 簽到設定 =====

// 開放簽到星期：0=星期日、1=星期一 ... 6=星期六
// 目前設定為星期一～星期五
const CHECKIN_DAYS = [1, 2, 3, 4, 5];

// 一天允許簽到的時段
const CHECKIN_WINDOWS = [
  { start: "08:00", end: "09:00" },
  { start: "12:00", end: "13:00" },
  { start: "17:00", end: "18:00" },
  { start: "22:00", end: "23:00" }
];

// 簽到地點：家樂福
const CHECKIN_AREA = {
  latitude: 24.996680,
  longitude: 121.421019,
  radiusMeters: 200
};

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = deg => deg * Math.PI / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getTaiwanTime() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);

  const obj = {};
  for (const p of parts) obj[p.type] = p.value;

  const weekdayText = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    weekday: "short"
  }).format(now);

  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };

  return {
    date: `${obj.year}-${obj.month}-${obj.day}`,
    time: `${obj.hour}:${obj.minute}`,
    weekday: weekdayMap[weekdayText]
  };
}

function isAllowedTime(time) {
  return CHECKIN_WINDOWS.some(window => {
    return time >= window.start && time <= window.end;
  });
}

function isAllowedDay(weekday) {
  return CHECKIN_DAYS.includes(weekday);
}

async function isHoliday(env, date) {
  const row = await env.DB.prepare(
    "SELECT date FROM holidays WHERE date = ?"
  ).bind(date).first();

  return Boolean(row);
}

async function hasSuccessfulAttendance(env, token, date) {
  const row = await env.DB.prepare(`
    SELECT id
    FROM checkins
    WHERE requester_token = ? AND date = ?
  `).bind(token, date).first();

  return Boolean(row);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: cors
      });
    }

    try {
      // =========================================================
      // 使用者：今日狀態
      // =========================================================
      if (url.pathname === "/api/status" && request.method === "GET") {
        const token = request.headers.get("X-User-Token");
        const taiwan = getTaiwanTime();
        const holiday = await isHoliday(env, taiwan.date);
        const attended = token
          ? await hasSuccessfulAttendance(env, token, taiwan.date)
          : false;

        return json({
          date: taiwan.date,
          time: taiwan.time,
          weekday: taiwan.weekday,
          isHoliday: holiday,
          isAllowedDay: isAllowedDay(taiwan.weekday),
          isAllowedTime: isAllowedTime(taiwan.time),
          attended
        }, 200, cors);
      }

      // =========================================================
      // 使用者：簽到
      // =========================================================
      if (url.pathname === "/api/checkin" && request.method === "POST") {
        const body = await readJson(request);
        const token = request.headers.get("X-User-Token");

        if (!token) {
          return json({ error: "缺少使用者識別" }, 401, cors);
        }

        const latitude = Number(body?.latitude);
        const longitude = Number(body?.longitude);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return json({ error: "無法取得有效的位置" }, 400, cors);
        }

        const taiwan = getTaiwanTime();

        if (await isHoliday(env, taiwan.date)) {
          return json({ error: "今天是國定假日，不開放簽到，也不列入簽到紀錄" }, 403, cors);
        }

        if (!isAllowedDay(taiwan.weekday)) {
          return json({ error: "今天不開放簽到" }, 403, cors);
        }

        if (!isAllowedTime(taiwan.time)) {
          return json({ error: "目前不在允許簽到的時段" }, 403, cors);
        }

        const distance = distanceMeters(
          latitude,
          longitude,
          CHECKIN_AREA.latitude,
          CHECKIN_AREA.longitude
        );

        if (distance > CHECKIN_AREA.radiusMeters) {
          return json({
            error: `目前距離簽到地點約 ${Math.round(distance)} 公尺，超出允許範圍`
          }, 403, cors);
        }

        if (await hasSuccessfulAttendance(env, token, taiwan.date)) {
          return json({ error: "今天已經有成功簽到或核准請假紀錄" }, 409, cors);
        }

        await env.DB.prepare(`
          INSERT INTO checkins
          (
            date,
            checked_at,
            requester_token,
            latitude,
            longitude,
            distance_m,
            source
          )
          VALUES (?, ?, ?, ?, ?, ?, 'checkin')
        `).bind(
          taiwan.date,
          new Date().toISOString(),
          token,
          latitude,
          longitude,
          Math.round(distance)
        ).run();

        return json({
          ok: true,
          date: taiwan.date,
          time: taiwan.time,
          distance: Math.round(distance),
          source: "checkin"
        }, 200, cors);
      }

      // =========================================================
      // 使用者：送出請假
      // =========================================================
      if (url.pathname === "/api/requests" && request.method === "POST") {
        const body = await readJson(request);
        const token = request.headers.get("X-User-Token") || body?.requesterToken;

        if (!body?.id || !body?.reason || !token) {
          return json({ error: "缺少必要資料" }, 400, cors);
        }

        const requestDate = String(body.date || getTaiwanTime().date).slice(0, 10);

        if (await isHoliday(env, requestDate)) {
          return json({ error: "國定假日不需要請假，也不列入簽到紀錄" }, 403, cors);
        }

        const existing = await env.DB.prepare(
          "SELECT id FROM leave_requests WHERE id = ?"
        ).bind(body.id).first();

        if (existing) {
          return json({ error: "申請編號已存在" }, 409, cors);
        }

        await env.DB.prepare(`
          INSERT INTO leave_requests
          (
            id,
            date,
            reason,
            status,
            submitted_at,
            requester_token
          )
          VALUES (?, ?, ?, 'pending', ?, ?)
        `).bind(
          String(body.id).slice(0, 100),
          requestDate,
          String(body.reason).slice(0, 1000),
          new Date().toISOString(),
          String(token).slice(0, 200)
        ).run();

        return json({ ok: true, id: body.id }, 201, cors);
      }

      // =========================================================
      // 使用者：查看自己的請假
      // =========================================================
      if (url.pathname === "/api/employee/requests" && request.method === "GET") {
        const token = request.headers.get("X-User-Token");

        if (!token) {
          return json({ error: "缺少使用者識別" }, 401, cors);
        }

        const result = await env.DB.prepare(`
          SELECT
            id,
            date,
            reason,
            status,
            submitted_at AS submittedAt,
            reviewed_at AS reviewedAt,
            review_note AS reviewNote
          FROM leave_requests
          WHERE requester_token = ?
          ORDER BY submitted_at DESC
        `).bind(token).all();

        return json({ requests: result.results || [] }, 200, cors);
      }

      // =========================================================
      // 使用者：今日心情
      // score 1~5；1~2 分必須填原因
      // =========================================================
      if (url.pathname === "/api/mood" && request.method === "POST") {
        const token = request.headers.get("X-User-Token");
        const body = await readJson(request);

        if (!token) {
          return json({ error: "缺少使用者識別" }, 401, cors);
        }

        const score = Number(body?.score);
        const reason = String(body?.reason || "").trim();
        const taiwan = getTaiwanTime();

        if (!Number.isInteger(score) || score < 1 || score > 5) {
          return json({ error: "心情指數必須是 1 到 5 分" }, 400, cors);
        }

        if (score < 3 && !reason) {
          return json({ error: "心情低於 3 分時，請填寫原因" }, 400, cors);
        }

        if (await isHoliday(env, taiwan.date)) {
          return json({ error: "國定假日不需要填寫簽到心情" }, 403, cors);
        }

        const attended = await hasSuccessfulAttendance(env, token, taiwan.date);
        if (!attended) {
          return json({ error: "今天尚未完成簽到或請假尚未核准" }, 403, cors);
        }

        await env.DB.prepare(`
          INSERT INTO daily_moods
          (
            date,
            requester_token,
            score,
            reason,
            submitted_at
          )
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(requester_token, date)
          DO UPDATE SET
            score = excluded.score,
            reason = excluded.reason,
            submitted_at = excluded.submitted_at
        `).bind(
          taiwan.date,
          token,
          score,
          reason || null,
          new Date().toISOString()
        ).run();

        return json({ ok: true, score, reason: reason || null }, 200, cors);
      }

      if (url.pathname === "/api/mood/today" && request.method === "GET") {
        const token = request.headers.get("X-User-Token");

        if (!token) {
          return json({ error: "缺少使用者識別" }, 401, cors);
        }

        const taiwan = getTaiwanTime();
        const mood = await env.DB.prepare(`
          SELECT
            date,
            score,
            reason,
            submitted_at AS submittedAt
          FROM daily_moods
          WHERE requester_token = ? AND date = ?
        `).bind(token, taiwan.date).first();

        return json({ mood: mood || null }, 200, cors);
      }

      // =========================================================
      // 使用者：統計
      // 核准請假也會寫進 checkins，所以會自然計入累積簽到
      // =========================================================
      if (url.pathname === "/api/stats" && request.method === "GET") {
        const token = request.headers.get("X-User-Token");

        if (!token) {
          return json({ error: "缺少使用者識別" }, 401, cors);
        }

        const result = await env.DB.prepare(`
          SELECT COUNT(*) AS total
          FROM checkins
          WHERE requester_token = ?
        `).bind(token).first();

        return json({ total: Number(result?.total || 0) }, 200, cors);
      }

      // =========================================================
      // Admin：查看所有請假
      // =========================================================
      if (url.pathname === "/api/admin/requests" && request.method === "GET") {
        if (!isAdmin(request, env)) {
          return json({ error: "管理者密碼錯誤" }, 401, cors);
        }

        const result = await env.DB.prepare(`
          SELECT
            id,
            date,
            reason,
            status,
            submitted_at AS submittedAt,
            reviewed_at AS reviewedAt,
            review_note AS reviewNote
          FROM leave_requests
          ORDER BY
            CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
            submitted_at DESC
        `).all();

        return json({ requests: result.results || [] }, 200, cors);
      }

      // =========================================================
      // Admin：核准 / 拒絕請假
      // 核准後直接寫一筆 source='leave' 的成功簽到
      // =========================================================
      if (url.pathname === "/api/admin/review" && request.method === "POST") {
        if (!isAdmin(request, env)) {
          return json({ error: "管理者密碼錯誤" }, 401, cors);
        }

        const body = await readJson(request);

        if (!body?.id || !["approve", "reject"].includes(body.action)) {
          return json({ error: "操作資料錯誤" }, 400, cors);
        }

        const leave = await env.DB.prepare(`
          SELECT id, date, requester_token, status
          FROM leave_requests
          WHERE id = ?
        `).bind(body.id).first();

        if (!leave) {
          return json({ error: "找不到請假申請" }, 404, cors);
        }

        if (leave.status !== "pending") {
          return json({ error: "這筆申請已經審核過" }, 409, cors);
        }

        const status = body.action === "approve" ? "approved" : "rejected";
        const reviewedAt = new Date().toISOString();

        await env.DB.prepare(`
          UPDATE leave_requests
          SET status = ?, reviewed_at = ?, review_note = ?
          WHERE id = ? AND status = 'pending'
        `).bind(
          status,
          reviewedAt,
          String(body.reviewNote || "").slice(0, 1000),
          body.id
        ).run();

        let countedAsAttendance = false;

        if (status === "approved") {
          const holiday = await isHoliday(env, leave.date);

          if (!holiday) {
            await env.DB.prepare(`
              INSERT OR IGNORE INTO checkins
              (
                date,
                checked_at,
                requester_token,
                latitude,
                longitude,
                distance_m,
                source
              )
              VALUES (?, ?, ?, NULL, NULL, NULL, 'leave')
            `).bind(
              leave.date,
              reviewedAt,
              leave.requester_token
            ).run();

            countedAsAttendance = true;
          }
        }

        return json({
          ok: true,
          status,
          countedAsAttendance
        }, 200, cors);
      }

      // =========================================================
      // Admin：國定假日清單
      // =========================================================
      if (url.pathname === "/api/admin/holidays" && request.method === "GET") {
        if (!isAdmin(request, env)) {
          return json({ error: "管理者密碼錯誤" }, 401, cors);
        }

        const result = await env.DB.prepare(`
          SELECT date
          FROM holidays
          ORDER BY date ASC
        `).all();

        return json({ holidays: result.results || [] }, 200, cors);
      }

      // =========================================================
      // Admin：新增國定假日
      // body: { date: "2026-10-10" }
      // =========================================================
      if (url.pathname === "/api/admin/holidays" && request.method === "POST") {
        if (!isAdmin(request, env)) {
          return json({ error: "管理者密碼錯誤" }, 401, cors);
        }

        const body = await readJson(request);
        const date = String(body?.date || "").trim();

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return json({ error: "日期格式錯誤，請使用 YYYY-MM-DD" }, 400, cors);
        }

        await env.DB.prepare(`
          INSERT OR IGNORE INTO holidays (date)
          VALUES (?)
        `).bind(date).run();

        return json({ ok: true, date }, 201, cors);
      }

      // =========================================================
      // Admin：刪除國定假日
      // /api/admin/holidays?date=2026-10-10
      // =========================================================
      if (url.pathname === "/api/admin/holidays" && request.method === "DELETE") {
        if (!isAdmin(request, env)) {
          return json({ error: "管理者密碼錯誤" }, 401, cors);
        }

        const date = String(url.searchParams.get("date") || "").trim();

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return json({ error: "日期格式錯誤" }, 400, cors);
        }

        await env.DB.prepare(
          "DELETE FROM holidays WHERE date = ?"
        ).bind(date).run();

        return json({ ok: true, date }, 200, cors);
      }

      // =========================================================
      // 靜態檔案
      // =========================================================
      if (env.ASSETS?.fetch) {
        return env.ASSETS.fetch(request);
      }

      return json({ error: "找不到頁面" }, 404, cors);
    } catch (error) {
      console.error("Worker error:", error);
      return json({
        error: "伺服器發生錯誤",
        detail: String(error?.message || error)
      }, 500, cors);
    }
  }
};

