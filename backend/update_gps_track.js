// GPSだけを抽出したCSVから、指定した班の移動軌跡をSQLiteに反映する。
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const databaseFile = path.join(__dirname, 'database.sqlite');
const MAP_SOURCE_BOUNDS = {
    north: 35.0668688174732,
    south: 35.06464445892178,
    west: 135.78416397658356 + 0.00006,
    east: 135.78518787088882 + 0.00006
};
const MAP_CENTER_LAT = (MAP_SOURCE_BOUNDS.north + MAP_SOURCE_BOUNDS.south) / 2;
const METERS_PER_DEGREE_LAT = 111320;
const METERS_PER_DEGREE_LNG = METERS_PER_DEGREE_LAT * Math.cos(MAP_CENTER_LAT * Math.PI / 180);
const RIVER_CORRIDOR_RADIUS_M = 45;
const RIVER_CENTERLINE = [
    [35.06678, 135.78470],
    [35.06635, 135.78472],
    [35.06595, 135.78480],
    [35.06555, 135.78478],
    [35.06515, 135.78472],
    [35.06475, 135.78466]
];

function usage() {
    console.log(`
Usage:
  node update_gps_track.js <group-id-or-name> <gps-csv-path> [--dry-run] [--keep-outliers]

Examples:
  node update_gps_track.js "D組D班" "C:\\Users\\abono\\Downloads\\D組D班_gps.csv" --dry-run
  node update_gps_track.js "D組D班" "C:\\Users\\abono\\Downloads\\D組D班_gps.csv"
`);
}

function normalizeHeader(row, names) {
    for (const name of names) {
        if (row[name] !== undefined) return row[name];
    }

    const lowerMap = Object.fromEntries(
        Object.entries(row).map(([key, value]) => [String(key).trim().toLowerCase(), value])
    );
    for (const name of names) {
        const value = lowerMap[String(name).trim().toLowerCase()];
        if (value !== undefined) return value;
    }
    return undefined;
}

function toFloat(value) {
    if (value === undefined || value === null || value === '') return NaN;
    return Number.parseFloat(String(value).replace(',', '').trim());
}

function isValidCoordinate(lat, lng) {
    return Number.isFinite(lat)
        && Number.isFinite(lng)
        && lat !== 0
        && lng !== 0
        && lat >= -90
        && lat <= 90
        && lng >= -180
        && lng <= 180;
}

function toLocalMeters(point) {
    return {
        x: (point[1] - MAP_SOURCE_BOUNDS.west) * METERS_PER_DEGREE_LNG,
        y: (point[0] - MAP_SOURCE_BOUNDS.south) * METERS_PER_DEGREE_LAT
    };
}

function distancePointToSegmentMeters(point, segmentStart, segmentEnd) {
    const p = toLocalMeters(point);
    const a = toLocalMeters(segmentStart);
    const b = toLocalMeters(segmentEnd);
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

function distanceToRiverMeters(lat, lng) {
    let minDistance = Infinity;
    const point = [lat, lng];
    for (let index = 0; index < RIVER_CENTERLINE.length - 1; index += 1) {
        minDistance = Math.min(
            minDistance,
            distancePointToSegmentMeters(point, RIVER_CENTERLINE[index], RIVER_CENTERLINE[index + 1])
        );
    }
    return minDistance;
}

function isMapPoint(lat, lng) {
    const margin = 0.00035;
    return lat <= MAP_SOURCE_BOUNDS.north + margin
        && lat >= MAP_SOURCE_BOUNDS.south - margin
        && lng >= MAP_SOURCE_BOUNDS.west - margin
        && lng <= MAP_SOURCE_BOUNDS.east + margin;
}

function isRiverCorridorPoint(lat, lng) {
    return isMapPoint(lat, lng) && distanceToRiverMeters(lat, lng) <= RIVER_CORRIDOR_RADIUS_M;
}

function readGpsCsv(filePath) {
    return new Promise((resolve, reject) => {
        const points = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', row => {
                const lat = toFloat(normalizeHeader(row, ['latitude', 'lat', 'GPSLatitude', 'GpsLatitude']));
                const lng = toFloat(normalizeHeader(row, ['longitude', 'lng', 'lon', 'GPSLongitude', 'GpsLongitude']));
                if (isValidCoordinate(lat, lng)) {
                    points.push([lat, lng]);
                }
            })
            .on('end', () => resolve(points))
            .on('error', reject);
    });
}

async function findGroup(db, selector) {
    const exact = await db.all(
        `SELECT id, name, gps_track FROM groups
         WHERE id = ? OR name = ? OR name = ?`,
        selector,
        selector,
        selector.endsWith('.MP4') ? selector : `${selector}.MP4`
    );
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) {
        throw new Error(`班の指定が複数に一致しました: ${exact.map(group => group.name).join(', ')}`);
    }

    const partial = await db.all(
        'SELECT id, name, gps_track FROM groups WHERE name LIKE ?',
        `%${selector}%`
    );
    if (partial.length === 1) return partial[0];
    if (partial.length > 1) {
        throw new Error(`班の指定が複数に一致しました: ${partial.map(group => group.name).join(', ')}`);
    }

    throw new Error(`班が見つかりません: ${selector}`);
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const keepOutliers = args.includes('--keep-outliers');
    const positional = args.filter(arg => !arg.startsWith('--'));

    if (positional.length < 2 || args.includes('--help')) {
        usage();
        process.exit(positional.length < 2 ? 1 : 0);
    }

    const [selector, csvPath] = positional;
    const resolvedCsvPath = path.resolve(csvPath);
    if (!fs.existsSync(resolvedCsvPath)) {
        throw new Error(`GPS CSVが見つかりません: ${resolvedCsvPath}`);
    }

    const csvPoints = await readGpsCsv(resolvedCsvPath);
    const filteredPoints = keepOutliers
        ? csvPoints
        : csvPoints.filter(point => isRiverCorridorPoint(point[0], point[1]));

    if (filteredPoints.length < 2) {
        throw new Error(`有効なGPS点が少なすぎます。CSV点数: ${csvPoints.length}, 補正後: ${filteredPoints.length}`);
    }

    const db = await open({ filename: databaseFile, driver: sqlite3.Database });
    try {
        const group = await findGroup(db, selector);
        let oldPoints = [];
        try {
            oldPoints = JSON.parse(group.gps_track || '[]');
        } catch (error) {
            oldPoints = [];
        }

        console.log(`target group: ${group.name} (${group.id})`);
        console.log(`csv points: ${csvPoints.length}`);
        console.log(`filtered points: ${filteredPoints.length}`);
        console.log(`old gps_track points: ${Array.isArray(oldPoints) ? oldPoints.length : 0}`);

        if (dryRun) {
            console.log('dry-run: database was not updated');
            return;
        }

        await db.run(
            'UPDATE groups SET gps_track = ? WHERE id = ?',
            JSON.stringify(filteredPoints),
            group.id
        );
        console.log('updated gps_track successfully');
    } finally {
        await db.close();
    }
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
