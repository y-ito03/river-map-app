// main.js
// frontend/main.js の一番上に追加
const BACKEND_URL = `http://${window.location.hostname}:8000`;
import './style.css';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
window.L = L; 
import 'leaflet.heat';
import './wizard.js'; 

import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';
L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl });

// --- ベクター画像を表示する範囲（ご指定の座標） ---
const imageBounds = [
    [35.0668688174732, 135.78416397658356], // 左上 (北西)
    [35.06464445892178, 135.78518787088882]  // 右下 (南東)
];

// --- 地図の初期化 ---
const map = L.map('map', { 
    minZoom: 17, 
    maxZoom: 22, 
    maxBounds: imageBounds, 
    maxBoundsViscosity: 1.0
}).fitBounds(imageBounds); 

L.imageOverlay('/river_map4.svg', imageBounds, {
    interactive: true,
    opacity: 1.0
}).addTo(map);

const resizeObserver = new ResizeObserver(() => {
    map.invalidateSize();
});
resizeObserver.observe(document.getElementById('map'));

// --- バックエンドから取得したデータを保存する変数 ---
let surveyData = {};

let currentPolyline = null; 
let currentMarkers = [];    
let currentHeatLayer = null; 
let currentGroupId = null;  

// --- サイドパネルに表示するHTMLを作る関数 ---
window.renderPanelHTML = function(groupId, detId, postIndex = 0) {
    const det = surveyData[groupId].detections.find(d => d.id === detId);
    
    // 【変更】データベースから取得したサムネイル画像のパス（URL）を組み込む
    const thumbUrl = det.thumbnail_url ? `${BACKEND_URL}/${det.thumbnail_url}` : '';

    let html = `
        <div>
            <b style="font-size: 1.4em; color: #333;">${det.class_name}</b><br>
            <span style="font-size: 0.9em; color: #666;">検出: ${det.timestamp}秒</span><br>
            
            <div style="display:flex; gap:10px; margin-top:15px; margin-bottom:15px;">
                <div style="flex:1; background:#eee; height:100px; text-align:center; border-radius:8px; overflow:hidden;">
                    ${thumbUrl ? `<img src="${thumbUrl}" style="width:100%; height:100%; object-fit:cover;" alt="AI画像">` : '<span style="line-height:100px; color:#555; font-size:0.8em;">地上画像なし</span>'}
                </div>
                <div style="flex:1; background:#ddd; height:100px; text-align:center; font-size:0.8em; line-height:100px; color:#555; border-radius:8px;">水中画像</div>
            </div>
            
            <button onclick="window.openWizard('${det.id}')" style="margin-bottom:20px; padding:12px 15px; background:#4CAF50; color:white; border:none; border-radius:8px; font-weight:bold; cursor:pointer; width:100%; font-size: 1.1em;">
                ＋ ついかする！
            </button>
    `;

    if (det.user_posts && det.user_posts.length > 0) {
        const post = det.user_posts[postIndex];
        
        // 🌟【新規】画像URLがあれば<img>タグを作り、無ければ空にする
        const userImgHtml = post.image_url 
            ? `<div style="margin-top:10px;"><img src="${BACKEND_URL}/${post.image_url}" style="width:100%; border-radius:8px; object-fit:cover;"></div>` 
            : '';

        html += `
            <div style="background:#fff9c4; padding:15px; border-radius:8px; border:1px solid #fbc02d;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <button ${postIndex === 0 ? 'disabled' : ''} onclick="window.changePost(event, '${groupId}', '${detId}', ${postIndex - 1})" style="padding:5px 15px; background:#fbc02d; color:white; border:none; border-radius:4px; font-weight:bold; cursor:pointer;">＜</button>
                    <span style="font-weight:bold; font-size:0.9em; color:#333;">${det.user_posts.length}けん中の${postIndex + 1}けんばん</span>
                    <button ${postIndex === det.user_posts.length - 1 ? 'disabled' : ''} onclick="window.changePost(event, '${groupId}', '${detId}', ${postIndex + 1})" style="padding:5px 15px; background:#fbc02d; color:white; border:none; border-radius:4px; font-weight:bold; cursor:pointer;">＞</button>
                </div>
                <div style="font-size:1em; line-height:1.6; color:#333;">
                    <b>なまえ:</b> ${post.nickname}<br>
                    <b>いきもの:</b> ${post.creature}<br>
                    <b>コメント:</b> ${post.comment}
                    ${userImgHtml} </div>
            </div>
        `;
    } else {
        html += `<p style="color:#666; text-align:center; margin-top:20px;">まだみんなのとうろくはありません。</p>`;
    }

    html += `</div>`;
    return html;
};

window.openDetailPanel = function(groupId, detId, postIndex = 0) {
    const panel = document.getElementById('detail-panel');
    const content = document.getElementById('panel-content');
    content.innerHTML = window.renderPanelHTML(groupId, detId, postIndex);
    panel.classList.remove('hidden');
    
    const det = surveyData[groupId].detections.find(d => d.id === detId);
    map.panTo([det.lat, det.lng]);
};

window.changePost = function(event, groupId, detId, newIndex) {
    if (event) event.stopPropagation();
    window.openDetailPanel(groupId, detId, newIndex);
};

document.getElementById('close-panel').addEventListener('click', () => {
    document.getElementById('detail-panel').classList.add('hidden');
});

function clearMap() {
    if (currentPolyline) map.removeLayer(currentPolyline);
    if (currentHeatLayer) map.removeLayer(currentHeatLayer);
    currentMarkers.forEach(marker => map.removeLayer(marker));
    currentMarkers = [];
    document.getElementById('summary-panel').classList.add('hidden');
    document.getElementById('detail-panel').classList.add('hidden'); 
}

function renderGroupData(groupId) {
    currentGroupId = groupId;
    const data = surveyData[groupId];
    if (!data) return;

    clearMap();

    // 軌跡の描画
    if (data.gps_track && data.gps_track.length > 0) {
        currentPolyline = L.polyline(data.gps_track, { color: 'blue', weight: 4 }).addTo(map);
    }

    // ピンの描画
    if (data.detections) {
        data.detections.forEach(det => {
            const marker = L.marker([det.lat, det.lng], { detId: det.id }).addTo(map);
            marker.on('click', () => { window.openDetailPanel(groupId, det.id, 0); });
            currentMarkers.push(marker);
        });
    }

    map.fitBounds(imageBounds);
}

function drawHeatLayer(targetCreature) {
    if (currentHeatLayer) map.removeLayer(currentHeatLayer);
    let heatPoints = [];
    Object.values(surveyData).forEach(group => {
        if (!group.detections) return;
        group.detections.forEach(det => {
            if (targetCreature === 'all' || det.class_name === targetCreature) {
                heatPoints.push([det.lat, det.lng, 1]); 
            }
        });
    });
    currentHeatLayer = L.heatLayer(heatPoints, { radius: 25, blur: 15, maxZoom: 18 }).addTo(map);
}

function renderHeatmap() {
    clearMap(); 
    currentGroupId = "heatmap";
    document.querySelector('.title').innerText = `川の調査記録 - ヒートマップモード`;

    let creatureCounts = {}; 
    Object.values(surveyData).forEach(group => {
        if (!group.detections) return;
        group.detections.forEach(det => {
            if (creatureCounts[det.class_name]) {
                creatureCounts[det.class_name]++;
            } else {
                creatureCounts[det.class_name] = 1;
            }
        });
    });

    const ul = document.getElementById('summary-list');
    ul.innerHTML = ''; 
    const filterSelect = document.getElementById('heatmap-filter');
    filterSelect.innerHTML = '<option value="all">すべてのいきもの</option>';

    for (const [name, count] of Object.entries(creatureCounts)) {
        const li = document.createElement('li');
        li.innerText = `${name} : ${count}匹`;
        ul.appendChild(li);

        const option = document.createElement('option');
        option.value = name;
        option.innerText = name;
        filterSelect.appendChild(option);
    }
    
    document.getElementById('summary-panel').classList.remove('hidden');
    drawHeatLayer('all');
}

// --- 【新規】サイドバーのメニューをデータに合わせて自動作成する関数 ---
function updateSidebarMenu() {
    const sidebarList = document.querySelector('#sidebar ul');
    sidebarList.innerHTML = ''; // メニューを一旦空にする

    // 1. データベースから取得した動画の数だけボタンを作る
    Object.entries(surveyData).forEach(([groupId, group]) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.className = 'nav-btn group-btn';
        btn.dataset.group = groupId;
        // CSVの original_video_filename（例: GX010033.MP4）をボタン名にする
        btn.innerText = `${group.name} の記録`; 
        
        btn.addEventListener('click', () => {
            renderGroupData(groupId);
            document.querySelector('.title').innerText = `川の調査記録 - ${group.name}`;
            document.getElementById('sidebar').classList.add('hidden');
        });
        
        li.appendChild(btn);
        sidebarList.appendChild(li);
    });

    // 2. ヒートマップボタンを追加
    const liHeat = document.createElement('li');
    const btnHeat = document.createElement('button');
    btnHeat.id = 'btn-heatmap';
    btnHeat.className = 'nav-btn';
    btnHeat.innerText = 'ヒートマップモード';
    btnHeat.addEventListener('click', () => {
        renderHeatmap();
        document.getElementById('sidebar').classList.add('hidden');
    });
    liHeat.appendChild(btnHeat);
    sidebarList.appendChild(liHeat);

    // 3. リロードボタンを追加
    const liReload = document.createElement('li');
    const btnReload = document.createElement('button');
    btnReload.id = 'btn-reload';
    btnReload.className = 'nav-btn';
    btnReload.innerText = '最新状態にする';
    btnReload.addEventListener('click', async () => {
        document.getElementById('sidebar').classList.add('hidden');
        await loadSurveyData();
        alert("最新のデータをサーバーから再取得しました！");
        if (currentGroupId === "heatmap") {
            renderHeatmap();
        } else if (currentGroupId) {
            renderGroupData(currentGroupId);
        }
    });
    liReload.appendChild(btnReload);
    sidebarList.appendChild(liReload);
}

async function loadSurveyData() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/surveys`);
        surveyData = await response.json();
        console.log("サーバーからデータを取得しました:", surveyData);
        
        // データ取得後にメニューを構築
        updateSidebarMenu();
    } catch (error) {
        console.error("サーバーとの通信に失敗しました:", error);
    }
}

async function initApp() {
    await loadSurveyData(); 
}
initApp();

// ハンバーガーメニューの開閉
const menuBtn = document.getElementById('menu-btn');
const sidebar = document.getElementById('sidebar');
menuBtn.addEventListener('click', () => { sidebar.classList.toggle('hidden'); });