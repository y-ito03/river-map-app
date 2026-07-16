const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const csv = require('csv-parser');

const EVENT_DATE = '2026-07-11';
const outputFile = path.join(__dirname, 'data', '2026-07-11.json');
const mediaDir = path.join(__dirname, 'media');

const groupSources = [
    {
        id: '2026-07-11-team-1',
        name: '2026年7月11日 1班',
        sources: [
            'fc3a57e8-32ea-4343-a6f2-c2b827d44142',
            'c94df2b7-0d64-48ac-93b5-00db9b31f10b'
        ]
    },
    {
        id: '2026-07-11-team-2',
        name: '2026年7月11日 2班',
        sources: [
            '483c1760-897d-4daf-9010-d27bd46f3b74',
            '3f316464-4dc6-49a1-a834-6fa88f617a35'
        ]
    },
    {
        id: '2026-07-11-team-3',
        name: '2026年7月11日 3班',
        sources: [
            '0618f2fe-c15b-4b5c-aec8-e076a3bef441',
            '802b5204-2c5b-408c-a868-c34683fb13d5'
        ]
    },
    {
        id: '2026-07-11-team-4',
        name: '2026年7月11日 4班',
        sources: ['0ce7aeb9-b271-43d5-b54e-b26082b493c5']
    },
    {
        id: '2026-07-11-team-5',
        name: '2026年7月11日 5班',
        sources: ['ad0a1901-c82f-425a-a09d-12a9d23db448']
    },
    {
        id: '2026-07-11-team-6',
        name: '2026年7月11日 6班',
        sources: ['61ff6af0-f637-49f2-b2d9-f420c37af944']
    },
    {
        id: '2026-07-11-team-7',
        name: '2026年7月11日 7班',
        sources: [
            '9ff98726-09e7-4454-b663-b9697d9e942a',
            'f502f056-4ebc-47c1-ba21-d8f9c584445e'
        ]
    }
];

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

function parseTrack(value) {
    try {
        const points = JSON.parse(value || '[]');
        return Array.isArray(points)
            ? points
                .filter(point => Array.isArray(point) && point.length >= 2)
                .map(point => [Number(point[0]), Number(point[1])])
                .filter(point => point.every(Number.isFinite))
            : [];
    } catch (error) {
        return [];
    }
}

function pointDistanceMeters(first, second) {
    if (!first || !second) return Infinity;
    const centerLat = (first[0] + second[0]) / 2;
    const latMeters = (first[0] - second[0]) * 111320;
    const lngMeters = (first[1] - second[1]) * 111320 * Math.cos(centerLat * Math.PI / 180);
    return Math.hypot(latMeters, lngMeters);
}

function appendTrack(target, nextTrack) {
    if (nextTrack.length === 0) return;
    if (target.length > 0 && pointDistanceMeters(target[target.length - 1], nextTrack[0]) <= 5) {
        target.push(...nextTrack.slice(1));
        return;
    }
    target.push(...nextTrack);
}

function detectionId(sourceId, row) {
    const fingerprint = [
        EVENT_DATE,
        sourceId,
        row.detection_timestamp_sec,
        row.detection_class_name,
        row.detection_thumbnail_path_relative
    ].join('|');
    return `event-${crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 32)}`;
}

function normalizeThumbnailPath(sourceId, value) {
    const normalized = String(value || '').replaceAll('\\', '/').replace(/^\/+/, '');
    if (!normalized) return null;
    return normalized.startsWith(`${sourceId}/`) ? normalized : `${sourceId}/${normalized}`;
}

async function copySourceThumbnails(sourceRoot, sourceId) {
    const sourceDir = path.join(sourceRoot, sourceId, 'thumbnails');
    const destinationDir = path.join(mediaDir, sourceId, 'thumbnails');
    if (!fs.existsSync(sourceDir)) {
        throw new Error(`サムネイルフォルダが見つかりません: ${sourceDir}`);
    }
    await fs.promises.mkdir(path.dirname(destinationDir), { recursive: true });
    await fs.promises.cp(sourceDir, destinationDir, { recursive: true, force: true });
}

async function prepare() {
    const args = process.argv.slice(2);
    const sourceRoot = args.find(arg => !arg.startsWith('--'));
    const shouldCopyMedia = args.includes('--copy-media');
    if (!sourceRoot) {
        throw new Error('CommonMediaStorageのパスを指定してください。');
    }

    const manifest = {
        event_date: EVENT_DATE,
        generated_at: new Date().toISOString(),
        groups: []
    };
    const copiedSources = new Set();

    for (const group of groupSources) {
        const gpsTrack = [];
        const detections = [];
        const sourceVideos = [];
        let timestampOffset = 0;

        for (const sourceId of group.sources) {
            const csvFile = path.join(sourceRoot, sourceId, 'results.csv');
            if (!fs.existsSync(csvFile)) {
                throw new Error(`解析結果が見つかりません: ${csvFile}`);
            }

            const rows = await readCsvRows(csvFile);
            if (rows.length === 0) {
                throw new Error(`解析結果が空です: ${csvFile}`);
            }

            const partTrack = parseTrack(rows[0].full_gps_track_json);
            appendTrack(gpsTrack, partTrack);
            sourceVideos.push(rows[0].original_video_filename || sourceId);

            const rawTimestamps = rows
                .map(row => Number(row.detection_timestamp_sec))
                .filter(Number.isFinite);
            const partDuration = Math.max(
                partTrack.length > 0 ? partTrack.length - 1 : 0,
                rawTimestamps.length > 0 ? Math.max(...rawTimestamps) : 0
            );

            for (const row of rows) {
                const lat = Number(row.detection_latitude);
                const lng = Number(row.detection_longitude);
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

                const rawTimestamp = Number(row.detection_timestamp_sec);
                const confidence = Number(row.detection_confidence);
                detections.push({
                    id: detectionId(sourceId, row),
                    source_id: sourceId,
                    class_name: String(row.detection_class_name || ''),
                    confidence: Number.isFinite(confidence) ? confidence : null,
                    lat,
                    lng,
                    timestamp_sec: timestampOffset + (Number.isFinite(rawTimestamp) ? rawTimestamp : 0),
                    thumbnail_path: normalizeThumbnailPath(sourceId, row.detection_thumbnail_path_relative)
                });
            }

            timestampOffset += partDuration + 0.01;
            if (shouldCopyMedia && !copiedSources.has(sourceId)) {
                await copySourceThumbnails(sourceRoot, sourceId);
                copiedSources.add(sourceId);
            }
        }

        manifest.groups.push({
            id: group.id,
            name: group.name,
            source_ids: group.sources,
            source_videos: sourceVideos,
            gps_track: gpsTrack,
            detections
        });
        console.log(`${group.name}: 軌跡 ${gpsTrack.length}点 / 検出候補 ${detections.length}件`);
    }

    await fs.promises.mkdir(path.dirname(outputFile), { recursive: true });
    await fs.promises.writeFile(outputFile, JSON.stringify(manifest), 'utf8');
    console.log(`データファイルを作成しました: ${outputFile}`);
    if (shouldCopyMedia) {
        console.log(`サムネイルをコピーしました: ${mediaDir}`);
    }
}

prepare().catch(error => {
    console.error(error.message || error);
    process.exit(1);
});
