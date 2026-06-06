// main.js
const API_BASE_URL = '';
const ACCESS_STORAGE_KEY = 'riverMapAccessCode';
const TUTORIAL_STORAGE_KEY = 'riverMapTutorialSeen';

import './style.css';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
window.L = L;
import 'leaflet.heat';
import './wizard.js';

const getAccessCode = () => localStorage.getItem(ACCESS_STORAGE_KEY) || '';
const getAccessHeaders = () => {
    const code = getAccessCode();
    return code ? { 'X-Access-Code': code } : {};
};
const toMediaPath = (path) => {
    if (!path) return '';
    const cleanPath = path.replace(/^\/+/, '');
    const code = getAccessCode();
    return code ? `/media/${cleanPath}?access=${encodeURIComponent(code)}` : `/media/${cleanPath}`;
};

window.fetchWithAccess = (url, options = {}) => {
    const headers = new Headers(options.headers || {});
    const code = getAccessCode();
    if (code) headers.set('X-Access-Code', code);
    return fetch(url, { ...options, headers });
};

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[char]));
}

function setupAccessCodeFromUrl() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('access') || url.searchParams.get('code');
    if (!code) return;

    localStorage.setItem(ACCESS_STORAGE_KEY, code);
    url.searchParams.delete('access');
    url.searchParams.delete('code');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
}

async function checkAccess() {
    try {
        const response = await window.fetchWithAccess(`${API_BASE_URL}/api/access-check`);
        if (response.ok) return true;
    } catch (error) {
        console.error("アクセス確認に失敗しました:", error);
    }

    document.getElementById('access-gate').classList.remove('hidden');
    return false;
}

// --- ベクター画像を表示する範囲（ご指定の座標） ---
const imageBounds = [
    [35.0668688174732, 135.78416397658356], // 左上 (北西)
    [35.06464445892178, 135.78518787088882]  // 右下 (南東)
];
const allowedBounds = L.latLngBounds(imageBounds);

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
let freePosts = [];

let currentTrackLayers = [];
let currentMarkers = [];
let currentHeatLayer = null;
let currentGroupId = null;
let freePostMode = false;
let allTracksClassFilter = 'all';
let coachmarkIndex = 0;

const groupColors = {
    1: '#d32f2f',
    2: '#1976d2',
    3: '#388e3c',
    4: '#fbc02d',
    5: '#7b1fa2',
    6: '#00acc1',
    7: '#f06292'
};
const classDashPatterns = {
    1: null,
    2: '10 8',
    3: '2 8'
};

const legendPanel = document.createElement('div');
legendPanel.id = 'legend-panel';
legendPanel.className = 'legend-panel hidden';
document.getElementById('app').appendChild(legendPanel);

const freePostBanner = document.createElement('div');
freePostBanner.id = 'free-post-banner';
freePostBanner.className = 'free-post-banner hidden';
freePostBanner.innerText = '地図をタップして、投稿する場所をえらんでください';
document.getElementById('app').appendChild(freePostBanner);

const coachmarkOverlay = document.createElement('div');
coachmarkOverlay.id = 'coachmark-overlay';
coachmarkOverlay.className = 'coachmark-overlay hidden';
coachmarkOverlay.innerHTML = `
    <div class="coachmark-dim"></div>
    <div id="coachmark-highlight" class="coachmark-highlight"></div>
    <div id="coachmark-card" class="coachmark-card">
        <h2 id="coachmark-title"></h2>
        <p id="coachmark-body"></p>
        <div class="coachmark-actions">
            <button id="coachmark-skip" class="coachmark-skip">おわる</button>
            <span id="coachmark-count" class="coachmark-count"></span>
            <button id="coachmark-next" class="coachmark-next">つぎへ</button>
        </div>
    </div>
`;
document.getElementById('app').appendChild(coachmarkOverlay);

function parseGroupInfo(groupName) {
    const match = String(groupName || '').match(/(\d+)\s*組.*?(\d+)\s*班/);
    if (!match) {
        return { classNumber: 1, teamNumber: 1 };
    }

    return {
        classNumber: Number(match[1]),
        teamNumber: Number(match[2])
    };
}

function getGroupStyle(groupName) {
    const { classNumber, teamNumber } = parseGroupInfo(groupName);
    return {
        color: groupColors[teamNumber] || '#455a64',
        weight: 4,
        opacity: 0.9,
        dashArray: classDashPatterns[classNumber] || null
    };
}

function getLegendLineClass(groupName) {
    const { classNumber } = parseGroupInfo(groupName);
    if (classNumber === 2) return 'dashed';
    if (classNumber === 3) return 'dotted';
    return '';
}

function groupMatchesClass(groupName, classFilter) {
    if (classFilter === 'all') return true;
    return parseGroupInfo(groupName).classNumber === Number(classFilter);
}

function createMarkerIcon(type) {
    return L.divIcon({
        className: '',
        html: `<div class="map-marker ${type}"></div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 34]
    });
}

function setFreePostMode(enabled) {
    freePostMode = enabled;
    freePostBanner.classList.toggle('hidden', !enabled);
    const button = document.getElementById('btn-free-post');
    if (button) button.classList.toggle('active', enabled);
}

function renderImageBlock(label, imageUrl) {
    if (!imageUrl) return '';
    return `
        <span class="post-image-label">${escapeHtml(label)}</span>
        <img src="${toMediaPath(imageUrl)}" class="post-image" alt="${escapeHtml(label)}">
    `;
}

function renderPostCard(posts, postIndex, groupId, detId) {
    const post = posts[postIndex];
    const userImgHtml = renderImageBlock('かいた え・しゃしん', post.image_url);
    const conceptImgHtml = renderImageBlock('概念図', post.concept_image_url);

    return `
        <div style="background:#fff9c4; padding:15px; border-radius:8px; border:1px solid #fbc02d;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <button ${postIndex === 0 ? 'disabled' : ''} onclick="window.changePost(event, '${groupId}', '${detId}', ${postIndex - 1})" style="padding:5px 15px; background:#fbc02d; color:white; border:none; border-radius:4px; font-weight:bold; cursor:pointer;">＜</button>
                <span style="font-weight:bold; font-size:0.9em; color:#333;">${posts.length}けん中の${postIndex + 1}けんばん</span>
                <button ${postIndex === posts.length - 1 ? 'disabled' : ''} onclick="window.changePost(event, '${groupId}', '${detId}', ${postIndex + 1})" style="padding:5px 15px; background:#fbc02d; color:white; border:none; border-radius:4px; font-weight:bold; cursor:pointer;">＞</button>
            </div>
            <div style="font-size:1em; line-height:1.6; color:#333;">
                <b>なまえ:</b> ${escapeHtml(post.nickname)}<br>
                <b>いきもの:</b> ${escapeHtml(post.creature)}<br>
                <b>コメント:</b> ${escapeHtml(post.comment)}
                ${userImgHtml}
                ${conceptImgHtml}
            </div>
        </div>
    `;
}

// --- サイドパネルに表示するHTMLを作る関数 ---
window.renderPanelHTML = function(groupId, detId, postIndex = 0) {
    const det = surveyData[groupId].detections.find(d => d.id === detId);
    const thumbUrl = toMediaPath(det.thumbnail_url);

    let html = `
        <div>
            <b style="font-size: 1.4em; color: #333;">${escapeHtml(det.class_name)}</b><br>
            <span style="font-size: 0.9em; color: #666;">検出: ${escapeHtml(det.timestamp)}秒</span><br>
            
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
        html += renderPostCard(det.user_posts, postIndex, groupId, detId);
    } else {
        html += `<p style="color:#666; text-align:center; margin-top:20px;">まだみんなのとうろくはありません。</p>`;
    }

    html += `</div>`;
    return html;
};

function renderFreePostHTML(post) {
    return `
        <div>
            <b style="font-size: 1.4em; color: #333;">自由投稿</b><br>
            <span style="font-size: 0.9em; color: #666;">好きな場所に登録された投稿です</span><br>
            <div style="background:#f3e5f5; padding:15px; border-radius:8px; border:1px solid #ce93d8; margin-top:15px;">
                <div style="font-size:1em; line-height:1.6; color:#333;">
                    <b>なまえ:</b> ${escapeHtml(post.nickname)}<br>
                    <b>いきもの:</b> ${escapeHtml(post.creature)}<br>
                    <b>コメント:</b> ${escapeHtml(post.comment)}
                    ${renderImageBlock('かいた え・しゃしん', post.image_url)}
                    ${renderImageBlock('概念図', post.concept_image_url)}
                </div>
            </div>
        </div>
    `;
}

window.openDetailPanel = function(groupId, detId, postIndex = 0) {
    const panel = document.getElementById('detail-panel');
    const content = document.getElementById('panel-content');
    content.innerHTML = window.renderPanelHTML(groupId, detId, postIndex);
    panel.classList.remove('hidden');

    const det = surveyData[groupId].detections.find(d => d.id === detId);
    map.panTo([det.lat, det.lng]);
};

function openFreePostPanel(postId) {
    const post = freePosts.find(item => item.id === postId);
    if (!post) return;

    const panel = document.getElementById('detail-panel');
    const content = document.getElementById('panel-content');
    content.innerHTML = renderFreePostHTML(post);
    panel.classList.remove('hidden');
    map.panTo([post.lat, post.lng]);
}

window.changePost = function(event, groupId, detId, newIndex) {
    if (event) event.stopPropagation();
    window.openDetailPanel(groupId, detId, newIndex);
};

document.getElementById('close-panel').addEventListener('click', () => {
    document.getElementById('detail-panel').classList.add('hidden');
});

function clearMap() {
    currentTrackLayers.forEach(layer => map.removeLayer(layer));
    currentTrackLayers = [];
    if (currentHeatLayer) map.removeLayer(currentHeatLayer);
    currentHeatLayer = null;
    currentMarkers.forEach(marker => map.removeLayer(marker));
    currentMarkers = [];
    document.getElementById('summary-panel').classList.add('hidden');
    document.getElementById('detail-panel').classList.add('hidden');
    legendPanel.classList.add('hidden');
}

function renderFreePostMarkers() {
    freePosts.forEach(post => {
        const marker = L.marker([post.lat, post.lng], { icon: createMarkerIcon('free') }).addTo(map);
        marker.on('click', () => openFreePostPanel(post.id));
        currentMarkers.push(marker);
    });
}

function renderPostedDetectionMarkers(classFilter = 'all') {
    Object.entries(surveyData).forEach(([groupId, group]) => {
        if (!groupMatchesClass(group.name, classFilter) || !group.detections) return;

        group.detections.forEach(det => {
            if (!det.user_posts || det.user_posts.length === 0) return;

            const marker = L.marker([det.lat, det.lng], {
                detId: det.id,
                icon: createMarkerIcon('posted')
            }).addTo(map);
            marker.on('click', () => { window.openDetailPanel(groupId, det.id, 0); });
            currentMarkers.push(marker);
        });
    });
}

function renderGroupData(groupId) {
    setFreePostMode(false);
    currentGroupId = groupId;
    const data = surveyData[groupId];
    if (!data) return;

    clearMap();

    if (data.gps_track && data.gps_track.length > 0) {
        const line = L.polyline(data.gps_track, getGroupStyle(data.name)).addTo(map);
        currentTrackLayers.push(line);
    }

    if (data.detections) {
        data.detections.forEach(det => {
            const hasPosts = det.user_posts && det.user_posts.length > 0;
            const marker = L.marker([det.lat, det.lng], {
                detId: det.id,
                icon: createMarkerIcon(hasPosts ? 'posted' : 'unposted')
            }).addTo(map);
            marker.on('click', () => { window.openDetailPanel(groupId, det.id, 0); });
            currentMarkers.push(marker);
        });
    }

    renderFreePostMarkers();
    map.fitBounds(imageBounds);
}

function renderAllTracks(classFilter = allTracksClassFilter) {
    setFreePostMode(false);
    currentGroupId = "all-tracks";
    allTracksClassFilter = classFilter;
    clearMap();
    document.querySelector('.title').innerText = classFilter === 'all'
        ? '川の調査記録 - 全班の軌跡'
        : `川の調査記録 - ${classFilter}組の軌跡`;

    const legendItems = [];
    Object.entries(surveyData).forEach(([groupId, group]) => {
        if (!group.gps_track || group.gps_track.length === 0) return;
        if (!groupMatchesClass(group.name, classFilter)) return;

        const style = getGroupStyle(group.name);
        const line = L.polyline(group.gps_track, style).addTo(map);
        line.on('click', () => {
            renderGroupData(groupId);
            document.querySelector('.title').innerText = `川の調査記録 - ${group.name}`;
        });
        currentTrackLayers.push(line);

        legendItems.push(`
            <div class="legend-item">
                <span class="legend-line ${getLegendLineClass(group.name)}" style="border-top-color:${style.color};"></span>
                <span>${escapeHtml(group.name)}</span>
            </div>
        `);
    });

    renderPostedDetectionMarkers(classFilter);
    renderFreePostMarkers();
    legendPanel.innerHTML = `
        <h3>凡例</h3>
        <select id="track-class-filter" class="track-filter" aria-label="表示する組">
            <option value="all" ${classFilter === 'all' ? 'selected' : ''}>すべての組</option>
            <option value="1" ${classFilter === '1' ? 'selected' : ''}>1組だけ</option>
            <option value="2" ${classFilter === '2' ? 'selected' : ''}>2組だけ</option>
            <option value="3" ${classFilter === '3' ? 'selected' : ''}>3組だけ</option>
        </select>
        ${legendItems.length > 0 ? legendItems.join('') : '<p style="margin:0; color:#666;">表示できる軌跡がありません。</p>'}
    `;
    legendPanel.classList.remove('hidden');
    document.getElementById('track-class-filter').addEventListener('change', (event) => {
        renderAllTracks(event.target.value);
    });
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
    freePosts.forEach(post => {
        if (targetCreature === 'all' || post.creature === targetCreature) {
            heatPoints.push([post.lat, post.lng, 1]);
        }
    });
    currentHeatLayer = L.heatLayer(heatPoints, { radius: 25, blur: 15, maxZoom: 18 }).addTo(map);
}

function renderHeatmap() {
    setFreePostMode(false);
    clearMap();
    currentGroupId = "heatmap";
    document.querySelector('.title').innerText = `川の調査記録 - ヒートマップモード`;

    let creatureCounts = {};
    Object.values(surveyData).forEach(group => {
        if (!group.detections) return;
        group.detections.forEach(det => {
            creatureCounts[det.class_name] = (creatureCounts[det.class_name] || 0) + 1;
        });
    });
    freePosts.forEach(post => {
        creatureCounts[post.creature] = (creatureCounts[post.creature] || 0) + 1;
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

document.getElementById('heatmap-filter').addEventListener('change', (event) => {
    drawHeatLayer(event.target.value);
});

const coachmarkSteps = [
    {
        selector: '#menu-btn',
        title: 'メニュー',
        body: 'ここから班の記録、全班の軌跡、ヒートマップ、好きな場所への投稿を選びます。',
        before: () => document.getElementById('sidebar').classList.add('hidden')
    },
    {
        selector: '#btn-all-tracks',
        title: '全班の軌跡',
        body: 'すべての班の移動軌跡を重ねて表示します。表示中に凡例のメニューから1組、2組、3組を選べます。',
        before: () => document.getElementById('sidebar').classList.remove('hidden')
    },
    {
        selector: '#btn-free-post',
        title: '好きな場所に投稿',
        body: 'このボタンを押してから地図をタップすると、検出ポイント以外の好きな場所にも投稿できます。',
        before: () => document.getElementById('sidebar').classList.remove('hidden')
    },
    {
        selector: '#map',
        title: '地図',
        body: 'ピンを押すと、その場所の画像や投稿が見られます。オレンジ色のピンは投稿がある場所です。',
        before: () => document.getElementById('sidebar').classList.add('hidden')
    },
    {
        selector: '#btn-heatmap',
        title: 'ヒートマップ',
        body: '見つかったいきものが多い場所を色の濃さで確認できます。',
        before: () => document.getElementById('sidebar').classList.remove('hidden')
    }
];

function placeCoachmark(targetElement) {
    const rect = targetElement.getBoundingClientRect();
    const padding = 8;
    const highlight = document.getElementById('coachmark-highlight');
    const card = document.getElementById('coachmark-card');

    highlight.style.top = `${Math.max(rect.top - padding, 8)}px`;
    highlight.style.left = `${Math.max(rect.left - padding, 8)}px`;
    highlight.style.width = `${Math.min(rect.width + padding * 2, window.innerWidth - 16)}px`;
    highlight.style.height = `${Math.min(rect.height + padding * 2, window.innerHeight - 16)}px`;

    const cardWidth = Math.min(360, window.innerWidth - 32);
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow > 190 ? rect.bottom + 16 : Math.max(16, rect.top - 190);
    let left = rect.left;
    if (left + cardWidth > window.innerWidth - 16) {
        left = window.innerWidth - cardWidth - 16;
    }

    card.style.top = `${top}px`;
    card.style.left = `${Math.max(16, left)}px`;
}

function renderCoachmarkStep() {
    const step = coachmarkSteps[coachmarkIndex];
    if (!step) {
        finishTutorial();
        return;
    }

    if (step.before) step.before();

    requestAnimationFrame(() => {
        const targetElement = document.querySelector(step.selector);
        if (!targetElement) {
            coachmarkIndex += 1;
            renderCoachmarkStep();
            return;
        }

        document.getElementById('coachmark-title').innerText = step.title;
        document.getElementById('coachmark-body').innerText = step.body;
        document.getElementById('coachmark-count').innerText = `${coachmarkIndex + 1}/${coachmarkSteps.length}`;
        document.getElementById('coachmark-next').innerText = coachmarkIndex === coachmarkSteps.length - 1 ? 'おわる' : 'つぎへ';
        placeCoachmark(targetElement);
        coachmarkOverlay.classList.remove('hidden');
    });
}

function finishTutorial() {
    localStorage.setItem(TUTORIAL_STORAGE_KEY, '1');
    coachmarkOverlay.classList.add('hidden');
    document.getElementById('sidebar').classList.add('hidden');
}

function showTutorial(force = false) {
    if (!force && localStorage.getItem(TUTORIAL_STORAGE_KEY) === '1') return;
    coachmarkIndex = 0;
    renderCoachmarkStep();
}

document.getElementById('coachmark-skip').addEventListener('click', finishTutorial);
document.getElementById('coachmark-next').addEventListener('click', () => {
    coachmarkIndex += 1;
    renderCoachmarkStep();
});
window.addEventListener('resize', () => {
    if (!coachmarkOverlay.classList.contains('hidden')) {
        renderCoachmarkStep();
    }
});

function updateSidebarMenu() {
    const sidebarList = document.querySelector('#sidebar ul');
    sidebarList.innerHTML = '';

    Object.entries(surveyData).forEach(([groupId, group]) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.className = 'nav-btn group-btn';
        btn.dataset.group = groupId;
        btn.innerText = `${group.name} の記録`;

        btn.addEventListener('click', () => {
            renderGroupData(groupId);
            document.querySelector('.title').innerText = `川の調査記録 - ${group.name}`;
            document.getElementById('sidebar').classList.add('hidden');
        });

        li.appendChild(btn);
        sidebarList.appendChild(li);
    });

    const liAllTracks = document.createElement('li');
    const btnAllTracks = document.createElement('button');
    btnAllTracks.id = 'btn-all-tracks';
    btnAllTracks.className = 'nav-btn';
    btnAllTracks.innerText = '全班の軌跡を表示';
    btnAllTracks.addEventListener('click', () => {
        renderAllTracks();
        document.getElementById('sidebar').classList.add('hidden');
    });
    liAllTracks.appendChild(btnAllTracks);
    sidebarList.appendChild(liAllTracks);

    const liFreePost = document.createElement('li');
    const btnFreePost = document.createElement('button');
    btnFreePost.id = 'btn-free-post';
    btnFreePost.className = 'nav-btn';
    btnFreePost.innerText = '好きな場所に投稿する';
    btnFreePost.addEventListener('click', () => {
        setFreePostMode(true);
        document.getElementById('sidebar').classList.add('hidden');
    });
    liFreePost.appendChild(btnFreePost);
    sidebarList.appendChild(liFreePost);

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

    const liTutorial = document.createElement('li');
    const btnTutorial = document.createElement('button');
    btnTutorial.className = 'nav-btn';
    btnTutorial.innerText = '使い方を見る';
    btnTutorial.addEventListener('click', () => {
        showTutorial(true);
        document.getElementById('sidebar').classList.add('hidden');
    });
    liTutorial.appendChild(btnTutorial);
    sidebarList.appendChild(liTutorial);

    const liReload = document.createElement('li');
    const btnReload = document.createElement('button');
    btnReload.id = 'btn-reload';
    btnReload.className = 'nav-btn';
    btnReload.innerText = '最新状態にする';
    btnReload.addEventListener('click', async () => {
        document.getElementById('sidebar').classList.add('hidden');
        await loadSurveyData();
        alert("最新のデータをサーバーから再取得しました！");
        rerenderCurrentView();
    });
    liReload.appendChild(btnReload);
    sidebarList.appendChild(liReload);
}

function rerenderCurrentView() {
    if (currentGroupId === "heatmap") {
        renderHeatmap();
    } else if (currentGroupId === "all-tracks") {
        renderAllTracks();
    } else if (currentGroupId) {
        renderGroupData(currentGroupId);
    }
}

async function loadSurveyData() {
    try {
        const response = await window.fetchWithAccess(`${API_BASE_URL}/api/surveys`);
        if (!response.ok) {
            throw new Error(`サーバーエラー: ${response.status}`);
        }
        const payload = await response.json();
        surveyData = payload.groups || payload;
        freePosts = payload.free_posts || [];
        console.log("サーバーからデータを取得しました:", payload);
        updateSidebarMenu();
    } catch (error) {
        console.error("サーバーとの通信に失敗しました:", error);
    }
}

window.onPostSubmitted = async function() {
    setFreePostMode(false);
    await loadSurveyData();
    rerenderCurrentView();
};

map.on('click', (event) => {
    if (!freePostMode) return;

    if (!allowedBounds.contains(event.latlng)) {
        alert("投稿できる場所は川マップの範囲内だけです。");
        return;
    }

    window.openWizard({
        type: 'free',
        lat: event.latlng.lat,
        lng: event.latlng.lng
    });
});

async function initApp() {
    setupAccessCodeFromUrl();
    const hasAccess = await checkAccess();
    if (!hasAccess) return;

    await loadSurveyData();
    showTutorial(false);
}
initApp();

// ハンバーガーメニューの開閉
const menuBtn = document.getElementById('menu-btn');
const sidebar = document.getElementById('sidebar');
menuBtn.addEventListener('click', () => { sidebar.classList.toggle('hidden'); });
