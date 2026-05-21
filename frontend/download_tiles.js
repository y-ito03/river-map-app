// download_tiles.js
import fs from 'fs';
import path from 'path';

// 岩倉川の調査エリア（以前より南北・東西に広範囲化）
const MIN_LAT = 35.060;
const MAX_LAT = 35.070;
const MIN_LON = 135.780;
const MAX_LON = 135.790;

// ズームレベル：14（広域）〜 18（国土地理院の写真の最大限界）
const MIN_ZOOM = 14;
const MAX_ZOOM = 18;

function lon2tile(lon, zoom) { return (Math.floor((lon + 180) / 360 * Math.pow(2, zoom))); }
function lat2tile(lat, zoom) { return (Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom))); }

async function downloadTile(z, x, y) {
    const url = `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${z}/${x}/${y}.jpg`;
    
    const dir = path.join(process.cwd(), 'public', 'tiles', z.toString(), x.toString());
    const filePath = path.join(dir, `${y}.jpg`);

    if (fs.existsSync(filePath)) return;

    fs.mkdirSync(dir, { recursive: true });

    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'RiverSurveyApp/1.0' }
        });
        if (!response.ok) throw new Error(`Status ${response.status}`);
        const buffer = await response.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(buffer));
        console.log(`保存完了: 衛星写真 ズーム${z} - ${x}/${y}.jpg`);
        
        await new Promise(res => setTimeout(res, 200)); 
    } catch (err) {
        console.error(`エラー ${z}/${x}/${y}:`, err.message);
    }
}

async function main() {
    console.log("広範囲の衛星写真のダウンロードを開始します...");
    for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
        const minX = lon2tile(MIN_LON, z);
        const maxX = lon2tile(MAX_LON, z);
        const minY = lat2tile(MAX_LAT, z);
        const maxY = lat2tile(MIN_LAT, z);

        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                await downloadTile(z, x, y);
            }
        }
    }
    console.log("すべての衛星写真の追加保存が完了しました！");
}

main();