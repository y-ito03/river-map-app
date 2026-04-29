// main.js
import './style.css';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
window.L = L; 
import 'leaflet.heat';
import './wizard.js'; 
import { dummyData } from './data.js'; 

import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';
L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl });

// --- 地図の初期化 ---
const map = L.map('map', { 
    minZoom: 14, // 14まで縮小できるように変更
    maxZoom: 20  // 20まで拡大できるように変更（超拡大モード）
}).setView([35.0658, 135.7847], 17);

L.tileLayer('/tiles/{z}/{x}/{y}.jpg', {
    minZoom: 14, 
    maxZoom: 20, 
    maxNativeZoom: 18, // 画像データとして存在するのは18まで。それ以上は画像を強制的に引き伸ばす
    attribution: 'Map data &copy; 国土地理院'
}).addTo(map);

let currentPolyline = null; 
let currentMarkers = [];    
let currentHeatLayer = null; 
let currentGroupId = null;  

// --- サイドパネルに表示するHTMLを作る関数 ---
window.renderPanelHTML = function(groupId, detId, postIndex = 0) {
    const det = dummyData[groupId].detections.find(d => d.id === detId);
    
    let html = `
        <div>
            <b style="font-size: 1.4em; color: #333;">${det.class_name}</b><br>
            <span style="font-size: 0.9em; color: #666;">検出: ${det.timestamp}秒</span><br>
            
            <div style="display:flex; gap:10px; margin-top:15px; margin-bottom:15px;">
                <div style="flex:1; background:#eee; height:100px; text-align:center; font-size:0.8em; line-height:100px; color:#555; border-radius:8px;">地上画像</div>
                <div style="flex:1; background:#ddd; height:100px; text-align:center; font-size:0.8em; line-height:100px; color:#555; border-radius:8px;">水中画像</div>
            </div>
            
            <button onclick="window.openWizard('${det.id}')" style="margin-bottom:20px; padding:12px 15px; background:#4CAF50; color:white; border:none; border-radius:8px; font-weight:bold; cursor:pointer; width:100%; font-size: 1.1em;">
                ＋ ついかする
            </button>
    `;

    if (det.user_posts && det.user_posts.length > 0) {
        const post = det.user_posts[postIndex];
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
                </div>
            </div>
        `;
    } else {
        html += `<p style="color:#666; text-align:center; margin-top:20px;">まだみんなのとうろくはありません。</p>`;
    }

    html += `</div>`;
    return html;
};

// --- パネルを開く関数 ---
window.openDetailPanel = function(groupId, detId, postIndex = 0) {
    const panel = document.getElementById('detail-panel');
    const content = document.getElementById('panel-content');
    content.innerHTML = window.renderPanelHTML(groupId, detId, postIndex);
    panel.classList.remove('hidden');
    
    const det = dummyData[groupId].detections.find(d => d.id === detId);
    map.panTo([det.lat, det.lng]);
};

// --- カルーセルの表示更新関数 ---
window.changePost = function(event, groupId, detId, newIndex) {
    if (event) event.stopPropagation();
    window.openDetailPanel(groupId, detId, newIndex);
};

// パネルの閉じるボタン
document.getElementById('close-panel').addEventListener('click', () => {
    document.getElementById('detail-panel').classList.add('hidden');
});

// --- 地図上のデータをすべて消す関数 ---
function clearMap() {
    if (currentPolyline) map.removeLayer(currentPolyline);
    if (currentHeatLayer) map.removeLayer(currentHeatLayer);
    currentMarkers.forEach(marker => map.removeLayer(marker));
    currentMarkers = [];
    document.getElementById('summary-panel').classList.add('hidden');
    document.getElementById('detail-panel').classList.add('hidden'); 
}

// --- 班のデータを地図に描画する関数 ---
function renderGroupData(groupId) {
    currentGroupId = groupId;
    const data = dummyData[groupId];
    if (!data) return;

    clearMap();

    currentPolyline = L.polyline(data.gps_track, { color: 'blue', weight: 4 }).addTo(map);

    data.detections.forEach(det => {
        const marker = L.marker([det.lat, det.lng], { detId: det.id }).addTo(map);
        marker.on('click', () => { window.openDetailPanel(groupId, det.id, 0); });
        currentMarkers.push(marker);
    });

    map.fitBounds(currentPolyline.getBounds());
}

// --- 【追加】指定した生物のヒートマップ（熱源）を描画する関数 ---
function drawHeatLayer(targetCreature) {
    if (currentHeatLayer) map.removeLayer(currentHeatLayer);

    let heatPoints = [];
    
    // 全データから、条件に合うものだけを抽出する
    Object.values(dummyData).forEach(group => {
        group.detections.forEach(det => {
            if (targetCreature === 'all' || det.class_name === targetCreature) {
                // [緯度, 経度, 強度] の配列を作成して追加
                heatPoints.push([det.lat, det.lng, 1]); 
            }
        });
    });

    // ヒートマップを地図に追加
    currentHeatLayer = L.heatLayer(heatPoints, { radius: 25, blur: 15, maxZoom: 18 }).addTo(map);
}

// --- ヒートマップモードの準備とUI構築を行う関数 ---
function renderHeatmap() {
    clearMap(); 
    currentGroupId = "heatmap";
    document.querySelector('.title').innerText = `川の調査記録 - ヒートマップモード`;

    let creatureCounts = {}; 

    // 全ての生物の出現数を集計する
    Object.values(dummyData).forEach(group => {
        group.detections.forEach(det => {
            if (creatureCounts[det.class_name]) {
                creatureCounts[det.class_name]++;
            } else {
                creatureCounts[det.class_name] = 1;
            }
        });
    });

    // リストの初期化
    const ul = document.getElementById('summary-list');
    ul.innerHTML = ''; 
    
    // ドロップダウンの初期化
    const filterSelect = document.getElementById('heatmap-filter');
    filterSelect.innerHTML = '<option value="all">すべてのいきもの</option>';

    // 集計結果をもとに、リストとドロップダウンの項目（option）を作成
    for (const [name, count] of Object.entries(creatureCounts)) {
        // リスト（〇〇 : 〇匹）の追加
        const li = document.createElement('li');
        li.innerText = `${name} : ${count}匹`;
        ul.appendChild(li);

        // ドロップダウンの選択肢の追加
        const option = document.createElement('option');
        option.value = name;
        option.innerText = name;
        filterSelect.appendChild(option);
    }
    
    document.getElementById('summary-panel').classList.remove('hidden');

    // 初期状態として「すべて」のヒートマップを描画する
    drawHeatLayer('all');
}


// --- UI（メニュー・ボタン等）の動作 ---
const menuBtn = document.getElementById('menu-btn');
const sidebar = document.getElementById('sidebar');

menuBtn.addEventListener('click', () => { sidebar.classList.toggle('hidden'); });

document.querySelectorAll('.group-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        renderGroupData(e.target.dataset.group);
        document.querySelector('.title').innerText = `川の調査記録 - ${dummyData[e.target.dataset.group].name}`;
        sidebar.classList.add('hidden');
    });
});

document.getElementById('btn-heatmap').addEventListener('click', () => {
    renderHeatmap();
    sidebar.classList.add('hidden');
});

// 【追加】ドロップダウンが変更されたら、ヒートマップを描き直す
document.getElementById('heatmap-filter').addEventListener('change', (e) => {
    drawHeatLayer(e.target.value);
});

document.getElementById('btn-reload').addEventListener('click', () => {
    alert("最新のデータを取得しました！（※今はダミーなので画面は変わりません）");
    sidebar.classList.add('hidden');
});