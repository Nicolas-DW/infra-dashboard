import './css/variables.css';
import './css/base.css';
import './css/layout.css';
import './css/cards.css';
import './css/connections.css';
import './css/dialog.css';
import './css/whiteboard.css';

import { DEFAULT_CATEGORIES, DEFAULT_NODES, DEFAULT_CONNECTIONS, DEFAULT_ALERTS } from './js/data.js';
import { customConfirm } from './js/ui.js';
import config from './config.js';
import { initWhiteboard, renderWhiteboard, exposeWhiteboardGlobals } from './js/whiteboard.js';
import { buildInfraDocument } from './js/seed-infra.js';

/* ═══ STATE ═══ */
const STORAGE_KEY = "hjdash_v6";

function loadState() {
  try {
    let r = localStorage.getItem(STORAGE_KEY);
    if (r) return JSON.parse(r);
    for (const k of ["hjdash_v5", "hjdash_v4", "hjdash_v3"]) { r = localStorage.getItem(k); if (r) return JSON.parse(r); }
  } catch (e) { /* ignore */ }
  return null;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    categories: S.categories, nodes: S.nodes, connections: S.connections, alerts: S.alerts,
    conceptionConfigs: S.conceptionConfigs, activeConceptionConfig: S.activeConceptionConfig,
    sandbox: S.sandbox, whiteboardViewport: S.whiteboardViewport,
    lastUpdated: new Date().toISOString().slice(0, 10),
  }));
}

const saved = loadState();
const S = {
  categories: saved?.categories ?? structuredClone(DEFAULT_CATEGORIES),
  nodes: saved?.nodes ?? structuredClone(DEFAULT_NODES),
  connections: saved?.connections ?? [...DEFAULT_CONNECTIONS],
  alerts: saved?.alerts ?? structuredClone(DEFAULT_ALERTS),
  conceptionConfigs: saved?.conceptionConfigs ?? [],
  activeConceptionConfig: saved?.activeConceptionConfig ?? '',
  sandbox: saved?.sandbox ?? { nodes: [], zones: [], connections: [], positions: {} },
  whiteboardViewport: saved?.whiteboardViewport ?? { panX: 220, panY: 0, zoom: 1 },
  lastUpdated: saved?.lastUpdated ?? "2026-04-09",
  currentView: "dashboard",
};

/* ═══ SEED INFRA DOCUMENT ═══ */
if (buildInfraDocument(S)) saveState();

/* ═══ INIT WHITEBOARD ═══ */
initWhiteboard(S, saveState, toast);
exposeWhiteboardGlobals();

/* ═══ UI STATE (non-persistent) ═══ */
const collapsedCats = new Set();

/* ═══ DOM REFS ═══ */
const dlgNode = document.getElementById("dlgNode");
const dlgCat = document.getElementById("dlgCat");
const dlgConn = document.getElementById("dlgConn");

/* ═══ RENDER ═══ */
function render() {
  const app = document.getElementById("app");
  if (S.currentView === "dashboard") renderDashboard(app);
  else { app.innerHTML = renderHeader(); const wb = document.createElement("div"); wb.id = "wb-app"; app.appendChild(wb); renderWhiteboard(wb); }
}

function renderHeader() {
  const v = S.currentView;
  return `<div class="header">
    <h1>🏗️ <span>${config.title}</span> — ${config.subtitle}</h1>
    <div class="last-updated">Dernière mise à jour : ${S.lastUpdated}</div>
  </div>
  <div class="view-tabs">
    <button class="view-tab ${v === 'dashboard' ? 'active' : ''}" onclick="window.__setView('dashboard')">📋 Dashboard</button>
    <button class="view-tab ${v === 'conception' ? 'active' : ''}" onclick="window.__setView('conception')">🧪 Conception</button>
  </div>
  ${v === 'dashboard' ? `<div class="toolbar">
    <button onclick="window.__openAddNode()">+ Service</button>
    <button onclick="window.__openAddCat()">+ Catégorie</button>
    <div class="toolbar-spacer"></div>
    <button class="toolbar-subtle" onclick="window.__exportJSON()" title="Exporter JSON">📥</button>
    <label class="toolbar-subtle" title="Importer JSON">📤<input type="file" accept=".json" onchange="window.__importJSON(event)" style="display:none"></label>
  </div>` : ''}`;
}

function renderDashboard(app) {
  let h = renderHeader();

  // Dropdown filter
  h += `<div class="dash-top-bar">
    <div class="search-bar"><input type="text" id="search" placeholder="🔍 Rechercher..." oninput="window.__filterNodes(this.value)"></div>
    <div class="filter-dropdown-wrap">
      <select id="cat-filter" onchange="window.__filterCategory(this.value)">
        <option value="all">Toutes les catégories</option>
        ${S.categories.map(c => `<option value="${c.id}">${c.icon} ${c.label}</option>`).join('')}
      </select>
    </div>
  </div>`;

  h += `<div id="nodes-container">`;
  S.categories.forEach(cat => {
    const cn = S.nodes.filter(n => n.category === cat.id);
    if (!cn.length) return;
    const collapsed = collapsedCats.has(cat.id);
    h += `<div class="category" data-category="${cat.id}">
      <div class="category-title" onclick="window.__toggleCat('${cat.id}')">
        <span class="cat-drag-handle" title="Glisser pour réordonner">⠿</span>
        <span class="cat-collapse-arrow ${collapsed ? 'collapsed' : ''}">▼</span>
        <span class="dot" style="background:${cat.color}"></span>${cat.icon} ${cat.label}
        <span class="cat-count">${cn.length}</span>
        <button class="cat-edit-btn" onclick="event.stopPropagation();window.__openEditCat('${cat.id}')" title="Modifier">✎</button>
      </div>
      <div class="nodes-grid ${collapsed ? 'hidden' : ''}">
        ${cn.map((n, i) => renderNode(n, cat.color, i)).join('')}
      </div>
    </div>`;
  });
  h += `</div>`;

  h += `<div class="connections-section" id="conn-section">
    <h3>🔗 Flux & Connexions (${S.connections.length})</h3>
    ${S.connections.map((c, i) => {
      const p = c.split(" · ");
      return `<div class="connection-line">
        <span class="arrow">⟶</span><span>${p[0]}</span>
        ${p[1] ? `<span style="color:var(--text-muted);font-style:italic">— ${p[1]}</span>` : ''}
        <span class="conn-actions">
          <button onclick="window.__openEditConn(${i})">✎</button>
          <button class="cdel" onclick="window.__deleteConn(${i})">✕</button>
        </span>
      </div>`;
    }).join('')}
    <button class="btn btn-ghost" onclick="window.__openAddConn()" style="margin-top:.5rem">+ Connexion</button>
  </div>`;

  if (S.alerts && S.alerts.length) {
    h += `<div class="alert-section">
      <h3>⚠️ Recommandations sécurité (${S.alerts.length})</h3>
      ${S.alerts.map(a => `<div class="alert-item">
        <span class="severity ${a.severity === 'warn' ? 'sev-warn' : a.severity === 'high' ? 'sev-high' : 'sev-info'}">
          ${a.severity === 'warn' ? 'ATTENTION' : a.severity === 'high' ? 'CRITIQUE' : 'INFO'}</span>${a.text}
      </div>`).join('')}</div>`;
  }
  app.innerHTML = h;
  initDragAndDrop();
}

function renderNode(node, accent, idx) {
  const det = Object.entries(node.details || {}).map(([k, v]) => {
    const isWarn = String(v).includes('⚠️');
    return `<span class="detail-chip"><span class="label">${k}:</span> <span class="value" ${isWarn ? 'style="color:var(--accent-orange)"' : ''}>${v}</span></span>`;
  }).join('');
  const tags = (node.tags || []).map(t => `<span class="tag">${t}</span>`).join('');
  const links = (node.links || []).map(l => `<a href="${l.url}" target="_blank" rel="noopener" class="node-link">${l.label}</a>`).join('');
  const hasExtra = det || tags || links;

  return `<div class="node-card" data-id="${node.id}" data-tags="${(node.tags || []).join(' ')}" data-category="${node.category}" style="animation-delay:${idx * .03}s" ondblclick="window.__openEditNode('${node.id}')">
    <style>.node-card[data-id="${node.id}"]::before{background:${accent};}</style>
    <div class="node-header">
      <span class="card-drag-handle" title="Glisser pour réordonner">⠿</span>
      <div class="node-icon" style="background:${accent}15;color:${accent}">${node.icon}</div>
      <div><div class="node-name">${node.name}</div><div class="node-type">${node.type || ''}</div></div>
      ${hasExtra ? `<button class="card-expand-btn" onclick="event.stopPropagation();window.__toggleCard(this)" title="Détails">▼</button>` : ''}
    </div>
    ${node.description ? `<div class="node-description">${node.description}</div>` : ''}
    ${hasExtra ? `<div class="node-extra">
      ${det ? `<div class="node-details">${det}</div>` : ''}
      ${tags ? `<div class="node-tags">${tags}</div>` : ''}
      ${links ? `<div class="node-links">${links}</div>` : ''}
    </div>` : ''}
  </div>`;
}

/* ═══ HELPERS ═══ */
function toast(msg) {
  const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}
function esc(s) { return String(s).replace(/"/g, '&quot;'); }

/* ═══ VIEW SWITCHING ═══ */
function setView(view) { S.currentView = view; render(); }

/* ═══ FILTERS ═══ */
function filterCategory(id) {
  document.querySelectorAll('.category').forEach(s => { s.style.display = (id === 'all' || s.dataset.category === id) ? '' : 'none'; });
}
function filterNodes(q) {
  q = q.toLowerCase().trim();
  document.querySelectorAll('.node-card').forEach(c => { c.style.display = (c.textContent.toLowerCase() + ' ' + (c.dataset.tags || '')).includes(q) ? '' : 'none'; });
  document.querySelectorAll('.category').forEach(s => s.style.display = '');
}
function toggleCat(catId) {
  if (collapsedCats.has(catId)) collapsedCats.delete(catId); else collapsedCats.add(catId);
  const cat = document.querySelector(`.category[data-category="${catId}"]`); if (!cat) return;
  const grid = cat.querySelector('.nodes-grid');
  const arrow = cat.querySelector('.cat-collapse-arrow');
  if (grid) grid.classList.toggle('hidden');
  if (arrow) arrow.classList.toggle('collapsed');
}
function toggleCard(btn) {
  const card = btn.closest('.node-card');
  if (card) { card.classList.toggle('expanded'); btn.classList.toggle('expanded'); }
}

/* ═══ DRAG & DROP ═══ */
let dragType = null; // 'category' | 'node'
let dragId = null;
let dragSource = null;

function initDragAndDrop() {
  const container = document.getElementById("nodes-container");
  if (!container) return;

  // Activate draggable only when mousedown starts on a handle
  container.addEventListener("mousedown", (e) => {
    const catHandle = e.target.closest('.cat-drag-handle');
    const cardHandle = e.target.closest('.card-drag-handle');
    if (catHandle) {
      const cat = catHandle.closest('.category');
      if (cat) cat.setAttribute('draggable', 'true');
    } else if (cardHandle) {
      const card = cardHandle.closest('.node-card');
      if (card) card.setAttribute('draggable', 'true');
    }
  });

  container.addEventListener("dragstart", (e) => {
    const card = e.target.closest('.node-card[draggable="true"]');
    const cat = e.target.closest('.category[draggable="true"]');
    if (card) {
      dragType = 'node'; dragId = card.dataset.id; dragSource = card;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
    } else if (cat) {
      dragType = 'category'; dragId = cat.dataset.category; dragSource = cat;
      cat.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
    } else {
      e.preventDefault();
    }
  });

  container.addEventListener("dragend", () => {
    // Clean up draggable attributes
    container.querySelectorAll('[draggable="true"]').forEach(el => el.removeAttribute('draggable'));
    container.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    container.querySelectorAll('.drag-over, .drag-over-top, .drag-over-bottom').forEach(el => {
      el.classList.remove('drag-over', 'drag-over-top', 'drag-over-bottom');
    });
    dragType = null; dragId = null; dragSource = null;
  });

  container.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // Clear previous indicators
    container.querySelectorAll('.drag-over-top, .drag-over-bottom, .drag-over').forEach(el => {
      el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over');
    });

    if (dragType === 'category') {
      const target = e.target.closest('.category');
      if (!target || target === dragSource) return;
      const rect = target.getBoundingClientRect();
      target.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drag-over-top' : 'drag-over-bottom');
    }

    if (dragType === 'node') {
      const targetCard = e.target.closest('.node-card');
      const targetGrid = e.target.closest('.nodes-grid');
      if (targetCard && targetCard !== dragSource) {
        const rect = targetCard.getBoundingClientRect();
        targetCard.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drag-over-top' : 'drag-over-bottom');
      } else if (targetGrid && !targetCard) {
        targetGrid.classList.add('drag-over');
      }
    }
  });

  container.addEventListener("drop", (e) => {
    e.preventDefault();
    if (dragType === 'category') dropCategory(e);
    if (dragType === 'node') dropNode(e);
  });
}

function dropCategory(e) {
  const target = e.target.closest('.category');
  if (!target || target.dataset.category === dragId) return;
  const fromIdx = S.categories.findIndex(c => c.id === dragId);
  const toIdx = S.categories.findIndex(c => c.id === target.dataset.category);
  if (fromIdx < 0 || toIdx < 0) return;
  const rect = target.getBoundingClientRect();
  const after = e.clientY > rect.top + rect.height / 2;
  const [moved] = S.categories.splice(fromIdx, 1);
  const insertIdx = S.categories.findIndex(c => c.id === target.dataset.category);
  S.categories.splice(after ? insertIdx + 1 : insertIdx, 0, moved);
  saveState(); render(); toast("Catégorie déplacée");
}

function dropNode(e) {
  const targetCard = e.target.closest('.node-card');
  const targetGrid = e.target.closest('.nodes-grid');
  const targetCat = e.target.closest('.category');
  if (!targetCat) return;
  const newCatId = targetCat.dataset.category;
  const nodeIdx = S.nodes.findIndex(n => n.id === dragId);
  if (nodeIdx < 0) return;
  const node = S.nodes[nodeIdx];

  // Remove from old position
  S.nodes.splice(nodeIdx, 1);

  // Update category if moving across
  node.category = newCatId;

  if (targetCard && targetCard.dataset.id !== dragId) {
    // Insert before or after the target card
    const rect = targetCard.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    const targetIdx = S.nodes.findIndex(n => n.id === targetCard.dataset.id);
    S.nodes.splice(after ? targetIdx + 1 : targetIdx, 0, node);
  } else {
    // Dropped on grid (empty area) → append to end of that category's nodes
    const lastInCat = S.nodes.filter(n => n.category === newCatId);
    if (lastInCat.length) {
      const lastIdx = S.nodes.indexOf(lastInCat[lastInCat.length - 1]);
      S.nodes.splice(lastIdx + 1, 0, node);
    } else {
      S.nodes.push(node);
    }
  }

  saveState(); render(); toast("Service déplacé");
}

/* ═══ NODE CRUD ═══ */
function populateCatSel() {
  document.getElementById("f_category").innerHTML = S.categories.map(c => `<option value="${c.id}">${c.icon} ${c.label}</option>`).join('');
}
function addDetailRow(k = '', v = '') {
  const c = document.getElementById("f_details"), r = document.createElement("div"); r.className = "repeater-row";
  r.innerHTML = `<input type="text" placeholder="Clé" value="${esc(k)}"><input type="text" placeholder="Valeur" value="${esc(v)}"><button type="button" onclick="this.parentElement.remove()">✕</button>`;
  c.appendChild(r);
}
function addLinkRow(l = '', u = '') {
  const c = document.getElementById("f_links"), r = document.createElement("div"); r.className = "repeater-row";
  r.innerHTML = `<input type="text" placeholder="Label" value="${esc(l)}"><input type="url" placeholder="https://..." value="${esc(u)}"><button type="button" onclick="this.parentElement.remove()">✕</button>`;
  c.appendChild(r);
}
function clearNodeForm() {
  ["f_id_orig", "f_id", "f_name", "f_icon", "f_type", "f_description", "f_tags"].forEach(id => document.getElementById(id).value = '');
  document.getElementById("f_details").innerHTML = ''; document.getElementById("f_links").innerHTML = '';
}

function openAddNode(catId) {
  clearNodeForm(); populateCatSel();
  if (catId) document.getElementById("f_category").value = catId;
  document.getElementById("dlgNodeTitle").textContent = "Ajouter un service";
  document.getElementById("btn-delete-node").style.display = 'none';
  dlgNode.showModal();
}

function openEditNode(nid) {
  const n = S.nodes.find(x => x.id === nid); if (!n) return;
  clearNodeForm(); populateCatSel();
  document.getElementById("f_id_orig").value = n.id; document.getElementById("f_id").value = n.id;
  document.getElementById("f_name").value = n.name; document.getElementById("f_category").value = n.category;
  document.getElementById("f_icon").value = n.icon || ''; document.getElementById("f_type").value = n.type || '';
  document.getElementById("f_description").value = n.description || '';
  document.getElementById("f_tags").value = (n.tags || []).join(', ');
  Object.entries(n.details || {}).forEach(([k, v]) => addDetailRow(k, v));
  (n.links || []).forEach(l => addLinkRow(l.label, l.url));
  document.getElementById("dlgNodeTitle").textContent = `Modifier : ${n.name}`;
  document.getElementById("btn-delete-node").style.display = '';
  dlgNode.showModal();
}

function saveNode() {
  const orig = document.getElementById("f_id_orig").value;
  const name = document.getElementById("f_name").value.trim();
  if (!name) { toast("Nom requis"); return; }
  let id = document.getElementById("f_id").value.trim();
  if (!id) id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const details = {}, links = [];
  document.querySelectorAll("#f_details .repeater-row").forEach(r => { const i = r.querySelectorAll("input"), k = i[0].value.trim(), v = i[1].value.trim(); if (k) details[k] = v; });
  document.querySelectorAll("#f_links .repeater-row").forEach(r => { const i = r.querySelectorAll("input"), l = i[0].value.trim(), u = i[1].value.trim(); if (l && u) links.push({ label: l, url: u }); });
  const nd = { id, name, category: document.getElementById("f_category").value, icon: document.getElementById("f_icon").value.trim() || '📦', type: document.getElementById("f_type").value.trim(), description: document.getElementById("f_description").value.trim(), tags: document.getElementById("f_tags").value.split(',').map(t => t.trim()).filter(Boolean), details, links };
  if (orig) { const i = S.nodes.findIndex(n => n.id === orig); if (i >= 0) S.nodes[i] = nd; } else S.nodes.push(nd);
  saveState(); dlgNode.close(); render(); toast(orig ? `${name} mis à jour` : `${name} ajouté`);
}

async function deleteNodeFromDialog() {
  const orig = document.getElementById("f_id_orig").value;
  const n = S.nodes.find(x => x.id === orig); if (!n) return;
  dlgNode.close();
  const ok = await customConfirm(`Supprimer "${n.name}" ?`, 'Supprimer');
  if (!ok) return;
  S.nodes = S.nodes.filter(x => x.id !== orig);
  saveState(); render(); toast(`${n.name} supprimé`);
}

/* ═══ CATEGORY CRUD ═══ */
function openAddCat() {
  document.getElementById("fc_id_orig").value = ''; document.getElementById("fc_id").value = '';
  document.getElementById("fc_label").value = ''; document.getElementById("fc_icon").value = '';
  document.getElementById("fc_color").value = '#3b82f6'; document.getElementById("fc_del_btn").style.display = 'none';
  document.getElementById("dlgCatTitle").textContent = "Ajouter une catégorie"; dlgCat.showModal();
}
function openEditCat(cid) {
  const c = S.categories.find(x => x.id === cid); if (!c) return;
  document.getElementById("fc_id_orig").value = c.id; document.getElementById("fc_id").value = c.id;
  document.getElementById("fc_label").value = c.label; document.getElementById("fc_icon").value = c.icon;
  document.getElementById("fc_color").value = c.color; document.getElementById("fc_del_btn").style.display = '';
  document.getElementById("dlgCatTitle").textContent = `Modifier : ${c.label}`; dlgCat.showModal();
}
function saveCat() {
  const orig = document.getElementById("fc_id_orig").value; const label = document.getElementById("fc_label").value.trim();
  if (!label) { toast("Nom requis"); return; }
  let id = document.getElementById("fc_id").value.trim(); if (!id) id = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const cd = { id, label, icon: document.getElementById("fc_icon").value.trim() || '📁', color: document.getElementById("fc_color").value };
  if (orig) { const i = S.categories.findIndex(c => c.id === orig); if (i >= 0) { S.categories[i] = cd; if (orig !== id) S.nodes.forEach(n => { if (n.category === orig) n.category = id; }); } } else S.categories.push(cd);
  saveState(); dlgCat.close(); render(); toast(orig ? `${label} mis à jour` : `${label} ajoutée`);
}
async function deleteCat() {
  const orig = document.getElementById("fc_id_orig").value; const cat = S.categories.find(c => c.id === orig);
  if (!cat) return; dlgCat.close();
  const ok = await customConfirm(`Supprimer "${cat.label}" ?`, 'Supprimer');
  if (!ok) return; S.categories = S.categories.filter(c => c.id !== orig);
  saveState(); render(); toast(`${cat.label} supprimée`);
}

/* ═══ DASHBOARD CONNECTIONS ═══ */
function openAddConn() {
  document.getElementById("fco_idx").value = ''; document.getElementById("fco_route").value = '';
  document.getElementById("fco_desc").value = ''; document.getElementById("dlgConnTitle").textContent = "Ajouter une connexion"; dlgConn.showModal();
}
function openEditConn(i) {
  const c = S.connections[i]; if (c == null) return; const p = c.split(" · ");
  document.getElementById("fco_idx").value = i; document.getElementById("fco_route").value = p[0] || '';
  document.getElementById("fco_desc").value = p[1] || ''; document.getElementById("dlgConnTitle").textContent = "Modifier"; dlgConn.showModal();
}
function saveConn() {
  const idx = document.getElementById("fco_idx").value; const route = document.getElementById("fco_route").value.trim();
  if (!route) { toast("Route requise"); return; }
  const desc = document.getElementById("fco_desc").value.trim(); const line = desc ? `${route} · ${desc}` : route;
  if (idx !== '') S.connections[parseInt(idx)] = line; else S.connections.push(line);
  saveState(); dlgConn.close(); render(); toast("Connexion enregistrée");
}
async function deleteConn(i) {
  const ok = await customConfirm("Supprimer cette connexion ?", "Supprimer");
  if (!ok) return; S.connections.splice(i, 1); saveState(); render(); toast("Supprimée");
}

/* ═══ IMPORT / EXPORT ═══ */
function exportJSON() {
  const d = { categories: S.categories, nodes: S.nodes, connections: S.connections, alerts: S.alerts, conceptionConfigs: S.conceptionConfigs, lastUpdated: S.lastUpdated, exportedAt: new Date().toISOString() };
  const b = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(b);
  a.download = `infra-${config.title.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); URL.revokeObjectURL(a.href); toast("Exporté");
}
function importJSON(e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = function (ev) {
    try {
      const d = JSON.parse(ev.target.result);
      if (d.categories) S.categories = d.categories; if (d.nodes) S.nodes = d.nodes;
      if (d.connections) S.connections = d.connections; if (d.alerts) S.alerts = d.alerts;
      if (d.conceptionConfigs) S.conceptionConfigs = d.conceptionConfigs;
      if (d.lastUpdated) S.lastUpdated = d.lastUpdated;
      saveState(); render(); toast("Import réussi !");
    } catch (err) { toast("JSON invalide"); }
  };
  r.readAsText(f); e.target.value = '';
}
async function resetData() {
  const ok = await customConfirm("Réinitialiser toutes les données ? Irréversible.", "Réinitialiser");
  if (!ok) return;
  S.categories = structuredClone(DEFAULT_CATEGORIES); S.nodes = structuredClone(DEFAULT_NODES);
  S.connections = [...DEFAULT_CONNECTIONS]; S.alerts = structuredClone(DEFAULT_ALERTS);
  S.conceptionConfigs = []; S.activeConceptionConfig = '';
  S.sandbox = { nodes: [], zones: [], connections: [], positions: {} };
  S.whiteboardViewport = { panX: 220, panY: 0, zoom: 1 };
  S.lastUpdated = new Date().toISOString().slice(0, 10);
  saveState(); render(); toast("Réinitialisé");
}

/* ═══ EXPOSE ═══ */
window.__setView = setView;
window.__openAddNode = openAddNode;
window.__openAddCat = openAddCat;
window.__openEditCat = openEditCat;
window.__openEditNode = openEditNode;
window.__openAddConn = openAddConn;
window.__openEditConn = openEditConn;
window.__deleteConn = deleteConn;
window.__exportJSON = exportJSON;
window.__importJSON = importJSON;
window.__filterCategory = filterCategory;
window.__filterNodes = filterNodes;
window.__toggleCat = toggleCat;
window.__toggleCard = toggleCard;

/* ═══ EVENT LISTENERS ═══ */
document.getElementById("btn-add-detail").addEventListener("click", () => addDetailRow());
document.getElementById("btn-add-link").addEventListener("click", () => addLinkRow());
document.getElementById("btn-save-node").addEventListener("click", saveNode);
document.getElementById("btn-delete-node").addEventListener("click", deleteNodeFromDialog);
document.getElementById("btn-save-cat").addEventListener("click", saveCat);
document.getElementById("fc_del_btn").addEventListener("click", deleteCat);
document.getElementById("btn-save-conn").addEventListener("click", saveConn);
document.getElementById("btn-save-wb-conn").addEventListener("click", () => window.__wbSaveWbConn());
document.getElementById("fwc_del_btn").addEventListener("click", () => window.__wbDeleteWbConn());
document.getElementById("btn-save-wb-zone").addEventListener("click", () => window.__wbSaveWbZone());
document.getElementById("fwz_del_btn").addEventListener("click", () => window.__wbDeleteWbZone());
document.getElementById("btn-save-wb-text").addEventListener("click", () => window.__wbSaveWbText());

[dlgNode, dlgCat, dlgConn,
 document.getElementById("dlgWbConn"), document.getElementById("dlgWbZone"), document.getElementById("dlgWbText"),
 document.getElementById("dlgConfirm"), document.getElementById("dlgPrompt"),
].forEach(d => d.addEventListener("click", e => { if (e.target === d) d.close(); }));

/* ═══ INIT ═══ */
render();
