/* ═══════════════════════════════════════
   STATE
   ═══════════════════════════════════════ */

let currentPath = "";
let currentFiles = [];
let currentSort = { key: "name", asc: true };
let currentView = "files"; // "files" | "starred"
let isGridView = true;
let contextFile = null;
let dragCounter = 0;
let searchTimeout = null;

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

/* ═══════════════════════════════════════
   UTILS
   ═══════════════════════════════════════ */

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + " " + units[i];
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function isTyping() {
  const tag = document.activeElement?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
}

/* ═══════════════════════════════════════
   API CALLS
   ═══════════════════════════════════════ */

async function fetchFiles(path = "") {
  try {
    const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    currentPath = path;
    currentView = "files";
    currentFiles = data.items || [];

    setActiveNav("navFiles");
    renderFiles();
    renderBreadcrumb(data.breadcrumb || []);
    updateFileCount();
    updateStorage(data.storage);
    updateToolbarVisibility();
  } catch (err) {
    console.error("fetchFiles error:", err);
    showToast("Failed to load files", "error");
  }
}

async function fetchStarred() {
  try {
    const res = await fetch("/api/starred");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    currentView = "starred";
    currentFiles = data.items || [];
    currentPath = "";

    setActiveNav("navStarred");
    renderFiles();
    renderViewHeader("Starred", "star", currentFiles.length);
    updateToolbarVisibility();
  } catch (err) {
    showToast("Failed to load starred files", "error");
  }
}

async function apiSearch(query) {
  try {
    const res = await fetch(
      `/api/search?q=${encodeURIComponent(query)}&path=${encodeURIComponent(currentPath)}`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    showToast("Search failed", "error");
    return { results: [] };
  }
}

async function apiUpload(files) {
  const formData = new FormData();
  formData.append("path", currentPath);
  for (const file of files) formData.append("files", file);

  const progressEl = document.getElementById("uploadProgress");
  const fillEl = document.getElementById("uploadFill");
  const statusEl = document.getElementById("uploadStatus");

  progressEl.classList.remove("hidden");
  fillEl.style.width = "0%";
  statusEl.textContent = `Uploading ${files.length} file(s)...`;

  try {
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          fillEl.style.width = pct + "%";
          statusEl.textContent = `${pct}% — ${files.length} file(s)`;
        }
      });
      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          showToast(`Uploaded ${files.length} file(s)`, "success");
          fetchFiles(currentPath);
          resolve();
        } else reject(new Error(`HTTP ${xhr.status}`));
      });
      xhr.addEventListener("error", () => reject(new Error("Network error")));
      xhr.open("POST", "/api/upload");
      xhr.send(formData);
    });
  } catch (err) {
    showToast("Upload failed", "error");
  } finally {
    setTimeout(() => progressEl.classList.add("hidden"), 1500);
  }
}

async function apiCreateFolder(name) {
  try {
    const res = await fetch("/api/folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: currentPath, name }),
    });
    if (!res.ok)
      throw new Error(
        (await res.json().catch(() => ({}))).detail || `HTTP ${res.status}`,
      );
    showToast(`Created folder "${name}"`, "success");
    fetchFiles(currentPath);
  } catch (err) {
    showToast(err.message || "Failed to create folder", "error");
  }
}

async function apiRename(oldPath, newName) {
  try {
    const res = await fetch("/api/rename", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ old_path: oldPath, new_name: newName }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showToast("Renamed successfully", "success");
    refreshCurrentView();
  } catch (err) {
    showToast("Rename failed", "error");
  }
}

async function apiDelete(filePath) {
  try {
    const res = await fetch("/api/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showToast("File deleted", "success");
    refreshCurrentView();
  } catch (err) {
    showToast("Delete failed", "error");
  }
}

async function apiToggleStar(filePath) {
  try {
    const res = await fetch("/api/star", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    showToast(data.message, "success");
    refreshCurrentView();
  } catch (err) {
    showToast("Failed to toggle star", "error");
  }
}

async function apiPreview(filePath) {
  try {
    const res = await fetch(`/api/preview/${encodeURIComponent(filePath)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) return await res.json();
    return null;
  } catch (err) {
    return null;
  }
}

function refreshCurrentView() {
  switch (currentView) {
    case "files":
      fetchFiles(currentPath);
      break;
    case "starred":
      fetchStarred();
      break;
  }
}

/* ═══════════════════════════════════════
   SORTING
   ═══════════════════════════════════════ */

function sortItems(items) {
  return [...items].sort((a, b) => {
    if (a.type === "folder" && b.type !== "folder") return -1;
    if (a.type !== "folder" && b.type === "folder") return 1;
    let valA, valB;
    switch (currentSort.key) {
      case "name":
        valA = (a.name || "").toLowerCase();
        valB = (b.name || "").toLowerCase();
        return currentSort.asc
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      case "date":
        valA = new Date(a.modified || 0).getTime();
        valB = new Date(b.modified || 0).getTime();
        break;
      case "size":
        valA = a.size || 0;
        valB = b.size || 0;
        break;
      default:
        return 0;
    }
    return currentSort.asc ? valA - valB : valB - valA;
  });
}

/* ═══════════════════════════════════════
   RENDER — File Cards
   ═══════════════════════════════════════ */

function createFileCard(item) {
  const iconData = FILE_ICONS[item.file_type] || FILE_ICONS.default;
  const isImage = item.file_type === "image";
  const isFolder = item.type === "folder";

  let previewHtml;
  if (isImage) {
    previewHtml = `<img src="/uploads/${encodeURIComponent(item.path)}" alt="${escapeHtml(item.name)}" loading="lazy">`;
  } else {
    previewHtml = `<span class="material-icons-round file-icon ${iconData.css}">${iconData.icon}</span>`;
  }

  const sizeTxt = isFolder ? "" : formatSize(item.size);
  const dateTxt = formatDate(item.modified);
  const metaParts = [sizeTxt, dateTxt].filter(Boolean);

  const starBadge = item.is_starred
    ? `<span class="star-badge material-icons-round" title="Starred">star</span>`
    : "";

  return `
    <div class="file-card" data-path="${escapeHtml(item.path)}" data-id="${item.id || ""}">
      <div class="file-card-preview">
        ${previewHtml}
        ${starBadge}
      </div>
      <div class="file-card-info">
        <div class="file-card-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
        <div class="file-card-meta">${escapeHtml(metaParts.join(" · "))}</div>
      </div>
      <div class="file-card-actions">
        <button class="btn-icon btn-more" title="More">
          <span class="material-icons-round">more_vert</span>
        </button>
      </div>
    </div>
  `;
}

function renderFiles() {
  const grid = document.getElementById("filesGrid");
  const emptyState = document.getElementById("emptyState");
  const container = document.getElementById("filesContainer");
  const sorted = sortItems(currentFiles);

  grid.classList.toggle("list-view", !isGridView);

  if (sorted.length === 0) {
    grid.innerHTML = "";
    container.classList.add("hidden");
    emptyState.classList.remove("hidden");

    const emptyIcon = emptyState.querySelector(".material-icons-round");
    const emptyH3 = emptyState.querySelector("h3");
    const emptyP = emptyState.querySelector("p");

    if (currentView === "starred") {
      emptyIcon.textContent = "star_outline";
      emptyH3.textContent = "No starred files";
      emptyP.textContent = "Star files to find them quickly here";
    } else {
      emptyIcon.textContent = "cloud_off";
      emptyH3.textContent = "No files here";
      emptyP.textContent = "Upload files or create a folder to get started";
    }
    return;
  }

  container.classList.remove("hidden");
  emptyState.classList.add("hidden");
  grid.innerHTML = sorted.map((item) => createFileCard(item)).join("");
  attachCardEvents(sorted);
}

function attachCardEvents(sortedItems) {
  const cards = document.querySelectorAll("#filesGrid .file-card");

  cards.forEach((card, index) => {
    const item = sortedItems[index];

    card.addEventListener("dblclick", () => {
      if (item.type === "folder") fetchFiles(item.path);
      else openPreview(item);
    });

    card.addEventListener("click", (e) => {
      if (e.target.closest(".btn-more")) return;
      document
        .querySelectorAll(".file-card")
        .forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
    });

    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showContextMenu(e, item);
    });

    const moreBtn = card.querySelector(".btn-more");
    if (moreBtn) {
      moreBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        showContextMenu(e, item);
      });
    }
  });
}

/* ═══════════════════════════════════════
   RENDER — Headers & Breadcrumb
   ═══════════════════════════════════════ */

function renderBreadcrumb() {
  const bc = document.getElementById("breadcrumb");

  let html = `
    <a href="#" class="breadcrumb-item" onclick="fetchFiles(''); return false;">
      <span class="material-icons-round" style="font-size:18px">home</span> My Files
    </a>
  `;

  if (currentPath) {
    const parts = currentPath.split("/").filter(Boolean);
    let accumulated = "";
    parts.forEach((part, i) => {
      accumulated += (accumulated ? "/" : "") + part;
      const isLast = i === parts.length - 1;
      const safePath = escapeHtml(accumulated);
      html += `
        <span class="material-icons-round breadcrumb-separator">chevron_right</span>
        <a href="#" class="breadcrumb-item" onclick="fetchFiles('${safePath}'); return false;"
           ${isLast ? 'style="color:var(--text-primary)"' : ""}>${escapeHtml(part)}</a>
      `;
    });
  }

  bc.innerHTML = html;
}

function renderViewHeader(title, icon, count) {
  const bc = document.getElementById("breadcrumb");
  bc.innerHTML = `
    <span class="breadcrumb-item" style="color:var(--text-primary); cursor:default;">
      <span class="material-icons-round" style="font-size:18px">${icon}</span> ${escapeHtml(title)}
    </span>
  `;
  document.getElementById("fileCount").textContent =
    `${count} item${count !== 1 ? "s" : ""}`;
}

function updateToolbarVisibility() {
  const toolbar = document.getElementById("toolbar");
  toolbar.style.display = currentView === "files" ? "flex" : "none";
}

/* ═══════════════════════════════════════
   SIDEBAR — Nav
   ═══════════════════════════════════════ */

function setActiveNav(activeId) {
  document
    .querySelectorAll(".nav-item")
    .forEach((n) => n.classList.remove("active"));
  const el = document.getElementById(activeId);
  if (el) el.classList.add("active");
}

/* ═══════════════════════════════════════
   CONTEXT MENU
   ═══════════════════════════════════════ */

function showContextMenu(e, item) {
  contextFile = item;
  const menu = document.getElementById("contextMenu");
  const menuInner = menu.querySelector(".ctx-menu-inner");

  const starIcon = item.is_starred ? "star" : "star_outline";
  const starLabel = item.is_starred ? "Unstar" : "Star";

  menuInner.innerHTML = `
    <button class="ctx-item" data-action="open">
      <span class="material-icons-round">open_in_new</span> <span>Open</span>
    </button>
    <button class="ctx-item" data-action="download">
      <span class="material-icons-round">download</span> <span>Download</span>
    </button>
    <button class="ctx-item" data-action="star">
      <span class="material-icons-round">${starIcon}</span> <span>${starLabel}</span>
    </button>
    <button class="ctx-item" data-action="rename">
      <span class="material-icons-round">drive_file_rename_outline</span> <span>Rename</span>
    </button>
    <div class="ctx-separator"></div>
    <button class="ctx-item danger" data-action="delete">
      <span class="material-icons-round">delete_outline</span> <span>Delete</span>
    </button>
  `;

  menuInner.querySelectorAll(".ctx-item").forEach((btn) => {
    btn.addEventListener("click", () =>
      handleContextAction(btn.dataset.action),
    );
  });

  menu.classList.remove("hidden");
  const x = Math.min(e.clientX, window.innerWidth - 220);
  const y = Math.min(e.clientY, window.innerHeight - 260);
  menu.style.left = x + "px";
  menu.style.top = y + "px";
}

function hideContextMenu() {
  document.getElementById("contextMenu").classList.add("hidden");
  contextFile = null;
}

function handleContextAction(action) {
  if (!contextFile) return;

  switch (action) {
    case "open":
      if (contextFile.type === "folder") fetchFiles(contextFile.path);
      else openPreview(contextFile);
      break;

    case "download":
      const a = document.createElement("a");
      a.href = `/api/download/${encodeURIComponent(contextFile.path)}`;
      a.download = contextFile.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      break;

    case "star":
      apiToggleStar(contextFile.path);
      break;

    case "rename":
      showRenameDialog(contextFile);
      break;

    case "delete":
      if (confirm(`Delete "${contextFile.name}"? This cannot be undone.`)) {
        apiDelete(contextFile.path);
      }
      break;
  }

  hideContextMenu();
}

/* ═══════════════════════════════════════
   DRAG & DROP, SEARCH, PREVIEW, MODALS
   ═══════════════════════════════════════ */

function setupDragDrop() {
  const overlay = document.getElementById("dropOverlay");
  document.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragCounter++;
    overlay.classList.add("visible");
  });
  document.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) overlay.classList.remove("visible");
  });
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    dragCounter = 0;
    overlay.classList.remove("visible");
    if (e.dataTransfer.files.length > 0) apiUpload(e.dataTransfer.files);
  });
}

function setupSearch() {
  const input = document.getElementById("searchInput");
  input.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    const query = input.value.trim();
    if (!query) {
      refreshCurrentView();
      return;
    }
    searchTimeout = setTimeout(async () => {
      const data = await apiSearch(query);
      currentFiles = data.results || [];
      renderFiles();
      document.getElementById("fileCount").textContent =
        `${currentFiles.length} result(s)`;
    }, 300);
  });
}

async function openPreview(item) {
  const modal = document.getElementById("previewModal");
  const title = document.getElementById("previewTitle");
  const body = document.getElementById("previewBody");

  title.textContent = item.name;
  body.innerHTML = `<p style="color:var(--text-tertiary)">Loading...</p>`;
  modal.classList.remove("hidden");

  const fileUrl = `/uploads/${encodeURIComponent(item.path)}`;

  switch (item.file_type) {
    case "image":
      body.innerHTML = `<img src="${fileUrl}" alt="${escapeHtml(item.name)}" class="preview-image">`;
      break;
    case "video":
      body.innerHTML = `<video src="${fileUrl}" controls autoplay style="max-width:100%;max-height:65vh;border-radius:8px;"></video>`;
      break;
    case "audio":
      body.innerHTML = `<div style="text-align:center;padding:40px;">
        <span class="material-icons-round" style="font-size:64px;color:var(--color-audio);">audiotrack</span>
        <p style="margin:16px 0;color:var(--text-secondary);">${escapeHtml(item.name)}</p>
        <audio src="${fileUrl}" controls autoplay style="width:100%;max-width:400px;"></audio>
      </div>`;
      break;
    case "code":
      const data = await apiPreview(item.path);
      if (data && data.content)
        body.innerHTML = `<pre class="preview-code">${escapeHtml(data.content)}</pre>`;
      else body.innerHTML = defaultPreviewHtml(item, fileUrl);
      break;
    case "pdf":
      body.innerHTML = `<iframe src="${fileUrl}" style="width:100%;height:70vh;border:none;border-radius:8px;"></iframe>`;
      break;
    default:
      body.innerHTML = defaultPreviewHtml(item, fileUrl);
  }
}

function defaultPreviewHtml(item, fileUrl) {
  const iconData = FILE_ICONS[item.file_type] || FILE_ICONS.default;
  return `<div style="text-align:center;padding:40px;">
    <span class="material-icons-round file-icon ${iconData.css}" style="font-size:72px;">${iconData.icon}</span>
    <p style="margin:16px 0;font-weight:500;">${escapeHtml(item.name)}</p>
    <p style="color:var(--text-tertiary);margin-bottom:20px;">${formatSize(item.size)}</p>
    <a href="${fileUrl}" download="${escapeHtml(item.name)}"
      style="display:inline-flex;align-items:center;gap:8px;padding:10px 24px;background:var(--accent);color:white;border-radius:var(--radius-md);text-decoration:none;font-weight:600;">
      <span class="material-icons-round" style="font-size:20px;">download</span> Download
    </a>
  </div>`;
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.add("hidden");
}

function showNewFolderDialog() {
  const input = document.getElementById("folderNameInput");
  input.value = "";
  document.getElementById("folderModal").classList.remove("hidden");
  setTimeout(() => input.focus(), 100);
}

function createFolder() {
  const name = document.getElementById("folderNameInput").value.trim();
  if (!name) {
    showToast("Please enter a folder name", "error");
    return;
  }
  apiCreateFolder(name);
  closeModal("folderModal");
}

function showRenameDialog(item) {
  const input = document.getElementById("renameInput");
  input.value = item.name;
  document.getElementById("renameModal").classList.remove("hidden");
  setTimeout(() => {
    input.focus();
    const dotIndex = item.name.lastIndexOf(".");
    if (dotIndex > 0 && item.type !== "folder")
      input.setSelectionRange(0, dotIndex);
    else input.select();
  }, 100);
}

function renameFile() {
  const newName = document.getElementById("renameInput").value.trim();
  if (!newName) {
    showToast("Please enter a name", "error");
    return;
  }
  if (!contextFile) return;
  apiRename(contextFile.path, newName);
  closeModal("renameModal");
}

function sortFiles(key) {
  if (currentSort.key === key) currentSort.asc = !currentSort.asc;
  else currentSort = { key, asc: true };
  renderFiles();
}

/* ═══════════════════════════════════════
   UI HELPERS
   ═══════════════════════════════════════ */

function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  const icons = { success: "check_circle", error: "error_outline" };
  toast.innerHTML = `
    <span class="material-icons-round" style="font-size:20px;">${icons[type] || "info"}</span>
    <span>${escapeHtml(message)}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function updateFileCount() {
  const el = document.getElementById("fileCount");
  const folders = currentFiles.filter((f) => f.type === "folder").length;
  const files = currentFiles.filter((f) => f.type !== "folder").length;
  const parts = [];
  if (folders) parts.push(`${folders} folder${folders > 1 ? "s" : ""}`);
  if (files) parts.push(`${files} file${files > 1 ? "s" : ""}`);
  el.textContent = parts.join(", ") || "Empty";
}

function updateStorage(storage) {
  if (!storage) return;
  const fill = document.getElementById("storageFill");
  const text = document.getElementById("storageText");
  const pct = Math.min((storage.used / storage.total) * 100, 100);
  fill.style.width = pct + "%";
  text.textContent = `${formatSize(storage.used)} of ${formatSize(storage.total)} used`;
}

function toggleView() {
  isGridView = !isGridView;
  document.getElementById("viewIcon").textContent = isGridView
    ? "grid_view"
    : "view_list";
  renderFiles();
}

function setupKeyboard() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal("previewModal");
      closeModal("folderModal");
      closeModal("renameModal");
      hideContextMenu();
    }
    if (e.key === "Backspace" && !isTyping()) {
      e.preventDefault();
      if (currentView !== "files") {
        fetchFiles("");
        return;
      }
      if (currentPath) {
        const parts = currentPath.split("/").filter(Boolean);
        parts.pop();
        fetchFiles(parts.join("/"));
      }
    }
    if (e.key === "Enter" && !isTyping()) {
      const selected = document.querySelector(".file-card.selected");
      if (selected) {
        const path = selected.dataset.path;
        const item = currentFiles.find((f) => f.path === path);
        if (item) {
          if (item.type === "folder") fetchFiles(item.path);
          else openPreview(item);
        }
      }
    }
  });
}

function setupMobile() {
  const menuBtn = document.getElementById("mobileMenu");
  const sidebar = document.getElementById("sidebar");
  menuBtn.addEventListener("click", () => sidebar.classList.toggle("open"));
  document.addEventListener("click", (e) => {
    if (
      sidebar.classList.contains("open") &&
      !sidebar.contains(e.target) &&
      !menuBtn.contains(e.target)
    )
      sidebar.classList.remove("open");
  });
}

/* ═══════════════════════════════════════
   INIT
   ═══════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {
  // File input
  document.getElementById("fileInput").addEventListener("change", (e) => {
    if (e.target.files.length > 0) apiUpload(e.target.files);
    e.target.value = "";
  });

  // View toggle
  document.getElementById("toggleView").addEventListener("click", toggleView);

  // Click outside context menu
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#contextMenu") && !e.target.closest(".btn-more"))
      hideContextMenu();
  });

  // Modal backdrop close
  ["previewModal", "folderModal", "renameModal"].forEach((id) => {
    const el = document.getElementById(id);
    if (el)
      el.addEventListener("click", (e) => {
        if (e.target === e.currentTarget) closeModal(id);
      });
  });

  // Input enter keys
  document
    .getElementById("folderNameInput")
    .addEventListener("keydown", (e) => {
      if (e.key === "Enter") createFolder();
    });
  document.getElementById("renameInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") renameFile();
  });

  // Nav items
  document.getElementById("navFiles").addEventListener("click", (e) => {
    e.preventDefault();
    fetchFiles("");
  });
  document.getElementById("navStarred").addEventListener("click", (e) => {
    e.preventDefault();
    fetchStarred();
  });

  setupDragDrop();
  setupSearch();
  setupKeyboard();
  setupMobile();

  // Initial load
  fetchFiles("");
});
