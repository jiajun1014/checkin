const JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}

async function readJson(request) {
  try { return await request.json(); }
  catch { return null; }
}

function corsHeaders(request) {
  return {
    "Access-Control-Allow-Origin": new URL(request.url).origin,
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password, X-User-Token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  };
}
// ===== 簽到設定 =====

// 一天允許簽到的時段
const CHECKIN_WINDOWS = [
  { start: "08:00", end: "09:00" },
  { start: "12:00", end: "13:00" },
  { start: "17:00", end: "18:00" },
  { start: "22:00", end: "23:00" }   // ← 新增這段
];

// // 簽到地點：國立中興大學
// const CHECKIN_AREA = {
//   latitude: 24.123806,
//   longitude: 120.675194,
//   radiusMeters: 200
// };
// //輔大
// const CHECKIN_AREA = {
//   latitude: 25.033649,
//   longitude: 121.433255,
//   radiusMeters: 200
// };
//家樂福
const CHECKIN_AREA = {
  latitude: 24.996680,
  longitude: 121.421019,
  radiusMeters: 200
};

// 計算兩個 GPS 座標之間的距離
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


// 取得台灣時間
function getTaiwanTime() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());

  const obj = {};

  for (const p of parts) {
    obj[p.type] = p.value;
  }

  return {
    date: `${obj.year}-${obj.month}-${obj.day}`,
    time: `${obj.hour}:${obj.minute}`
  };
}


// 判斷是否位於允許簽到的時間
function isAllowedTime(time) {
  return CHECKIN_WINDOWS.some(window => {
    return time >= window.start && time <= window.end;
  });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    try {
            // ===== Employee: Check in =====
      if (url.pathname === "/api/checkin" && request.method === "POST") {

        const body = await readJson(request);
        const token = request.headers.get("X-User-Token");

        if (!token) {
          return json({ error: "缺少使用者識別" }, 401);
        }

        const latitude = Number(body?.latitude);
        const longitude = Number(body?.longitude);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return json({ error: "無法取得有效的位置" }, 400);
        }


        // 取得目前台灣時間
        const taiwan = getTaiwanTime();


        // ===== 檢查時間 =====
        if (!isAllowedTime(taiwan.time)) {
          return json({
            error: "目前不在允許簽到的時段"
          }, 403);
        }


        // ===== 計算與指定地點的距離 =====
        const distance = distanceMeters(
          latitude,
          longitude,
          CHECKIN_AREA.latitude,
          CHECKIN_AREA.longitude
        );


        // ===== 檢查位置 =====
        if (distance > CHECKIN_AREA.radiusMeters) {
          return json({
            error: `目前距離簽到地點約 ${Math.round(distance)} 公尺，超出允許範圍`
          }, 403);
        }


        // ===== 檢查今天是否已經簽到 =====
        const existing = await env.DB.prepare(`
          SELECT id
          FROM checkins
          WHERE requester_token = ?
          AND date = ?
        `).bind(
          token,
          taiwan.date
        ).first();

        if (existing) {
          return json({
            error: "今天已經簽到過了"
          }, 409);
        }


        // ===== 寫入 D1 =====
        await env.DB.prepare(`
          INSERT INTO checkins
          (
            date,
            checked_at,
            requester_token,
            latitude,
            longitude,
            distance_m
          )
          VALUES (?, ?, ?, ?, ?, ?)
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
          distance: Math.round(distance)
        });
      }
      // Employee: create request
      if (url.pathname === "/api/requests" && request.method === "POST") {
        const body = await readJson(request);
        if (!body?.id || !body?.name || !body?.reason || !body?.requesterToken) {
          return json({ error: "缺少必要資料" }, 400);
        }

        const existing = await env.DB.prepare(
          "SELECT id FROM leave_requests WHERE id = ?"
        ).bind(body.id).first();
        if (existing) return json({ error: "申請編號已存在" }, 409);

        await env.DB.prepare(`
          INSERT INTO leave_requests
          (id, date, name, reason, status, submitted_at, requester_token)
          VALUES (?, ?, ?, ?, 'pending', ?, ?)
        `).bind(
          body.id,
          body.date || new Date().toISOString().slice(0,10),
          String(body.name).slice(0,100),
          String(body.reason).slice(0,1000),
          new Date().toISOString(),
          String(body.requesterToken).slice(0,200)
        ).run();

        return json({ ok: true, id: body.id }, 201);
      }

      // Employee: only own requests
      if (url.pathname === "/api/employee/requests" && request.method === "GET") {
        const token = request.headers.get("X-User-Token");
        if (!token) return json({ error: "缺少使用者識別" }, 401);

        const result = await env.DB.prepare(`
          SELECT id, date, name, reason, status, submitted_at AS submittedAt,
                 reviewed_at AS reviewedAt, review_note AS reviewNote
          FROM leave_requests
          WHERE requester_token = ?
          ORDER BY submitted_at ASC
        `).bind(token).all();

        return json({ requests: result.results || [] });
      }

      // Admin: list all requests
      if (url.pathname === "/api/admin/requests" && request.method === "GET") {
        if (!env.ADMIN_PASSWORD || request.headers.get("X-Admin-Password") !== env.ADMIN_PASSWORD) {
          return json({ error: "管理者密碼錯誤" }, 401);
        }

        const result = await env.DB.prepare(`
          SELECT id, date, name, reason, status, submitted_at AS submittedAt,
                 reviewed_at AS reviewedAt, review_note AS reviewNote
          FROM leave_requests
          ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END,
                   submitted_at ASC
        `).all();

        return json({ requests: result.results || [] });
      }

      // Admin: approve/reject
      if (url.pathname === "/api/admin/review" && request.method === "POST") {
        if (!env.ADMIN_PASSWORD || request.headers.get("X-Admin-Password") !== env.ADMIN_PASSWORD) {
          return json({ error: "管理者密碼錯誤" }, 401);
        }

        const body = await readJson(request);
        if (!body?.id || !["approve", "reject"].includes(body.action)) {
          return json({ error: "操作資料錯誤" }, 400);
        }

        const status = body.action === "approve" ? "approved" : "rejected";
        const result = await env.DB.prepare(`
          UPDATE leave_requests
          SET status = ?, reviewed_at = ?, review_note = ?
          WHERE id = ? AND status = 'pending'
        `).bind(
          status,
          new Date().toISOString(),
          String(body.reviewNote || "").slice(0,1000),
          body.id
        ).run();

        if (!result.meta.changes) {
          return json({ error: "找不到待審核申請,或已經審核過" }, 404);
        }
        return json({ ok: true });
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: "伺服器發生錯誤" }, 500);
    }
  }
};


