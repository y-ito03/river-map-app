import './admin.css';

const ADMIN_STORAGE_KEY = 'riverMapAdminCode';

const loginPanel = document.getElementById('login-panel');
const adminTabs = document.getElementById('admin-tabs');
const postsPanel = document.getElementById('posts-panel');
const detectionsPanel = document.getElementById('detections-panel');
const adminCodeInput = document.getElementById('admin-code-input');
const saveCodeBtn = document.getElementById('save-code-btn');
const logoutBtn = document.getElementById('logout-btn');
const loginMessage = document.getElementById('login-message');
const postsList = document.getElementById('posts-list');
const reloadBtn = document.getElementById('reload-btn');
const statusFilter = document.getElementById('status-filter');
const typeFilter = document.getElementById('type-filter');
const summaryText = document.getElementById('summary-text');
const detectionsList = document.getElementById('detections-list');
const reloadDetectionsBtn = document.getElementById('reload-detections-btn');
const detectionStatusFilter = document.getElementById('detection-status-filter');
const detectionGroupFilter = document.getElementById('detection-group-filter');
const detectionSummaryText = document.getElementById('detection-summary-text');
const addDetectionForm = document.getElementById('add-detection-form');
const addDetectionGroup = document.getElementById('add-detection-group');
const addDetectionClass = document.getElementById('add-detection-class');
const addDetectionMessage = document.getElementById('add-detection-message');

let posts = [];
let detections = [];
let labelOptions = [];
let groups = [];
let activeView = 'posts';
const detectionLabelAliases = {
  ebi: 'エビ',
  'ハグロトンボのヤゴ': 'ハグロトンボ',
  'コオニヤンマのヤゴ': 'コオニヤンマ',
  その他: 'その他の生き物',
};

function getAdminCode() {
  return localStorage.getItem(ADMIN_STORAGE_KEY) || '';
}

function setAdminCode(code) {
  localStorage.setItem(ADMIN_STORAGE_KEY, code);
}

function clearAdminCode() {
  localStorage.removeItem(ADMIN_STORAGE_KEY);
}

function adminHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Admin-Code': getAdminCode(),
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));
}

function toMediaPath(path) {
  if (!path) return '';
  return `/media/${String(path).replace(/^\/+/, '')}?admin=${encodeURIComponent(getAdminCode())}`;
}

function showLogin(message = '') {
  loginPanel.classList.remove('hidden');
  adminTabs.classList.add('hidden');
  postsPanel.classList.add('hidden');
  detectionsPanel.classList.add('hidden');
  logoutBtn.classList.add('hidden');
  loginMessage.textContent = message;
}

function showAdmin() {
  loginPanel.classList.add('hidden');
  adminTabs.classList.remove('hidden');
  logoutBtn.classList.remove('hidden');
  setActiveView(activeView);
}

function setActiveView(view) {
  activeView = view;
  postsPanel.classList.toggle('hidden', view !== 'posts');
  detectionsPanel.classList.toggle('hidden', view !== 'detections');
  adminTabs.querySelectorAll('.tab-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });

  if (view === 'posts' && posts.length === 0) {
    loadPosts().catch((error) => showLogin(error.message));
  }
  if (view === 'detections' && detections.length === 0) {
    loadDetections().catch((error) => showLogin(error.message));
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...adminHeaders(),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `通信に失敗しました (${response.status})`);
  }

  return response.json();
}

async function fetchForm(url, formData) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Admin-Code': getAdminCode(),
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `通信に失敗しました (${response.status})`);
  }

  return response.json();
}

async function checkAdminCode() {
  await fetchJson('/api/admin/check');
}

function getPostTypeLabel(post) {
  return post.type === 'free' ? 'えらんだ場所' : 'ピン';
}

function parseVerifiedLabels(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
  } catch (error) {
    // Older values may be stored as plain text.
  }
  return [value].filter(Boolean);
}

function normalizeDetectionLabel(value) {
  return detectionLabelAliases[value] || value || '';
}

function getLocationLabel(post) {
  if (post.type === 'free') {
    const classLabel = post.class_number ? `クラス ${post.class_number}` : '全体';
    return `${classLabel} / 緯度 ${Number(post.lat).toFixed(6)}, 経度 ${Number(post.lng).toFixed(6)}`;
  }

  const groupName = post.group_name || '班不明';
  const detection = post.detection_class || 'いきもの不明';
  return `${groupName} / ${detection}`;
}

function renderImage(label, imageUrl) {
  if (!imageUrl) return '';
  const src = toMediaPath(imageUrl);
  return `
    <a class="admin-image" href="${escapeHtml(src)}" target="_blank" rel="noreferrer">
      <img src="${escapeHtml(src)}" alt="${escapeHtml(label)}">
      <span>${escapeHtml(label)}</span>
    </a>
  `;
}

function getFilteredPosts() {
  return posts.filter((post) => {
    const status = statusFilter.value;
    const type = typeFilter.value;

    if (status === 'visible' && post.hidden) return false;
    if (status === 'hidden' && !post.hidden) return false;
    if (type !== 'all' && post.type !== type) return false;
    return true;
  });
}

function renderPosts() {
  const filteredPosts = getFilteredPosts();
  const visibleCount = posts.filter((post) => !post.hidden).length;
  const hiddenCount = posts.filter((post) => post.hidden).length;
  summaryText.textContent = `全 ${posts.length}件 / 表示中 ${visibleCount}件 / 非表示 ${hiddenCount}件`;

  if (filteredPosts.length === 0) {
    postsList.innerHTML = '<p class="empty-text">表示する投稿はありません。</p>';
    return;
  }

  postsList.innerHTML = filteredPosts.map((post) => `
    <article class="post-card ${post.hidden ? 'is-hidden' : ''}">
      <div class="post-card-header">
        <div>
          <span class="post-type">${getPostTypeLabel(post)}</span>
          <h2>${escapeHtml(post.creature || 'いきもの未選択')}</h2>
        </div>
        <span class="status-badge">${post.hidden ? '非表示' : '表示中'}</span>
      </div>

      <p class="location-text">${escapeHtml(getLocationLabel(post))}</p>
      <p class="comment-text">${escapeHtml(post.comment || 'コメントなし')}</p>

      <div class="image-row">
        ${renderImage('かいた絵', post.image_url)}
        ${renderImage('考えた図', post.concept_image_url)}
      </div>

      <div class="actions">
        <button class="secondary-btn" data-action="toggle" data-type="${post.type}" data-id="${post.id}" data-hidden="${post.hidden ? '0' : '1'}">
          ${post.hidden ? '表示にもどす' : '非表示にする'}
        </button>
        <button class="danger-btn" data-action="delete" data-type="${post.type}" data-id="${post.id}">
          削除
        </button>
      </div>
    </article>
  `).join('');
}

async function loadPosts() {
  summaryText.textContent = '読み込み中...';
  const data = await fetchJson('/api/admin/posts');
  posts = data.posts || [];
  renderPosts();
}

function updateDetectionGroupFilter() {
  const currentValue = detectionGroupFilter.value;
  const groupNames = groups
    .map((group) => group.name || group.id || '班不明')
    .sort((a, b) => a.localeCompare(b, 'ja'));

  detectionGroupFilter.innerHTML = `
    <option value="all">すべての班</option>
    ${groupNames.map((groupName) => `<option value="${escapeHtml(groupName)}">${escapeHtml(groupName)}</option>`).join('')}
  `;

  if ([...detectionGroupFilter.options].some((option) => option.value === currentValue)) {
    detectionGroupFilter.value = currentValue;
  }
}

function updateAddDetectionFormOptions() {
  const selectedGroup = addDetectionGroup.value;
  const selectedClass = addDetectionClass.value;

  addDetectionGroup.innerHTML = `
    <option value="">班を選ぶ</option>
    ${groups.map((group) => `
      <option value="${escapeHtml(group.id)}">${escapeHtml(group.name || group.id)}</option>
    `).join('')}
  `;

  addDetectionClass.innerHTML = `
    <option value="">生物名を選ぶ</option>
    ${labelOptions.map((name) => `
      <option value="${escapeHtml(name)}">${escapeHtml(name)}</option>
    `).join('')}
  `;

  if ([...addDetectionGroup.options].some((option) => option.value === selectedGroup)) {
    addDetectionGroup.value = selectedGroup;
  }
  if ([...addDetectionClass.options].some((option) => option.value === selectedClass)) {
    addDetectionClass.value = selectedClass;
  }
}

function getFilteredDetections() {
  return detections.filter((detection) => {
    const status = detectionStatusFilter.value;
    const group = detectionGroupFilter.value;
    const groupName = detection.group_name || detection.group_id || '班不明';

    if (status === 'visible' && detection.hidden) return false;
    if (status === 'hidden' && !detection.hidden) return false;
    if (group !== 'all' && groupName !== group) return false;
    return true;
  });
}

function renderDetectionSelect(detection) {
  const selectedName = normalizeDetectionLabel(detection.class_name);
  return `
    <select class="detection-name-select" data-detection-id="${escapeHtml(detection.id)}" aria-label="候補名">
      ${labelOptions.map((name) => `
        <option value="${escapeHtml(name)}" ${name === selectedName ? 'selected' : ''}>
          ${escapeHtml(name)}
        </option>
      `).join('')}
    </select>
  `;
}

function renderDetections() {
  const filteredDetections = getFilteredDetections();
  const visibleCount = detections.filter((detection) => !detection.hidden).length;
  const hiddenCount = detections.filter((detection) => detection.hidden).length;
  detectionSummaryText.textContent = `全 ${detections.length}件 / 表示中 ${visibleCount}件 / 非表示 ${hiddenCount}件`;

  if (filteredDetections.length === 0) {
    detectionsList.innerHTML = '<p class="empty-text">表示する検出候補はありません。</p>';
    return;
  }

  detectionsList.innerHTML = filteredDetections.map((detection) => {
    const verifiedLabels = parseVerifiedLabels(detection.verified_class_name);
    const displayClassName = normalizeDetectionLabel(detection.class_name);
    const thumbnail = toMediaPath(detection.thumbnail_path);
    const groupName = detection.group_name || detection.group_id || '班不明';
    const timestamp = Number.isFinite(Number(detection.timestamp_sec))
      ? `${Number(detection.timestamp_sec).toFixed(1)}秒`
      : '時刻不明';

    return `
      <article class="detection-card ${detection.hidden ? 'is-hidden' : ''}">
        <div class="detection-thumb">
          ${thumbnail
            ? `<a href="${escapeHtml(thumbnail)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(thumbnail)}" alt="AI検出候補"></a>`
            : '<span>画像なし</span>'}
        </div>

        <div class="detection-body">
          <div class="post-card-header">
            <div>
              <span class="post-type">AI検出候補</span>
              <h2>${escapeHtml(displayClassName || '候補名なし')}?</h2>
            </div>
            <span class="status-badge">${detection.hidden ? '非表示' : '表示中'}</span>
          </div>

          <p class="location-text">${escapeHtml(groupName)} / ${escapeHtml(timestamp)}</p>
          ${verifiedLabels.length > 0
            ? `<p class="verified-text">児童の確認: ${escapeHtml(verifiedLabels.join('、'))}</p>`
            : '<p class="verified-text">児童の確認: まだ</p>'}

          <div class="detection-edit-row">
            ${renderDetectionSelect(detection)}
            <button class="secondary-btn" data-action="save-detection-name" data-id="${escapeHtml(detection.id)}">候補名を保存</button>
          </div>

          <div class="actions">
            <button class="secondary-btn" data-action="toggle-detection" data-id="${escapeHtml(detection.id)}" data-hidden="${detection.hidden ? '0' : '1'}">
              ${detection.hidden ? '表示にもどす' : '非表示にする'}
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

async function loadDetections() {
  detectionSummaryText.textContent = '読み込み中...';
  const data = await fetchJson('/api/admin/detections');
  groups = data.groups || [];
  detections = data.detections || [];
  labelOptions = data.label_options || [];
  updateDetectionGroupFilter();
  updateAddDetectionFormOptions();
  renderDetections();
}

async function handleLogin() {
  const code = adminCodeInput.value.trim();
  if (!code) {
    loginMessage.textContent = '管理用コードを入力してください。';
    return;
  }

  setAdminCode(code);
  try {
    await checkAdminCode();
    showAdmin();
  } catch (error) {
    clearAdminCode();
    showLogin(error.message);
  }
}

async function toggleDetection(id, hidden) {
  await fetchJson(`/api/admin/detections/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ hidden }),
  });
  await loadDetections();
}

async function saveDetectionName(id) {
  const select = [...detectionsList.querySelectorAll('.detection-name-select')]
    .find((element) => element.dataset.detectionId === id);
  if (!select) return;

  await fetchJson(`/api/admin/detections/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ class_name: select.value }),
  });
  await loadDetections();
}

async function addDetection(event) {
  event.preventDefault();

  const formData = new FormData(addDetectionForm);
  if (!formData.get('group_id') || !formData.get('class_name')) {
    addDetectionMessage.textContent = '班と候補名を選んでください。';
    return;
  }

  const currentGroup = formData.get('group_id');
  addDetectionMessage.textContent = '追加中...';

  try {
    await fetchForm('/api/admin/detections', formData);
    addDetectionForm.reset();
    addDetectionGroup.value = currentGroup;
    addDetectionMessage.textContent = '候補を追加しました。';
    await loadDetections();
  } catch (error) {
    addDetectionMessage.textContent = error.message;
  }
}

async function togglePost(type, id, hidden) {
  await fetchJson(`/api/admin/posts/${type}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ hidden }),
  });
  await loadPosts();
}

async function deletePost(type, id) {
  if (!window.confirm('この投稿を削除します。元にもどせません。よろしいですか？')) return;

  await fetchJson(`/api/admin/posts/${type}/${id}`, {
    method: 'DELETE',
  });
  await loadPosts();
}

saveCodeBtn.addEventListener('click', handleLogin);
adminCodeInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') handleLogin();
});
logoutBtn.addEventListener('click', () => {
  clearAdminCode();
  adminCodeInput.value = '';
  showLogin('管理用コードを消しました。');
});
reloadBtn.addEventListener('click', () => {
  loadPosts().catch((error) => showLogin(error.message));
});
reloadDetectionsBtn.addEventListener('click', () => {
  loadDetections().catch((error) => showLogin(error.message));
});
statusFilter.addEventListener('change', renderPosts);
typeFilter.addEventListener('change', renderPosts);
detectionStatusFilter.addEventListener('change', renderDetections);
detectionGroupFilter.addEventListener('change', renderDetections);
addDetectionForm.addEventListener('submit', addDetection);
adminTabs.addEventListener('click', (event) => {
  const button = event.target.closest('.tab-btn');
  if (!button) return;
  setActiveView(button.dataset.view);
});
postsList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const { action, type, id, hidden } = button.dataset;
  button.disabled = true;

  const task = action === 'delete'
    ? deletePost(type, id)
    : togglePost(type, id, hidden === '1');

  task.catch((error) => {
    window.alert(error.message);
    button.disabled = false;
  });
});
detectionsList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const { action, id, hidden } = button.dataset;
  button.disabled = true;

  const task = action === 'save-detection-name'
    ? saveDetectionName(id)
    : toggleDetection(id, hidden === '1');

  task.catch((error) => {
    window.alert(error.message);
    button.disabled = false;
  });
});

async function init() {
  const code = getAdminCode();
  if (!code) {
    showLogin();
    return;
  }

  try {
    await checkAdminCode();
    showAdmin();
  } catch (error) {
    clearAdminCode();
    showLogin(error.message);
  }
}

init();
