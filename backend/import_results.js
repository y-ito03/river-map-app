// backend/import_results.js
// results.csv の新しい軌跡・検出データだけを、既存投稿を消さずに追加する。
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const crypto = require('crypto');

const databaseFile = path.join(__dirname, 'database.sqlite');
const csvFile = path.join(__dirname, 'results.csv');

function readCsvRows(filePath) {
    return new Promise((resolve, reject) => {
        const rows = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', row => rows.push(row))
            .on('end', () => resolve(rows))
            .on('error', reject);
    });
}

async function ensureImportSchema(db) {
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
    `);

    const columns = await db.all('PRAGMA table_info(detections)');
    const groupColumns = await db.all('PRAGMA table_info(groups)');
    if (!groupColumns.some(column => column.name === 'event_date')) {
        await db.exec("ALTER TABLE groups ADD COLUMN event_date TEXT DEFAULT '2026-06-19'");
    }
    if (!columns.some(column => column.name === 'verified_class_name')) {
        await db.exec('ALTER TABLE detections ADD COLUMN verified_class_name TEXT');
    }
    if (!columns.some(column => column.name === 'hidden')) {
        await db.exec('ALTER TABLE detections ADD COLUMN hidden INTEGER DEFAULT 0');
    }
}

async function importResults() {
    if (!fs.existsSync(csvFile)) {
        throw new Error(`results.csv が見つかりません: ${csvFile}`);
    }

    const rows = await readCsvRows(csvFile);
    const db = await open({ filename: databaseFile, driver: sqlite3.Database });
    await ensureImportSchema(db);

    let insertedGroups = 0;
    let insertedDetections = 0;
    let skippedDetections = 0;

    await db.exec('BEGIN TRANSACTION');
    try {
        for (const row of rows) {
            const groupId = row.processing_id;
            if (!groupId) continue;

            const groupName = row.original_video_filename || groupId;
            const gpsTrack = row.full_gps_track_json || '[]';
            const existingGroup = await db.get('SELECT id FROM groups WHERE id = ?', groupId);
            if (!existingGroup) {
                await db.run(
                    'INSERT INTO groups (id, name, gps_track, event_date) VALUES (?, ?, ?, ?)',
                    groupId,
                    groupName,
                    gpsTrack,
                    '2026-06-19'
                );
                insertedGroups += 1;
            }

            const lat = parseFloat(row.detection_latitude);
            const lng = parseFloat(row.detection_longitude);
            const timestamp = parseFloat(row.detection_timestamp_sec);
            const confidence = parseFloat(row.detection_confidence);
            const className = row.detection_class_name || '';
            const thumbnailPath = row.detection_thumbnail_path_relative || '';

            if (Number.isNaN(lat) || Number.isNaN(lng)) continue;

            const existingDetection = await db.get(
                `SELECT id FROM detections
                 WHERE group_id = ?
                   AND class_name = ?
                   AND timestamp_sec = ?
                   AND lat = ?
                   AND lng = ?
                   AND thumbnail_path = ?`,
                groupId,
                className,
                Number.isNaN(timestamp) ? null : timestamp,
                lat,
                lng,
                thumbnailPath
            );

            if (existingDetection) {
                skippedDetections += 1;
                continue;
            }

            await db.run(
                `INSERT INTO detections
                    (id, group_id, class_name, verified_class_name, confidence, lat, lng, timestamp_sec, thumbnail_path)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                crypto.randomUUID(),
                groupId,
                className,
                null,
                Number.isNaN(confidence) ? null : confidence,
                lat,
                lng,
                Number.isNaN(timestamp) ? null : timestamp,
                thumbnailPath
            );
            insertedDetections += 1;
        }

        await db.exec('COMMIT');
    } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
    } finally {
        await db.close();
    }

    console.log(`groups added: ${insertedGroups}`);
    console.log(`detections added: ${insertedDetections}`);
    console.log(`detections skipped: ${skippedDetections}`);
}

importResults().catch(error => {
    console.error(error);
    process.exit(1);
});
