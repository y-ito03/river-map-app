// main.js
const API_BASE_URL = '';
const ACCESS_STORAGE_KEY = 'riverMapAccessCode';
const TUTORIAL_STORAGE_KEY = 'riverMapTutorialSeen';
const APP_TITLE = '岩倉川の調査記録';
const EVENT_DATE_JUNE19 = '2026-06-19';
const EVENT_DATE_JULY11 = '2026-07-11';
const JULY11_GROUP_ID = EVENT_DATE_JULY11;
const JULY11_LABEL = '2026年7月11日';

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

// --- 地図イラストを表示する範囲 ---
// 緯度経度は縦方向の川として保存し、画面表示だけ時計回り90度へ変換する。
const MAP_IMAGE_LNG_OFFSET = 0.00006;
const mapIllustrations = {
    [EVENT_DATE_JUNE19]: {
        url: '/river_map6_landscape.jpg',
        sourceBounds: [
            [35.0668688174732, 135.78416397658356 + MAP_IMAGE_LNG_OFFSET],
            [35.06464445892178, 135.78518787088882 + MAP_IMAGE_LNG_OFFSET]
        ]
    },
    [EVENT_DATE_JULY11]: {
        url: '/20260711_map.png',
        sourceBounds: [
            [35.06805, 135.78410],
            [35.06580, 135.78565]
        ]
    }
};

function createMapGeometry(sourceBounds) {
    const sourceNorth = sourceBounds[0][0];
    const sourceWest = sourceBounds[0][1];
    const sourceSouth = sourceBounds[1][0];
    const sourceEast = sourceBounds[1][1];
    const sourceLatSpan = sourceNorth - sourceSouth;
    const sourceLngSpan = sourceEast - sourceWest;
    const sourceCenterLat = (sourceNorth + sourceSouth) / 2;
    const sourceCenterLng = (sourceWest + sourceEast) / 2;
    const imageBounds = [
        [sourceCenterLat + sourceLngSpan / 2, sourceCenterLng - sourceLatSpan / 2],
        [sourceCenterLat - sourceLngSpan / 2, sourceCenterLng + sourceLatSpan / 2]
    ];

    return {
        sourceNorth,
        sourceWest,
        sourceSouth,
        sourceEast,
        sourceLatSpan,
        sourceLngSpan,
        imageBounds,
        allowedBounds: L.latLngBounds(imageBounds),
        targetNorth: imageBounds[0][0],
        targetWest: imageBounds[0][1],
        targetSouth: imageBounds[1][0],
        targetEast: imageBounds[1][1],
        targetLatSpan: imageBounds[0][0] - imageBounds[1][0],
        targetLngSpan: imageBounds[1][1] - imageBounds[0][1]
    };
}

Object.values(mapIllustrations).forEach(config => {
    config.geometry = createMapGeometry(config.sourceBounds);
});
let currentMapIllustration = EVENT_DATE_JUNE19;
let currentMapGeometry = mapIllustrations[currentMapIllustration].geometry;

function toDisplayLatLng(lat, lng) {
    const geometry = currentMapGeometry;
    const x = (lng - geometry.sourceWest) / geometry.sourceLngSpan;
    const y = (geometry.sourceNorth - lat) / geometry.sourceLatSpan;
    const rotatedX = 1 - y;
    const rotatedY = x;

    return [
        geometry.targetNorth - rotatedY * geometry.targetLatSpan,
        geometry.targetWest + rotatedX * geometry.targetLngSpan
    ];
}

function toSourceLatLng(lat, lng) {
    const geometry = currentMapGeometry;
    const rotatedX = (lng - geometry.targetWest) / geometry.targetLngSpan;
    const rotatedY = (geometry.targetNorth - lat) / geometry.targetLatSpan;
    const x = rotatedY;
    const y = 1 - rotatedX;

    return {
        lat: geometry.sourceNorth - y * geometry.sourceLatSpan,
        lng: geometry.sourceWest + x * geometry.sourceLngSpan
    };
}

function toDisplayTrack(track = []) {
    return track.map(point => toDisplayLatLng(point[0], point[1]));
}

// --- 地図の初期化 ---
const map = L.map('map', {
    minZoom: 17,
    maxZoom: 22,
    zoomSnap: 0.1,
    zoomDelta: 0.25,
    maxBounds: currentMapGeometry.imageBounds,
    maxBoundsViscosity: 1.0
});

let mapImageOverlay = null;

function fitMapToIllustration() {
    const coverZoom = map.getBoundsZoom(currentMapGeometry.imageBounds, true);
    map.setView(currentMapGeometry.allowedBounds.getCenter(), Math.max(coverZoom, map.getMinZoom()), { animate: false });
}

function setMapIllustration(dateKey) {
    const nextDateKey = mapIllustrations[dateKey] ? dateKey : EVENT_DATE_JUNE19;
    if (mapImageOverlay && currentMapIllustration === nextDateKey) return;

    if (mapImageOverlay) {
        map.removeLayer(mapImageOverlay);
    }

    currentMapIllustration = nextDateKey;
    currentMapGeometry = mapIllustrations[nextDateKey].geometry;
    map.setMaxBounds(currentMapGeometry.imageBounds);
    mapImageOverlay = L.imageOverlay(mapIllustrations[nextDateKey].url, currentMapGeometry.imageBounds, {
        interactive: true,
        opacity: 1.0
    }).addTo(map);
    mapImageOverlay.bringToBack();
}

setMapIllustration(EVENT_DATE_JUNE19);

fitMapToIllustration();

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
let selectedReviewGroupId = null;
let lastPanelGroupId = null;
let lastPanelOptions = {};
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
const classNames = {
    1: 'Davis',
    2: 'Hardy',
    3: 'Learned'
};
const classNameToNumber = {
    davis: 1,
    hardy: 2,
    learned: 3
};
const classLetterToNumber = {
    d: 1,
    h: 2,
    l: 3
};
const teamLetterToNumber = {
    a: 1,
    b: 2,
    c: 3,
    d: 4,
    e: 5,
    f: 6,
    g: 7
};
const speciesIconMap = [
    { keywords: ['サワガニ'], url: '/species-icons/sawagani.svg' },
    { keywords: ['アカハライモリ', 'イモリ'], url: '/species-icons/akaharaimori.svg' },
    { keywords: ['コオニヤンマ'], url: '/species-icons/kooni-yago.svg' },
    { keywords: ['ヤゴ', 'ハグロトンボ'], url: '/species-icons/hagurotonbo-yago.svg' },
    { keywords: ['カワニナ'], url: '/species-icons/kawanina.svg' },
    { keywords: ['エビ', 'ebi'], url: '/species-icons/ebi.svg' },
    { keywords: ['カワムツ'], url: '/species-icons/kawamutsu.svg' },
    { keywords: ['ドンコ'], url: '/species-icons/donko.svg' },
    { keywords: ['ヨシノボリ'], url: '/species-icons/yoshinobori.svg' },
    { keywords: ['ドジョウ'], url: '/species-icons/dojo.svg' },
    { keywords: ['その他の生き物', '生き物なし'], url: '/species-icons/other.svg' }
];
const detectionLabelOptions = [
    'サワガニ',
    'アカハライモリ',
    'ハグロトンボ',
    'コオニヤンマ',
    'カワニナ',
    'エビ',
    'カワムツ',
    'ドンコ',
    'ヨシノボリ',
    'ドジョウ',
    'その他の生き物',
    '生き物なし'
];
const speciesLabelAliases = {
    ebi: 'エビ'
};

const legendPanel = document.createElement('div');
legendPanel.id = 'legend-panel';
legendPanel.className = 'legend-panel hidden';
document.getElementById('app').appendChild(legendPanel);

const freePostBanner = document.createElement('div');
freePostBanner.id = 'free-post-banner';
freePostBanner.className = 'free-post-banner hidden';
freePostBanner.innerText = '地図をタップして、とうこうする場所をえらんでね';
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

const imageLightbox = document.createElement('div');
imageLightbox.id = 'image-lightbox';
imageLightbox.className = 'image-lightbox hidden';
imageLightbox.innerHTML = `
    <button id="image-lightbox-close" class="image-lightbox-close" aria-label="画像をとじる">×</button>
    <img id="image-lightbox-img" class="image-lightbox-img" alt="">
`;
document.getElementById('app').appendChild(imageLightbox);

const panelReopenTab = document.createElement('button');
panelReopenTab.id = 'panel-reopen-tab';
panelReopenTab.className = 'panel-reopen-tab hidden';
panelReopenTab.type = 'button';
panelReopenTab.innerText = '確認';
document.getElementById('app').appendChild(panelReopenTab);

function parseGroupInfo(groupName) {
    const name = String(groupName || '');
    const classTeamLetterMatch = name.match(/([DHL])\s*組.*?([A-G])\s*班/i);
    if (classTeamLetterMatch) {
        const teamLabel = classTeamLetterMatch[2].toUpperCase();
        return {
            classNumber: classLetterToNumber[classTeamLetterMatch[1].toLowerCase()] || 1,
            teamNumber: teamLetterToNumber[teamLabel.toLowerCase()] || 1,
            teamLabel
        };
    }

    const reversedLetterMatch = name.match(/([DHL])\s*班.*?([A-G])\s*組/i);
    if (reversedLetterMatch) {
        const teamLabel = reversedLetterMatch[2].toUpperCase();
        return {
            classNumber: classLetterToNumber[reversedLetterMatch[1].toLowerCase()] || 1,
            teamNumber: teamLetterToNumber[teamLabel.toLowerCase()] || 1,
            teamLabel
        };
    }

    const japaneseMatch = name.match(/(\d+)\s*組.*?(\d+)\s*班/);
    if (japaneseMatch) {
        return {
            classNumber: Number(japaneseMatch[1]),
            teamNumber: Number(japaneseMatch[2]),
            teamLabel: japaneseMatch[2]
        };
    }

    const englishMatch = name.match(/(Davis|Hardy|Learned).*?([A-G]|\d+)\s*班/i);
    if (englishMatch) {
        const rawTeam = englishMatch[2];
        const isLetterTeam = /^[A-G]$/i.test(rawTeam);
        const teamLabel = isLetterTeam ? rawTeam.toUpperCase() : rawTeam;
        return {
            classNumber: classNameToNumber[englishMatch[1].toLowerCase()] || 1,
            teamNumber: isLetterTeam ? (teamLetterToNumber[rawTeam.toLowerCase()] || 1) : Number(rawTeam),
            teamLabel
        };
    }

    const teamMatch = name.match(/(\d+)\s*班/);
    return {
        classNumber: 1,
        teamNumber: teamMatch ? Number(teamMatch[1]) : 1,
        teamLabel: teamMatch ? teamMatch[1] : '1'
    };
}

function getDisplayGroupName(groupName) {
    const { classNumber, teamLabel } = parseGroupInfo(groupName);
    return `${classNames[classNumber] || `Class ${classNumber}`} ${teamLabel}班`;
}

function getGroupDisplayName(groupId) {
    const group = surveyData[groupId];
    if (!group) return '';
    if (group.event_date === EVENT_DATE_JULY11 && groupId !== JULY11_GROUP_ID) {
        return `${parseGroupInfo(group.name).teamLabel}班`;
    }
    return getDisplayGroupName(group.name);
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

function isEventGroup(groupId) {
    const group = surveyData[groupId];
    return groupId === JULY11_GROUP_ID || group?.event_date === EVENT_DATE_JULY11 || group?.is_event === true;
}

function isEventOverview(groupId) {
    return groupId === JULY11_GROUP_ID || surveyData[groupId]?.is_event === true;
}

function getPostEventDate(post) {
    return post?.event_date || EVENT_DATE_JUNE19;
}

function freePostMatchesClass(post, classFilter) {
    if (getPostEventDate(post) !== EVENT_DATE_JUNE19) return false;
    if (classFilter === 'all') return true;
    return Number(post.class_number) === Number(classFilter);
}

function freePostMatchesEvent(post, eventDate) {
    return getPostEventDate(post) === eventDate;
}

function getCurrentPostEventDate() {
    return isEventGroup(currentGroupId) ? EVENT_DATE_JULY11 : EVENT_DATE_JUNE19;
}

function getCurrentFreePostClassNumber() {
    if (currentGroupId && surveyData[currentGroupId] && !isEventGroup(currentGroupId)) {
        return parseGroupInfo(surveyData[currentGroupId].name).classNumber;
    }

    if (currentGroupId === 'all-tracks' && allTracksClassFilter !== 'all') {
        return Number(allTracksClassFilter);
    }

    if (currentGroupId === 'all-tracks' && selectedReviewGroupId && surveyData[selectedReviewGroupId]) {
        return parseGroupInfo(surveyData[selectedReviewGroupId].name).classNumber;
    }

    return null;
}

function createMarkerIcon(type) {
    return L.divIcon({
        className: '',
        html: `<div class="map-marker ${type}"></div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 34]
    });
}

function getSpeciesIconUrl(creatureName) {
    const name = String(creatureName || '');
    const match = speciesIconMap.find(item => item.keywords.some(keyword => name.includes(keyword)));
    return match?.url || '/species-icons/other.svg';
}

function normalizeSpeciesLabel(creatureName) {
    const name = String(creatureName || '').trim();
    return speciesLabelAliases[name.toLowerCase()] || name;
}

function getPrimaryPostCreature(posts) {
    if (!posts || posts.length === 0) return '';
    const latestPost = posts[posts.length - 1];
    return latestPost.creature || '';
}

function createSpeciesMarkerIcon(creatureName) {
    const iconUrl = getSpeciesIconUrl(creatureName);
    return L.divIcon({
        className: '',
        html: `
            <div class="species-marker">
                <img src="${iconUrl}" alt="">
            </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 40]
    });
}

function createPostedIcon(posts) {
    return createSpeciesMarkerIcon(getPrimaryPostCreature(posts));
}

function setFreePostMode(enabled) {
    freePostMode = enabled;
    freePostBanner.classList.toggle('hidden', !enabled);
    const button = document.getElementById('btn-free-post');
    if (button) button.classList.toggle('active', enabled);
}

function renderImageBlock(label, imageUrl) {
    if (!imageUrl) return '';
    const fullImageUrl = toMediaPath(imageUrl);
    const safeImageUrl = escapeHtml(fullImageUrl);
    return `
        <span class="post-image-label">${escapeHtml(label)}</span>
        <button type="button" class="image-thumb-button" data-full-image="${safeImageUrl}" data-image-label="${escapeHtml(label)}">
            <img src="${safeImageUrl}" class="post-image" alt="${escapeHtml(label)}">
        </button>
    `;
}

function renderImageTile(label, imageUrl, emptyText) {
    if (!imageUrl) {
        return `<div class="image-preview-tile image-preview-empty">${escapeHtml(emptyText)}</div>`;
    }

    const fullImageUrl = toMediaPath(imageUrl);
    const safeImageUrl = escapeHtml(fullImageUrl);
    return `
        <button type="button" class="image-preview-tile image-thumb-button" data-full-image="${safeImageUrl}" data-image-label="${escapeHtml(label)}">
            <img src="${safeImageUrl}" alt="${escapeHtml(label)}">
        </button>
    `;
}

function renderPopupImage(label, imageUrl) {
    if (!imageUrl) {
        return `
            <div class="popup-sketch-empty">
                <span>${escapeHtml(label)}</span>
                <small>なし</small>
            </div>
        `;
    }

    const fullImageUrl = toMediaPath(imageUrl);
    const safeImageUrl = escapeHtml(fullImageUrl);
    return `
        <button type="button" class="popup-sketch-thumb image-thumb-button" data-full-image="${safeImageUrl}" data-image-label="${escapeHtml(label)}">
            <img src="${safeImageUrl}" alt="${escapeHtml(label)}">
            <span>${escapeHtml(label)}</span>
        </button>
    `;
}

function renderPostSketchPopup(posts = []) {
    const latestPost = posts.filter(Boolean).at(-1);
    if (!latestPost) {
        return '<div class="popup-sketch-card"><p>投稿はありません。</p></div>';
    }

    return `
        <div class="popup-sketch-card">
            <strong>${escapeHtml(latestPost.creature || 'とうこう')}</strong>
            <div class="popup-sketch-grid">
                ${renderPopupImage('場所のスケッチ', latestPost.concept_image_url)}
                ${renderPopupImage('生物のスケッチ', latestPost.image_url)}
            </div>
        </div>
    `;
}

function getVerifiedLabels(det) {
    const rawValue = det?.verified_class_name;
    if (!rawValue) return [];

    if (Array.isArray(rawValue)) {
        return rawValue.map(value => String(value).trim()).filter(Boolean);
    }

    const rawText = String(rawValue).trim();
    if (!rawText) return [];

    try {
        const parsed = JSON.parse(rawText);
        if (Array.isArray(parsed)) {
            return parsed.map(value => String(value).trim()).filter(Boolean);
        }
    } catch (error) {
        // 古い単一文字列の保存形式もそのまま読めるようにする。
    }

    return rawText.split(/[、,]/).map(value => value.trim()).filter(Boolean);
}

function getDetectionDisplayName(det) {
    const verifiedLabels = getVerifiedLabels(det);
    return verifiedLabels.length > 0 ? verifiedLabels.join('、') : `${normalizeSpeciesLabel(det.class_name)}?`;
}

function getGroupFreePosts(groupId) {
    const group = surveyData[groupId];
    if (!group) return [];
    if (isEventGroup(groupId)) {
        return freePosts.filter(post => freePostMatchesEvent(post, EVENT_DATE_JULY11));
    }

    const { classNumber } = parseGroupInfo(group.name);
    return freePosts.filter(post => Number(post.class_number) === Number(classNumber));
}

function getGroupPosts(groupId) {
    const group = surveyData[groupId];
    if (!group) return [];
    const detectionPosts = (group.detections || []).flatMap(det => det.user_posts || []);
    return [...detectionPosts, ...getGroupFreePosts(groupId)];
}

function findDetectionById(detId) {
    for (const group of Object.values(surveyData)) {
        const detection = (group.detections || []).find(det => det.id === detId);
        if (detection) return detection;
    }
    return null;
}

function renderImageGallery(title, images, emptyText) {
    const validImages = images.filter(item => item.url);
    return `
        <section class="review-section">
            <h3>${escapeHtml(title)}</h3>
            ${validImages.length > 0 ? `
                <div class="review-image-grid">
                    ${validImages.map(item => renderImageTile(item.label || title, item.url, emptyText)).join('')}
                </div>
            ` : `<div class="review-empty">${escapeHtml(emptyText)}</div>`}
        </section>
    `;
}

function renderDetectionReviewCard(det) {
    const selectedValues = getVerifiedLabels(det);
    const selectedSet = new Set(selectedValues);
    const isConfirmed = selectedValues.length > 0;
    const optionControls = detectionLabelOptions.map(name => `
        <label class="ai-label-choice">
            <input
                type="checkbox"
                class="ai-label-checkbox"
                value="${escapeHtml(name)}"
                ${selectedSet.has(name) ? 'checked' : ''}
            >
            <span>${escapeHtml(name)}</span>
        </label>
    `).join('');

    return `
        <article class="ai-detection-card ${isConfirmed ? 'is-confirmed' : 'is-unconfirmed'}" data-detection-id="${escapeHtml(det.id)}">
            ${renderImageTile('AI検出画像', det.thumbnail_url, '画像なし')}
            <div class="ai-detection-body">
                <p class="ai-detection-name ${isConfirmed ? 'confirmed' : 'unconfirmed'}">${escapeHtml(getDetectionDisplayName(det))}</p>
                <details class="ai-label-menu">
                    <summary>生物名を選ぶ</summary>
                    <div class="ai-label-options" aria-label="正しい生物名">
                        ${optionControls}
                    </div>
                    <button type="button" class="ai-label-save" data-detection-id="${escapeHtml(det.id)}">決定</button>
                </details>
            </div>
        </article>
    `;
}

function getSortedGroupEntries(classFilter = 'all', eventDate = EVENT_DATE_JUNE19) {
    return Object.entries(surveyData)
        .filter(([groupId, group]) => (
            !isEventOverview(groupId)
            && (group.event_date || EVENT_DATE_JUNE19) === eventDate
            && (eventDate === EVENT_DATE_JULY11 || groupMatchesClass(group.name, classFilter))
        ))
        .sort(([, a], [, b]) => {
            const infoA = parseGroupInfo(a.name);
            const infoB = parseGroupInfo(b.name);
            return infoA.classNumber - infoB.classNumber || infoA.teamNumber - infoB.teamNumber;
        });
}

function getDefaultReviewGroupId(classFilter = 'all', eventDate = EVENT_DATE_JUNE19) {
    const entries = getSortedGroupEntries(classFilter, eventDate);
    if (eventDate === EVENT_DATE_JULY11) return entries[0]?.[0] || null;
    const davisOne = entries.find(([, group]) => {
        const info = parseGroupInfo(group.name);
        return info.classNumber === 1 && info.teamNumber === 1;
    });
    return (davisOne || entries[0])?.[0] || null;
}

function renderGroupSelector(selectedGroupId, classFilter, eventDate = EVENT_DATE_JUNE19) {
    const groups = getSortedGroupEntries(classFilter, eventDate);
    if (groups.length === 0) return '';

    return `
        <label class="review-select-label">
            表示する班
            <select id="review-group-select" class="track-filter">
                ${groups.map(([groupId, group]) => `
                    <option value="${escapeHtml(groupId)}" ${groupId === selectedGroupId ? 'selected' : ''}>
                        ${escapeHtml(getGroupDisplayName(groupId))}
                    </option>
                `).join('')}
            </select>
        </label>
    `;
}

function renderGroupReviewHTML(groupId, options = {}) {
    const group = surveyData[groupId];
    if (!group) return '<p class="placeholder-text">表示できる班がありません。</p>';
    const isAllRecordsView = options.viewMode === 'all-records';
    const isEventRecord = isEventGroup(groupId);
    const postButtonLabel = isEventRecord ? '投稿する' : 'この班で投稿する';

    const posts = getGroupPosts(groupId);
    const detections = group.detections || [];
    const groundImage = group.selected_images?.ground || '';
    const underwaterImage = group.selected_images?.underwater || '';
    const placeSketches = posts.map((post, index) => ({
        label: `場所のスケッチ ${index + 1}`,
        url: post.concept_image_url
    }));
    const speciesSketches = posts.map((post, index) => ({
        label: `${post.creature || '生物'}のスケッチ ${index + 1}`,
        url: post.image_url
    }));

    return `
        <div class="review-panel">
            ${options.showSelector ? renderGroupSelector(groupId, options.classFilter || 'all', options.eventDate || group.event_date) : ''}
            ${isAllRecordsView ? '' : `<button type="button" class="panel-post-btn" data-group-id="${escapeHtml(groupId)}">${postButtonLabel}</button>`}
            ${isAllRecordsView ? '' : `
                <section class="review-section">
                    <h3>AIの予想（画像を見て正しい生物名に変更しよう！）</h3>
                    <div class="ai-detection-grid">
                        ${detections.length > 0
                            ? detections.map(renderDetectionReviewCard).join('')
                            : '<div class="review-empty">AI検出データがありません。</div>'}
                    </div>
                </section>
            `}
            <section class="review-section">
                <h3>岩倉川の様子</h3>
                <div class="river-state-grid">
                    <div class="review-subsection">
                        <h4>地上の様子</h4>
                        ${groundImage ? `<div class="review-image-grid single-image-grid">${renderImageTile('地上の様子', groundImage, '画像なし')}</div>` : '<div class="review-empty">地上の様子はありません。</div>'}
                    </div>
                    <div class="review-subsection">
                        <h4>水中の様子</h4>
                        ${underwaterImage ? `<div class="review-image-grid single-image-grid">${renderImageTile('水中の様子', underwaterImage, '画像なし')}</div>` : '<div class="review-empty">水中の様子はありません。</div>'}
                    </div>
                </div>
            </section>
            <section class="review-section">
                <h3>みんなのとうこう</h3>
                <div class="review-subsection">
                    <h4>場所のスケッチ</h4>
                    ${placeSketches.some(item => item.url) ? `<div class="review-image-grid">${placeSketches.filter(item => item.url).map(item => renderImageTile(item.label, item.url, '画像なし')).join('')}</div>` : '<div class="review-empty">まだ投稿はありません。</div>'}
                </div>
                <div class="review-subsection">
                    <h4>生物のスケッチ</h4>
                    ${speciesSketches.some(item => item.url) ? `<div class="review-image-grid">${speciesSketches.filter(item => item.url).map(item => renderImageTile(item.label, item.url, '画像なし')).join('')}</div>` : '<div class="review-empty">まだ投稿はありません。</div>'}
                </div>
            </section>
        </div>
    `;
}

function openGroupReviewPanel(groupId, options = {}) {
    if (!groupId) return;
    selectedReviewGroupId = groupId;
    lastPanelGroupId = groupId;
    lastPanelOptions = { ...options };
    const panel = document.getElementById('detail-panel');
    const content = document.getElementById('panel-content');
    const panelTitle = isEventOverview(groupId)
        ? `${JULY11_LABEL}の確認`
        : surveyData[groupId]?.event_date === EVENT_DATE_JULY11
            ? `${JULY11_LABEL} ${getGroupDisplayName(groupId)}の確認`
            : `${getGroupDisplayName(groupId)} の確認`;
    document.getElementById('panel-title').innerText = panelTitle;
    content.innerHTML = renderGroupReviewHTML(groupId, options);
    panel.classList.remove('hidden');
    panelReopenTab.classList.add('hidden');
}

async function updateDetectionLabel(detId, creatures) {
    const response = await window.fetchWithAccess(`${API_BASE_URL}/api/detections/${encodeURIComponent(detId)}/verification`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatures })
    });

    if (!response.ok) {
        throw new Error(`保存できませんでした (${response.status})`);
    }

    const payload = await response.json();
    const detection = findDetectionById(detId);
    if (detection) detection.verified_class_name = payload.verified_class_name;
}

document.getElementById('close-panel').addEventListener('click', () => {
    document.getElementById('detail-panel').classList.add('hidden');
    if (lastPanelGroupId) {
        panelReopenTab.innerText = '確認';
        panelReopenTab.classList.remove('hidden');
    }
});

panelReopenTab.addEventListener('click', () => {
    if (lastPanelGroupId) {
        openGroupReviewPanel(lastPanelGroupId, lastPanelOptions);
    }
});

function startFreePostForGroup(groupId) {
    if (!groupId || !surveyData[groupId]) return;
    selectedReviewGroupId = groupId;
    if (currentGroupId !== 'all-tracks' || isEventGroup(groupId)) {
        currentGroupId = groupId;
    }
    setFreePostMode(true);
    document.getElementById('detail-panel').classList.add('hidden');
}

function clearMap() {
    currentTrackLayers.forEach(layer => map.removeLayer(layer));
    currentTrackLayers = [];
    if (currentHeatLayer) map.removeLayer(currentHeatLayer);
    currentHeatLayer = null;
    currentMarkers.forEach(marker => map.removeLayer(marker));
    currentMarkers = [];
    document.getElementById('summary-panel').classList.add('hidden');
    document.getElementById('detail-panel').classList.add('hidden');
    panelReopenTab.classList.add('hidden');
    legendPanel.classList.add('hidden');
}

function renderFreePostMarkers(classFilter = 'all', eventDate = EVENT_DATE_JUNE19) {
    freePosts.forEach(post => {
        if (eventDate === EVENT_DATE_JULY11) {
            if (!freePostMatchesEvent(post, EVENT_DATE_JULY11)) return;
        } else if (!freePostMatchesClass(post, classFilter)) {
            return;
        }

        const marker = L.marker(toDisplayLatLng(post.lat, post.lng), { icon: createSpeciesMarkerIcon(post.creature) }).addTo(map);
        marker.bindPopup(renderPostSketchPopup([post]), {
            className: 'sketch-popup',
            maxWidth: 260,
            minWidth: 190
        });
        currentMarkers.push(marker);
    });
}

function renderPostedDetectionMarkers(classFilter = 'all', targetGroupId = null, eventDate = EVENT_DATE_JUNE19) {
    Object.entries(surveyData).forEach(([groupId, group]) => {
        if (targetGroupId && groupId !== targetGroupId) return;
        if (isEventOverview(groupId)) return;
        if (!targetGroupId && (group.event_date || EVENT_DATE_JUNE19) !== eventDate) return;
        if (eventDate === EVENT_DATE_JUNE19 && !groupMatchesClass(group.name, classFilter)) return;
        if (!group.detections) return;

        group.detections.forEach(det => {
            if (!det.user_posts || det.user_posts.length === 0) return;

            const marker = L.marker(toDisplayLatLng(det.lat, det.lng), {
                detId: det.id,
                icon: createPostedIcon(det.user_posts)
            }).addTo(map);
            marker.bindPopup(renderPostSketchPopup(det.user_posts), {
                className: 'sketch-popup',
                maxWidth: 260,
                minWidth: 190
            });
            currentMarkers.push(marker);
        });
    });
}

function renderGroupData(groupId) {
    if (isEventOverview(groupId)) {
        renderJuly11Layer();
        return;
    }

    const data = surveyData[groupId];
    if (!data) return;
    const eventDate = data.event_date || EVENT_DATE_JUNE19;
    setFreePostMode(false);
    setMapIllustration(eventDate);
    currentGroupId = groupId;

    clearMap();
    document.querySelector('.title').innerText = eventDate === EVENT_DATE_JULY11
        ? `${APP_TITLE} - ${JULY11_LABEL} ${getGroupDisplayName(groupId)}`
        : `${APP_TITLE} - ${getGroupDisplayName(groupId)}`;

    if (data.gps_track && data.gps_track.length > 0) {
        const line = L.polyline(toDisplayTrack(data.gps_track), getGroupStyle(data.name)).addTo(map);
        line.on('click', () => {
            openGroupReviewPanel(groupId);
        });
        currentTrackLayers.push(line);
    }

    const { classNumber } = parseGroupInfo(data.name);
    renderFreePostMarkers(String(classNumber), eventDate);
    renderPostedDetectionMarkers(String(classNumber), groupId, eventDate);
    openGroupReviewPanel(groupId);
    fitMapToIllustration();
    updateSidebarMenu();
}

function renderAllTracks(classFilter = allTracksClassFilter) {
    setFreePostMode(false);
    setMapIllustration(EVENT_DATE_JUNE19);
    currentGroupId = "all-tracks";
    allTracksClassFilter = classFilter;
    clearMap();
    document.querySelector('.title').innerText = classFilter === 'all'
        ? `${APP_TITLE} - すべての班の記録`
        : `${APP_TITLE} - ${classNames[classFilter]}の道`;

    const legendItems = [];
    Object.entries(surveyData).forEach(([groupId, group]) => {
        if (isEventGroup(groupId)) return;
        if (!group.gps_track || group.gps_track.length === 0) return;
        if (!groupMatchesClass(group.name, classFilter)) return;

        const style = getGroupStyle(group.name);
        const line = L.polyline(toDisplayTrack(group.gps_track), style).addTo(map);
        line.on('click', () => {
            openGroupReviewPanel(groupId, {
                showSelector: true,
                classFilter: allTracksClassFilter,
                viewMode: 'all-records'
            });
        });
        currentTrackLayers.push(line);

        legendItems.push(`
            <div class="legend-item">
                <span class="legend-line ${getLegendLineClass(group.name)}" style="border-top-color:${style.color};"></span>
                <span>${escapeHtml(getGroupDisplayName(groupId))}</span>
            </div>
        `);
    });

    renderPostedDetectionMarkers(classFilter);
    renderFreePostMarkers(classFilter);
    legendPanel.innerHTML = `
        <h3>色と線の見方</h3>
        <select id="track-class-filter" class="track-filter" aria-label="表示するクラス">
            <option value="all" ${classFilter === 'all' ? 'selected' : ''}>すべてのクラス</option>
            <option value="1" ${classFilter === '1' ? 'selected' : ''}>Davisだけ</option>
            <option value="2" ${classFilter === '2' ? 'selected' : ''}>Hardyだけ</option>
            <option value="3" ${classFilter === '3' ? 'selected' : ''}>Learnedだけ</option>
        </select>
        ${legendItems.length > 0 ? legendItems.join('') : '<p style="margin:0; color:#666;">表示できる道がありません。</p>'}
    `;
    legendPanel.classList.remove('hidden');
    document.getElementById('track-class-filter').addEventListener('change', (event) => {
        renderAllTracks(event.target.value);
    });
    const reviewGroupId = selectedReviewGroupId && surveyData[selectedReviewGroupId] && groupMatchesClass(surveyData[selectedReviewGroupId].name, classFilter)
        ? selectedReviewGroupId
        : getDefaultReviewGroupId(classFilter, EVENT_DATE_JUNE19);
    openGroupReviewPanel(reviewGroupId, { showSelector: true, classFilter, viewMode: 'all-records' });
    fitMapToIllustration();
    updateSidebarMenu();
}

function drawHeatLayer(targetCreature) {
    if (currentHeatLayer) map.removeLayer(currentHeatLayer);
    let heatPoints = [];
    Object.entries(surveyData).forEach(([groupId, group]) => {
        if (isEventGroup(groupId)) return;
        if (!group.detections) return;
        group.detections.forEach(det => {
            const creatureNames = getVerifiedLabels(det);
            const namesForHeat = creatureNames.length > 0 ? creatureNames : [normalizeSpeciesLabel(det.class_name)];
            if (targetCreature === 'all' || namesForHeat.includes(targetCreature)) {
                heatPoints.push([...toDisplayLatLng(det.lat, det.lng), 1]);
            }
        });
    });
    freePosts.forEach(post => {
        if (getPostEventDate(post) !== EVENT_DATE_JUNE19) return;
        if (targetCreature === 'all' || post.creature === targetCreature) {
            heatPoints.push([...toDisplayLatLng(post.lat, post.lng), 1]);
        }
    });
    currentHeatLayer = L.heatLayer(heatPoints, { radius: 25, blur: 15, maxZoom: 18 }).addTo(map);
}

function renderHeatmap() {
    setFreePostMode(false);
    setMapIllustration(EVENT_DATE_JUNE19);
    clearMap();
    currentGroupId = "heatmap";
    document.querySelector('.title').innerText = `${APP_TITLE} - 多く見つかった場所`;

    let creatureCounts = {};
    Object.entries(surveyData).forEach(([groupId, group]) => {
        if (isEventGroup(groupId)) return;
        if (!group.detections) return;
        group.detections.forEach(det => {
            const creatureNames = getVerifiedLabels(det);
            const namesForCount = creatureNames.length > 0 ? creatureNames : [normalizeSpeciesLabel(det.class_name)];
            namesForCount.forEach(creatureName => {
                creatureCounts[creatureName] = (creatureCounts[creatureName] || 0) + 1;
            });
        });
    });
    freePosts.forEach(post => {
        if (getPostEventDate(post) !== EVENT_DATE_JUNE19) return;
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
    updateSidebarMenu();
}

function renderJuly11Layer() {
    setFreePostMode(false);
    clearMap();
    setMapIllustration(EVENT_DATE_JULY11);
    currentGroupId = JULY11_GROUP_ID;
    document.querySelector('.title').innerText = `${APP_TITLE} - ${JULY11_LABEL}`;

    const julyGroups = getSortedGroupEntries('all', EVENT_DATE_JULY11);
    const legendItems = [];
    julyGroups.forEach(([groupId, group]) => {
        if (!group.gps_track || group.gps_track.length === 0) return;
        const style = getGroupStyle(group.name);
        const line = L.polyline(toDisplayTrack(group.gps_track), style).addTo(map);
        line.on('click', () => {
            openGroupReviewPanel(groupId, {
                showSelector: true,
                eventDate: EVENT_DATE_JULY11
            });
        });
        currentTrackLayers.push(line);
        legendItems.push(`
            <div class="legend-item">
                <span class="legend-line" style="border-top-color:${style.color};"></span>
                <span>${escapeHtml(getGroupDisplayName(groupId))}</span>
            </div>
        `);
    });

    renderFreePostMarkers('all', EVENT_DATE_JULY11);
    renderPostedDetectionMarkers('all', null, EVENT_DATE_JULY11);
    if (legendItems.length > 0) {
        legendPanel.innerHTML = `<h3>色と線の見方</h3>${legendItems.join('')}`;
        legendPanel.classList.remove('hidden');
    }

    const reviewGroupId = selectedReviewGroupId
        && surveyData[selectedReviewGroupId]?.event_date === EVENT_DATE_JULY11
        && !isEventOverview(selectedReviewGroupId)
        ? selectedReviewGroupId
        : getDefaultReviewGroupId('all', EVENT_DATE_JULY11);
    if (reviewGroupId) {
        openGroupReviewPanel(reviewGroupId, {
            showSelector: true,
            eventDate: EVENT_DATE_JULY11
        });
    } else {
        openGroupReviewPanel(JULY11_GROUP_ID);
    }
    fitMapToIllustration();
    updateSidebarMenu();
}

document.getElementById('heatmap-filter').addEventListener('change', (event) => {
    drawHeatLayer(event.target.value);
});

const coachmarkSteps = [
    {
        selector: '#menu-btn',
        title: 'メニュー',
        body: 'ここから、班の記録や、すべての班の記録を見ることができます。',
        before: () => document.getElementById('sidebar').classList.add('hidden')
    },
    {
        selector: '#btn-all-tracks',
        title: 'すべての班の記録',
        body: 'すべての班が歩いた道や投稿を、まとめて見ることができます。Davis、Hardy、Learnedだけをえらぶこともできます。',
        before: () => {
            document.getElementById('sidebar').classList.remove('hidden');
            document.getElementById('menu-date-2026-06-19')?.setAttribute('open', '');
        }
    },
    {
        selector: '#btn-free-post',
        title: '場所をえらんで投稿',
        body: 'このボタンを押してから地図をタップすると、スケッチをとうこうする場所をえらべます。',
        before: () => {
            document.getElementById('sidebar').classList.remove('hidden');
            document.getElementById('menu-date-2026-06-19')?.setAttribute('open', '');
        }
    },
    {
        selector: '#map',
        title: '地図',
        body: '班が歩いた道と、とうこうされた場所を見ることができます。',
        before: () => document.getElementById('sidebar').classList.add('hidden')
    },
    {
        selector: '#btn-heatmap',
        title: '多く見つかった場所',
        body: 'いきものが多く見つかった場所を、色で見ることができます。',
        before: () => {
            document.getElementById('sidebar').classList.remove('hidden');
            document.getElementById('menu-date-2026-06-19')?.setAttribute('open', '');
        }
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

coachmarkOverlay.addEventListener('click', (event) => {
    event.stopPropagation();
});
document.getElementById('coachmark-skip').addEventListener('click', (event) => {
    event.stopPropagation();
    finishTutorial();
});
document.getElementById('coachmark-next').addEventListener('click', (event) => {
    event.stopPropagation();
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

    const liJune19 = document.createElement('li');
    const june19Details = document.createElement('details');
    june19Details.id = 'menu-date-2026-06-19';
    june19Details.className = 'menu-details date-menu-details';
    june19Details.open = Boolean(currentGroupId && surveyData[currentGroupId] && !isEventGroup(currentGroupId));

    const june19Summary = document.createElement('summary');
    june19Summary.innerText = '2026年6月19日';
    june19Details.appendChild(june19Summary);

    const groupsDetails = document.createElement('details');
    groupsDetails.className = 'menu-details group-menu-details';
    groupsDetails.open = Boolean(currentGroupId && surveyData[currentGroupId] && !isEventGroup(currentGroupId));

    const groupsSummary = document.createElement('summary');
    groupsSummary.innerText = '班の記録を選ぶ';
    groupsDetails.appendChild(groupsSummary);

    let hasGroupMenu = false;
    Object.entries(classNames).forEach(([classNumber, className]) => {
        const classGroups = getSortedGroupEntries(String(classNumber));
        if (classGroups.length === 0) return;
        hasGroupMenu = true;

        const classDetails = document.createElement('details');
        classDetails.className = 'menu-details class-menu-details';
        classDetails.open = currentGroupId && surveyData[currentGroupId] && !isEventGroup(currentGroupId)
            ? parseGroupInfo(surveyData[currentGroupId].name).classNumber === Number(classNumber)
            : false;

        const classSummary = document.createElement('summary');
        classSummary.innerText = className;
        classDetails.appendChild(classSummary);

        const groupList = document.createElement('div');
        groupList.className = 'group-menu-list';

        classGroups.forEach(([groupId, group]) => {
            const btn = document.createElement('button');
            btn.className = 'nav-btn group-btn';
            btn.dataset.group = groupId;
            btn.innerText = `${getGroupDisplayName(groupId)} の記録`;

            btn.addEventListener('click', () => {
                renderGroupData(groupId);
                document.querySelector('.title').innerText = `${APP_TITLE} - ${getGroupDisplayName(groupId)}`;
                document.getElementById('sidebar').classList.add('hidden');
            });

            groupList.appendChild(btn);
        });

        classDetails.appendChild(groupList);
        groupsDetails.appendChild(classDetails);
    });

    if (!hasGroupMenu) {
        const btn = document.createElement('button');
        btn.className = 'nav-btn date-nav-btn';
        btn.disabled = true;
        btn.innerText = '表示できる班がありません';
        groupsDetails.appendChild(btn);
    }

    june19Details.appendChild(groupsDetails);

    liJune19.appendChild(june19Details);
    sidebarList.appendChild(liJune19);

    const liJuly11 = document.createElement('li');
    const july11Details = document.createElement('details');
    july11Details.id = 'menu-date-2026-07-11';
    july11Details.className = 'menu-details date-menu-details';
    july11Details.open = currentGroupId === JULY11_GROUP_ID
        || surveyData[currentGroupId]?.event_date === EVENT_DATE_JULY11;

    const july11Summary = document.createElement('summary');
    july11Summary.innerText = JULY11_LABEL;
    july11Details.appendChild(july11Summary);

    const btnJuly11 = document.createElement('button');
    btnJuly11.id = 'btn-july-2026';
    btnJuly11.className = 'nav-btn group-btn';
    btnJuly11.innerText = 'すべての班の記録を見る';
    btnJuly11.classList.toggle('active', currentGroupId === JULY11_GROUP_ID);
    btnJuly11.addEventListener('click', () => {
        renderJuly11Layer();
        document.getElementById('sidebar').classList.add('hidden');
    });
    july11Details.appendChild(btnJuly11);

    getSortedGroupEntries('all', EVENT_DATE_JULY11).forEach(([groupId]) => {
        const btn = document.createElement('button');
        btn.className = 'nav-btn group-btn';
        btn.dataset.group = groupId;
        btn.innerText = `${getGroupDisplayName(groupId)} の記録`;
        btn.classList.toggle('active', currentGroupId === groupId);
        btn.addEventListener('click', () => {
            renderGroupData(groupId);
            document.getElementById('sidebar').classList.add('hidden');
        });
        july11Details.appendChild(btn);
    });

    liJuly11.appendChild(july11Details);
    sidebarList.appendChild(liJuly11);

    const liAllTracks = document.createElement('li');
    const btnAllTracks = document.createElement('button');
    btnAllTracks.id = 'btn-all-tracks';
    btnAllTracks.className = 'nav-btn';
    btnAllTracks.innerText = 'すべての班の記録を見る';
    btnAllTracks.addEventListener('click', () => {
        selectedReviewGroupId = null;
        renderAllTracks();
        document.getElementById('sidebar').classList.add('hidden');
    });
    liAllTracks.appendChild(btnAllTracks);
    sidebarList.appendChild(liAllTracks);

    const liFreePost = document.createElement('li');
    const btnFreePost = document.createElement('button');
    btnFreePost.id = 'btn-free-post';
    btnFreePost.className = 'nav-btn';
    btnFreePost.innerText = '投稿する場所を選ぶ';
    btnFreePost.addEventListener('click', () => {
        setMapIllustration(EVENT_DATE_JUNE19);
        if (isEventGroup(currentGroupId)) {
            currentGroupId = null;
            clearMap();
            fitMapToIllustration();
        }
        document.querySelector('.title').innerText = `${APP_TITLE} - 投稿する場所を選ぶ`;
        setFreePostMode(true);
        document.getElementById('sidebar').classList.add('hidden');
    });
    liFreePost.appendChild(btnFreePost);
    sidebarList.appendChild(liFreePost);

    const liHeat = document.createElement('li');
    const btnHeat = document.createElement('button');
    btnHeat.id = 'btn-heatmap';
    btnHeat.className = 'nav-btn';
    btnHeat.innerText = '多く見つかった場所を見る';
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
    btnReload.innerText = '新しくする';
    btnReload.addEventListener('click', async () => {
        document.getElementById('sidebar').classList.add('hidden');
        await loadSurveyData();
        alert("新しいデータを読みこみました！");
        rerenderCurrentView();
    });
    liReload.appendChild(btnReload);
    sidebarList.appendChild(liReload);
}

function rerenderCurrentView() {
    if (currentGroupId === '2026-07-11') {
        renderJuly11Layer();
    } else if (currentGroupId === "heatmap") {
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

window.onPostCancelled = function() {
    setFreePostMode(false);
};

map.on('click', (event) => {
    if (!freePostMode) return;

    if (!currentMapGeometry.allowedBounds.contains(event.latlng)) {
        alert("とうこうできるのは、地図の中だけです。");
        return;
    }
    const sourceLatLng = toSourceLatLng(event.latlng.lat, event.latlng.lng);

    window.openWizard({
        type: 'free',
        lat: sourceLatLng.lat,
        lng: sourceLatLng.lng,
        classNumber: getCurrentFreePostClassNumber(),
        eventDate: getCurrentPostEventDate()
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

function openImageLightbox(imageUrl, label) {
    const img = document.getElementById('image-lightbox-img');
    img.src = imageUrl;
    img.alt = label || '画像';
    imageLightbox.classList.remove('hidden');
}

function closeImageLightbox() {
    imageLightbox.classList.add('hidden');
    document.getElementById('image-lightbox-img').src = '';
}

document.addEventListener('click', (event) => {
    const imageButton = event.target.closest('.image-thumb-button');
    if (!imageButton) return;

    event.stopPropagation();
    openImageLightbox(imageButton.dataset.fullImage, imageButton.dataset.imageLabel);
});

document.addEventListener('change', async (event) => {
    const reviewGroupSelect = event.target.closest('#review-group-select');
    if (reviewGroupSelect) {
        const selectedEventDate = surveyData[reviewGroupSelect.value]?.event_date || EVENT_DATE_JUNE19;
        openGroupReviewPanel(reviewGroupSelect.value, {
            showSelector: true,
            classFilter: allTracksClassFilter,
            eventDate: selectedEventDate,
            viewMode: currentGroupId === 'all-tracks' ? 'all-records' : undefined
        });
    }
});

document.addEventListener('click', async (event) => {
    const saveButton = event.target.closest('.ai-label-save');
    if (saveButton) {
        const card = saveButton.closest('.ai-detection-card');
        const creatures = [...card.querySelectorAll('.ai-label-checkbox:checked')]
            .map(input => input.value)
            .filter(Boolean);

        if (creatures.length === 0) {
            alert('正しい生物名を1つ以上えらんでください。');
            return;
        }

        saveButton.disabled = true;
        saveButton.innerText = '保存中...';
        try {
            await updateDetectionLabel(saveButton.dataset.detectionId, creatures);
            const selectedEventDate = surveyData[selectedReviewGroupId]?.event_date || EVENT_DATE_JUNE19;
            openGroupReviewPanel(selectedReviewGroupId, {
                showSelector: currentGroupId === 'all-tracks' || selectedEventDate === EVENT_DATE_JULY11,
                classFilter: allTracksClassFilter,
                eventDate: selectedEventDate,
                viewMode: currentGroupId === 'all-tracks' ? 'all-records' : undefined
            });
        } catch (error) {
            alert(error.message);
            saveButton.disabled = false;
            saveButton.innerText = '決定';
        }
        return;
    }

    const panelPostButton = event.target.closest('.panel-post-btn');
    if (panelPostButton) {
        startFreePostForGroup(panelPostButton.dataset.groupId);
    }
});
document.getElementById('image-lightbox-close').addEventListener('click', (event) => {
    event.stopPropagation();
    closeImageLightbox();
});
imageLightbox.addEventListener('click', closeImageLightbox);
document.getElementById('image-lightbox-img').addEventListener('click', (event) => {
    event.stopPropagation();
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !imageLightbox.classList.contains('hidden')) {
        closeImageLightbox();
    }
});

// ハンバーガーメニューの開閉
const menuBtn = document.getElementById('menu-btn');
const sidebar = document.getElementById('sidebar');
menuBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    sidebar.classList.toggle('hidden');
});
sidebar.addEventListener('click', (event) => {
    event.stopPropagation();
});
document.addEventListener('click', () => {
    if (!coachmarkOverlay.classList.contains('hidden')) return;
    if (!sidebar.classList.contains('hidden')) {
        sidebar.classList.add('hidden');
    }
});
