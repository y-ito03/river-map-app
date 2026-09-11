const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const csv = require('csv-parser');

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

function createDetectionId(eventDate, sourceId, row) {
    const fingerprint = [
        eventDate,
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

function normalizeSource(source) {
    return typeof source === 'string'
        ? { id: source, expected_video: '' }
        : {
            id: String(source?.id || '').trim(),
            expected_video: String(source?.expected_video || '').trim()
        };
}

async function copySourceThumbnails(sourceRoot, sourceId, mediaDir) {
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
    const positionalArgs = args.filter(arg => !arg.startsWith('--'));
    const sourceRoot = positionalArgs[0] ? path.resolve(positionalArgs[0]) : '';
    const configFile = positionalArgs[1] ? path.resolve(positionalArgs[1]) : '';
    const shouldCopyMedia = args.includes('--copy-media');

    if (!sourceRoot || !configFile) {
        throw new Error('CommonMediaStorageのパスと取込設定JSONを指定してください。');
    }
    if (!fs.existsSync(configFile)) {
        throw new Error(`取込設定が見つかりません: ${configFile}`);
    }

    const config = JSON.parse(await fs.promises.readFile(configFile, 'utf8'));
    const eventDate = String(config.event_date || '').trim();
    if (!eventDate || !Array.isArray(config.groups) || config.groups.length === 0) {
        throw new Error('取込設定のevent_dateまたはgroupsが正しくありません。');
    }

    const outputFile = path.resolve(__dirname, config.output_file || `data/${eventDate}.json`);
    const mediaDir = path.join(__dirname, 'media');
    const manifest = {
        event_date: eventDate,
        generated_at: new Date().toISOString(),
        groups: []
    };
    const copiedSources = new Set();

    for (const group of config.groups) {
        const sources = (group.sources || []).map(normalizeSource);
        if (!group.id || !group.name || sources.length === 0 || sources.some(source => !source.id)) {
            throw new Error(`班設定が正しくありません: ${JSON.stringify(group)}`);
        }

        const gpsTrack = [];
        const detections = [];
        const sourceVideos = [];
        let timestampOffset = 0;

        for (const source of sources) {
            const csvFile = path.join(sourceRoot, source.id, 'results.csv');
            if (!fs.existsSync(csvFile)) {
                throw new Error(`解析結果が見つかりません: ${csvFile}`);
            }

            const rows = await readCsvRows(csvFile);
            if (rows.length === 0) {
                throw new Error(`解析結果が空です: ${csvFile}`);
            }

            const videoName = String(rows[0].original_video_filename || '').trim();
            if (source.expected_video && videoName.toLowerCase() !== source.expected_video.toLowerCase()) {
                throw new Error(`${source.id} の動画名が一致しません: ${videoName}（期待値: ${source.expected_video}）`);
            }

            const partTrack = parseTrack(rows[0].full_gps_track_json);
            if (partTrack.length < 2) {
                throw new Error(`GPS軌跡が不足しています: ${csvFile}`);
            }
            appendTrack(gpsTrack, partTrack);
            sourceVideos.push(videoName || source.id);

            const rawTimestamps = rows
                .map(row => Number(row.detection_timestamp_sec))
                .filter(Number.isFinite);
            const partDuration = Math.max(
                partTrack.length - 1,
                rawTimestamps.length > 0 ? Math.max(...rawTimestamps) : 0
            );

            for (const row of rows) {
                const lat = Number(row.detection_latitude);
                const lng = Number(row.detection_longitude);
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

                const rawTimestamp = Number(row.detection_timestamp_sec);
                const confidence = Number(row.detection_confidence);
                detections.push({
                    id: createDetectionId(eventDate, source.id, row),
                    source_id: source.id,
                    class_name: String(row.detection_class_name || ''),
                    confidence: Number.isFinite(confidence) ? confidence : null,
                    lat,
                    lng,
                    timestamp_sec: timestampOffset + (Number.isFinite(rawTimestamp) ? rawTimestamp : 0),
                    thumbnail_path: normalizeThumbnailPath(source.id, row.detection_thumbnail_path_relative)
                });
            }

            timestampOffset += partDuration + 0.01;
            if (shouldCopyMedia && !copiedSources.has(source.id)) {
                await copySourceThumbnails(sourceRoot, source.id, mediaDir);
                copiedSources.add(source.id);
            }
        }

        manifest.groups.push({
            id: group.id,
            name: group.name,
            source_ids: sources.map(source => source.id),
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
