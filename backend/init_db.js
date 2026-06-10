// backend/init_db.js
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const crypto = require('crypto'); // ランダムなIDを作るためのツール

async function setupDatabase() {
    const databaseFile = path.join(__dirname, 'database.sqlite');
    const csvFile = path.join(__dirname, 'results.csv');
    const db = await open({ filename: databaseFile, driver: sqlite3.Database });

    console.log("📦 データベースのテーブルを作成中...");
    
    // テーブルを作り直す（リセット）
    await db.exec('DROP TABLE IF EXISTS groups;');
    await db.exec('DROP TABLE IF EXISTS detections;');

    // このCSVの形に合わせたテーブル構造
    await db.exec(`
        CREATE TABLE IF NOT EXISTS groups (
            id TEXT PRIMARY KEY,
            name TEXT,
            gps_track TEXT
        );
        CREATE TABLE IF NOT EXISTS detections (
            id TEXT PRIMARY KEY,
            group_id TEXT,
            class_name TEXT,
            confidence REAL,
            lat REAL,
            lng REAL,
            timestamp_sec REAL,
            thumbnail_path TEXT
        );
        CREATE TABLE IF NOT EXISTS user_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            detection_id TEXT,
            nickname TEXT,
            creature TEXT,
            comment TEXT,
            image_url TEXT,
            concept_image_url TEXT,
            hidden INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS free_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lat REAL,
            lng REAL,
            class_number INTEGER,
            nickname TEXT,
            creature TEXT,
            comment TEXT,
            image_url TEXT,
            concept_image_url TEXT,
            hidden INTEGER DEFAULT 0
        );
    `);

    console.log("📄 CSVファイル (results.csv) を読み込んでいます...");

    // CSVを1行ずつ読み込んでデータベースに保存
    fs.createReadStream(csvFile)
        .pipe(csv())
        .on('data', async (row) => {
            // processing_id をグループIDとして扱う
            const groupId = row.processing_id;
            // ファイル名を班の名前にする（例: GX010033.MP4）
            const videoName = row.original_video_filename; 
            const gpsTrack = row.full_gps_track_json;

            // 1. グループを登録（INSERT OR IGNORE で、すでに同じ動画があれば無視する）
            await db.run(
                "INSERT OR IGNORE INTO groups (id, name, gps_track) VALUES (?, ?, ?)",
                [groupId, videoName, gpsTrack]
            );

            // 2. 検出データを登録
            const lat = parseFloat(row.detection_latitude);
            const lng = parseFloat(row.detection_longitude);

            // 緯度経度が正しく取れている行だけを保存する
            if (!isNaN(lat) && !isNaN(lng)) {
                const detId = crypto.randomUUID(); // 重複しない適当なIDを自動生成
                
                await db.run(
                    `INSERT INTO detections (id, group_id, class_name, confidence, lat, lng, timestamp_sec, thumbnail_path) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        detId,
                        groupId,
                        row.detection_class_name,
                        parseFloat(row.detection_confidence),
                        lat,
                        lng,
                        parseFloat(row.detection_timestamp_sec),
                        row.detection_thumbnail_path_relative
                    ]
                );
            }
        })
        .on('end', () => {
            console.log("✅ CSVの取り込みとデータベース構築が完了しました！");
        });
}

setupDatabase();
