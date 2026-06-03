// backend/server.js
const express = require('express');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const multer = require('multer'); // ファイルを処理するツール
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8000;
const mediaDir = path.join(__dirname, 'media');
const uploadDir = path.join(mediaDir, 'uploads');
const databaseFile = path.join(__dirname, 'database.sqlite');

app.use(express.json());
app.use('/media', (req, res, next) => {
    const requestedPath = decodeURIComponent(req.path).replace(/^\/+/, '');
    const filePath = path.resolve(mediaDir, requestedPath);

    if (!filePath.startsWith(mediaDir + path.sep)) {
        return res.status(403).json({ error: "アクセスできないパスです" });
    }

    res.sendFile(filePath, (err) => {
        if (err) next();
    });
});
app.use(express.static(mediaDir));

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
        cb(null, 'post_' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

let db;

// ① 全データを取得する窓口
app.get('/api/surveys', async (req, res) => {
    console.log("【受信】フロントエンドからデータ取得リクエストが来ました");
    const surveyData = {};
    try {
        const groups = await db.all("SELECT * FROM groups");
        for (const group of groups) {
            surveyData[group.id] = {
                name: group.name,
                gps_track: JSON.parse(group.gps_track),
                detections: []
            };
            const detections = await db.all("SELECT * FROM detections WHERE group_id = ?", group.id);
            for (const det of detections) {
                // image_url も一緒に取得するように追加
                const posts = await db.all("SELECT nickname, creature, comment, image_url FROM user_posts WHERE detection_id = ?", det.id);
                surveyData[group.id].detections.push({
                    id: det.id,
                    lat: det.lat,
                    lng: det.lng,
                    class_name: det.class_name,
                    timestamp: det.timestamp_sec,
                    thumbnail_url: det.thumbnail_path,
                    user_posts: posts
                });
            }
        }
        res.json(surveyData);
    } catch (err) {
        console.error("データベースエラー:", err);
        res.status(500).json({ error: "データの取得に失敗しました" });
    }
});

// ② 児童の追加投稿を受け取る窓口（画像ファイル対応）
// upload.single('image') を追加し、ファイルを受け取れるようにする
app.post('/api/detections/:id/posts', upload.single('image'), async (req, res) => {
    const detectionId = req.params.id;
    const postData = req.body; // テキストデータ
    const file = req.file;     // 画像ファイルデータ

    console.log(`【受信】ピン [${detectionId}] への新しい投稿:`, postData);
    if (file) console.log(`画像も受信しました: ${file.filename}`);

    // 画像があればそのパスを作成、無ければ null
    const imageUrl = file ? `uploads/${file.filename}` : null;

    try {
        // image_url もデータベースに保存する
        await db.run(
            "INSERT INTO user_posts (detection_id, nickname, creature, comment, image_url) VALUES (?, ?, ?, ?, ?)",
            [detectionId, postData.nickname, postData.creature, postData.comment, imageUrl]
        );
        res.json({ status: "success", message: "投稿をデータベースに保存しました！" });
    } catch (err) {
        console.error("保存エラー:", err);
        res.status(500).json({ error: "保存に失敗しました" });
    }
});

async function startServer() {
    db = await open({ filename: databaseFile, driver: sqlite3.Database });

    app.listen(PORT, () => {
        console.log(`バックエンドサーバーが起動しました: http://localhost:${PORT}`);
    });
}

startServer().catch((err) => {
    console.error("バックエンドサーバーの起動に失敗しました:", err);
    process.exit(1);
});
