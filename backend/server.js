// backend/server.js
const express = require('express');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const multer = require('multer'); // ファイルを処理するツール
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8000;
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const ACCESS_CODE_REQUIRED = process.env.ACCESS_CODE_REQUIRED === 'true';
const ADMIN_CODE = process.env.ADMIN_CODE || ACCESS_CODE;
const DETECTION_LABEL_OPTIONS = [
    'サワガニ',
    'アカハライモリ',
    'ハグロトンボ',
    'コオニヤンマ',
    'カワニナ',
    'エビ',
    'カワムツ',
    'ドンコ',
    'ヨシノボリ',
    'ドジョウ',
    'その他の生き物',
    '生き物なし'
];
const DETECTION_LABEL_OPTION_SET = new Set(DETECTION_LABEL_OPTIONS);
const mediaDir = path.join(__dirname, 'media');
const uploadDir = path.join(mediaDir, 'uploads');
const databaseFile = path.join(__dirname, 'database.sqlite');
const SELECTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const EVENT_DATE_JUNE19 = '2026-06-19';
const EVENT_DATE_JULY11 = '2026-07-11';
const JULY11_GROUP = {
    id: EVENT_DATE_JULY11,
    name: '2026年7月11日',
    gps_track: '[]',
    event_date: EVENT_DATE_JULY11,
    is_event: 1
};
const METERS_PER_DEGREE_LAT = 111320;
const RIVER_CORRIDOR_RADIUS_M = Number(process.env.RIVER_CORRIDOR_RADIUS_M || 25);
const JULY11_RIVER_CORRIDOR_RADIUS_M = Number(process.env.JULY11_RIVER_CORRIDOR_RADIUS_M || 8);
const JULY11_ROUTE_BIN_LAT_DEGREES = 0.00005;
const JULY11_ROUTE_MIN_BIN_POINTS = 20;
const TRACK_SEGMENT_MAX_JUMP_M = 20;
const MAP_CONFIGS = {
    [EVENT_DATE_JUNE19]: {
        bounds: {
            north: 35.0668688174732,
            south: 35.06464445892178,
            west: 135.78416397658356 + 0.00006,
            east: 135.78518787088882 + 0.00006
        },
        corridorRadiusM: RIVER_CORRIDOR_RADIUS_M,
        riverCenterline: [
            [35.06678, 135.78470],
            [35.06635, 135.78472],
            [35.06595, 135.78480],
            [35.06555, 135.78478],
            [35.06515, 135.78472],
            [35.06475, 135.78466]
        ]
    },
    [EVENT_DATE_JULY11]: {
        bounds: {
            north: 35.07020,
            south: 35.06440,
            west: 135.78380,
            east: 135.78720
        },
        corridorRadiusM: JULY11_RIVER_CORRIDOR_RADIUS_M,
        riverCenterline: [],
        useConsensusCenterline: true
    }
};
const CLASS_LETTER_TO_NUMBER = { d: 1, h: 2, l: 3 };
const CLASS_NAME_TO_NUMBER = { davis: 1, hardy: 2, learned: 3 };
const TEAM_LETTER_TO_NUMBER = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 };

app.use(express.json());

function getEventDate(value) {
    const text = String(value || '').trim();
    return text === EVENT_DATE_JULY11 ? EVENT_DATE_JULY11 : EVENT_DATE_JUNE19;
}

function isVirtualGroupId(groupId) {
    return String(groupId) === JULY11_GROUP.id;
}

function getVirtualGroups() {
    return [{ ...JULY11_GROUP }];
}

async function getGroupsWithVirtualEvents() {
    const groups = await db.all(
        "SELECT id, name, gps_track, COALESCE(event_date, ?) AS event_date, 0 AS is_event FROM groups ORDER BY event_date ASC, name ASC",
        EVENT_DATE_JUNE19
    );
    return [...groups, ...getVirtualGroups()];
}

async function getGroupWithVirtualEvent(groupId) {
    if (isVirtualGroupId(groupId)) return { ...JULY11_GROUP };
    return db.get(
        "SELECT id, name, gps_track, COALESCE(event_date, ?) AS event_date, 0 AS is_event FROM groups WHERE id = ?",
        EVENT_DATE_JUNE19,
        groupId
    );
}

function getDefaultPointForGroup(group) {
    if (group?.is_event) {
        const { bounds } = getMapConfig(group.event_date);
        return {
            lat: (bounds.north + bounds.south) / 2,
            lng: (bounds.west + bounds.east) / 2
        };
    }

    return getDefaultGroupPoint(group?.gps_track, group?.name, group?.event_date);
}

function getAccessCode(req) {
    return req.get('X-Access-Code') || req.query.access || '';
}

function getAdminCode(req) {
    return req.get('X-Admin-Code') || req.query.admin || '';
}

function requireAccess(req, res, next) {
    if (!ACCESS_CODE_REQUIRED || !ACCESS_CODE || getAccessCode(req) === ACCESS_CODE) {
        next();
        return;
    }

    res.status(401).json({ error: "アクセスコードが正しくありません" });
}

function requireAdmin(req, res, next) {
    if (!ADMIN_CODE || getAdminCode(req) === ADMIN_CODE) {
        next();
        return;
    }

    res.status(401).json({ error: "管理用コードが正しくありません" });
}

function getSelectedImagePath(groupId, imageName) {
    const selectedDir = path.resolve(mediaDir, groupId, 'selected');
    if (!selectedDir.startsWith(mediaDir + path.sep)) return null;

    for (const extension of SELECTED_IMAGE_EXTENSIONS) {
        const filePath = path.join(selectedDir, `${imageName}${extension}`);
        if (fs.existsSync(filePath)) {
            return path.posix.join(groupId, 'selected', `${imageName}${extension}`);
        }
    }

    return null;
}

function parseGroupInfo(groupName) {
    const name = String(groupName || '');
    const classTeamLetterMatch = name.match(/([DHL])\s*組.*?([A-G])\s*班/i);
    if (classTeamLetterMatch) {
        return {
            classNumber: CLASS_LETTER_TO_NUMBER[classTeamLetterMatch[1].toLowerCase()] || 1,
            teamNumber: TEAM_LETTER_TO_NUMBER[classTeamLetterMatch[2].toLowerCase()] || 1
        };
    }

    const reversedLetterMatch = name.match(/([DHL])\s*班.*?([A-G])\s*組/i);
    if (reversedLetterMatch) {
        return {
            classNumber: CLASS_LETTER_TO_NUMBER[reversedLetterMatch[1].toLowerCase()] || 1,
            teamNumber: TEAM_LETTER_TO_NUMBER[reversedLetterMatch[2].toLowerCase()] || 1
        };
    }

    const japaneseMatch = name.match(/(\d+)\s*組.*?(\d+)\s*班/);
    if (japaneseMatch) {
        return {
            classNumber: Number(japaneseMatch[1]) || 1,
            teamNumber: Number(japaneseMatch[2]) || 1
        };
    }

    const englishMatch = name.match(/(Davis|Hardy|Learned).*?([A-G]|\d+)\s*班/i);
    if (englishMatch) {
        const rawTeam = englishMatch[2];
        return {
            classNumber: CLASS_NAME_TO_NUMBER[englishMatch[1].toLowerCase()] || 1,
            teamNumber: /^[A-G]$/i.test(rawTeam)
                ? TEAM_LETTER_TO_NUMBER[rawTeam.toLowerCase()] || 1
                : Number(rawTeam) || 1
        };
    }

    const teamMatch = name.match(/(\d+)\s*班/);
    return {
        classNumber: 1,
        teamNumber: teamMatch ? Number(teamMatch[1]) || 1 : 1
    };
}

function getMapConfig(eventDate = EVENT_DATE_JUNE19) {
    return MAP_CONFIGS[getEventDate(eventDate)] || MAP_CONFIGS[EVENT_DATE_JUNE19];
}

function isMapPoint(lat, lng, eventDate = EVENT_DATE_JUNE19) {
    const { bounds } = getMapConfig(eventDate);
    const margin = 0.00035;
    return Number.isFinite(lat)
        && Number.isFinite(lng)
        && lat <= bounds.north + margin
        && lat >= bounds.south - margin
        && lng >= bounds.west - margin
        && lng <= bounds.east + margin;
}

function toLocalMeters(point, eventDate = EVENT_DATE_JUNE19) {
    const { bounds } = getMapConfig(eventDate);
    const centerLat = (bounds.north + bounds.south) / 2;
    const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos(centerLat * Math.PI / 180);
    return {
        x: (point[1] - bounds.west) * metersPerDegreeLng,
        y: (point[0] - bounds.south) * METERS_PER_DEGREE_LAT
    };
}

function distancePointToSegmentMeters(point, segmentStart, segmentEnd, eventDate = EVENT_DATE_JUNE19) {
    const p = toLocalMeters(point, eventDate);
    const a = toLocalMeters(segmentStart, eventDate);
    const b = toLocalMeters(segmentEnd, eventDate);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
    const closestX = a.x + dx * t;
    const closestY = a.y + dy * t;

    return Math.hypot(p.x - closestX, p.y - closestY);
}

function distanceBetweenPointsMeters(pointA, pointB, eventDate = EVENT_DATE_JUNE19) {
    const a = toLocalMeters(pointA, eventDate);
    const b = toLocalMeters(pointB, eventDate);
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToRiverMeters(lat, lng, eventDate = EVENT_DATE_JUNE19, centerlineOverride = null) {
    const config = getMapConfig(eventDate);
    const riverCenterline = Array.isArray(centerlineOverride) && centerlineOverride.length >= 2
        ? centerlineOverride
        : config.riverCenterline;
    if (!Array.isArray(riverCenterline) || riverCenterline.length < 2) return Infinity;

    let minDistance = Infinity;
    const point = [lat, lng];
    for (let index = 0; index < riverCenterline.length - 1; index += 1) {
        minDistance = Math.min(
            minDistance,
            distancePointToSegmentMeters(point, riverCenterline[index], riverCenterline[index + 1], eventDate)
        );
    }
    return minDistance;
}

function isRiverCorridorPoint(lat, lng, eventDate = EVENT_DATE_JUNE19, centerlineOverride = null) {
    const { corridorRadiusM } = getMapConfig(eventDate);
    return isMapPoint(lat, lng, eventDate)
        && distanceToRiverMeters(lat, lng, eventDate, centerlineOverride) <= corridorRadiusM;
}

function parseGpsTrack(gpsTrack) {
    try {
        const points = JSON.parse(gpsTrack || '[]');
        return Array.isArray(points) ? points : [];
    } catch (error) {
        return [];
    }
}

function getValidTrackPoints(gpsTrack) {
    return parseGpsTrack(gpsTrack).filter(point => (
        Array.isArray(point)
        && point.length >= 2
        && Number.isFinite(Number(point[0]))
        && Number.isFinite(Number(point[1]))
    )).map(point => [Number(point[0]), Number(point[1])]);
}

function median(values) {
    if (!Array.isArray(values) || values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

function buildConsensusCenterline(groups, eventDate) {
    const config = getMapConfig(eventDate);
    if (!config.useConsensusCenterline) return config.riverCenterline;

    const bins = new Map();
    groups.filter(group => getEventDate(group.event_date) === getEventDate(eventDate)).forEach(group => {
        getValidTrackPoints(group.gps_track).forEach(([lat, lng]) => {
            if (!isMapPoint(lat, lng, eventDate)) return;
            const binIndex = Math.floor((lat - config.bounds.south) / JULY11_ROUTE_BIN_LAT_DEGREES);
            if (!bins.has(binIndex)) bins.set(binIndex, []);
            bins.get(binIndex).push(lng);
        });
    });

    const centerline = [...bins.entries()]
        .filter(([, lngValues]) => lngValues.length >= JULY11_ROUTE_MIN_BIN_POINTS)
        .sort(([indexA], [indexB]) => indexA - indexB)
        .map(([binIndex, lngValues]) => [
            config.bounds.south + (binIndex + 0.5) * JULY11_ROUTE_BIN_LAT_DEGREES,
            median(lngValues)
        ]);

    return centerline.map((point, index) => {
        const nearbyPoints = centerline.slice(Math.max(0, index - 2), Math.min(centerline.length, index + 3));
        return [point[0], median(nearbyPoints.map(nearbyPoint => nearbyPoint[1]))];
    });
}

function splitTrackIntoSegments(points, eventDate, maxJumpMeters = TRACK_SEGMENT_MAX_JUMP_M) {
    if (!Array.isArray(points) || points.length === 0) return [];
    const segments = [];
    let currentSegment = [points[0]];

    for (let index = 1; index < points.length; index += 1) {
        if (distanceBetweenPointsMeters(points[index - 1], points[index], eventDate) > maxJumpMeters) {
            if (currentSegment.length >= 2) segments.push(currentSegment);
            currentSegment = [points[index]];
        } else {
            currentSegment.push(points[index]);
        }
    }
    if (currentSegment.length >= 2) segments.push(currentSegment);
    return segments;
}

function smoothTrackSegment(points, radius = 2) {
    return points.map((point, index) => {
        const nearbyPoints = points.slice(Math.max(0, index - radius), Math.min(points.length, index + radius + 1));
        return [
            median(nearbyPoints.map(nearbyPoint => nearbyPoint[0])),
            median(nearbyPoints.map(nearbyPoint => nearbyPoint[1]))
        ];
    });
}

function getFallbackTrack(groupName) {
    const { classNumber, teamNumber } = parseGroupInfo(groupName);
    const teamIndex = Math.max(1, Math.min(7, teamNumber));
    const startLat = 35.06608 - (teamIndex - 1) * 0.0002;
    const endLat = Math.max(35.06472, startLat - 0.00068);
    const classLngOffset = { 1: -0.000035, 2: 0, 3: 0.000035 }[classNumber] || 0;
    const points = [];

    for (let index = 0; index < 42; index += 1) {
        const t = index / 41;
        const lat = startLat + (endLat - startLat) * t;
        const lng = 135.78473
            + classLngOffset
            + Math.sin(t * Math.PI * 1.7 + teamIndex * 0.45) * 0.00008
            + Math.sin(t * Math.PI * 5) * 0.000025;
        points.push([lat, lng]);
    }

    return points;
}

function getUsableTrack(gpsTrack, groupName, eventDate = EVENT_DATE_JUNE19, centerlineOverride = null) {
    const validPoints = getValidTrackPoints(gpsTrack);
    const inMapPoints = validPoints.filter(point => isMapPoint(point[0], point[1], eventDate));
    const config = getMapConfig(eventDate);
    const hasUsableCenterline = (
        Array.isArray(centerlineOverride) && centerlineOverride.length >= 2
    ) || (
        Array.isArray(config.riverCenterline) && config.riverCenterline.length >= 2
    );
    const riverPoints = hasUsableCenterline
        ? inMapPoints.filter(point => isRiverCorridorPoint(point[0], point[1], eventDate, centerlineOverride))
        : inMapPoints;

    if (riverPoints.length >= 2) {
        const segments = splitTrackIntoSegments(riverPoints, eventDate)
            .map(segment => smoothTrackSegment(segment));
        const points = segments.flat();
        return {
            points,
            segments,
            corrected: points.length !== validPoints.length
        };
    }

    const fallbackTrack = getFallbackTrack(groupName);
    return {
        points: fallbackTrack,
        segments: [fallbackTrack],
        corrected: true
    };
}

function getTrackPointByRatio(track, ratio) {
    if (!Array.isArray(track) || track.length === 0) return null;
    const safeRatio = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0.5));
    const index = Math.round(safeRatio * (track.length - 1));
    const point = track[index];
    if (!Array.isArray(point) || point.length < 2) return null;
    return {
        lat: Number(point[0]),
        lng: Number(point[1])
    };
}

function getDefaultGroupPoint(gpsTrack, groupName = '', eventDate = EVENT_DATE_JUNE19) {
    const { points } = getUsableTrack(gpsTrack, groupName, eventDate);
    return getTrackPointByRatio(points, 0.5);
}

app.use('/media', (req, res, next) => {
    const hasAccess = ACCESS_CODE && getAccessCode(req) === ACCESS_CODE;
    const hasAdmin = ADMIN_CODE && getAdminCode(req) === ADMIN_CODE;
    if (ACCESS_CODE_REQUIRED && (ACCESS_CODE || ADMIN_CODE) && !hasAccess && !hasAdmin) {
        return res.status(401).json({ error: "アクセスコードが正しくありません" });
    }

    const requestedPath = decodeURIComponent(req.path).replace(/^\/+/, '');
    const filePath = path.resolve(mediaDir, requestedPath);

    if (!filePath.startsWith(mediaDir + path.sep)) {
        return res.status(403).json({ error: "アクセスできないパスです" });
    }

    res.sendFile(filePath, (err) => {
        if (err) next();
    });
});

// 画像アップロード用の設定
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true }); // uploadsフォルダが無ければ自動作成
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir) // 保存先
    },
    filename: function (req, file, cb) {
        // 名前が被らないように「時間＋元のファイル形式」で保存
        const prefix = file.fieldname === 'conceptImage'
            ? 'concept_'
            : file.fieldname === 'thumbnail'
                ? 'manual_detection_'
                : 'post_';
        cb(null, prefix + Date.now() + '_' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });
const postUpload = upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'conceptImage', maxCount: 1 }
]);
const manualDetectionUpload = upload.single('thumbnail');
const selectedImageUpload = upload.single('image');

let db;

app.get('/api/access-check', requireAccess, (req, res) => {
    res.json({ status: "ok" });
});

app.get('/api/admin/check', requireAdmin, (req, res) => {
    res.json({ status: "ok" });
});

// ① 全データを取得する窓口
app.get('/api/surveys', requireAccess, async (req, res) => {
    console.log("【受信】フロントエンドからデータ取得リクエストが来ました");
    const groupsData = {};
    try {
        const groups = await getGroupsWithVirtualEvents();
        const eventCenterlines = {
            [EVENT_DATE_JULY11]: buildConsensusCenterline(groups, EVENT_DATE_JULY11)
        };
        for (const group of groups) {
            const eventDate = group.event_date || EVENT_DATE_JUNE19;
            const centerline = eventCenterlines[eventDate] || null;
            const usableTrack = group.is_event
                ? { points: [], segments: [], corrected: false }
                : getUsableTrack(group.gps_track, group.name, eventDate, centerline);
            groupsData[group.id] = {
                name: group.name,
                event_date: eventDate,
                is_event: Boolean(group.is_event),
                gps_track: usableTrack.points,
                gps_track_segments: usableTrack.segments,
                gps_track_corrected: usableTrack.corrected,
                selected_images: {
                    ground: getSelectedImagePath(group.id, 'ground'),
                    underwater: getSelectedImagePath(group.id, 'underwater')
                },
                detections: []
            };
            const detections = await db.all("SELECT * FROM detections WHERE group_id = ? AND COALESCE(hidden, 0) = 0", group.id);
            const finiteTimestamps = detections
                .map(det => Number(det.timestamp_sec))
                .filter(Number.isFinite);
            const minTimestamp = finiteTimestamps.length > 0 ? Math.min(...finiteTimestamps) : 0;
            const maxTimestamp = finiteTimestamps.length > 0 ? Math.max(...finiteTimestamps) : 0;
            for (const det of detections) {
                // image_url も一緒に取得するように追加
                const posts = await db.all(
                    "SELECT nickname, creature, comment, image_url, concept_image_url FROM user_posts WHERE detection_id = ? AND COALESCE(hidden, 0) = 0",
                    det.id
                );
                let lat = Number(det.lat);
                let lng = Number(det.lng);
                if (group.is_event) {
                    const fallbackPoint = Number.isFinite(lat) && Number.isFinite(lng)
                        ? null
                        : getDefaultPointForGroup(group);
                    if (fallbackPoint) {
                        lat = fallbackPoint.lat;
                        lng = fallbackPoint.lng;
                    }
                } else if (!isRiverCorridorPoint(lat, lng, eventDate, centerline)) {
                    const timestamp = Number(det.timestamp_sec);
                    const ratio = Number.isFinite(timestamp) && maxTimestamp > minTimestamp
                        ? (timestamp - minTimestamp) / (maxTimestamp - minTimestamp)
                        : 0.5;
                    const fallbackPoint = getTrackPointByRatio(usableTrack.points, ratio);
                    if (fallbackPoint) {
                        lat = fallbackPoint.lat;
                        lng = fallbackPoint.lng;
                    }
                }
                groupsData[group.id].detections.push({
                    id: det.id,
                    lat,
                    lng,
                    class_name: det.class_name,
                    verified_class_name: det.verified_class_name,
                    timestamp: det.timestamp_sec,
                    thumbnail_url: det.thumbnail_path,
                    user_posts: posts
                });
            }
        }
        const freePosts = await db.all(`
            SELECT
                id,
                lat,
                lng,
                class_number,
                group_id,
                COALESCE(event_date, ?) AS event_date,
                nickname,
                creature,
                comment,
                image_url,
                concept_image_url
            FROM free_posts
            WHERE COALESCE(hidden, 0) = 0
            ORDER BY id ASC
        `, EVENT_DATE_JUNE19);
        res.json({ groups: groupsData, free_posts: freePosts });
    } catch (err) {
        console.error("データベースエラー:", err);
        res.status(500).json({ error: "データの取得に失敗しました" });
    }
});

// ② 児童の追加投稿を受け取る窓口（画像ファイル対応）
// upload.single('image') を追加し、ファイルを受け取れるようにする
app.post('/api/detections/:id/posts', requireAccess, postUpload, async (req, res) => {
    const detectionId = req.params.id;
    const postData = req.body; // テキストデータ
    const imageFile = req.files?.image?.[0];
    const conceptFile = req.files?.conceptImage?.[0];

    console.log(`【受信】ピン [${detectionId}] への新しい投稿:`, postData);
    if (imageFile) console.log(`画像も受信しました: ${imageFile.filename}`);
    if (conceptFile) console.log(`概念図も受信しました: ${conceptFile.filename}`);

    // 画像があればそのパスを作成、無ければ null
    const imageUrl = imageFile ? `uploads/${imageFile.filename}` : null;
    const conceptImageUrl = conceptFile ? `uploads/${conceptFile.filename}` : null;

    try {
        // image_url もデータベースに保存する
        await db.run(
            "INSERT INTO user_posts (detection_id, nickname, creature, comment, image_url, concept_image_url) VALUES (?, ?, ?, ?, ?, ?)",
            [detectionId, postData.nickname, postData.creature, postData.comment, imageUrl, conceptImageUrl]
        );
        res.json({ status: "success", message: "投稿をデータベースに保存しました！" });
    } catch (err) {
        console.error("保存エラー:", err);
        res.status(500).json({ error: "保存に失敗しました" });
    }
});

app.post('/api/free-posts', requireAccess, postUpload, async (req, res) => {
    const postData = req.body;
    const lat = parseFloat(postData.lat);
    const lng = parseFloat(postData.lng);
    const classNumber = postData.classNumber ? parseInt(postData.classNumber, 10) : null;
    const groupId = String(postData.groupId || postData.group_id || '').trim() || null;
    let eventDate = getEventDate(postData.eventDate || postData.event_date);
    const imageFile = req.files?.image?.[0];
    const conceptFile = req.files?.conceptImage?.[0];

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return res.status(400).json({ error: "投稿場所が正しくありません" });
    }

    const imageUrl = imageFile ? `uploads/${imageFile.filename}` : null;
    const conceptImageUrl = conceptFile ? `uploads/${conceptFile.filename}` : null;

    try {
        if (groupId) {
            const group = await getGroupWithVirtualEvent(groupId);
            if (!group || group.is_event) {
                return res.status(400).json({ error: "投稿する班が正しくありません" });
            }
            eventDate = getEventDate(group.event_date);
        }

        await db.run(
            `INSERT INTO free_posts (lat, lng, class_number, group_id, event_date, nickname, creature, comment, image_url, concept_image_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [lat, lng, Number.isNaN(classNumber) ? null : classNumber, groupId, eventDate, postData.nickname, postData.creature, postData.comment, imageUrl, conceptImageUrl]
        );
        res.json({ status: "success", message: "自由投稿を保存しました！" });
    } catch (err) {
        console.error("自由投稿の保存エラー:", err);
        res.status(500).json({ error: "保存に失敗しました" });
    }
});

app.patch('/api/detections/:id/verification', requireAccess, async (req, res) => {
    const detectionId = req.params.id;
    const requestedCreatures = Array.isArray(req.body.creatures)
        ? req.body.creatures
        : [req.body.creature];
    const creatures = [...new Set(requestedCreatures
        .map(value => String(value || '').trim())
        .filter(Boolean)
    )];

    if (creatures.length === 0 || creatures.some(creature => !DETECTION_LABEL_OPTION_SET.has(creature))) {
        return res.status(400).json({ error: "生き物の名前が正しくありません" });
    }

    try {
        const verifiedClassName = JSON.stringify(creatures);
        const result = await db.run(
            "UPDATE detections SET verified_class_name = ? WHERE id = ?",
            [verifiedClassName, detectionId]
        );

        if (result.changes === 0) {
            return res.status(404).json({ error: "検出データが見つかりません" });
        }

        res.json({ status: "success", verified_class_name: verifiedClassName, creatures });
    } catch (err) {
        console.error("検出名の更新エラー:", err);
        res.status(500).json({ error: "生き物の名前を保存できませんでした" });
    }
});

function getPostTable(type) {
    if (type === 'detection') return 'user_posts';
    if (type === 'free') return 'free_posts';
    return null;
}

async function getAdminPosts() {
    const detectionPosts = await db.all(`
        SELECT
            'detection' AS type,
            p.id,
            p.detection_id,
            p.nickname,
            p.creature,
            p.comment,
            p.image_url,
            p.concept_image_url,
            COALESCE(p.hidden, 0) AS hidden,
            d.class_name AS detection_class,
            d.lat,
            d.lng,
            d.thumbnail_path,
            CASE
                WHEN d.group_id = ? THEN ?
                ELSE g.name
            END AS group_name
        FROM user_posts p
        LEFT JOIN detections d ON d.id = p.detection_id
        LEFT JOIN groups g ON g.id = d.group_id
        ORDER BY p.id DESC
    `, JULY11_GROUP.id, JULY11_GROUP.name);

    const freePosts = await db.all(`
        SELECT
            'free' AS type,
            fp.id,
            NULL AS detection_id,
            fp.nickname,
            fp.creature,
            fp.comment,
            fp.image_url,
            fp.concept_image_url,
            COALESCE(fp.hidden, 0) AS hidden,
            NULL AS detection_class,
            fp.lat,
            fp.lng,
            NULL AS thumbnail_path,
            fp.class_number,
            fp.group_id,
            COALESCE(fp.event_date, ?) AS event_date,
            g.name AS group_name
        FROM free_posts fp
        LEFT JOIN groups g ON g.id = fp.group_id
        ORDER BY fp.id DESC
    `, EVENT_DATE_JUNE19);

    return [...detectionPosts, ...freePosts].sort((a, b) => b.id - a.id);
}

app.get('/api/admin/posts', requireAdmin, async (req, res) => {
    try {
        const posts = await getAdminPosts();
        const groups = await db.all(
            `SELECT id, name, COALESCE(event_date, ?) AS event_date
             FROM groups
             ORDER BY event_date, name`,
            [EVENT_DATE_JUNE19]
        );
        res.json({ posts, groups });
    } catch (err) {
        console.error("管理用投稿一覧の取得エラー:", err);
        res.status(500).json({ error: "投稿一覧の取得に失敗しました" });
    }
});

app.patch('/api/admin/posts/:type/:id', requireAdmin, async (req, res) => {
    const table = getPostTable(req.params.type);
    if (!table) {
        return res.status(400).json({ error: "投稿の種類が正しくありません" });
    }

    const id = Number(req.params.id);
    const hidden = req.body.hidden ? 1 : 0;

    try {
        const result = await db.run(`UPDATE ${table} SET hidden = ? WHERE id = ?`, [hidden, id]);
        if (result.changes === 0) {
            return res.status(404).json({ error: "投稿が見つかりません" });
        }
        res.json({ status: "success", hidden });
    } catch (err) {
        console.error("投稿の表示状態更新エラー:", err);
        res.status(500).json({ error: "投稿の更新に失敗しました" });
    }
});

app.patch('/api/admin/posts/free/:id/group', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const groupId = String(req.body.group_id || '').trim();

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "投稿IDが正しくありません" });
    }

    try {
        if (!groupId) {
            const result = await db.run("UPDATE free_posts SET group_id = NULL WHERE id = ?", [id]);
            if (result.changes === 0) {
                return res.status(404).json({ error: "投稿が見つかりません" });
            }
            return res.json({ status: "success", group_id: null });
        }

        const group = await getGroupWithVirtualEvent(groupId);
        if (!group || group.is_event) {
            return res.status(400).json({ error: "投稿した班が正しくありません" });
        }

        const { classNumber } = parseGroupInfo(group.name);
        const eventDate = getEventDate(group.event_date);
        const result = await db.run(
            "UPDATE free_posts SET group_id = ?, class_number = ?, event_date = ? WHERE id = ?",
            [groupId, classNumber, eventDate, id]
        );
        if (result.changes === 0) {
            return res.status(404).json({ error: "投稿が見つかりません" });
        }

        return res.json({ status: "success", group_id: groupId });
    } catch (err) {
        console.error("自由投稿の班更新エラー:", err);
        return res.status(500).json({ error: "投稿した班を保存できませんでした" });
    }
});

app.get('/api/admin/detections', requireAdmin, async (req, res) => {
    try {
        const groups = await getGroupsWithVirtualEvents();
        const detections = await db.all(`
            SELECT
                d.id,
                d.group_id,
                d.class_name,
                d.verified_class_name,
                d.confidence,
                d.lat,
                d.lng,
                d.timestamp_sec,
                d.thumbnail_path,
                COALESCE(d.hidden, 0) AS hidden,
                CASE
                    WHEN d.group_id = ? THEN ?
                    ELSE g.name
                END AS group_name
            FROM detections d
            LEFT JOIN groups g ON g.id = d.group_id
            ORDER BY group_name ASC, d.timestamp_sec ASC, d.id ASC
        `, JULY11_GROUP.id, JULY11_GROUP.name);

        res.json({ groups, detections, label_options: DETECTION_LABEL_OPTIONS });
    } catch (err) {
        console.error("管理用検出候補一覧の取得エラー:", err);
        res.status(500).json({ error: "検出候補一覧の取得に失敗しました" });
    }
});

app.post('/api/admin/detections', requireAdmin, manualDetectionUpload, async (req, res) => {
    const groupId = String(req.body.group_id || '').trim();
    const className = String(req.body.class_name || '').trim();
    const timestamp = req.body.timestamp_sec === undefined || req.body.timestamp_sec === ''
        ? null
        : Number(req.body.timestamp_sec);
    let lat = req.body.lat === undefined || req.body.lat === '' ? null : Number(req.body.lat);
    let lng = req.body.lng === undefined || req.body.lng === '' ? null : Number(req.body.lng);

    if (!groupId) {
        return res.status(400).json({ error: "班を選んでください" });
    }

    if (!DETECTION_LABEL_OPTION_SET.has(className)) {
        return res.status(400).json({ error: "候補名が正しくありません" });
    }

    if (timestamp !== null && !Number.isFinite(timestamp)) {
        return res.status(400).json({ error: "動画内の時刻が正しくありません" });
    }

    try {
        const group = await getGroupWithVirtualEvent(groupId);
        if (!group) {
            return res.status(404).json({ error: "班が見つかりません" });
        }

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            const defaultPoint = getDefaultPointForGroup(group);
            if (!defaultPoint) {
                return res.status(400).json({ error: "追加する場所を決められませんでした" });
            }
            lat = defaultPoint.lat;
            lng = defaultPoint.lng;
        }

        const thumbnailPath = req.file ? `uploads/${req.file.filename}` : null;
        const detectionId = crypto.randomUUID();

        await db.run(
            `INSERT INTO detections
                (id, group_id, class_name, verified_class_name, confidence, lat, lng, timestamp_sec, thumbnail_path, hidden)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                detectionId,
                groupId,
                className,
                null,
                null,
                lat,
                lng,
                timestamp,
                thumbnailPath,
                0
            ]
        );

        res.json({ status: "success", id: detectionId });
    } catch (err) {
        console.error("検出候補の追加エラー:", err);
        res.status(500).json({ error: "検出候補の追加に失敗しました" });
    }
});

app.post('/api/admin/groups/:id/selected-image', requireAdmin, selectedImageUpload, async (req, res) => {
    const groupId = req.params.id;
    const imageType = String(req.body.type || '').trim();

    if (!['ground', 'underwater'].includes(imageType)) {
        return res.status(400).json({ error: "画像の種類が正しくありません" });
    }

    if (!req.file) {
        return res.status(400).json({ error: "画像ファイルを選んでください" });
    }

    try {
        const group = await getGroupWithVirtualEvent(groupId);
        if (!group) {
            return res.status(404).json({ error: "班が見つかりません" });
        }

        const selectedDir = path.resolve(mediaDir, groupId, 'selected');
        if (!selectedDir.startsWith(mediaDir + path.sep)) {
            return res.status(403).json({ error: "保存できないパスです" });
        }

        await fs.promises.mkdir(selectedDir, { recursive: true });

        for (const extension of SELECTED_IMAGE_EXTENSIONS) {
            const existingPath = path.join(selectedDir, `${imageType}${extension}`);
            try {
                await fs.promises.unlink(existingPath);
            } catch (err) {
                if (err.code !== 'ENOENT') throw err;
            }
        }

        const extension = path.extname(req.file.originalname).toLowerCase() || '.jpg';
        const safeExtension = SELECTED_IMAGE_EXTENSIONS.includes(extension) ? extension : '.jpg';
        const destinationPath = path.join(selectedDir, `${imageType}${safeExtension}`);
        await fs.promises.rename(req.file.path, destinationPath);

        res.json({
            status: "success",
            image_url: path.posix.join(groupId, 'selected', `${imageType}${safeExtension}`)
        });
    } catch (err) {
        console.error("班代表画像の保存エラー:", err);
        if (req.file) {
            await fs.promises.unlink(req.file.path).catch(() => {});
        }
        res.status(500).json({ error: "画像の保存に失敗しました" });
    }
});

app.delete('/api/admin/groups/:id/selected-image/:type', requireAdmin, async (req, res) => {
    const groupId = req.params.id;
    const imageType = String(req.params.type || '').trim();

    if (!['ground', 'underwater'].includes(imageType)) {
        return res.status(400).json({ error: "画像の種類が正しくありません" });
    }

    try {
        const group = await getGroupWithVirtualEvent(groupId);
        if (!group) {
            return res.status(404).json({ error: "班が見つかりません" });
        }

        const selectedDir = path.resolve(mediaDir, groupId, 'selected');
        if (!selectedDir.startsWith(mediaDir + path.sep)) {
            return res.status(403).json({ error: "削除できないパスです" });
        }

        let deleted = 0;
        for (const extension of SELECTED_IMAGE_EXTENSIONS) {
            const existingPath = path.join(selectedDir, `${imageType}${extension}`);
            try {
                await fs.promises.unlink(existingPath);
                deleted += 1;
            } catch (err) {
                if (err.code !== 'ENOENT') throw err;
            }
        }

        res.json({ status: "success", deleted });
    } catch (err) {
        console.error("班代表画像の削除エラー:", err);
        res.status(500).json({ error: "画像の削除に失敗しました" });
    }
});

app.patch('/api/admin/detections/:id', requireAdmin, async (req, res) => {
    const detectionId = req.params.id;
    const updates = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(req.body, 'hidden')) {
        updates.push('hidden = ?');
        values.push(req.body.hidden ? 1 : 0);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'class_name')) {
        const className = String(req.body.class_name || '').trim();
        if (!DETECTION_LABEL_OPTION_SET.has(className)) {
            return res.status(400).json({ error: "候補名が正しくありません" });
        }

        updates.push('class_name = ?');
        values.push(className);
    }

    if (updates.length === 0) {
        return res.status(400).json({ error: "更新内容がありません" });
    }

    values.push(detectionId);

    try {
        const result = await db.run(
            `UPDATE detections SET ${updates.join(', ')} WHERE id = ?`,
            values
        );

        if (result.changes === 0) {
            return res.status(404).json({ error: "検出候補が見つかりません" });
        }

        res.json({ status: "success" });
    } catch (err) {
        console.error("検出候補の更新エラー:", err);
        res.status(500).json({ error: "検出候補の更新に失敗しました" });
    }
});

async function deleteUploadFile(relativePath) {
    if (!relativePath) return;

    const filePath = path.resolve(mediaDir, relativePath);
    if (!filePath.startsWith(uploadDir + path.sep)) return;

    try {
        await fs.promises.unlink(filePath);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.warn("画像ファイルの削除に失敗しました:", filePath, err.message);
        }
    }
}

app.delete('/api/admin/posts/:type/:id', requireAdmin, async (req, res) => {
    const table = getPostTable(req.params.type);
    if (!table) {
        return res.status(400).json({ error: "投稿の種類が正しくありません" });
    }

    const id = Number(req.params.id);

    try {
        const post = await db.get(`SELECT id, image_url, concept_image_url FROM ${table} WHERE id = ?`, id);
        if (!post) {
            return res.status(404).json({ error: "投稿が見つかりません" });
        }

        await db.run(`DELETE FROM ${table} WHERE id = ?`, id);
        await deleteUploadFile(post.image_url);
        await deleteUploadFile(post.concept_image_url);

        res.json({ status: "success" });
    } catch (err) {
        console.error("投稿削除エラー:", err);
        res.status(500).json({ error: "投稿の削除に失敗しました" });
    }
});

async function addColumnIfMissing(tableName, columnName, columnDefinition) {
    const table = await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", tableName);
    if (!table) return;

    const columns = await db.all(`PRAGMA table_info(${tableName})`);
    if (!columns.some((column) => column.name === columnName)) {
        await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
    }
}

async function ensureSchema() {
    await db.exec(`
        CREATE TABLE IF NOT EXISTS groups (
            id TEXT PRIMARY KEY,
            name TEXT,
            gps_track TEXT,
            event_date TEXT DEFAULT '2026-06-19'
        );

        CREATE TABLE IF NOT EXISTS detections (
            id TEXT PRIMARY KEY,
            group_id TEXT,
            class_name TEXT,
            verified_class_name TEXT,
            confidence REAL,
            lat REAL,
            lng REAL,
            timestamp_sec REAL,
            thumbnail_path TEXT,
            hidden INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS user_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            detection_id TEXT,
            nickname TEXT,
            creature TEXT,
            comment TEXT,
            image_url TEXT,
            concept_image_url TEXT,
            event_date TEXT DEFAULT '2026-06-19',
            hidden INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS free_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lat REAL,
            lng REAL,
            class_number INTEGER,
            group_id TEXT,
            nickname TEXT,
            creature TEXT,
            comment TEXT,
            image_url TEXT,
            concept_image_url TEXT,
            event_date TEXT DEFAULT '2026-06-19',
            hidden INTEGER DEFAULT 0
        );
    `);
    await addColumnIfMissing('groups', 'event_date', `TEXT DEFAULT '${EVENT_DATE_JUNE19}'`);
    await addColumnIfMissing('detections', 'verified_class_name', 'TEXT');
    await addColumnIfMissing('detections', 'hidden', 'INTEGER DEFAULT 0');
    await addColumnIfMissing('user_posts', 'concept_image_url', 'TEXT');
    await addColumnIfMissing('user_posts', 'hidden', 'INTEGER DEFAULT 0');
    await addColumnIfMissing('free_posts', 'class_number', 'INTEGER');
    await addColumnIfMissing('free_posts', 'group_id', 'TEXT');
    await addColumnIfMissing('free_posts', 'concept_image_url', 'TEXT');
    await addColumnIfMissing('free_posts', 'event_date', `TEXT DEFAULT '${EVENT_DATE_JUNE19}'`);
    await addColumnIfMissing('free_posts', 'hidden', 'INTEGER DEFAULT 0');
}

async function startServer() {
    db = await open({ filename: databaseFile, driver: sqlite3.Database });
    await ensureSchema();

    app.listen(PORT, () => {
        console.log(`バックエンドサーバーが起動しました: http://localhost:${PORT}`);
        if (ACCESS_CODE_REQUIRED && ACCESS_CODE) {
            console.log("アクセスコード保護が有効です");
        } else {
            console.log("アクセスコードなしで利用できます");
        }
        if (ADMIN_CODE) {
            console.log("管理画面保護が有効です");
        }
    });
}

startServer().catch((err) => {
    console.error("バックエンドサーバーの起動に失敗しました:", err);
    process.exit(1);
});
