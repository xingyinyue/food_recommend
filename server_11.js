/**
 * =========================================================
 * server_10_full.js
 *
 * - 接收問卷資料（POST /submit-survey）
 * - 存入 MySQL（ai_meal.user_profiles）
 * - 使用「最新一筆 user_profiles」做外食推薦
 * 
 * 餐廳條列網址
 * http://localhost:3000/osm/restaurants
 * 餐廳篩選網址
 * http://localhost:3000/recommend/outside/osm
 * =========================================================
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const db = require("./db"); // MySQL 連線池

const app = express();
app.use(cors());
app.use(express.json());
// ✅ 關鍵：對齊 public 資料夾
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

/* =========================================================
 * 接收問卷 → 存入 MySQL
 * ========================================================= */
app.post("/submit-survey", async (req, res) => {
  try {
    const profile = req.body;

    if (!profile || typeof profile !== "object") {
      return res.status(400).json({ error: "invalid profile" });
    }

    await db.query(
      "INSERT INTO user_profiles (profile) VALUES (?)",
      [JSON.stringify(profile)]
    );

    console.log("📝 Survey saved:", profile);

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Save survey failed:", err);
    res.status(500).json({ error: "save failed" });
  }
});

/* =========================================================
 * 外食推薦（使用最新一筆 user_profiles）
 * ========================================================= */
app.get("/recommend/outside", async (req, res) => {
  try {
    // 1️⃣ 取最新一筆問卷
    const [rows] = await db.query(
      "SELECT profile FROM user_profiles ORDER BY id DESC LIMIT 1"
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "no user profile found" });
    }

    const rawProfile = rows[0].profile;

    let profile;

    // ✅ 關鍵修正：只在「字串」時才 parse
    if (typeof rawProfile === "string") {
      profile = JSON.parse(rawProfile);
    } else {
      profile = rawProfile;
    }

    console.log("🧠 Profile used for recommend:", profile);

    // 2️⃣ 外食推薦邏輯（目前是 MVP 版，可再進化）
    const recommendations = [];

    if (profile.cuisines?.includes("taiwanese")) {
      recommendations.push("滷肉飯", "雞腿便當", "燙青菜");
    }
    if (profile.cuisines?.includes("japanese")) {
      recommendations.push("日式便當", "烤魚定食");
    }
    if (profile.healthGoals?.includes("light")) {
      recommendations.push("舒肥雞胸沙拉", "清燉湯品");
    }
    if (profile.healthGoals?.includes("more_protein")) {
      recommendations.push("烤雞腿便當", "牛肉便當");
    }

    // fallback
    if (recommendations.length === 0) {
      recommendations.push("均衡便當", "自助餐");
    }

    res.json({
      profileUsed: profile,
      outsideRecommendations: recommendations,
    });
  } catch (err) {
    console.error("❌ Recommend failed:", err);
    res.status(500).json({ error: "recommend failed" });
  }
});

/* =========================================================
 * 工具函式：距離計算（Haversine）
 * ========================================================= */
function calcDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // 地球半徑 km
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function distanceScore(distanceKm) {
  const MAX_DISTANCE = 3;
  const d = Math.min(distanceKm, MAX_DISTANCE);
  return 1 - d / MAX_DISTANCE;
}

function preferenceScore(profile, restaurant) {
  let score = 0;
  let maxScore = 0;

  if (profile.cuisines?.length) {
    maxScore += 1;
    if (
      profile.cuisines.some(c =>
        restaurant.cuisine?.toLowerCase().includes(c)
      )
    ) {
      score += 1;
    }
  }

  if (profile.healthGoals?.includes("light")) {
    maxScore += 1;
    if (
      restaurant.amenity === "cafe" ||
      restaurant.tags?.diet === "healthy"
    ) {
      score += 1;
    }
  }

  if (maxScore === 0) return 0.5;
  return score / maxScore;
}

//
async function fetchOSMRestaurants() {
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"="restaurant"](25.01,121.52,25.04,121.56);
      node["amenity"="fast_food"](25.01,121.52,25.04,121.56);
      node["amenity"="cafe"](25.01,121.52,25.04,121.56);
    );
    out tags center;
  `;

  const response = await fetch(
    "https://overpass-api.de/api/interpreter",
    {
      method: "POST",
      body: query,
      headers: { "Content-Type": "text/plain" }
    }
  );

  const data = await response.json();

  return data.elements.map(el => ({
    osm_id: el.id,
    name: el.tags?.name || "未命名店家",
    amenity: el.tags?.amenity,
    cuisine: el.tags?.cuisine || "",
    lat: el.lat,
    lon: el.lon,
    tags: el.tags || {}
  }));
}

/* =========================================================
 * OSM API 把OSM店家變乾淨json
 * ========================================================= */
app.get("/osm/restaurants", async (req, res) => {
 try {
    const restaurants = await fetchOSMRestaurants();
    res.json({ count: restaurants.length, restaurants });
  } catch (err) {
    console.error("❌ OSM fetch failed:", err);
    res.status(500).json({ error: "OSM fetch failed" });
  }
});

/* =========================================================
 * 用最新一筆user profile 來篩 OSM 
 * ========================================================= */

app.get("/recommend/outside/osm", async (req, res) => {
  try {
    
    // ✅ Step 1：使用者位置（暫時寫死）
    const userLocation = {
      lat: 25.0173,
      lon: 121.5397
    };

    // 1️⃣ 取最新使用者 profile
    const [rows] = await db.query(
      "SELECT profile FROM user_profiles ORDER BY id DESC LIMIT 1"
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "no user profile" });
    }

    const rawProfile = rows[0].profile;

    const profile =
      typeof rawProfile === "string"
        ? JSON.parse(rawProfile)
        : rawProfile;
          
    let restaurants = await fetchOSMRestaurants();
  

    // 3️⃣ 根據問卷做「最基本篩選（MVP）」
    if (profile.cuisines?.length) {
      restaurants = restaurants.filter(r =>
        profile.cuisines.some(c =>
          r.cuisine?.toLowerCase().includes(c)
        )
      );
    }

    console.log("🔍 篩選後餐廳數量：", restaurants.length);

    restaurants.forEach(r => {
      console.log("🍴", {
        name: r.name,
        cuisine: r.cuisine,
        lat: r.lat,
        lon: r.lon
      });
    });

    // fallback
    if (restaurants.length === 0) {
      restaurants = osmData.restaurants.slice(0, 10);
    }

    //餐廳 = 距離 + 偏好 + score
    restaurants = restaurants.map(r => {
      const dKm = calcDistanceKm(
        userLocation.lat,
        userLocation.lon,
        r.lat,
        r.lon
      );

      const dScore = distanceScore(dKm);
      const pScore = preferenceScore(profile, r);

      const score =
        dScore * 0.6 +   // 距離權重
        pScore * 0.4;    // 偏好權重

      return {
        ...r,
        distanceKm: dKm,
        score: Number(score.toFixed(3)),
        scoreDetail: {
          distanceScore: dScore,
          preferenceScore: pScore
        }
      };
    });

    // 5️⃣ 依距離排序（近的在前）
    restaurants.sort((a, b) => a.distanceKm - b.distanceKm);

    res.json({
      profileUsed: profile,
      restaurants: restaurants.slice(0, 10)
    });
  } catch (err) {
    console.error("❌ OSM recommend failed:", err);
    res.status(500).json({ error: "recommend failed" });
  }
});

/* =========================================================
 * Debug：查看最近使用者資料
 * ========================================================= */
app.get("/debug/users", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, profile, created_at FROM user_profiles ORDER BY id DESC LIMIT 5"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "query failed" });
  }
});


app.get("/_test", (req, res) => {
  res.sendFile(path.join(__dirname, "index_17.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "meal_recommendation_3.html"));
});


/* =========================================================
 * 啟動 Server
 * ========================================================= */
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});