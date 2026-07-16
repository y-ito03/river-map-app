const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const databaseFile = path.join(__dirname, 'database.sqlite');
const defaultManifestFile = path.join(__dirname, 'data', '2026-07-11.json');

async function addColumnIfMissing(db, tableName, columnName, definition) {
    const columns = await db.all(`PRAGMA table_info(${tableName})`);
    if (!columns.some(column => column.name === columnName)) {
        await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
}

async function ensureSchema(db) {
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
    await addColumnIfMissing(db, 'groups', 'event_date', "TEXT DEFAULT '2026-06-19'");
    await addColumnIfMissing(db, 'detections', 'verified_class_name', 'TEXT');
    await addColumnIfMissing(db, 'detections', 'hidden', 'INTEGER DEFAULT 0');
}

async function importManifest() {
    const manifestFile = process.argv[2]
        ? path.resolve(process.argv[2])
        : defaultManifestFile;
    if (!fs.existsSync(manifestFile)) {
        throw new Error(`取込データが見つかりません: ${manifestFile}`);
    }

    const manifest = JSON.parse(await fs.promises.readFile(manifestFile, 'utf8'));
    const eventDate = String(manifest.event_date || '').trim();
    if (!eventDate || !Array.isArray(manifest.groups)) {
        throw new Error('取込データの形式が正しくありません。');
    }

    const db = await open({ filename: databaseFile, driver: sqlite3.Database });
    await ensureSchema(db);
    let groupCount = 0;
    let detectionCount = 0;

    await db.exec('BEGIN TRANSACTION');
    try {
        for (const group of manifest.groups) {
            await db.run(
                `INSERT INTO groups (id, name, gps_track, event_date)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    gps_track = excluded.gps_track,
                    event_date = excluded.event_date`,
                group.id,
                group.name,
                JSON.stringify(group.gps_track || []),
                eventDate
            );
            groupCount += 1;

            for (const detection of group.detections || []) {
                await db.run(
                    `INSERT INTO detections
                        (id, group_id, class_name, verified_class_name, confidence, lat, lng, timestamp_sec, thumbnail_path, hidden)
                     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 0)
                     ON CONFLICT(id) DO UPDATE SET
                        group_id = excluded.group_id,
                        class_name = excluded.class_name,
                        confidence = excluded.confidence,
                        lat = excluded.lat,
                        lng = excluded.lng,
                        timestamp_sec = excluded.timestamp_sec,
                        thumbnail_path = excluded.thumbnail_path`,
                    detection.id,
                    group.id,
                    detection.class_name,
                    detection.confidence,
                    detection.lat,
                    detection.lng,
                    detection.timestamp_sec,
                    detection.thumbnail_path
                );
                detectionCount += 1;
            }
        }
        await db.exec('COMMIT');
    } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
    } finally {
        await db.close();
    }

    console.log(`${eventDate}: ${groupCount}班 / ${detectionCount}件を取り込みました。`);
}

importManifest().catch(error => {
    console.error(error.message || error);
    process.exit(1);
});
