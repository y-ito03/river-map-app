import './admin.css';

const ADMIN_STORAGE_KEY = 'riverMapAdminCode';

const loginPanel = document.getElementById('login-panel');
const postsPanel = document.getElementById('posts-panel');
const adminCodeInput = document.getElementById('admin-code-input');
const saveCodeBtn = document.getElementById('save-code-btn');
const logoutBtn = document.getElementById('logout-btn');
const loginMessage = document.getElementById('login-message');
const postsList = document.getElementById('posts-list');
const reloadBtn = document.getElementById('reload-btn');
const statusFilter = document.getElementById('status-filter');
const typeFilter = document.getElementById('type-filter');
const summaryText = document.getElementById('summary-text');

let posts = [];

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
  postsPanel.classList.add('hidden');
  logoutBtn.classList.add('hidden');
  loginMessage.textContent = message;
}

function showPosts() {
  loginPanel.classList.add('hidden');
  postsPanel.classList.remove('hidden');
  logoutBtn.classList.remove('hidden');
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

async function checkAdminCode() {
  await fetchJson('/api/admin/check');
}

function getPostTypeLabel(post) {
  return post.type === 'free' ? 'えらんだ場所' : 'ピン';
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

async function handleLogin() {
  const code = adminCodeInput.value.trim();
  if (!code) {
    loginMessage.textContent = '管理用コードを入力してください。';
    return;
  }

  setAdminCode(code);
  try {
    await checkAdminCode();
    showPosts();
    await loadPosts();
  } catch (error) {
    clearAdminCode();
    showLogin(error.message);
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
statusFilter.addEventListener('change', renderPosts);
typeFilter.addEventListener('change', renderPosts);
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

async function init() {
  const code = getAdminCode();
  if (!code) {
    showLogin();
    return;
  }

  try {
    await checkAdminCode();
    showPosts();
    await loadPosts();
  } catch (error) {
    clearAdminCode();
    showLogin(error.message);
  }
}

init();
