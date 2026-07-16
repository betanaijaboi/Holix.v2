/* ── STATE ──────────────────────────────────────────────── */
const S = {
  user: null,
  magazines: [],
  currentMag: null,
  showFavs: false,
  adminToken: null,
  query: '',
  libClicks: 0,
  libTimer: null,
  pdfZoom: 1.0,
  pdfDoc: null,
  pdfRenderTasks: [],
  pdfPageObserver: null,
  pdfLazyObserver: null
};

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/* ── HELPERS ────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

function esc(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str));
  return d.innerHTML;
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

/* ── TOAST ──────────────────────────────────────────────── */
let toastTimer;
function toast(msg, dur = 3200) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), dur);
}

/* ── MODALS ─────────────────────────────────────────────── */
function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

/* ── API ────────────────────────────────────────────────── */
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (S.adminToken) headers['x-admin-token'] = S.adminToken;
  const r = await fetch(path, { ...opts, headers: { ...headers, ...opts.headers } });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/* ── USER ────────────────────────────────────────────────── */
async function checkUser() {
  try {
    const res = await api('/api/me');
    if (res.found) {
      S.user = res.user;
      renderUserChip();
    } else {
      openModal('registrationModal');
    }
  } catch {
    openModal('registrationModal');
  }
}

async function registerUser() {
  const input = $('userName');
  const name = input.value.trim();
  if (!name) { input.classList.add('shake'); setTimeout(() => input.classList.remove('shake'), 400); return; }
  const btn = $('registerSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Entering…';
  try {
    const res = await api('/api/register', { method: 'POST', body: JSON.stringify({ name }) });
    S.user = res.user;
    closeModal('registrationModal');
    renderUserChip();
    toast(`Welcome to HOLIX, ${res.user.name}! 👋`);
    loadMagazines();
  } catch (e) {
    toast(e.message || 'Registration failed');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enter Library';
  }
}

function renderUserChip() {
  if (!S.user) return;
  const initial = S.user.name.charAt(0).toUpperCase();
  const hr = $('headerRight');
  hr.innerHTML = `
    <div class="user-chip">
      <div class="user-avatar">${initial}</div>
      <span>Hey, ${esc(S.user.name.split(' ')[0])}!</span>
    </div>
    <button id="libraryBtn" class="library-btn" title="Click 3× for admin access">
      <svg class="lib-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <rect x="0" y="0" width="6.5" height="6.5" rx="1.5"/>
        <rect x="9.5" y="0" width="6.5" height="6.5" rx="1.5"/>
        <rect x="0" y="9.5" width="6.5" height="6.5" rx="1.5"/>
        <rect x="9.5" y="9.5" width="6.5" height="6.5" rx="1.5"/>
      </svg>
      Library
    </button>
  `;
  setupLibraryBtn();
}

/* ── FAVOURITES TOGGLE ──────────────────────────────────── */
async function toggleFav(magId, e) {
  if (e) e.stopPropagation();
  if (!S.user) { toast('Register to save favourites'); return; }
  try {
    const res = await api(`/api/favorites/${magId}`, { method: 'POST' });
    S.user.favorites = res.favorites;
    const isFav = res.favorites.includes(magId);
    toast(isFav ? '♥ Added to favourites' : '♡ Removed from favourites');
    // Update preview fav button if open
    if (S.currentMag?.id === magId) {
      setPreviewFavBtn(isFav);
      setPdfFavBtn(isFav);
      // Update fav badge in PDF HUD
      const favBadge = $('pdfFavBadge');
      if (favBadge) {
        const cur = parseInt(favBadge.textContent || '0');
        const next = Math.max(0, cur + (isFav ? 1 : -1));
        favBadge.textContent = next;
        favBadge.hidden = next === 0;
      }
    }
    if (S.showFavs) renderMagazines();
  } catch { toast('Could not update favourites'); }
}

function setPdfFavBtn(isFav) {
  const btn = $('pdfFavoriteBtn');
  if (!btn) return;
  btn.classList.toggle('faved', isFav);
  $('pdfFavIcon').setAttribute('fill', isFav ? '#DB2777' : 'none');
  $('pdfFavIcon').setAttribute('stroke', isFav ? '#DB2777' : 'currentColor');
}

/* ── MAGAZINES ───────────────────────────────────────────── */
async function loadMagazines() {
  try {
    const q = S.query ? `?q=${encodeURIComponent(S.query)}` : '';
    S.magazines = await api(`/api/magazines${q}`);
    renderMagazines();
  } catch { toast('Failed to load magazines'); }
}

function renderMagazines() {
  const grid = $('magazineGrid');
  let list = S.magazines;
  if (S.showFavs && S.user) list = list.filter(m => S.user.favorites?.includes(m.id));

  if (!list.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${S.showFavs ? '🤍' : '📚'}</div>
        <h3>${S.showFavs ? 'No favourites yet' : S.query ? 'No results found' : 'No magazines yet'}</h3>
        <p>${S.showFavs ? 'Heart a magazine while reading to save it here.' : S.query ? 'Try a different search term.' : 'Check back soon — new issues coming.'}</p>
      </div>`;
    return;
  }

  grid.innerHTML = list.map(mag => `
    <article class="mag-card" data-id="${mag.id}" onclick="openPreview('${mag.id}')">
      <div class="card-thumb">
        <img src="${mag.coverUrl}" alt="${esc(mag.title)}" loading="lazy"
          onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 300 400%22%3E%3Crect fill=%22%2314143a%22 width=%22300%22 height=%22400%22/%3E%3Ctext fill=%22%234444aa%22 font-size=%2260%22 font-family=%22serif%22 x=%22150%22 y=%22220%22 text-anchor=%22middle%22%3E📖%3C/text%3E%3C/svg%3E'">
        <div class="card-hover">
          <button class="btn-view-chip" onclick="openPreview('${mag.id}'); event.stopPropagation();">VIEW ISSUE</button>
        </div>
      </div>
      <div class="card-info">
        <div class="card-title">${esc(mag.title)}</div>
        ${mag.issue ? `<div class="card-issue">${esc(mag.issue)}</div>` : ''}
        <div class="card-meta">
          <span class="card-views">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            ${mag.views || 0}
          </span>
        </div>
      </div>
    </article>`).join('');
}

/* ── MAGAZINE PREVIEW ────────────────────────────────────── */
async function openPreview(magId) {
  try {
    const mag = await api(`/api/magazines/${magId}`);
    S.currentMag = mag;
    const idx = S.magazines.findIndex(m => m.id === magId);
    if (idx !== -1) S.magazines[idx].views = (mag.views || 0);

    $('previewCoverImg').src  = mag.coverUrl;
    $('previewCoverImg').alt  = mag.title;
    $('previewIssueNum').textContent   = mag.issue || '';
    $('previewEditionLbl').textContent = mag.title || '';
    $('previewDesc').textContent       = mag.description || '';

    const isFav = S.user?.favorites?.includes(magId) || false;
    setPreviewFavBtn(isFav);

    $('previewModal').classList.add('open');
  } catch { toast('Failed to load magazine'); }
}

function closePreview() {
  $('previewModal').classList.remove('open');
  S.currentMag = null;
}

function setPreviewFavBtn(isFav) {
  const btn = $('previewFavBtn');
  if (!btn) return;
  btn.classList.toggle('faved', isFav);
  $('prevFavIcon').setAttribute('fill', isFav ? '#DB2777' : 'none');
  $('prevFavIcon').setAttribute('stroke', isFav ? '#DB2777' : 'currentColor');
}

/* ── PDF VIEWER ──────────────────────────────────────────── */
function openMagazineFromPreview() {
  if (!S.currentMag) return;
  const mag = S.currentMag;

  // Populate left chrome
  $('pdfLeftStatus').textContent  = mag.issue || 'ISSUE';
  $('pdfLeftSubtitle').textContent = mag.title;

  // Populate right chrome meta card
  $('pdfMetaStatus').textContent = mag.issue || '—';
  $('pdfMetaTitle').textContent  = mag.title;

  // Reset zoom state
  S.pdfZoom = 1.0;
  $('pdfZoomLabel').textContent = '100%';
  $('pdfPageNum').textContent = '1';

  loadPdf(mag.pdfUrl);
  markAsRead(mag.id);

  // Fav button
  const isFav = S.user?.favorites?.includes(mag.id) || false;
  setPdfFavBtn(isFav);

  // Fav badge
  const favBadge = $('pdfFavBadge');
  if (mag.favCount > 0) {
    favBadge.textContent = mag.favCount;
    favBadge.hidden = false;
  } else {
    favBadge.hidden = true;
  }

  // Comment badge (load async)
  loadPdfCommentBadge(mag.id);

  $('pdfModal').classList.add('open');
  $('commentsPanel').classList.remove('open');
}

// Loads the PDF once via PDF.js, then renders it into per-page canvases.
// Rendering itself (renderPages) is separated out so zoom changes can
// re-render without re-fetching the document.
async function loadPdf(url) {
  cancelPdfRenders();
  const container = $('pdfPagesContainer');
  const loading = $('pdfLoading');
  container.innerHTML = '';
  loading.hidden = false;

  try {
    S.pdfDoc = await pdfjsLib.getDocument(url).promise;
    await renderPages(S.pdfZoom);
  } catch {
    container.innerHTML = '<p class="pdf-loading" style="position:static;color:#ff5566">Failed to load this PDF.</p>';
  } finally {
    loading.hidden = true;
  }
}

// Builds a correctly-sized placeholder for every page (cheap — just reads
// dimensions, doesn't render), then lazily renders each page's canvas only
// once it scrolls near the viewport. Rendering all pages upfront doesn't
// scale to longer magazines on the phones this is meant to support.
// Base scale is computed per-page so 100% zoom fits the viewer's width —
// the old "page-width" iframe behavior, reproduced manually.
async function renderPages(zoom) {
  if (!S.pdfDoc) return;
  cancelPdfRenders();
  const container = $('pdfPagesContainer');
  container.innerHTML = '';

  const wrapWidth = $('pdfFrameWrap').clientWidth - 32; // leave a little breathing room
  const pages = [];

  for (let i = 1; i <= S.pdfDoc.numPages; i++) {
    const page = await S.pdfDoc.getPage(i);
    const unscaledWidth = page.getViewport({ scale: 1 }).width;
    const baseScale = wrapWidth / unscaledWidth;
    const viewport = page.getViewport({ scale: baseScale * zoom });

    const wrap = document.createElement('div');
    wrap.className = 'pdf-page';
    wrap.dataset.page = i;
    wrap.style.width  = Math.floor(viewport.width) + 'px';
    wrap.style.height = Math.floor(viewport.height) + 'px';
    container.appendChild(wrap);
    pages.push({ page, viewport, wrap });
  }

  observePdfPageNumbers(pages.map(p => p.wrap));
  observeLazyPageRendering(pages);
  renderSinglePage(pages[0]); // render page 1 immediately — no blank flash on open
}

function renderSinglePage({ page, viewport, wrap }) {
  if (wrap.dataset.rendered) return;
  wrap.dataset.rendered = 'true';

  const outputScale = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width  = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width  = wrap.style.width;
  canvas.style.height = wrap.style.height;
  wrap.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
  const task = page.render({ canvasContext: ctx, viewport, transform });
  S.pdfRenderTasks.push(task);
  task.promise.catch(() => {}); // cancelled tasks reject — ignore
}

// Renders a page's canvas once it scrolls within ~1200px of the viewport.
function observeLazyPageRendering(pages) {
  S.pdfLazyObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const match = pages.find(p => p.wrap === entry.target);
      if (match) renderSinglePage(match);
    });
  }, { root: $('pdfFrameWrap'), rootMargin: '1200px 0px' });
  pages.forEach(p => S.pdfLazyObserver.observe(p.wrap));
}

// Tracks which page is most visible while scrolling and updates the page indicator.
function observePdfPageNumbers(wraps) {
  S.pdfPageObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) $('pdfPageNum').textContent = visible.target.dataset.page;
  }, { root: $('pdfFrameWrap'), threshold: [0.5] });
  wraps.forEach(w => S.pdfPageObserver.observe(w));
}

function cancelPdfRenders() {
  S.pdfRenderTasks.forEach(t => t.cancel());
  S.pdfRenderTasks = [];
  S.pdfLazyObserver?.disconnect();
  S.pdfPageObserver?.disconnect();
}

async function markAsRead(magId) {
  try {
    const res = await api(`/api/magazines/${magId}/read`, { method: 'POST' });
    if (S.currentMag?.id === magId) S.currentMag.views = res.views;
    const idx = S.magazines.findIndex(m => m.id === magId);
    if (idx !== -1) S.magazines[idx].views = res.views;
  } catch { /* silent — not registered yet, or offline */ }
}

async function loadPdfCommentBadge(magId) {
  try {
    const comments = await api(`/api/comments/${magId}`);
    const badge = $('pdfCommentBadge');
    if (comments.length > 0) {
      badge.textContent = comments.length;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  } catch { /* silent */ }
}

let _zoomDebounce;
function adjustZoom(delta) {
  S.pdfZoom = Math.min(3.0, Math.max(0.25, +(S.pdfZoom + delta).toFixed(2)));
  $('pdfZoomLabel').textContent = Math.round(S.pdfZoom * 100) + '%';
  // Debounce so rapid clicks only re-render once
  clearTimeout(_zoomDebounce);
  _zoomDebounce = setTimeout(() => renderPages(S.pdfZoom), 400);
}

function closePdfViewer() {
  $('pdfModal').classList.remove('open');
  cancelPdfRenders();
  $('pdfPagesContainer').innerHTML = '';
  S.pdfDoc = null;
  $('commentsPanel').classList.remove('open');
  if (document.fullscreenElement || document.webkitFullscreenElement) exitFullscreen();
  $('pdfModal').classList.remove('pseudo-fullscreen');
  updateFullscreenIcon();
}

// Explicit, user-initiated download — nothing downloads on its own.
// Fetches as a blob rather than a plain <a download>, since a plain
// download link silently fails to force-download cross-origin files
// (Supabase Storage is a different origin from the app).
async function downloadPdf() {
  if (!S.currentMag) return;
  const btn = $('pdfDownloadBtn');
  btn.disabled = true;
  try {
    const res = await fetch(S.currentMag.pdfUrl);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = [S.currentMag.title, S.currentMag.issue].filter(Boolean).join(' - ') + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
  } catch {
    toast('Download failed');
  } finally {
    btn.disabled = false;
  }
}

// True Fullscreen API isn't available for arbitrary elements on iPhone
// Safari (a long-standing WebKit limitation) — pseudo-fullscreen mode
// hides the side chrome as a fallback so the pages still get more room.
function exitFullscreen() {
  if (document.exitFullscreen) return document.exitFullscreen();
  if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
}

async function toggleFullscreen() {
  const modal = $('pdfModal');
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    await exitFullscreen();
    return;
  }
  const supported = document.fullscreenEnabled || document.webkitFullscreenEnabled;
  if (supported) {
    try {
      if (modal.requestFullscreen) { await modal.requestFullscreen(); return; }
      if (modal.webkitRequestFullscreen) { modal.webkitRequestFullscreen(); return; }
    } catch { /* fall through to pseudo-fullscreen */ }
  }
  modal.classList.toggle('pseudo-fullscreen');
  updateFullscreenIcon();
}

function updateFullscreenIcon() {
  const active = !!(document.fullscreenElement || document.webkitFullscreenElement) || $('pdfModal').classList.contains('pseudo-fullscreen');
  $('pdfFullscreenIcon').innerHTML = active
    ? '<path d="M9 3v4a1 1 0 0 1-1 1H4m16-5v4a1 1 0 0 1-1 1h-4M9 21v-4a1 1 0 0 0-1-1H4m16 5v-4a1 1 0 0 0-1-1h-4"/>'
    : '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>';
}

/* ── COMMENTS ────────────────────────────────────────────── */
function toggleComments() {
  const panel = $('commentsPanel');
  const opening = !panel.classList.contains('open');
  panel.classList.toggle('open', opening);
  if (opening) loadComments();
}

async function loadComments() {
  if (!S.currentMag) return;
  const list = $('commentsList');
  list.innerHTML = '<p class="comments-empty">Loading…</p>';
  try {
    const comments = await api(`/api/comments/${S.currentMag.id}`);
    if (!comments.length) {
      list.innerHTML = '<p class="comments-empty">No comments yet — be the first!</p>';
      return;
    }
    list.innerHTML = comments.map(c => `
      <div class="comment-item">
        <div class="comment-head">
          <div class="comment-av">${esc(c.userName.charAt(0).toUpperCase())}</div>
          <div>
            <div class="comment-author">${esc(c.userName)}</div>
            <div class="comment-date">${timeAgo(c.createdAt)}</div>
          </div>
        </div>
        <div class="comment-body">${esc(c.text)}</div>
      </div>`).join('');
    list.scrollTop = list.scrollHeight;
  } catch {
    list.innerHTML = '<p class="comments-empty" style="color:#ff5566">Failed to load.</p>';
  }
}

async function postComment() {
  if (!S.user) { toast('Register first to comment'); return; }
  if (!S.currentMag) return;
  const ta = $('commentText');
  const text = ta.value.trim();
  if (!text) { toast('Write something first'); return; }
  const btn = $('postCommentBtn');
  btn.disabled = true; btn.textContent = 'Posting…';
  try {
    const c = await api('/api/comments', {
      method: 'POST',
      body: JSON.stringify({ magazineId: S.currentMag.id, text })
    });
    ta.value = '';
    const list = $('commentsList');
    const empty = list.querySelector('.comments-empty');
    if (empty) empty.remove();
    const div = document.createElement('div');
    div.className = 'comment-item';
    div.innerHTML = `
      <div class="comment-head">
        <div class="comment-av">${esc(c.userName.charAt(0).toUpperCase())}</div>
        <div>
          <div class="comment-author">${esc(c.userName)}</div>
          <div class="comment-date">just now</div>
        </div>
      </div>
      <div class="comment-body">${esc(c.text)}</div>`;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
    // Increment comment badge
    const badge = $('pdfCommentBadge');
    if (badge) {
      const next = (parseInt(badge.textContent || '0')) + 1;
      badge.textContent = next;
      badge.hidden = false;
    }
    toast('Comment posted!');
  } catch (e) { toast(e.message || 'Failed to post'); }
  finally { btn.disabled = false; btn.textContent = 'Post'; }
}

/* ── ADMIN ───────────────────────────────────────────────── */
function setupLibraryBtn() {
  // Triple-click the big hero "Library" heading to open admin
  // Guard: only attach once (heroTitle doesn't change, but renderUserChip can re-call this)
  const title = $('heroTitle');
  if (!title || title._libSetup) return;
  title._libSetup = true;
  title.addEventListener('click', () => {
    S.libClicks++;
    clearTimeout(S.libTimer);
    S.libTimer = setTimeout(() => { S.libClicks = 0; }, 700);
    if (S.libClicks >= 3) {
      S.libClicks = 0; clearTimeout(S.libTimer);
      S.adminToken ? openAdminPanel() : openModal('adminLoginModal');
    }
  });
}

async function adminLogin() {
  const pw = $('adminPassword').value;
  if (!pw) return;
  const btn = $('adminLoginBtn');
  const errEl = $('adminError');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Checking…';
  errEl.textContent = '';
  try {
    const res = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: pw }) });
    S.adminToken = res.token;
    $('adminPassword').value = '';
    closeModal('adminLoginModal');
    openAdminPanel();
  } catch {
    errEl.textContent = '✕ Wrong password. Try again.';
    $('adminPassword').value = ''; $('adminPassword').focus();
  } finally { btn.disabled = false; btn.textContent = 'Unlock'; }
}

async function openAdminPanel() {
  openModal('adminPanelModal');
  try {
    const stats = await api('/api/admin/stats');
    $('statsGrid').innerHTML = `
      <div class="stat-card"><div class="stat-num">${stats.totalMagazines}</div><div class="stat-lbl">Magazines</div></div>
      <div class="stat-card stat-card-clickable" onclick="openAdminMembers()" title="Click to see member list">
        <div class="stat-num">${stats.totalUsers}</div><div class="stat-lbl">Members</div>
      </div>
      <div class="stat-card"><div class="stat-num">${stats.totalComments}</div><div class="stat-lbl">Comments</div></div>
      <div class="stat-card"><div class="stat-num">${stats.totalReads}</div><div class="stat-lbl">Total Reads</div></div>
    `;
    $('viewAnalyticsBtn').onclick = openAdminAnalytics;
    const listEl = $('adminMagazineList');
    if (!stats.magazines.length) {
      listEl.innerHTML = '<p style="color:var(--gray);text-align:center;padding:20px 0">No magazines uploaded yet.</p>';
      return;
    }
    listEl.innerHTML = `
      <h4>${stats.magazines.length} Magazine${stats.magazines.length !== 1 ? 's' : ''}</h4>
      ${stats.magazines.map(m => `
        <div class="admin-mag-item">
          <img class="admin-mag-cover" src="${m.coverUrl}" alt="${esc(m.title)}" onerror="this.style.opacity='.3'">
          <div class="admin-mag-info">
            <div class="admin-mag-title">${esc(m.title)}</div>
            <div class="admin-mag-meta">${m.issue || 'No issue'} &nbsp;·&nbsp; ${m.views || 0} reads &nbsp;·&nbsp; ${m.commentCount} comments</div>
          </div>
          <button class="btn-delete" onclick="deleteMagazine('${m.id}')">Delete</button>
        </div>`).join('')}`;
  } catch { toast('Failed to load admin data'); }
}

async function openAdminMembers() {
  openModal('adminMembersModal');
  const listEl = $('membersList');
  listEl.innerHTML = '<p class="members-empty">Loading…</p>';
  try {
    const members = await api('/api/admin/members');
    if (!members.length) {
      listEl.innerHTML = '<p class="members-empty">No members yet.</p>';
      return;
    }
    listEl.innerHTML = members.map(m => `
      <div class="member-row">
        <div>
          <div class="member-row-name">${esc(m.name)}</div>
          <div class="member-row-meta">Joined ${timeAgo(m.joinedAt)} &nbsp;·&nbsp; ${esc(m.ip || 'unknown IP')}</div>
        </div>
        <div class="member-row-stats">${m.readsCount} read${m.readsCount !== 1 ? 's' : ''}<br>${m.favoritesCount} favorite${m.favoritesCount !== 1 ? 's' : ''}</div>
      </div>`).join('');
  } catch {
    listEl.innerHTML = '<p class="members-empty" style="color:#ff5566">Failed to load members.</p>';
  }
}

async function openAdminAnalytics() {
  openModal('adminAnalyticsModal');
  const readsEl = $('readsChart');
  const membersEl = $('membersChart');
  readsEl.innerHTML = '<p class="chart-empty">Loading…</p>';
  membersEl.innerHTML = '<p class="chart-empty">Loading…</p>';
  try {
    const { reads, members } = await api('/api/admin/analytics');
    readsEl.innerHTML = renderLineChart(reads, 'Reads');
    membersEl.innerHTML = renderLineChart(members, 'Members');
  } catch {
    readsEl.innerHTML = '<p class="chart-empty" style="color:#ff5566">Failed to load.</p>';
    membersEl.innerHTML = '';
  }
}

// Hand-rolled SVG line chart — cumulative totals over time, no charting library.
function renderLineChart(points, label) {
  if (!points.length) return `<p class="chart-empty">No ${label.toLowerCase()} yet.</p>`;

  const W = 680, H = 220, PAD = 36;
  const maxVal = Math.max(...points.map(p => p.total), 1);
  const n = points.length;
  const x = i => n === 1 ? W / 2 : PAD + (i / (n - 1)) * (W - PAD * 2);
  const y = v => H - PAD - (v / maxVal) * (H - PAD * 2);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.total).toFixed(1)}`).join(' ');
  const area = `${path} L ${x(n - 1).toFixed(1)} ${H - PAD} L ${x(0).toFixed(1)} ${H - PAD} Z`;

  const dots = points.map((p, i) => `
    <circle cx="${x(i).toFixed(1)}" cy="${y(p.total).toFixed(1)}" r="3.5" fill="#DB2777">
      <title>${p.date}: ${p.total}</title>
    </circle>`).join('');

  const firstLabel = points[0].date;
  const lastLabel = points[n - 1].date;

  return `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="rgba(255,255,255,.12)" stroke-width="1"/>
      <path d="${area}" fill="rgba(219,39,119,.12)" stroke="none"/>
      <path d="${path}" fill="none" stroke="#DB2777" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
      <text x="${PAD}" y="${H - 10}" fill="rgba(255,255,255,.4)" font-size="11">${firstLabel}</text>
      <text x="${W - PAD}" y="${H - 10}" fill="rgba(255,255,255,.4)" font-size="11" text-anchor="end">${lastLabel}</text>
      <text x="${PAD}" y="18" fill="rgba(255,255,255,.4)" font-size="11">${maxVal} total</text>
    </svg>`;
}

async function handleUpload(e) {
  e.preventDefault();
  const title = $('magTitle').value.trim();
  const coverFile = $('coverInput').files[0];
  const pdfFile = $('pdfInput').files[0];
  if (!title) { toast('Enter a title'); return; }
  if (!coverFile) { toast('Choose a cover image'); return; }
  if (!pdfFile) { toast('Choose a PDF file'); return; }

  const fd = new FormData();
  fd.append('title', title);
  fd.append('issue', $('magIssue').value.trim());
  fd.append('description', $('magDesc').value.trim());
  fd.append('cover', coverFile);
  fd.append('pdf', pdfFile);

  const progWrap = $('uploadProgress');
  const progBar = $('uploadProgressBar');
  const btn = $('uploadSubmitBtn');
  progWrap.hidden = false; progBar.style.width = '0';
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Uploading…';

  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = ev => {
      if (ev.lengthComputable) progBar.style.width = Math.round(ev.loaded / ev.total * 100) + '%';
    };
    xhr.onload = () => xhr.status < 300 ? resolve(JSON.parse(xhr.responseText)) : reject(new Error(JSON.parse(xhr.responseText).error));
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.open('POST', '/api/admin/upload');
    xhr.setRequestHeader('x-admin-token', S.adminToken);
    xhr.send(fd);
  }).then(() => {
    $('uploadForm').reset();
    $('coverFileName').textContent = 'No file chosen';
    $('pdfFileName').textContent = 'No file chosen';
    [$('coverDropZone'), $('pdfDropZone')].forEach(z => z.classList.remove('has-file'));
    progWrap.hidden = true;
    toast('✓ Magazine uploaded!');
    openAdminPanel();
    loadMagazines();
  }).catch(err => toast(err.message || 'Upload failed'))
    .finally(() => { btn.disabled = false; btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload Magazine`; });
}

async function deleteMagazine(id) {
  if (!confirm('Delete this magazine? This cannot be undone.')) return;
  try {
    await api(`/api/admin/magazine/${id}`, { method: 'DELETE' });
    toast('Magazine deleted');
    openAdminPanel();
    loadMagazines();
  } catch { toast('Failed to delete'); }
}

/* ── SEARCH ──────────────────────────────────────────────── */
function setupSearch() {
  const input = $('searchInput');
  const clearBtn = $('clearSearch');
  let timer;
  input.addEventListener('input', () => {
    S.query = input.value.trim();
    clearBtn.hidden = !S.query;
    clearTimeout(timer);
    timer = setTimeout(loadMagazines, 280);
  });
  clearBtn.addEventListener('click', () => {
    input.value = ''; S.query = '';
    clearBtn.hidden = true;
    loadMagazines();
    input.focus();
  });
}

/* ── INIT ────────────────────────────────────────────────── */
function init() {
  // Registration
  $('registerSubmitBtn').addEventListener('click', registerUser);
  $('userName').addEventListener('keydown', e => { if (e.key === 'Enter') registerUser(); });

  // Admin login
  $('adminLoginBtn').addEventListener('click', adminLogin);
  $('adminPassword').addEventListener('keydown', e => { if (e.key === 'Enter') adminLogin(); });

  // Upload
  $('uploadForm').addEventListener('submit', handleUpload);

  // File labels
  $('coverInput').addEventListener('change', e => {
    const n = e.target.files[0]?.name || 'No file chosen';
    $('coverFileName').textContent = n;
    $('coverDropZone').classList.toggle('has-file', !!e.target.files[0]);
  });
  $('pdfInput').addEventListener('change', e => {
    const n = e.target.files[0]?.name || 'No file chosen';
    $('pdfFileName').textContent = n;
    $('pdfDropZone').classList.toggle('has-file', !!e.target.files[0]);
  });

  // Preview modal
  $('closePreviewBtn').addEventListener('click', closePreview);
  $('previewLibraryBtn').addEventListener('click', () => {
    S.libClicks++;
    clearTimeout(S.libTimer);
    S.libTimer = setTimeout(() => { S.libClicks = 0; }, 700);
    if (S.libClicks >= 3) {
      S.libClicks = 0; clearTimeout(S.libTimer);
      S.adminToken ? openAdminPanel() : openModal('adminLoginModal');
    }
  });
  $('previewReadBtn').addEventListener('click', openMagazineFromPreview);
  $('previewFavBtn').addEventListener('click', () => {
    if (S.currentMag) toggleFav(S.currentMag.id);
  });
  $('previewShareBtn').addEventListener('click', () => {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: S.currentMag?.title || 'HOLIX Magazine', url });
    } else {
      navigator.clipboard.writeText(url).then(() => toast('Link copied!'));
    }
  });

  // PDF viewer — core
  $('closePdfBtn').addEventListener('click', closePdfViewer);
  $('pdfFavoriteBtn').addEventListener('click', () => { if (S.currentMag) toggleFav(S.currentMag.id); });
  $('openCommentBtn').addEventListener('click', toggleComments);
  $('closeCommentsBtn').addEventListener('click', () => $('commentsPanel').classList.remove('open'));
  $('postCommentBtn').addEventListener('click', postComment);
  $('commentText').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) postComment();
  });

  // PDF viewer — zoom
  $('pdfZoomIn').addEventListener('click',  () => adjustZoom(+0.1));
  $('pdfZoomOut').addEventListener('click', () => adjustZoom(-0.1));

  // PDF viewer — download & fullscreen
  $('pdfDownloadBtn').addEventListener('click', downloadPdf);
  $('pdfFullscreenBtn').addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', updateFullscreenIcon);
  document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);

  // Re-render pages to fit on orientation change / window resize
  let _resizeDebounce;
  window.addEventListener('resize', () => {
    if (!S.pdfDoc || !$('pdfModal').classList.contains('open')) return;
    clearTimeout(_resizeDebounce);
    _resizeDebounce = setTimeout(() => renderPages(S.pdfZoom), 300);
  });

  // PDF viewer — share
  $('pdfShareBtn').addEventListener('click', () => {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: S.currentMag?.title || 'HOLIX Magazine', url });
    } else {
      navigator.clipboard.writeText(url).then(() => toast('Link copied!'));
    }
  });

  // PDF viewer — credits
  $('pdfCreditsBtn').addEventListener('click', () => {
    const mag = S.currentMag;
    if (!mag) return;
    const info = [mag.title, mag.issue ? `Issue: ${mag.issue}` : '', mag.description ? `\n${mag.description}` : ''].filter(Boolean).join(' · ');
    toast(info, 5000);
  });

  // Favourites
  $('favBtn').addEventListener('click', () => {
    S.showFavs = !S.showFavs;
    const btn = $('favBtn');
    btn.classList.toggle('active', S.showFavs);
    btn.childNodes[2].textContent = S.showFavs ? ' HIDE FAVORITES' : ' SHOW FAVORITES';
    renderMagazines();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($('pdfModal').classList.contains('open'))       { closePdfViewer(); return; }
      if ($('previewModal').classList.contains('open'))   { closePreview(); return; }
      if ($('adminAnalyticsModal').classList.contains('open')){ closeModal('adminAnalyticsModal'); return; }
      if ($('adminMembersModal').classList.contains('open')){ closeModal('adminMembersModal'); return; }
      if ($('adminPanelModal').classList.contains('open')){ closeModal('adminPanelModal'); return; }
      if ($('adminLoginModal').classList.contains('open')){ closeModal('adminLoginModal'); return; }
    }
  });

  // Library triple-click
  setupLibraryBtn();
  setupSearch();

  // Bootstrap
  checkUser().then(() => loadMagazines());
}

document.addEventListener('DOMContentLoaded', init);
