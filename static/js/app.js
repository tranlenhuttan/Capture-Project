/* ═══════════════════════════════════════════
   STATE
═══════════════════════════════════════════ */
let currentPath = "";
let currentFiles = [];
let currentSort = { key: "name", asc: true };
let currentView = "files"; // "files"|"starred"|"collections"|"collectionDetail"
let isGridView = true;
let contextFile = null;
let renameTarget = null;
let dragCounter = 0;
let searchTimeout = null;
let collections = [];
let currentCollection = null;

// Slideshow state
let ss = {
  items: [],
  idx: 0,
  playing: false,
  displayTime: 5,
  transSpeed: 1.0,
  timer: null,
  audio: null,
  colId: null,
};

// Preset music tracks — place these files in static/music/
const MUSIC_TRACKS = {
  1: { name: "Track 1", src: "/static/music/track1.mp3" },
  2: { name: "Track 2", src: "/static/music/track2.mp3" },
};

const FILE_ICONS = {
  folder: { icon: "folder", css: "folder" },
  image: { icon: "image", css: "image" },
  video: { icon: "movie", css: "video" },
  audio: { icon: "audiotrack", css: "audio" },
  pdf: { icon: "picture_as_pdf", css: "pdf" },
  code: { icon: "code", css: "code" },
  document: { icon: "description", css: "file" },
  archive: { icon: "archive", css: "file" },
  default: { icon: "insert_drive_file", css: "file" },
};

/* ═══════════════════════════════════════════
   UTILS
═══════════════════════════════════════════ */
function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
function fmtSize(b) {
  if (!b) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1);
  return (b / Math.pow(1024, i)).toFixed(i ? 1 : 0) + " " + u[i];
}
function fmtDate(s) {
  if (!s) return "";
  return new Date(s).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function isTyping() {
  const t = document.activeElement?.tagName;
  return t === "INPUT" || t === "TEXTAREA";
}
function $(id) {
  return document.getElementById(id);
}
function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/* ═══════════════════════════════════════════
   API — Files
═══════════════════════════════════════════ */
async function fetchFiles(path = "") {
  try {
    const r = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
    if (!r.ok) throw new Error();
    const d = await r.json();
    currentPath = path;
    currentView = "files";
    currentFiles = d.items || [];
    setNav("navFiles");
    renderBreadcrumb();
    renderFiles();
    updateFileCount();
    updateStorage(d.storage);
    showToolbar("files");
  } catch {
    showToast("Failed to load files", "error");
  }
}

async function fetchStarred() {
  try {
    const r = await fetch("/api/starred");
    if (!r.ok) throw new Error();
    const d = await r.json();
    currentView = "starred";
    currentFiles = d.items || [];
    currentPath = "";
    setNav("navStarred");
    renderViewHeader("Starred", "star", currentFiles.length);
    renderFiles();
    showToolbar("none");
  } catch {
    showToast("Failed to load starred", "error");
  }
}

async function doSearch(q) {
  try {
    const r = await fetch(
      `/api/search?q=${encodeURIComponent(q)}&path=${encodeURIComponent(currentPath)}`,
    );
    return r.ok ? (await r.json()).results || [] : [];
  } catch {
    return [];
  }
}

async function apiUpload(files) {
  const fd = new FormData();
  fd.append("path", currentPath);
  for (const f of files) fd.append("files", f);
  const prog = $("uploadProgress"),
    fill = $("uploadFill"),
    stat = $("uploadStatus");
  prog.classList.remove("hidden");
  fill.style.width = "0%";
  stat.textContent = `Uploading ${files.length} file(s)…`;
  try {
    await new Promise((res, rej) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const p = Math.round((e.loaded / e.total) * 100);
          fill.style.width = p + "%";
          stat.textContent = p + "% — " + files.length + " file(s)";
        }
      };
      xhr.onload = () =>
        xhr.status < 300
          ? (showToast(`Uploaded ${files.length} file(s)`),
            fetchFiles(currentPath),
            res())
          : rej();
      xhr.onerror = rej;
      xhr.open("POST", "/api/upload");
      xhr.send(fd);
    });
  } catch {
    showToast("Upload failed", "error");
  } finally {
    setTimeout(() => prog.classList.add("hidden"), 1500);
  }
}

async function apiCreateFolder(name) {
  try {
    const r = await fetch("/api/folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: currentPath, name }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "");
    showToast(`Created "${name}"`);
    fetchFiles(currentPath);
  } catch (e) {
    showToast(e.message || "Failed", "error");
  }
}

async function apiRename(old, name) {
  try {
    const r = await fetch("/api/rename", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ old_path: old, new_name: name }),
    });
    if (!r.ok) throw new Error();
    showToast("Renamed");
    refreshView();
  } catch {
    showToast("Rename failed", "error");
  }
}

async function apiDelete(path) {
  try {
    const r = await fetch("/api/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!r.ok) throw new Error();
    showToast("Deleted");
    refreshView();
  } catch {
    showToast("Delete failed", "error");
  }
}

async function apiStar(path) {
  try {
    const r = await fetch("/api/star", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!r.ok) throw new Error();
    const d = await r.json();
    showToast(d.message);
    refreshView();
  } catch {
    showToast("Failed", "error");
  }
}

async function apiPreview(path) {
  try {
    const r = await fetch(`/api/preview/${encodeURIComponent(path)}`);
    if (!r.ok) throw new Error();
    const ct = r.headers.get("content-type") || "";
    return ct.includes("json") ? await r.json() : null;
  } catch {
    return null;
  }
}

function refreshView() {
  if (currentView === "files") fetchFiles(currentPath);
  else if (currentView === "starred") fetchStarred();
  else if (currentView === "collections") openCollectionsView();
  else if (currentView === "collectionDetail" && currentCollection)
    openCollectionDetail(currentCollection.id);
}

/* ═══════════════════════════════════════════
   API — Collections
═══════════════════════════════════════════ */
async function apiListCollections() {
  try {
    const r = await fetch("/api/collections");
    if (!r.ok) throw new Error();
    const d = await r.json();
    collections = d.collections || [];
    updateColBadge();
    return collections;
  } catch {
    return [];
  }
}

async function apiGetCollection(id) {
  const r = await fetch(`/api/collections/${id}`);
  if (!r.ok) throw new Error();
  return await r.json();
}

async function apiCreateColFolder(name) {
  const r = await fetch("/api/collections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!r.ok)
    throw new Error((await r.json().catch(() => ({}))).detail || "Failed");
  return await r.json();
}

async function apiUpdateCollection(id, data) {
  const r = await fetch(`/api/collections/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error();
  return await r.json();
}

async function apiDeleteCollection(id) {
  const r = await fetch(`/api/collections/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error();
}

async function apiAddImageToCol(colId, filePath) {
  const r = await fetch(`/api/collections/${colId}/add-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_path: filePath }),
  });
  if (!r.ok)
    throw new Error((await r.json().catch(() => ({}))).detail || "Failed");
  return await r.json();
}

async function apiRemoveImageFromCol(colId, filePath) {
  const r = await fetch(`/api/collections/${colId}/remove-image`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_path: filePath }),
  });
  if (!r.ok) throw new Error();
  return await r.json();
}

/* ═══════════════════════════════════════════
   SORT
═══════════════════════════════════════════ */
function sortItems(items) {
  return [...items].sort((a, b) => {
    if (a.type === "folder" && b.type !== "folder") return -1;
    if (a.type !== "folder" && b.type === "folder") return 1;
    let va, vb;
    if (currentSort.key === "name") {
      va = (a.name || "").toLowerCase();
      vb = (b.name || "").toLowerCase();
      return currentSort.asc ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    if (currentSort.key === "date") {
      va = new Date(a.modified || 0).getTime();
      vb = new Date(b.modified || 0).getTime();
    }
    if (currentSort.key === "size") {
      va = a.size || 0;
      vb = b.size || 0;
    }
    return currentSort.asc ? va - vb : vb - va;
  });
}

/* ═══════════════════════════════════════════
   RENDER — File Grid
═══════════════════════════════════════════ */
function createFileCard(item) {
  const ic = FILE_ICONS[item.file_type] || FILE_ICONS.default;
  const preview =
    item.file_type === "image"
      ? `<img src="/uploads/${encodeURIComponent(item.path)}" loading="lazy" alt="">`
      : `<span class="material-icons-round file-icon ${ic.css}">${ic.icon}</span>`;
  const meta = [
    item.type !== "folder" ? fmtSize(item.size) : "",
    fmtDate(item.modified),
  ]
    .filter(Boolean)
    .join(" · ");
  const star = item.is_starred
    ? `<span class="star-badge material-icons-round">star</span>`
    : "";
  return `
    <div class="file-card" data-path="${esc(item.path)}">
      <div class="card-preview">${preview}${star}</div>
      <div class="card-info">
        <div class="card-name" title="${esc(item.name)}">${esc(item.name)}</div>
        <div class="card-meta">${esc(meta)}</div>
      </div>
      <button class="btn-more btn-icon"><span class="material-icons-round">more_vert</span></button>
    </div>`;
}

function renderFiles() {
  const grid = $("filesGrid"),
    empty = $("emptyState"),
    cont = $("filesContainer");
  const sorted = sortItems(currentFiles);
  grid.classList.toggle("list-view", !isGridView);
  if (!sorted.length) {
    grid.innerHTML = "";
    cont.classList.add("hidden");
    empty.classList.remove("hidden");
    if (currentView === "starred") {
      empty.querySelector(".material-icons-round").textContent = "star_outline";
      empty.querySelector("h3").textContent = "No starred files";
      empty.querySelector("p").textContent =
        "Star files to find them quickly here";
    } else {
      empty.querySelector(".material-icons-round").textContent = "cloud_off";
      empty.querySelector("h3").textContent = "No files here";
      empty.querySelector("p").textContent =
        "Upload files or create a folder to get started";
    }
    return;
  }
  cont.classList.remove("hidden");
  empty.classList.add("hidden");
  grid.innerHTML = sorted.map(createFileCard).join("");
  grid.querySelectorAll(".file-card").forEach((card, i) => {
    const item = sorted[i];
    card.addEventListener("dblclick", () =>
      item.type === "folder" ? fetchFiles(item.path) : openPreview(item),
    );
    card.addEventListener("click", (e) => {
      if (e.target.closest(".btn-more")) return;
      grid
        .querySelectorAll(".file-card")
        .forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
    });
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showCtxMenu(e, item);
    });
    card.querySelector(".btn-more").addEventListener("click", (e) => {
      e.stopPropagation();
      showCtxMenu(e, item);
    });
  });
}

/* ═══════════════════════════════════════════
   RENDER — Collections List
═══════════════════════════════════════════ */
async function openCollectionsView() {
  currentView = "collections";
  currentPath = "";
  currentCollection = null;
  setNav("navCollections");
  showToolbar("collections");
  renderViewHeader("Collections", "photo_library", 0);

  const grid = $("filesGrid"),
    cont = $("filesContainer"),
    empty = $("emptyState");
  cont.classList.remove("hidden");
  empty.classList.add("hidden");
  grid.classList.toggle("list-view", !isGridView);
  grid.innerHTML = `<div class="loading-state"><span class="material-icons-round">hourglass_empty</span><span>Loading…</span></div>`;

  const cols = await apiListCollections();
  renderViewHeader("Collections", "photo_library", cols.length);

  if (!cols.length) {
    grid.innerHTML = "";
    cont.classList.add("hidden");
    empty.classList.remove("hidden");
    empty.querySelector(".material-icons-round").textContent = "photo_library";
    empty.querySelector("h3").textContent = "No collections yet";
    empty.querySelector("p").textContent =
      "Create a collection, then add photos from My Files";
    return;
  }
  cont.classList.remove("hidden");
  empty.classList.add("hidden");
  grid.innerHTML = cols.map(createColCard).join("");
  grid.querySelectorAll(".collection-card").forEach((card) => {
    const col = cols.find((c) => c.id === parseInt(card.dataset.colId));
    if (!col) return;
    card.addEventListener("click", (e) => {
      if (e.target.closest(".btn-more")) return;
      grid
        .querySelectorAll(".file-card")
        .forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
    });
    card.addEventListener("dblclick", (e) => {
      if (!e.target.closest(".btn-more")) openCollectionDetail(col.id);
    });
    card.querySelector(".btn-more").addEventListener("click", (e) => {
      e.stopPropagation();
      showColCtxMenu(e, col);
    });
  });
}

function createColCard(col) {
  const cover = col.cover_path
    ? `<img src="/uploads/${encodeURIComponent(col.cover_path)}" loading="lazy" alt="">`
    : `<span class="material-icons-round file-icon image" style="font-size:48px">photo_library</span>`;
  const musicTag = col.music_id
    ? `<span class="col-music-dot material-icons-round">music_note</span>`
    : "";
  return `
    <div class="file-card collection-card" data-col-id="${col.id}">
      <div class="card-preview">
        ${cover}${musicTag}
        <div class="col-photo-count">${col.item_count} photo${col.item_count !== 1 ? "s" : ""}</div>
        <div class="col-open-hint"><span class="material-icons-round">open_in_full</span>Open</div>
      </div>
      <div class="card-info">
        <div class="card-name" title="${esc(col.name)}">${esc(col.name)}</div>
        <div class="card-meta">${col.item_count} photos · ${col.display_time}s · ${col.transition_speed}s trans${col.music_id ? " · 🎵" : ""}</div>
      </div>
      <button class="btn-more btn-icon"><span class="material-icons-round">more_vert</span></button>
    </div>`;
}

/* ═══════════════════════════════════════════
   RENDER — Collection Detail
═══════════════════════════════════════════ */
async function openCollectionDetail(colId) {
  currentView = "collectionDetail";
  setNav("navCollections");

  const grid = $("filesGrid"),
    cont = $("filesContainer"),
    empty = $("emptyState");
  cont.classList.remove("hidden");
  empty.classList.add("hidden");
  grid.classList.remove("list-view");
  grid.innerHTML = `<div class="loading-state"><span class="material-icons-round">hourglass_empty</span><span>Loading…</span></div>`;

  let col;
  try {
    col = await apiGetCollection(colId);
  } catch {
    showToast("Failed to load", "error");
    return;
  }
  currentCollection = col;

  // Breadcrumb
  $("breadcrumb").innerHTML = `
    <a href="#" class="bc-item" onclick="openCollectionsView();return false;">
      <span class="material-icons-round" style="font-size:18px">photo_library</span>Collections
    </a>
    <span class="material-icons-round bc-sep">chevron_right</span>
    <span class="bc-item" style="color:var(--text-primary);cursor:default">${esc(col.name)}</span>`;
  $("fileCount").textContent =
    `${col.items.length} photo${col.items.length !== 1 ? "s" : ""}`;

  // Setup toolbar controls
  showToolbar("collectionDetail");
  _setupDetailToolbar(col);

  // Render photos
  if (!col.items.length) {
    grid.innerHTML = "";
    cont.classList.add("hidden");
    empty.classList.remove("hidden");
    empty.querySelector(".material-icons-round").textContent =
      "add_photo_alternate";
    empty.querySelector("h3").textContent = "No photos yet";
    empty.querySelector("p").textContent =
      "Go to My Files, right-click an image → Add to Collection";
    return;
  }
  cont.classList.remove("hidden");
  empty.classList.add("hidden");
  grid.innerHTML = col.items
    .map(
      (item, i) => `
    <div class="file-card col-photo-card" data-idx="${i}" data-path="${esc(item.file_path)}">
      <div class="card-preview">
        <img src="/uploads/${encodeURIComponent(item.file_path)}" loading="lazy" alt="">
        <div class="col-photo-order">${i + 1}</div>
        <button class="col-photo-remove btn-icon" title="Remove from collection">
          <span class="material-icons-round">remove_circle</span>
        </button>
      </div>
      <div class="card-info">
        <div class="card-name" title="${esc(item.file_name)}">${esc(item.file_name)}</div>
      </div>
    </div>`,
    )
    .join("");

  grid.querySelectorAll(".col-photo-card").forEach((card, i) => {
    const item = col.items[i];
    card.addEventListener("click", (e) => {
      if (e.target.closest(".col-photo-remove")) return;
      grid
        .querySelectorAll(".file-card")
        .forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
    });
    card.addEventListener("dblclick", (e) => {
      if (!e.target.closest(".col-photo-remove")) openSlideshow(col.id, i);
    });
    card
      .querySelector(".col-photo-remove")
      .addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Remove "${item.file_name}" from this collection?`))
          return;
        try {
          await apiRemoveImageFromCol(col.id, item.file_path);
          showToast("Removed");
          openCollectionDetail(col.id);
        } catch {
          showToast("Failed", "error");
        }
      });
  });
}

function _setupDetailToolbar(col) {
  const transSlider = $("colDetailTransSpeed"),
    transVal = $("colDetailTransVal");
  const timeSlider = $("colDetailDispTime"),
    timeVal = $("colDetailTimeVal");

  transSlider.value = col.transition_speed || 1.0;
  transVal.textContent = (col.transition_speed || 1.0).toFixed(1) + "s";
  timeSlider.value = col.display_time || 5;
  timeVal.textContent = (col.display_time || 5) + "s";

  // Music radio
  const musicVal = col.music_id || 0;
  document.querySelectorAll('input[name="colMusic"]').forEach((r) => {
    r.checked = parseInt(r.value) === musicVal;
  });

  const saveSettings = debounce(async () => {
    if (!currentCollection) return;
    try {
      const updated = await apiUpdateCollection(currentCollection.id, {
        transition_speed: parseFloat(transSlider.value),
        display_time: parseInt(timeSlider.value),
        music_id:
          parseInt(
            document.querySelector('input[name="colMusic"]:checked')?.value ||
              "0",
          ) || null,
      });
      currentCollection.transition_speed = updated.transition_speed;
      currentCollection.display_time = updated.display_time;
      currentCollection.music_id = updated.music_id;
    } catch {}
  }, 700);

  transSlider.oninput = function () {
    transVal.textContent = parseFloat(this.value).toFixed(1) + "s";
    saveSettings();
  };
  timeSlider.oninput = function () {
    timeVal.textContent = this.value + "s";
    saveSettings();
  };
  document.querySelectorAll('input[name="colMusic"]').forEach((r) => {
    r.onchange = saveSettings;
  });

  $("colDetailPlayBtn").onclick = () => openSlideshow(col.id, 0);
}

/* ═══════════════════════════════════════════
   CONTEXT MENUS
═══════════════════════════════════════════ */
function showCtxMenu(e, item) {
  contextFile = item;
  hideAddToColMenu();
  const menu = $("contextMenu"),
    inner = menu.querySelector(".ctx-menu-inner");
  inner.innerHTML = `
    <button class="ctx-item" data-action="open"><span class="material-icons-round">open_in_new</span>Open</button>
    <button class="ctx-item" data-action="download"><span class="material-icons-round">download</span>Download</button>
    <button class="ctx-item" data-action="star">
      <span class="material-icons-round">${item.is_starred ? "star" : "star_outline"}</span>${item.is_starred ? "Unstar" : "Star"}
    </button>
    ${
      item.file_type === "image"
        ? `
    <div class="ctx-sep"></div>
    <button class="ctx-item" data-action="addtocol">
      <span class="material-icons-round">add_photo_alternate</span>Add to Collection
      <span class="material-icons-round" style="font-size:14px;margin-left:auto;opacity:.5">chevron_right</span>
    </button>`
        : ""
    }
    <div class="ctx-sep"></div>
    <button class="ctx-item" data-action="rename"><span class="material-icons-round">drive_file_rename_outline</span>Rename</button>
    <button class="ctx-item danger" data-action="delete"><span class="material-icons-round">delete_outline</span>Delete</button>`;
  inner
    .querySelectorAll(".ctx-item[data-action]")
    .forEach((b) =>
      b.addEventListener("click", () => handleCtxAction(b.dataset.action, e)),
    );
  positionMenu(menu, e);
}

function showColCtxMenu(e, col) {
  contextFile = null;
  const menu = $("contextMenu"),
    inner = menu.querySelector(".ctx-menu-inner");
  inner.innerHTML = `
    <button class="ctx-item" id="ctxOpen"><span class="material-icons-round">folder_open</span>Open</button>
    <button class="ctx-item" id="ctxPlay"><span class="material-icons-round">play_arrow</span>Play Slideshow</button>
    <div class="ctx-sep"></div>
    <button class="ctx-item danger" id="ctxDel"><span class="material-icons-round">delete_outline</span>Delete</button>`;
  inner.querySelector("#ctxOpen").onclick = () => {
    hideCtxMenu();
    openCollectionDetail(col.id);
  };
  inner.querySelector("#ctxPlay").onclick = () => {
    hideCtxMenu();
    openSlideshow(col.id, 0);
  };
  inner.querySelector("#ctxDel").onclick = () => {
    hideCtxMenu();
    if (confirm(`Delete "${col.name}"? All photos stay in My Files.`))
      apiDeleteCollection(col.id)
        .then(() => {
          showToast("Deleted");
          openCollectionsView();
        })
        .catch(() => showToast("Failed", "error"));
  };
  positionMenu(menu, e);
}

function showAddToColSubmenu(filePath, anchorEl) {
  const sub = $("addToColMenu"),
    inner = $("addToColInner");
  if (!collections.length) {
    inner.innerHTML = `<div class="ctx-empty">No collections yet.<br>Create one first.</div>`;
  } else {
    inner.innerHTML = collections
      .map(
        (col) => `
      <button class="ctx-item" data-col-id="${col.id}">
        <span class="material-icons-round">photo_library</span>
        ${esc(col.name)}
        <span class="ctx-count">${col.item_count}</span>
      </button>`,
      )
      .join("");
    inner.querySelectorAll(".ctx-item[data-col-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        hideCtxMenu();
        hideAddToColMenu();
        const colId = parseInt(btn.dataset.colId);
        try {
          const res = await apiAddImageToCol(colId, filePath);
          const col = collections.find((c) => c.id === colId);
          showToast(`Added to "${col?.name || "Collection"}"`);
          // Update local count
          if (col) col.item_count = (col.item_count || 0) + 1;
          updateColBadge();
        } catch (err) {
          showToast(err.message || "Failed", "error");
        }
      });
    });
  }
  // Position sub-menu to the right of anchor
  const rect = anchorEl.getBoundingClientRect();
  sub.classList.remove("hidden");
  sub.style.left = rect.right + 4 + "px";
  sub.style.top = rect.top + "px";
}

function hideAddToColMenu() {
  $("addToColMenu").classList.add("hidden");
}

function positionMenu(menu, e) {
  menu.classList.remove("hidden");
  menu.style.left = Math.min(e.clientX, window.innerWidth - 220) + "px";
  menu.style.top = Math.min(e.clientY, window.innerHeight - 300) + "px";
}

function hideCtxMenu() {
  $("contextMenu").classList.add("hidden");
  hideAddToColMenu();
  contextFile = null;
}

function handleCtxAction(action, origEvent) {
  const item = contextFile;
  if (action !== "addtocol") hideCtxMenu();
  if (!item) return;
  switch (action) {
    case "open":
      item.type === "folder" ? fetchFiles(item.path) : openPreview(item);
      break;
    case "download": {
      const a = document.createElement("a");
      a.href = `/api/download/${encodeURIComponent(item.path)}`;
      a.download = item.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      break;
    }
    case "star":
      apiStar(item.path);
      break;
    case "addtocol": {
      // Show sub-menu anchored to the "Add to Collection" button
      const btn = $("contextMenu").querySelector('[data-action="addtocol"]');
      if (btn) showAddToColSubmenu(item.path, btn);
      break;
    }
    case "rename":
      showRenameDialog(item);
      break;
    case "delete":
      if (confirm(`Delete "${item.name}"? Cannot be undone.`))
        apiDelete(item.path);
      break;
  }
}

/* ═══════════════════════════════════════════
   COLLECTION MANAGEMENT
═══════════════════════════════════════════ */
function showNewCollectionDialog() {
  $("newColNameInput").value = "";
  $("newCollectionModal").classList.remove("hidden");
  setTimeout(() => $("newColNameInput").focus(), 80);
}

async function submitNewCollection() {
  const name = $("newColNameInput").value.trim();
  if (!name) {
    showToast("Enter a name", "error");
    return;
  }
  const btn = $("newColCreateBtn");
  btn.disabled = true;
  try {
    await apiCreateColFolder(name);
    await apiListCollections();
    closeModal("newCollectionModal");
    showToast(`Collection "${name}" created`);
    openCollectionsView();
  } catch (e) {
    showToast(e.message || "Failed", "error");
  } finally {
    btn.disabled = false;
  }
}

/* ═══════════════════════════════════════════
   SLIDESHOW PLAYER
═══════════════════════════════════════════ */
async function openSlideshow(colId, startIdx = 0) {
  let col;
  try {
    col = await apiGetCollection(colId);
  } catch {
    showToast("Failed to load slideshow", "error");
    return;
  }
  if (!col.items?.length) {
    showToast("No photos in this collection", "error");
    return;
  }

  ssStop();
  if (ss.audio) {
    ss.audio.pause();
    ss.audio = null;
  }

  ss = {
    items: col.items,
    idx: Math.max(0, Math.min(startIdx, col.items.length - 1)),
    playing: false,
    displayTime: col.display_time || 5,
    transSpeed: col.transition_speed || 1.0,
    timer: null,
    audio: null,
    colId,
  };

  // Apply transition speed to CSS
  document.documentElement.style.setProperty("--ss-trans", ss.transSpeed + "s");

  // Build slides
  const slidesEl = $("ssSlides");
  slidesEl.innerHTML = "";
  col.items.forEach((it, i) => {
    const div = document.createElement("div");
    div.className = "ss-slide";
    div.dataset.idx = i;
    const img = document.createElement("img");
    img.src = `/uploads/${encodeURIComponent(it.file_path)}`;
    img.alt = it.file_name;
    div.appendChild(img);
    slidesEl.appendChild(div);
  });

  // Filmstrip
  $("ssFilmstrip").innerHTML = col.items
    .map(
      (it, i) =>
        `<img class="ss-film" data-idx="${i}" src="/uploads/${encodeURIComponent(it.file_path)}" loading="lazy" alt="">`,
    )
    .join("");
  $("ssFilmstrip")
    .querySelectorAll(".ss-film")
    .forEach((t) =>
      t.addEventListener("click", () => ssGo(parseInt(t.dataset.idx))),
    );

  // Music
  if (col.music_id && MUSIC_TRACKS[col.music_id]) {
    ss.audio = new Audio(MUSIC_TRACKS[col.music_id].src);
    ss.audio.loop = true;
    ss.audio.volume = 0.55;
    $("ssMusicTagName").textContent = MUSIC_TRACKS[col.music_id].name;
    $("ssMusicTag").classList.remove("hidden");
    $("ssVolCtrl").classList.remove("hidden");
  } else {
    $("ssMusicTag").classList.add("hidden");
    $("ssVolCtrl").classList.add("hidden");
  }

  $("ssVolSlider").value = 55;
  $("ssTitle").textContent = col.name;
  $("ssPlayer").classList.remove("hidden");
  ssUpdateSlides();
}

function ssUpdateSlides() {
  const slides = $("ssSlides").querySelectorAll(".ss-slide");
  slides.forEach((s, i) => {
    const d = i - ss.idx;
    s.className = "ss-slide";
    if (d === 0) s.classList.add("ss-curr");
    else if (d === -1) s.classList.add("ss-prev");
    else if (d === 1) s.classList.add("ss-next");
    else if (d < -1) s.classList.add("ss-offl");
    else s.classList.add("ss-offr");
  });
  $("ssFilmstrip")
    .querySelectorAll(".ss-film")
    .forEach((t, i) => t.classList.toggle("active", i === ss.idx));
  $("ssFilmstrip").querySelector(".ss-film.active")?.scrollIntoView({
    behavior: "smooth",
    inline: "center",
    block: "nearest",
  });
  const n = ss.items.length;
  $("ssCounter").textContent = `${ss.idx + 1} / ${n}`;
  $("ssProgressPos").style.width = (n > 1 ? (ss.idx / (n - 1)) * 100 : 0) + "%";
}

function ssGo(idx) {
  ss.idx = Math.max(0, Math.min(ss.items.length - 1, idx));
  ssUpdateSlides();
  if (ss.playing) {
    ssStop();
    ssStartAuto();
  }
}
function ssNav(dir) {
  ssGo((ss.idx + dir + ss.items.length) % ss.items.length);
}

function ssPlay() {
  ss.playing = true;
  $("ssPlayIcon").textContent = "pause";
  if (ss.audio) {
    ss.audio.play().catch((err) => {
      showToast("⚠️ Click Play again to enable audio", "error");
      console.error("Audio blocked:", err);
    });
  }
  ssStartAuto();
}
function ssPause() {
  ss.playing = false;
  $("ssPlayIcon").textContent = "play_arrow";
  if (ss.audio) ss.audio.pause();
  ssStop();
  const ab = $("ssProgressAuto");
  ab.style.transition = "none";
  ab.style.width = "0%";
}
function ssTogglePlay() {
  ss.playing ? ssPause() : ssPlay();
}

function ssStartAuto() {
  ssStop();
  const ab = $("ssProgressAuto");
  ab.style.transition = "none";
  ab.style.width = "0%";
  void ab.offsetHeight;
  ab.style.transition = `width ${ss.displayTime}s linear`;
  ab.style.width = "100%";
  ss.timer = setTimeout(() => {
    if (ss.playing) {
      ssNav(1);
      ssStartAuto();
    }
  }, ss.displayTime * 1000);
}
function ssStop() {
  clearTimeout(ss.timer);
  ss.timer = null;
}

function closeSlideshow() {
  ssPause();
  ss.audio = null;
  $("ssPlayer").classList.add("hidden");
}

/* ═══════════════════════════════════════════
   HEADERS & TOOLBARS
═══════════════════════════════════════════ */
function renderBreadcrumb() {
  const bc = $("breadcrumb");
  let html = `<a href="#" class="bc-item" onclick="fetchFiles('');return false;"><span class="material-icons-round" style="font-size:18px">home</span>My Files</a>`;
  if (currentPath) {
    const parts = currentPath.split("/").filter(Boolean);
    let acc = "";
    parts.forEach((p, i) => {
      acc += (acc ? "/" : "") + p;
      const safe = esc(acc),
        last = i === parts.length - 1;
      html += `<span class="material-icons-round bc-sep">chevron_right</span>
        <a href="#" class="bc-item" onclick="fetchFiles('${safe}');return false;" ${last ? 'style="color:var(--text-primary)"' : ""}>${esc(p)}</a>`;
    });
  }
  bc.innerHTML = html;
}

function renderViewHeader(title, icon, count) {
  $("breadcrumb").innerHTML =
    `<span class="bc-item" style="color:var(--text-primary);cursor:default">
    <span class="material-icons-round" style="font-size:18px">${icon}</span>${esc(title)}</span>`;
  $("fileCount").textContent = `${count} item${count !== 1 ? "s" : ""}`;
}

function showToolbar(view) {
  $("toolbar").style.display = view === "files" ? "flex" : "none";
  $("toolbarCollections").classList.toggle("hidden", view !== "collections");
  $("toolbarColDetail").classList.toggle("hidden", view !== "collectionDetail");
}

function setNav(id) {
  document
    .querySelectorAll(".nav-item")
    .forEach((n) => n.classList.remove("active"));
  $(id)?.classList.add("active");
}

function updateColBadge() {
  const b = $("colsBadge");
  if (!b) return;
  b.textContent = collections.length;
  b.classList.toggle("hidden", collections.length === 0);
}

function updateFileCount() {
  const fld = currentFiles.filter((f) => f.type === "folder").length;
  const fil = currentFiles.filter((f) => f.type !== "folder").length;
  const p = [];
  if (fld) p.push(`${fld} folder${fld > 1 ? "s" : ""}`);
  if (fil) p.push(`${fil} file${fil > 1 ? "s" : ""}`);
  $("fileCount").textContent = p.join(", ") || "Empty";
}

function updateStorage(s) {
  if (!s) return;
  $("storageFill").style.width = Math.min((s.used / s.total) * 100, 100) + "%";
  $("storageText").textContent =
    `${fmtSize(s.used)} of ${fmtSize(s.total)} used`;
}

function sortFiles(key) {
  currentSort =
    currentSort.key === key
      ? { key, asc: !currentSort.asc }
      : { key, asc: true };
  renderFiles();
}

function toggleView() {
  isGridView = !isGridView;
  $("viewIcon").textContent = isGridView ? "grid_view" : "view_list";
  currentView === "collections" ? openCollectionsView() : renderFiles();
}

/* ═══════════════════════════════════════════
   MODALS
═══════════════════════════════════════════ */
function closeModal(id) {
  $(id).classList.add("hidden");
}

function showNewFolderDialog() {
  $("folderNameInput").value = "";
  $("folderModal").classList.remove("hidden");
  setTimeout(() => $("folderNameInput").focus(), 80);
}
function createFolder() {
  const n = $("folderNameInput").value.trim();
  if (!n) {
    showToast("Enter a name", "error");
    return;
  }
  apiCreateFolder(n);
  closeModal("folderModal");
}

function showRenameDialog(item) {
  renameTarget = item;
  const inp = $("renameInput");
  inp.value = item.name;
  $("renameModal").classList.remove("hidden");
  setTimeout(() => {
    inp.focus();
    const dot = item.name.lastIndexOf(".");
    if (dot > 0 && item.type !== "folder") inp.setSelectionRange(0, dot);
    else inp.select();
  }, 80);
}
function renameFile() {
  const n = $("renameInput").value.trim();
  if (!n || !renameTarget) return;
  apiRename(renameTarget.path, n);
  renameTarget = null;
  closeModal("renameModal");
}

async function openPreview(item) {
  $("previewTitle").textContent = item.name;
  const body = $("previewBody");
  body.innerHTML = `<p style="color:var(--text-tertiary)">Loading…</p>`;
  $("previewModal").classList.remove("hidden");
  const url = `/uploads/${encodeURIComponent(item.path)}`;
  switch (item.file_type) {
    case "image":
      body.innerHTML = `<img src="${url}" class="preview-img">`;
      break;
    case "video":
      body.innerHTML = `<video src="${url}" controls autoplay style="max-width:100%;max-height:65vh;border-radius:8px"></video>`;
      break;
    case "audio":
      body.innerHTML = `<div style="text-align:center;padding:40px"><span class="material-icons-round" style="font-size:64px;color:var(--color-audio)">audiotrack</span><p style="margin:16px 0">${esc(item.name)}</p><audio src="${url}" controls autoplay style="width:100%;max-width:400px"></audio></div>`;
      break;
    case "code": {
      const d = await apiPreview(item.path);
      body.innerHTML = d?.content
        ? `<pre class="preview-code">${esc(d.content)}</pre>`
        : previewFallback(item, url);
      break;
    }
    case "pdf":
      body.innerHTML = `<iframe src="${url}" style="width:100%;height:70vh;border:none;border-radius:8px"></iframe>`;
      break;
    default:
      body.innerHTML = previewFallback(item, url);
  }
}

function previewFallback(item, url) {
  const ic = FILE_ICONS[item.file_type] || FILE_ICONS.default;
  return `<div style="text-align:center;padding:40px">
    <span class="material-icons-round file-icon ${ic.css}" style="font-size:72px">${ic.icon}</span>
    <p style="margin:16px 0;font-weight:500">${esc(item.name)}</p>
    <p style="color:var(--text-tertiary);margin-bottom:20px">${fmtSize(item.size)}</p>
    <a href="${url}" download="${esc(item.name)}" style="display:inline-flex;align-items:center;gap:8px;padding:10px 24px;background:var(--accent);color:#fff;border-radius:var(--r-md);text-decoration:none;font-weight:600">
      <span class="material-icons-round" style="font-size:20px">download</span>Download</a></div>`;
}

/* ═══════════════════════════════════════════
   TOAST
═══════════════════════════════════════════ */
function showToast(msg, type = "success") {
  const c = $("toastContainer"),
    t = document.createElement("div");
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="material-icons-round" style="font-size:18px">${type === "success" ? "check_circle" : "error_outline"}</span><span>${esc(msg)}</span>`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

/* ═══════════════════════════════════════════
   DRAG & DROP / SEARCH / KEYBOARD
═══════════════════════════════════════════ */
function setupDragDrop() {
  const ov = $("dropOverlay");
  document.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragCounter++;
    ov.classList.add("visible");
  });
  document.addEventListener("dragleave", (e) => {
    e.preventDefault();
    if (--dragCounter === 0) ov.classList.remove("visible");
  });
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    dragCounter = 0;
    ov.classList.remove("visible");
    if (e.dataTransfer.files.length) apiUpload(e.dataTransfer.files);
  });
}

function setupSearch() {
  $("searchInput").addEventListener("input", () => {
    clearTimeout(searchTimeout);
    const q = $("searchInput").value.trim();
    if (!q) {
      refreshView();
      return;
    }
    searchTimeout = setTimeout(async () => {
      const results = await doSearch(q);
      currentFiles = results;
      renderFiles();
      $("fileCount").textContent = `${results.length} result(s)`;
    }, 300);
  });
}

function setupKeyboard() {
  document.addEventListener("keydown", (e) => {
    if (!$("ssPlayer").classList.contains("hidden")) {
      if (e.key === "Escape") closeSlideshow();
      if (e.key === "ArrowLeft") ssNav(-1);
      if (e.key === "ArrowRight") ssNav(1);
      if (e.key === " ") {
        e.preventDefault();
        ssTogglePlay();
      }
      return;
    }
    if (e.key === "Escape") {
      [
        "previewModal",
        "folderModal",
        "renameModal",
        "newCollectionModal",
      ].forEach(closeModal);
      hideCtxMenu();
    }
    if (e.key === "Backspace" && !isTyping()) {
      e.preventDefault();
      if (currentView === "collectionDetail") {
        openCollectionsView();
        return;
      }
      if (currentView !== "files") {
        fetchFiles("");
        return;
      }
      if (currentPath) {
        const p = currentPath.split("/").filter(Boolean);
        p.pop();
        fetchFiles(p.join("/"));
      }
    }
    if (e.key === "Enter" && !isTyping()) {
      const sel = document.querySelector(".file-card.selected");
      if (!sel) return;
      if (currentView === "collections") {
        const colId = parseInt(sel.dataset.colId);
        if (colId) openCollectionDetail(colId);
      } else if (currentView === "files") {
        const item = currentFiles.find((f) => f.path === sel.dataset.path);
        if (item)
          item.type === "folder" ? fetchFiles(item.path) : openPreview(item);
      }
    }
  });
}

/* ═══════════════════════════════════════════
   INIT
═══════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  $("fileInput").addEventListener("change", (e) => {
    if (e.target.files.length) apiUpload(e.target.files);
    e.target.value = "";
  });
  $("toggleView").addEventListener("click", toggleView);

  // Close menus on outside click
  document.addEventListener("click", (e) => {
    if (
      !e.target.closest("#contextMenu") &&
      !e.target.closest(".btn-more") &&
      !e.target.closest("#addToColMenu")
    )
      hideCtxMenu();
  });

  // Modal backdrop clicks
  ["previewModal", "folderModal", "renameModal", "newCollectionModal"].forEach(
    (id) => {
      $(id)?.addEventListener("click", (e) => {
        if (e.target === e.currentTarget) closeModal(id);
      });
    },
  );

  // Enter keys in inputs
  $("folderNameInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") createFolder();
  });
  $("renameInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") renameFile();
  });
  $("newColNameInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitNewCollection();
  });

  // Slideshow controls
  $("ssBtnClose").addEventListener("click", closeSlideshow);
  $("ssBtnPlay").addEventListener("click", ssTogglePlay);
  $("ssBtnPrev").addEventListener("click", () => ssNav(-1));
  $("ssBtnNext").addEventListener("click", () => ssNav(1));
  $("ssBtnLeft").addEventListener("click", () => ssNav(-1));
  $("ssBtnRight").addEventListener("click", () => ssNav(1));

  $("ssVolSlider").addEventListener("input", function () {
    if (ss.audio) ss.audio.volume = parseInt(this.value) / 100;
  });
  $("ssProgressTrack").addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    ssGo(Math.floor(((e.clientX - r.left) / r.width) * ss.items.length));
  });

  // Auto-hide cursor in player
  let cursorTimer;
  $("ssPlayer").addEventListener("mousemove", () => {
    $("ssPlayer").style.cursor = "";
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => {
      $("ssPlayer").style.cursor = "none";
    }, 2500);
  });

  // Mobile sidebar
  const mobileBtn = $("mobileMenu"),
    sidebar = $("sidebar");
  mobileBtn.addEventListener("click", () => sidebar.classList.toggle("open"));
  document.addEventListener("click", (e) => {
    if (
      sidebar.classList.contains("open") &&
      !sidebar.contains(e.target) &&
      !mobileBtn.contains(e.target)
    )
      sidebar.classList.remove("open");
  });

  setupDragDrop();
  setupSearch();
  setupKeyboard();
  apiListCollections();
  fetchFiles("");
});
