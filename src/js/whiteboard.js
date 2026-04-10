/**
 * Whiteboard engine — SVG canvas for infrastructure conception.
 */
import { AUXILIARY_NODES } from './data.js';
import { customConfirm, customPrompt } from './ui.js';

const NODE_W = 180;
const NODE_H = 60;
const MIN_NODE_W = 80;
const MIN_NODE_H = 40;

let viewport = { panX: 0, panY: 0, zoom: 1 };
let isPanning = false;
let panStart = { x: 0, y: 0 };
let selectedIds = new Set();
let svgEl = null;
let worldGroup = null;
let isFullscreen = false;
let spaceHeld = false; // space = camera-only mode
let linkDrag = { active: false, fromId: null, line: null, dropHandlers: [] };
let rectSel = { active: false, startX: 0, startY: 0, rect: null };
let handleDrag = { active: false, connId: null, handle: null, el: null }; // handle: 'cp1'|'cp2'|'fromAnchor'|'toAnchor'
let selectedConnId = null;

let stateRef = null;
let saveStateRef = null;
let toastRef = null;
let panelCollapsed = { services: false, aux: false, shapes: false, bg: true };
let serviceFilter = 'all';
let sidePanelVisible = true;
let configBarVisible = true;

export function initWhiteboard(state, saveFn, toastFn) {
  stateRef = state; saveStateRef = saveFn; toastRef = toastFn;
}

function getBoard() {
  const S = stateRef; const activeId = S.activeConceptionConfig;
  if (activeId) { const cfg = (S.conceptionConfigs || []).find(c => c.id === activeId); if (cfg) return cfg; }
  if (!S.sandbox) S.sandbox = { nodes: [], zones: [], connections: [], positions: {} };
  return S.sandbox;
}

/* ═══ UNDO / REDO ═══ */
const MAX_HISTORY = 50;
let undoStack = [];
let redoStack = [];

function snapshotBoard() {
  const b = getBoard();
  return JSON.stringify({ nodes: b.nodes, zones: b.zones, connections: b.connections, positions: b.positions });
}

function pushUndo() {
  const snap = snapshotBoard();
  if (undoStack.length && undoStack[undoStack.length - 1] === snap) return; // no change
  undoStack.push(snap);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
}

function applySnapshot(json) {
  const data = JSON.parse(json);
  const b = getBoard();
  b.nodes = data.nodes; b.zones = data.zones; b.connections = data.connections; b.positions = data.positions;
  saveStateRef();
  renderZones(); renderBoardNodes(); renderConnections(); renderSidePanel();
}

function undo() {
  if (!undoStack.length) { toastRef("Rien à annuler"); return; }
  redoStack.push(snapshotBoard());
  const snap = undoStack.pop();
  applySnapshot(snap);
  toastRef("Annulé");
}

function redo() {
  if (!redoStack.length) { toastRef("Rien à rétablir"); return; }
  undoStack.push(snapshotBoard());
  const snap = redoStack.pop();
  applySnapshot(snap);
  toastRef("Rétabli");
}

function save() { pushUndo(); saveStateRef(); }

/* ═══ BACKGROUND ═══ */
const GRID_TYPES = {
  dots:  { label: 'Points',  build: (sz, w, c) => `<circle cx="${sz/2}" cy="${sz/2}" r="${w}" fill="${c}"/>` },
  lines: { label: 'Lignes',  build: (sz, w, c) => `<line x1="0" y1="${sz}" x2="${sz}" y2="${sz}" stroke="${c}" stroke-width="${w}"/>` },
  grid:  { label: 'Grille',  build: (sz, w, c) => `<line x1="${sz}" y1="0" x2="${sz}" y2="${sz}" stroke="${c}" stroke-width="${w}"/><line x1="0" y1="${sz}" x2="${sz}" y2="${sz}" stroke="${c}" stroke-width="${w}"/>` },
  cross: { label: 'Croix',   build: (sz, w, c) => `<line x1="${sz/2-2}" y1="${sz/2}" x2="${sz/2+2}" y2="${sz/2}" stroke="${c}" stroke-width="${w}"/><line x1="${sz/2}" y1="${sz/2-2}" x2="${sz/2}" y2="${sz/2+2}" stroke="${c}" stroke-width="${w}"/>` },
  none:  { label: 'Aucun',   build: () => '' },
};

const WB_DEFAULTS = { bgColor: '', gradientOn: false, gradColor1: '#0b1120', gradColor2: '#1a1040', gradType: 'linear', gradAngle: 135, gridType: 'dots', gridSize: 30, gridWidth: 1, gridColor: '#ffffff', gridOpacity: 0.06, fontScale: 1, nodeStroke: 1.5, connStroke: 1.5, connOpacity: 0.5 };

function getWbSettings() {
  const board = getBoard();
  if (!board.wbSettings) board.wbSettings = { ...WB_DEFAULTS };
  // migrate old settings
  const s = board.wbSettings;
  if (s.gridPattern && !s.gridType) { s.gridType = s.gridPattern; delete s.gridPattern; }
  if (!('gridSize' in s) || typeof s.gridSize === 'string') s.gridSize = WB_DEFAULTS.gridSize;
  if (!('gridWidth' in s)) s.gridWidth = WB_DEFAULTS.gridWidth;
  if (!('gridColor' in s)) s.gridColor = WB_DEFAULTS.gridColor;
  if (!('gridOpacity' in s)) s.gridOpacity = WB_DEFAULTS.gridOpacity;
  if (!('gradientOn' in s)) { s.gradientOn = !!s.bgGradient; s.gradColor1 = WB_DEFAULTS.gradColor1; s.gradColor2 = WB_DEFAULTS.gradColor2; s.gradType = WB_DEFAULTS.gradType; s.gradAngle = WB_DEFAULTS.gradAngle; delete s.bgGradient; }
  if (!('fontScale' in s)) s.fontScale = WB_DEFAULTS.fontScale;
  if (!('nodeStroke' in s)) s.nodeStroke = WB_DEFAULTS.nodeStroke;
  if (!('connStroke' in s)) s.connStroke = WB_DEFAULTS.connStroke;
  if (!('connOpacity' in s)) s.connOpacity = WB_DEFAULTS.connOpacity;
  return s;
}

function buildGridPattern() {
  const s = getWbSettings();
  const gt = GRID_TYPES[s.gridType] || GRID_TYPES.dots;
  const sz = s.gridSize || 30;
  const w = s.gridWidth || 1;
  const hex = s.gridColor || '#ffffff';
  const op = s.gridOpacity ?? 0.06;
  // Convert hex + opacity to rgba
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  const c = `rgba(${r},${g},${b},${op})`;
  return `<pattern id="grid-pattern" width="${sz}" height="${sz}" patternUnits="userSpaceOnUse">${gt.build(sz, w, c)}</pattern>`;
}

function buildBgDefs() {
  const s = getWbSettings();
  let defs = '';
  if (s.gradientOn) {
    const a = (s.gradAngle || 0) * Math.PI / 180;
    if (s.gradType === 'radial') {
      defs += `<radialGradient id="wb-bg-grad" cx="50%" cy="50%" r="70%"><stop offset="0%" stop-color="${s.gradColor1}"/><stop offset="100%" stop-color="${s.gradColor2}"/></radialGradient>`;
    } else {
      const x2 = Math.round(Math.cos(a) * 50 + 50), y2 = Math.round(Math.sin(a) * 50 + 50);
      const x1 = 100 - x2, y1 = 100 - y2;
      defs += `<linearGradient id="wb-bg-grad" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%"><stop offset="0%" stop-color="${s.gradColor1}"/><stop offset="100%" stop-color="${s.gradColor2}"/></linearGradient>`;
    }
  }
  return defs;
}

function buildBgRect() {
  const s = getWbSettings();
  if (s.gradientOn) return `<rect width="10000" height="10000" x="-5000" y="-5000" fill="url(#wb-bg-grad)"/>`;
  if (s.bgColor) return `<rect width="10000" height="10000" x="-5000" y="-5000" fill="${s.bgColor}"/>`;
  return '';
}

/* ═══ RENDER ═══ */
export function renderWhiteboard(app) {
  viewport = stateRef.whiteboardViewport || { panX: 0, panY: 0, zoom: 1 };
  const spClass = sidePanelVisible ? '' : 'wb-panel-hidden';
  const wbs = getWbSettings();
  app.innerHTML = `
    <div class="wb-container ${isFullscreen ? 'wb-fullscreen' : ''} ${spClass}" id="wb-container"
         style="--wb-fs:${wbs.fontScale};--wb-node-stroke:${wbs.nodeStroke};--wb-conn-stroke:${wbs.connStroke};--wb-conn-opacity:${wbs.connOpacity}">
      <div class="wb-config-bar" id="wb-config-bar"></div>
      <button class="wb-toggle-bar" onclick="window.__wbToggleConfigBar()" id="wb-toggle-bar" title="Menu">${configBarVisible ? '✕' : '☰'}</button>
      <div class="wb-zoom-info" id="wb-zoom-info">${Math.round(viewport.zoom * 100)}%</div>
      <div class="wb-hint" id="wb-hint">Shift+drag : sélection · Clic droit : lien · Espace : vue · Suppr : supprimer · Ctrl+Z/Y : annuler/rétablir · Ctrl+S : sauver</div>
      <div class="wb-side-panel ${sidePanelVisible ? '' : 'hidden'}" id="wb-side-panel"></div>
      <svg id="wb-canvas" class="wb-canvas" xmlns="http://www.w3.org/2000/svg">
        <defs>${buildMarkerDefs()}
          ${buildGridPattern()}
          ${buildBgDefs()}
        </defs>
        <g id="wb-world">
          ${buildBgRect()}
          <rect width="10000" height="10000" x="-5000" y="-5000" fill="url(#grid-pattern)" />
          <g id="wb-zones"></g><g id="wb-connections"></g><g id="wb-nodes"></g><g id="wb-overlay"></g>
        </g>
      </svg>
    </div>`;
  svgEl = document.getElementById("wb-canvas"); worldGroup = document.getElementById("wb-world");
  applyViewport(); renderSidePanel(); renderConceptionBar(); renderZones(); renderBoardNodes(); renderConnections();
  initPanZoom(); initCanvasEvents(); initKeyboard();
}

function buildMarkerDefs() {
  return `
    <marker id="m-arrow-end" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto" markerUnits="strokeWidth"><polygon points="0 0,10 3.5,0 7" fill="var(--accent-blue)" opacity="0.7"/></marker>
    <marker id="m-arrow-start" markerWidth="10" markerHeight="7" refX="1" refY="3.5" orient="auto" markerUnits="strokeWidth"><polygon points="10 0,0 3.5,10 7" fill="var(--accent-blue)" opacity="0.7"/></marker>
    <marker id="m-circle-end" markerWidth="8" markerHeight="8" refX="5" refY="4" orient="auto" markerUnits="strokeWidth"><circle cx="4" cy="4" r="3" fill="none" stroke="var(--accent-blue)" stroke-width="1.5" opacity="0.7"/></marker>
    <marker id="m-circle-start" markerWidth="8" markerHeight="8" refX="3" refY="4" orient="auto" markerUnits="strokeWidth"><circle cx="4" cy="4" r="3" fill="none" stroke="var(--accent-blue)" stroke-width="1.5" opacity="0.7"/></marker>
    <marker id="m-diamond-end" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth"><polygon points="0 5,5 0,10 5,5 10" fill="var(--accent-blue)" opacity="0.7"/></marker>
    <marker id="m-diamond-start" markerWidth="10" markerHeight="10" refX="2" refY="5" orient="auto" markerUnits="strokeWidth"><polygon points="0 5,5 0,10 5,5 10" fill="var(--accent-blue)" opacity="0.7"/></marker>`;
}

/* ═══ SIDE PANEL ═══ */
const CATEGORY_FILTERS = [
  { id: 'all', label: 'Tout' }, { id: 'cloud', label: 'Cloud' }, { id: 'network', label: 'Réseau' },
  { id: 'tunnels', label: 'Tunnels' }, { id: 'access', label: 'Access' }, { id: 'apps', label: 'Apps' },
  { id: 'automation', label: 'Auto.' }, { id: 'workspace', label: 'Workspace' },
  { id: 'monitoring', label: 'Monitoring' }, { id: 'dev', label: 'Dev' }, { id: 'external', label: 'Externe' },
];

function renderSidePanel() {
  const S = stateRef; const board = getBoard();
  const onBoard = new Set((board.nodes || []).map(n => n.sourceId || n.wbId));
  const panel = document.getElementById("wb-side-panel"); if (!panel) return;
  const filtered = serviceFilter === 'all' ? S.nodes : S.nodes.filter(n => n.category === serviceFilter);
  const wbs = getWbSettings();
  panel.innerHTML = `
    <div class="wb-panel-header">Ajouter au canvas</div>
    <div class="wb-panel-section">
      <div class="wb-panel-title wb-collapsible" onclick="window.__wbTogglePanel('services')"><span class="wb-collapse-arrow ${panelCollapsed.services ? 'collapsed' : ''}">▼</span> Services</div>
      ${panelCollapsed.services ? '' : `<div class="wb-panel-filters">${CATEGORY_FILTERS.map(f => `<button class="wb-filter-chip ${serviceFilter === f.id ? 'active' : ''}" onclick="window.__wbSetServiceFilter('${f.id}')">${f.label}</button>`).join('')}</div>
        <div class="wb-panel-list">${filtered.map(n => { const on = onBoard.has(n.id); return `<button class="wb-panel-item ${on ? 'on-board' : ''}" onclick="window.__wbAddServiceNode('${n.id}')" ${on ? 'disabled' : ''}><span class="wb-panel-item-icon">${n.icon}</span><span class="wb-panel-item-name">${n.name}</span></button>`; }).join('')}</div>`}
    </div>
    <div class="wb-panel-section">
      <div class="wb-panel-title wb-collapsible" onclick="window.__wbTogglePanel('aux')"><span class="wb-collapse-arrow ${panelCollapsed.aux ? 'collapsed' : ''}">▼</span> Auxiliaires</div>
      ${panelCollapsed.aux ? '' : `<div class="wb-panel-list">${AUXILIARY_NODES.map(a => `<button class="wb-panel-item" onclick="window.__wbAddAuxNode('${a.id}')"><span class="wb-panel-item-icon">${a.icon}</span><span class="wb-panel-item-name">${a.name}</span></button>`).join('')}</div>`}
    </div>
    <div class="wb-panel-section">
      <div class="wb-panel-title wb-collapsible" onclick="window.__wbTogglePanel('shapes')"><span class="wb-collapse-arrow ${panelCollapsed.shapes ? 'collapsed' : ''}">▼</span> Formes & Liens</div>
      ${panelCollapsed.shapes ? '' : `<div class="wb-panel-list">
        <button class="wb-panel-item" onclick="window.__wbAddZone()"><span class="wb-panel-item-icon">▢</span><span class="wb-panel-item-name">Zone / Groupe</span></button>
        <button class="wb-panel-item" onclick="window.__wbAddConn()"><span class="wb-panel-item-icon">🔗</span><span class="wb-panel-item-name">Connexion (dialog)</span></button>
        <button class="wb-panel-item" onclick="window.__wbAddAuxNode('aux_text')"><span class="wb-panel-item-icon">📝</span><span class="wb-panel-item-name">Note / Texte</span></button>
      </div>`}
    </div>
    <div class="wb-panel-section wb-panel-bg-section">
      <div class="wb-panel-title wb-collapsible" onclick="window.__wbTogglePanel('bg')"><span class="wb-collapse-arrow ${panelCollapsed.bg ? 'collapsed' : ''}">▼</span> Fond & Grille</div>
      ${panelCollapsed.bg ? '' : `<div class="wb-panel-bg-options">
        <label>Couleur de fond</label>
        <div class="wb-bg-row">
          <input type="color" value="${wbs.bgColor || '#080e1a'}" onchange="window.__wbSetBg('bgColor', this.value)" class="wb-bg-color-input">
          <button class="wb-bg-reset" onclick="window.__wbSetBg('bgColor', '')" title="Par défaut">↺</button>
        </div>

        <label><input type="checkbox" ${wbs.gradientOn ? 'checked' : ''} onchange="window.__wbSetBg('gradientOn', this.checked)"> Dégradé</label>
        ${wbs.gradientOn ? `
          <div class="wb-bg-row">
            <input type="color" value="${wbs.gradColor1 || '#0b1120'}" onchange="window.__wbSetBg('gradColor1', this.value)" class="wb-bg-color-input" title="Couleur 1">
            <span class="wb-bg-arrow">→</span>
            <input type="color" value="${wbs.gradColor2 || '#1a1040'}" onchange="window.__wbSetBg('gradColor2', this.value)" class="wb-bg-color-input" title="Couleur 2">
          </div>
          <div class="wb-bg-row">
            <select onchange="window.__wbSetBg('gradType', this.value)" style="flex:1">
              <option value="linear" ${wbs.gradType === 'linear' ? 'selected' : ''}>Linéaire</option>
              <option value="radial" ${wbs.gradType === 'radial' ? 'selected' : ''}>Radial</option>
            </select>
            ${wbs.gradType === 'linear' ? `<input type="range" min="0" max="360" value="${wbs.gradAngle || 135}" onchange="window.__wbSetBg('gradAngle', +this.value)" title="Angle ${wbs.gradAngle || 135}°" style="flex:1">` : ''}
          </div>
        ` : ''}

        <label>Motif</label>
        <select onchange="window.__wbSetBg('gridType', this.value)">
          ${Object.entries(GRID_TYPES).map(([k, v]) => `<option value="${k}" ${wbs.gridType === k ? 'selected' : ''}>${v.label}</option>`).join('')}
        </select>
        ${wbs.gridType !== 'none' ? `
          <label>Taille <span class="wb-val">${wbs.gridSize}</span>px</label>
          <input type="range" min="8" max="100" value="${wbs.gridSize}" oninput="window.__wbSetBgLive('gridSize', +this.value, this)">
          <label>Épaisseur <span class="wb-val">${wbs.gridWidth}</span></label>
          <input type="range" min="0.2" max="4" step="0.1" value="${wbs.gridWidth}" oninput="window.__wbSetBgLive('gridWidth', +this.value, this)">
          <label>Couleur & opacité</label>
          <div class="wb-bg-row">
            <input type="color" value="${wbs.gridColor || '#ffffff'}" onchange="window.__wbSetBg('gridColor', this.value)" class="wb-bg-color-input">
            <input type="range" min="0.01" max="0.3" step="0.01" value="${wbs.gridOpacity}" oninput="window.__wbSetBgLive('gridOpacity', +this.value, this)" style="flex:1">
          </div>
        ` : ''}
      </div>`}
    </div>`;
}
function togglePanel(s) { panelCollapsed[s] = !panelCollapsed[s]; renderSidePanel(); }
function setServiceFilter(f) { serviceFilter = f; renderSidePanel(); }
function toggleSidePanel() { sidePanelVisible = !sidePanelVisible; const wa = document.getElementById("wb-app"); if (wa) renderWhiteboard(wa); }
function toggleConfigBar() {
  configBarVisible = !configBarVisible;
  const bar = document.getElementById("wb-config-bar");
  const btn = document.getElementById("wb-toggle-bar");
  if (bar) bar.classList.toggle('hidden', !configBarVisible);
  if (btn) btn.textContent = configBarVisible ? '✕' : '☰';
  if (configBarVisible) renderConceptionBar();
}

function setWbBg(key, val) { const s = getWbSettings(); s[key] = val; save(); const wa = document.getElementById("wb-app"); if (wa) renderWhiteboard(wa); }
function setWbBgLive(key, val, el) {
  // Update value without full re-render (for sliders)
  const s = getWbSettings(); s[key] = val;
  // Update the label showing the value
  const label = el.previousElementSibling;
  if (label) { const sp = label.querySelector('.wb-val'); if (sp) sp.textContent = val; }
  // Rebuild SVG grid pattern in-place
  const defs = svgEl?.querySelector('defs');
  if (defs) {
    const old = defs.querySelector('#grid-pattern');
    if (old) old.remove();
    const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    tmp.innerHTML = buildGridPattern();
    const pat = tmp.firstElementChild;
    if (pat) defs.appendChild(pat);
  }
  save();
}

function setWbStyle(key, val, el) {
  const s = getWbSettings(); s[key] = val;
  // Update label
  const label = el.previousElementSibling;
  if (label) {
    const sp = label.querySelector('.wb-val');
    if (sp) {
      if (key === 'fontScale' || key === 'connOpacity') sp.textContent = Math.round(val * 100) + '%';
      else sp.textContent = val;
    }
  }
  // Apply CSS custom properties live
  const c = document.getElementById("wb-container");
  if (c) {
    c.style.setProperty('--wb-fs', s.fontScale);
    c.style.setProperty('--wb-node-stroke', s.nodeStroke);
    c.style.setProperty('--wb-conn-stroke', s.connStroke);
    c.style.setProperty('--wb-conn-opacity', s.connOpacity);
  }
  save();
}

function resetWbStyle() {
  const s = getWbSettings();
  s.fontScale = WB_DEFAULTS.fontScale; s.nodeStroke = WB_DEFAULTS.nodeStroke;
  s.connStroke = WB_DEFAULTS.connStroke; s.connOpacity = WB_DEFAULTS.connOpacity;
  save(); const wa = document.getElementById("wb-app"); if (wa) renderWhiteboard(wa);
  toastRef("Style réinitialisé");
}

/* ═══ VIEW CENTER ═══ */
function panelWidth() { return sidePanelVisible ? 210 : 0; }
function getViewCenter() {
  const pw = panelWidth();
  const c = document.getElementById("wb-container"), cw = c ? c.clientWidth - pw : 800, ch = c ? c.clientHeight : 600;
  return { x: (-viewport.panX + pw + cw / 2) / viewport.zoom, y: (-viewport.panY + ch / 2) / viewport.zoom };
}

/* ═══ NODE SIZE ═══ */
function getNodeSize(node) {
  if (node.width && node.height) return { w: node.width, h: node.height };
  if (node.nodeType === 'user') return { w: 60, h: 60 };
  if (node.nodeType === 'cloud') return { w: NODE_W, h: 60 };
  if (node.nodeType === 'text') {
    const lines = (node.text || node.name || '').split('\n');
    return { w: Math.max(120, Math.min(250, Math.max(...lines.map(l => l.length)) * 7 + 20)), h: Math.max(40, lines.length * 16 + 16) };
  }
  return { w: node.width || NODE_W, h: node.height || NODE_H };
}

/* ═══ ADD NODES ═══ */
function addServiceNode(sourceId) {
  const S = stateRef; const board = getBoard();
  if (!board.nodes) board.nodes = []; if (!board.positions) board.positions = {};
  if (board.nodes.some(n => n.sourceId === sourceId)) { toastRef("Déjà sur le canvas"); return; }
  const source = S.nodes.find(n => n.id === sourceId); if (!source) return;
  const cat = S.categories.find(c => c.id === source.category) || { color: "#64748b" };
  const wbId = "wb_" + sourceId;
  board.nodes.push({ wbId, sourceId, nodeType: source.nodeType || "service", name: source.name, icon: source.icon, type: source.type || '', color: cat.color, width: NODE_W, height: NODE_H });
  const ctr = getViewCenter(); board.positions[wbId] = { x: ctr.x + Math.random() * 60 - 30 - NODE_W / 2, y: ctr.y + Math.random() * 60 - 30 - NODE_H / 2 };
  save(); renderBoardNodes(); renderConnections(); renderSidePanel(); toastRef(`${source.name} ajouté`);
}
function addAuxNode(auxId) {
  const board = getBoard(); if (!board.nodes) board.nodes = []; if (!board.positions) board.positions = {};
  const tpl = AUXILIARY_NODES.find(a => a.id === auxId); if (!tpl) return;
  const wbId = "wb_" + auxId + "_" + Date.now();
  const nd = { wbId, nodeType: tpl.nodeType, name: tpl.name, icon: tpl.icon, color: tpl.color };
  if (tpl.nodeType === "text") { document.getElementById("fwt_id").value = wbId; document.getElementById("fwt_text").value = ''; document.getElementById("dlgWbText").showModal(); board._pendingTextNode = nd; return; }
  board.nodes.push(nd); const ctr = getViewCenter(); board.positions[wbId] = { x: ctr.x + Math.random() * 60 - 30, y: ctr.y + Math.random() * 60 - 30 };
  save(); renderBoardNodes(); renderConnections(); toastRef(`${tpl.name} ajouté`);
}
function saveWbText() {
  const board = getBoard(); const wbId = document.getElementById("fwt_id").value; const text = document.getElementById("fwt_text").value.trim();
  if (!text) { toastRef("Texte requis"); return; }
  const existing = (board.nodes || []).find(n => n.wbId === wbId);
  if (existing) { existing.text = text; existing.name = text.slice(0, 30); }
  else if (board._pendingTextNode) { const nd = board._pendingTextNode; delete board._pendingTextNode; nd.text = text; nd.name = text.slice(0, 30); board.nodes.push(nd); const c = getViewCenter(); board.positions[nd.wbId] = { x: c.x, y: c.y }; }
  document.getElementById("dlgWbText").close(); save(); renderBoardNodes(); renderConnections(); toastRef("Note enregistrée");
}
async function removeNodeFromBoard(wbId) {
  const board = getBoard(); const node = (board.nodes || []).find(n => n.wbId === wbId); if (!node) return;
  const ok = await customConfirm(`Retirer "${node.name}" ?`, 'Retirer');
  if (!ok) return; board.nodes = board.nodes.filter(n => n.wbId !== wbId); delete board.positions[wbId];
  board.connections = (board.connections || []).filter(c => c.from !== wbId && c.to !== wbId);
  selectedIds.delete(wbId); save(); renderBoardNodes(); renderConnections(); renderSidePanel(); toastRef(`${node.name} retiré`);
}
async function removeSelected() {
  if (!selectedIds.size) return;
  const ok = await customConfirm(`Supprimer ${selectedIds.size} élément(s) ?`, 'Supprimer');
  if (!ok) return; const board = getBoard();
  for (const wbId of selectedIds) { board.nodes = (board.nodes || []).filter(n => n.wbId !== wbId); delete (board.positions || {})[wbId]; board.connections = (board.connections || []).filter(c => c.from !== wbId && c.to !== wbId); }
  selectedIds.clear(); save(); renderBoardNodes(); renderConnections(); renderSidePanel(); toastRef("Supprimé");
}
async function resetBoard() {
  const ok = await customConfirm("Vider le canvas ? Tout sera supprimé.", "Vider");
  if (!ok) return; const board = getBoard(); board.nodes = []; board.zones = []; board.connections = []; board.positions = {};
  selectedIds.clear(); save(); renderZones(); renderBoardNodes(); renderConnections(); renderSidePanel(); toastRef("Canvas vidé");
}

/* ═══ ZONES ═══ */
function addZone() { document.getElementById("fwz_id").value = ''; document.getElementById("fwz_label").value = ''; document.getElementById("fwz_color").value = '#3b82f6'; document.getElementById("fwz_del_btn").style.display = 'none'; document.getElementById("dlgWbZoneTitle").textContent = "Ajouter une zone"; document.getElementById("dlgWbZone").showModal(); }
function editZone(zoneId) { const z = (getBoard().zones || []).find(z => z.id === zoneId); if (!z) return; document.getElementById("fwz_id").value = z.id; document.getElementById("fwz_label").value = z.label; document.getElementById("fwz_color").value = z.color; document.getElementById("fwz_del_btn").style.display = ''; document.getElementById("dlgWbZoneTitle").textContent = "Modifier la zone"; document.getElementById("dlgWbZone").showModal(); }
function saveWbZone() { const board = getBoard(); if (!board.zones) board.zones = []; const id = document.getElementById("fwz_id").value; const label = document.getElementById("fwz_label").value.trim(); if (!label) { toastRef("Nom requis"); return; } const color = document.getElementById("fwz_color").value; if (id) { const z = board.zones.find(z => z.id === id); if (z) { z.label = label; z.color = color; } } else { const c = getViewCenter(); board.zones.push({ id: "zone_" + Date.now(), label, color, x: c.x - 175, y: c.y - 125, width: 350, height: 250 }); } document.getElementById("dlgWbZone").close(); save(); renderZones(); toastRef(id ? "Zone modifiée" : "Zone ajoutée"); }
async function deleteWbZone() { const board = getBoard(); const id = document.getElementById("fwz_id").value; const z = (board.zones || []).find(z => z.id === id); if (!z) return; document.getElementById("dlgWbZone").close(); const ok = await customConfirm(`Supprimer "${z.label}" ?`, 'Supprimer'); if (!ok) return; board.zones = board.zones.filter(z => z.id !== id); save(); renderZones(); toastRef("Zone supprimée"); }
async function removeZone(zoneId) { const board = getBoard(); const z = (board.zones || []).find(z => z.id === zoneId); if (!z) return; const ok = await customConfirm(`Supprimer "${z.label}" ?`, 'Supprimer'); if (!ok) return; board.zones = board.zones.filter(z => z.id !== zoneId); save(); renderZones(); toastRef("Zone supprimée"); }

/* ═══ CONNECTIONS ═══ */
function addConn(preFrom, preTo) {
  const board = getBoard(); if (!board.nodes || board.nodes.length < 2) { toastRef("Ajoutez au moins 2 éléments"); return; }
  const dlg = document.getElementById("dlgWbConn");
  document.getElementById("fwc_id").value = ''; document.getElementById("fwc_label").value = '';
  document.getElementById("fwc_from_label").value = ''; document.getElementById("fwc_to_label").value = '';
  document.getElementById("fwc_style").value = 'solid'; document.getElementById("fwc_routing").value = 'straight';
  document.getElementById("fwc_start_marker").value = 'none'; document.getElementById("fwc_end_marker").value = 'arrow';
  document.getElementById("fwc_del_btn").style.display = 'none';
  document.getElementById("dlgWbConnTitle").textContent = "Ajouter une connexion"; populateConnSelects();
  if (preFrom) document.getElementById("fwc_from").value = preFrom;
  if (preTo) document.getElementById("fwc_to").value = preTo;
  dlg.showModal();
}
function createLinkDirect(fromId, toId) {
  // Create link immediately without popup
  const board = getBoard(); if (!board.connections) board.connections = [];
  board.connections.push({ id: "conn_" + Date.now(), from: fromId, to: toId, label: '', fromLabel: '', toLabel: '', style: 'solid', routing: 'straight', startMarker: 'none', endMarker: 'arrow' });
  save(); renderConnections(); toastRef("Lien créé (double-clic pour éditer)");
}
function editConn(connId) {
  const conn = (getBoard().connections || []).find(c => c.id === connId); if (!conn) return;
  const dlg = document.getElementById("dlgWbConn"); populateConnSelects();
  document.getElementById("fwc_id").value = conn.id; document.getElementById("fwc_from").value = conn.from;
  document.getElementById("fwc_to").value = conn.to; document.getElementById("fwc_label").value = conn.label || '';
  document.getElementById("fwc_from_label").value = conn.fromLabel || ''; document.getElementById("fwc_to_label").value = conn.toLabel || '';
  document.getElementById("fwc_style").value = conn.style || 'solid'; document.getElementById("fwc_routing").value = conn.routing || 'straight';
  document.getElementById("fwc_start_marker").value = conn.startMarker || 'none'; document.getElementById("fwc_end_marker").value = conn.endMarker || 'arrow';
  document.getElementById("fwc_del_btn").style.display = ''; document.getElementById("dlgWbConnTitle").textContent = "Modifier la connexion"; dlg.showModal();
}
function populateConnSelects() { const opts = (getBoard().nodes || []).map(n => `<option value="${n.wbId}">${n.icon} ${n.name}</option>`).join(''); document.getElementById("fwc_from").innerHTML = opts; document.getElementById("fwc_to").innerHTML = opts; }
function saveWbConn() {
  const board = getBoard(); if (!board.connections) board.connections = [];
  const id = document.getElementById("fwc_id").value, from = document.getElementById("fwc_from").value, to = document.getElementById("fwc_to").value;
  if (from === to) { toastRef("Source ≠ destination"); return; }
  const cd = { from, to, label: document.getElementById("fwc_label").value.trim(), fromLabel: document.getElementById("fwc_from_label").value.trim(), toLabel: document.getElementById("fwc_to_label").value.trim(), style: document.getElementById("fwc_style").value, routing: document.getElementById("fwc_routing").value, startMarker: document.getElementById("fwc_start_marker").value, endMarker: document.getElementById("fwc_end_marker").value };
  if (id) { const c = board.connections.find(c => c.id === id); if (c) Object.assign(c, cd); } else { cd.id = "conn_" + Date.now(); board.connections.push(cd); }
  document.getElementById("dlgWbConn").close(); save(); renderConnections(); toastRef(id ? "Connexion modifiée" : "Connexion ajoutée");
}
async function deleteWbConn() { const id = document.getElementById("fwc_id").value; if (!id) return; document.getElementById("dlgWbConn").close(); const ok = await customConfirm("Supprimer cette connexion ?", "Supprimer"); if (!ok) return; const board = getBoard(); board.connections = (board.connections || []).filter(c => c.id !== id); if (selectedConnId === id) selectedConnId = null; save(); renderConnections(); toastRef("Connexion supprimée"); }

/* ═══ VIEWPORT ═══ */
function applyViewport() { if (!worldGroup) return; worldGroup.setAttribute("transform", `translate(${viewport.panX},${viewport.panY}) scale(${viewport.zoom})`); const i = document.getElementById("wb-zoom-info"); if (i) i.textContent = `${Math.round(viewport.zoom * 100)}%`; }
function saveVp() { stateRef.whiteboardViewport = { ...viewport }; save(); }
function zoomIn() { viewport.zoom = Math.min(3, viewport.zoom * 1.2); applyViewport(); saveVp(); }
function zoomOut() { viewport.zoom = Math.max(0.15, viewport.zoom / 1.2); applyViewport(); saveVp(); }
function fitAll() {
  const board = getBoard(); const pos = board.positions || {}; const ids = Object.keys(pos);
  if (!ids.length && !(board.zones || []).length) { toastRef("Rien à cadrer"); return; }
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const id of ids) { const p = pos[id]; const nd = (board.nodes || []).find(n => n.wbId === id); const sz = nd ? getNodeSize(nd) : { w: NODE_W, h: NODE_H }; x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x + sz.w); y2 = Math.max(y2, p.y + sz.h); }
  for (const z of (board.zones || [])) { x1 = Math.min(x1, z.x); y1 = Math.min(y1, z.y); x2 = Math.max(x2, z.x + z.width); y2 = Math.max(y2, z.y + z.height); }
  if (x1 === Infinity) return;
  const c = document.getElementById("wb-container"); if (!c) return;
  const pw = panelWidth();
  const cw = c.clientWidth - pw, ch = c.clientHeight, pad = 80;
  const s = Math.min(cw / (x2 - x1 + pad * 2), ch / (y2 - y1 + pad * 2), 2);
  viewport.zoom = s; viewport.panX = (cw / 2 + pw) - (x1 + (x2 - x1) / 2) * s; viewport.panY = (ch / 2) - (y1 + (y2 - y1) / 2) * s;
  applyViewport(); saveVp(); toastRef("Vue ajustée");
}
function resetView() { viewport = { panX: 220, panY: 0, zoom: 1 }; applyViewport(); saveVp(); }
function toggleFullscreen() { isFullscreen = !isFullscreen; const c = document.getElementById("wb-container"); if (c) c.classList.toggle("wb-fullscreen", isFullscreen); const b = document.getElementById("wb-fs-btn"); if (b) b.innerHTML = isFullscreen ? '⬇ Réduire' : '⬆ Plein écran'; }

/* ═══ PAN / ZOOM ═══ */
function initPanZoom() {
  if (!svgEl) return;
  svgEl.addEventListener("pointerdown", (e) => {
    const onBg = e.target === svgEl || (e.target.tagName === 'rect' && !e.target.closest('.wb-node,.wb-zone,.wb-conn-group,.wb-handle'));
    if (!onBg && !spaceHeld) return;
    if (e.shiftKey && !spaceHeld) { startRectSelect(e); return; }
    isPanning = true; panStart = { x: e.clientX - viewport.panX, y: e.clientY - viewport.panY };
    svgEl.classList.add("grabbing"); svgEl.setPointerCapture(e.pointerId);
  });
  svgEl.addEventListener("pointermove", (e) => { if (rectSel.active) { updateRectSelect(e); return; } if (!isPanning) return; viewport.panX = e.clientX - panStart.x; viewport.panY = e.clientY - panStart.y; applyViewport(); });
  svgEl.addEventListener("pointerup", (e) => { if (rectSel.active) { endRectSelect(e); return; } if (isPanning) { isPanning = false; svgEl.classList.remove("grabbing"); svgEl.releasePointerCapture(e.pointerId); saveVp(); } });
  svgEl.addEventListener("wheel", (e) => { e.preventDefault(); const r = svgEl.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; const f = e.deltaY < 0 ? 1.1 : 1 / 1.1; const nz = Math.min(3, Math.max(0.15, viewport.zoom * f)); viewport.panX = mx - (mx - viewport.panX) * (nz / viewport.zoom); viewport.panY = my - (my - viewport.panY) * (nz / viewport.zoom); viewport.zoom = nz; applyViewport(); saveVp(); }, { passive: false });
}

/* ═══ RECT SELECT ═══ */
function svgPoint(e) { const r = svgEl.getBoundingClientRect(); return { x: (e.clientX - r.left - viewport.panX) / viewport.zoom, y: (e.clientY - r.top - viewport.panY) / viewport.zoom }; }
function startRectSelect(e) { rectSel.active = true; const p = svgPoint(e); rectSel.startX = p.x; rectSel.startY = p.y; const ov = document.getElementById("wb-overlay"); const r = document.createElementNS("http://www.w3.org/2000/svg", "rect"); r.setAttribute("fill", "rgba(59,130,246,0.12)"); r.setAttribute("stroke", "var(--accent-blue)"); r.setAttribute("stroke-width", "1.5"); r.setAttribute("stroke-dasharray", "4 2"); r.setAttribute("x", p.x); r.setAttribute("y", p.y); r.setAttribute("width", 0); r.setAttribute("height", 0); ov.appendChild(r); rectSel.rect = r; svgEl.setPointerCapture(e.pointerId); }
function updateRectSelect(e) { if (!rectSel.rect) return; const p = svgPoint(e); rectSel.rect.setAttribute("x", Math.min(rectSel.startX, p.x)); rectSel.rect.setAttribute("y", Math.min(rectSel.startY, p.y)); rectSel.rect.setAttribute("width", Math.abs(p.x - rectSel.startX)); rectSel.rect.setAttribute("height", Math.abs(p.y - rectSel.startY)); }
function endRectSelect(e) {
  if (!rectSel.rect) return; const p = svgPoint(e);
  const x1 = Math.min(rectSel.startX, p.x), y1 = Math.min(rectSel.startY, p.y), x2 = Math.max(rectSel.startX, p.x), y2 = Math.max(rectSel.startY, p.y);
  rectSel.rect.remove(); rectSel.rect = null; rectSel.active = false; svgEl.releasePointerCapture(e.pointerId);
  const board = getBoard(); selectedIds.clear();
  for (const nd of (board.nodes || [])) {
    const pos = (board.positions || {})[nd.wbId]; if (!pos) continue;
    const sz = getNodeSize(nd); const cx = pos.x + sz.w / 2, cy = pos.y + sz.h / 2;
    if (cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2) selectedIds.add(nd.wbId);
  }
  applySelection(); if (selectedIds.size) toastRef(`${selectedIds.size} sélectionné(s)`);
}

function applySelection() { document.querySelectorAll(".wb-node").forEach(g => { g.classList.toggle("selected", selectedIds.has(g.getAttribute("data-id"))); }); }

/* ═══ CANVAS EVENTS ═══ */
function initCanvasEvents() {
  svgEl.addEventListener("pointerdown", (e) => { const onBg = e.target === svgEl || (e.target.tagName === 'rect' && !e.target.closest('.wb-node,.wb-zone,.wb-conn-group,.wb-handle')); if (onBg && !e.shiftKey) { selectedIds.clear(); applySelection(); deselectConn(); } });
  svgEl.addEventListener("pointermove", (e) => { if (!linkDrag.active || !linkDrag.line) return; const p = svgPoint(e); linkDrag.line.setAttribute("x2", p.x); linkDrag.line.setAttribute("y2", p.y); });
  svgEl.addEventListener("pointerup", () => { cancelLinkDrag(); });
}

function initKeyboard() {
  document.addEventListener("keydown", (e) => {
    if (stateRef.currentView !== 'conception') return;
    // Ctrl+S: save (works even in inputs)
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveConfig(); return; }
    // Ctrl+Z: undo, Ctrl+Shift+Z: redo (works even in inputs)
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) { e.preventDefault(); redo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); return; }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); spaceHeld = true; if (svgEl) svgEl.style.cursor = 'grab'; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size) { e.preventDefault(); removeSelected(); }
    if (e.key === 'Escape') { selectedIds.clear(); applySelection(); cancelLinkDrag(); deselectConn(); }
  });
  document.addEventListener("keyup", (e) => { if (e.code === 'Space') { spaceHeld = false; if (svgEl) svgEl.style.cursor = ''; } });
}

/* ═══ RENDER ZONES ═══ */
function renderZones() {
  const board = getBoard(); const zg = document.getElementById("wb-zones"); if (!zg) return; zg.innerHTML = '';
  for (const zone of (board.zones || [])) {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g"); g.classList.add("wb-zone");
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", zone.x); bg.setAttribute("y", zone.y); bg.setAttribute("width", zone.width); bg.setAttribute("height", zone.height);
    bg.setAttribute("fill", zone.color + "08"); bg.setAttribute("stroke", zone.color); bg.setAttribute("stroke-width", "1.5"); bg.setAttribute("stroke-dasharray", "8 4"); bg.setAttribute("rx", "16"); bg.setAttribute("ry", "16"); g.appendChild(bg);
    const lbl = document.createElementNS("http://www.w3.org/2000/svg", "text"); lbl.setAttribute("x", zone.x + 12); lbl.setAttribute("y", zone.y + 22); lbl.classList.add("wb-zone-label"); lbl.setAttribute("fill", zone.color); lbl.textContent = zone.label; g.appendChild(lbl);
    const rh = document.createElementNS("http://www.w3.org/2000/svg", "rect"); rh.setAttribute("x", zone.x + zone.width - 16); rh.setAttribute("y", zone.y + zone.height - 16); rh.setAttribute("width", 16); rh.setAttribute("height", 16); rh.setAttribute("fill", zone.color); rh.setAttribute("opacity", "0.15"); rh.setAttribute("rx", "3"); rh.style.cursor = "nwse-resize"; rh.classList.add("wb-zone-resize"); g.appendChild(rh);
    g.addEventListener("dblclick", (e) => { e.stopPropagation(); editZone(zone.id); });
    // Delete button (visible on hover)
    const delG = document.createElementNS("http://www.w3.org/2000/svg", "g"); delG.classList.add("wb-zone-delete");
    delG.innerHTML = `<rect x="${zone.x + zone.width - 28}" y="${zone.y + 4}" width="24" height="18" rx="4" fill="var(--accent-red)" opacity="0"/><text x="${zone.x + zone.width - 16}" y="${zone.y + 14}" text-anchor="middle" dominant-baseline="central" style="font-size:10px;fill:var(--accent-red);opacity:0;cursor:pointer">✕</text>`;
    delG.addEventListener("click", (e) => { e.stopPropagation(); removeZone(zone.id); }); g.appendChild(delG);
    let dr = false, moved = false, sx, sy, ox, oy;
    g.addEventListener("pointerdown", (e) => { if (e.target.closest('.wb-zone-delete') || e.target.classList.contains("wb-zone-resize") || e.button !== 0 || spaceHeld) return; e.stopPropagation(); dr = true; moved = false; g.setPointerCapture(e.pointerId); ox = zone.x; oy = zone.y; sx = e.clientX; sy = e.clientY; });
    g.addEventListener("pointermove", (e) => { if (!dr) return; const dx = (e.clientX - sx) / viewport.zoom, dy = (e.clientY - sy) / viewport.zoom; if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return; moved = true; g.style.cursor = "grabbing"; zone.x = ox + dx; zone.y = oy + dy; bg.setAttribute("x", zone.x); bg.setAttribute("y", zone.y); lbl.setAttribute("x", zone.x + 12); lbl.setAttribute("y", zone.y + 22); rh.setAttribute("x", zone.x + zone.width - 16); rh.setAttribute("y", zone.y + zone.height - 16); delG.querySelector('rect').setAttribute("x", zone.x + zone.width - 28); delG.querySelector('rect').setAttribute("y", zone.y + 4); delG.querySelector('text').setAttribute("x", zone.x + zone.width - 16); delG.querySelector('text').setAttribute("y", zone.y + 14); });
    g.addEventListener("pointerup", () => { if (!dr) return; dr = false; g.style.cursor = ""; if (moved) save(); });
    let rs = false, rsx, rsy, row, roh;
    rh.addEventListener("pointerdown", (e) => { e.stopPropagation(); rs = true; rh.setPointerCapture(e.pointerId); row = zone.width; roh = zone.height; rsx = e.clientX; rsy = e.clientY; });
    rh.addEventListener("pointermove", (e) => { if (!rs) return; zone.width = Math.max(100, row + (e.clientX - rsx) / viewport.zoom); zone.height = Math.max(60, roh + (e.clientY - rsy) / viewport.zoom); bg.setAttribute("width", zone.width); bg.setAttribute("height", zone.height); rh.setAttribute("x", zone.x + zone.width - 16); rh.setAttribute("y", zone.y + zone.height - 16); });
    rh.addEventListener("pointerup", () => { if (!rs) return; rs = false; save(); });
    zg.appendChild(g);
  }
}

/* ═══ RENDER NODES ═══ */
function renderBoardNodes() {
  const board = getBoard(); const ng = document.getElementById("wb-nodes"); if (!ng) return; ng.innerHTML = '';
  const fs = getWbSettings().fontScale || 1;
  for (const node of (board.nodes || [])) {
    const pos = (board.positions || {})[node.wbId] || { x: 100, y: 100 };
    const color = node.color || "#64748b"; const sz = getNodeSize(node);
    const isUser = node.nodeType === "user"; const isCloud = node.nodeType === "cloud"; const isText = node.nodeType === "text";
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g"); g.classList.add("wb-node"); g.setAttribute("data-id", node.wbId); g.setAttribute("transform", `translate(${pos.x},${pos.y})`);
    if (selectedIds.has(node.wbId)) g.classList.add("selected");
    if (isText) {
      const lh = 16 * fs;
      const lines = (node.text || node.name || '').split('\n');
      g.innerHTML = `<rect x="0" y="0" width="${sz.w}" height="${sz.h}" class="wb-node-bg" fill="var(--bg-card)" stroke="${color}" stroke-dasharray="4 2" opacity="0.8"/>${lines.map((l, i) => `<text x="10" y="${14 * fs + i * lh}" class="wb-node-type" style="fill:var(--text)">${escSvg(l)}</text>`).join('')}`;
    } else if (isUser) {
      g.innerHTML = `<circle cx="30" cy="30" r="28" class="wb-node-bg" fill="${color}12" stroke="${color}"/><text x="30" y="26" text-anchor="middle" class="wb-node-icon">${node.icon}</text><text x="30" y="44" text-anchor="middle" class="wb-node-name">${truncate(node.name, 14)}</text>`;
    } else if (isCloud) {
      g.innerHTML = `<ellipse cx="${sz.w / 2}" cy="30" rx="${sz.w / 2 - 5}" ry="28" class="wb-node-bg" fill="${color}12" stroke="${color}"/><text x="${sz.w / 2}" y="24" text-anchor="middle" class="wb-node-icon">${node.icon}</text><text x="${sz.w / 2}" y="42" text-anchor="middle" class="wb-node-name">${node.name}</text>`;
    } else {
      g.innerHTML = `<rect x="0" y="0" width="${sz.w}" height="${sz.h}" class="wb-node-bg" fill="var(--bg-card)" stroke="${color}"/><rect x="0" y="0" width="4" height="${sz.h}" fill="${color}" rx="2"/><text x="34" y="${sz.h / 2 - 5}" class="wb-node-icon">${node.icon}</text><text x="52" y="${sz.h / 2 - 5}" class="wb-node-name">${truncate(node.name, 18)}</text><text x="52" y="${sz.h / 2 + 9}" class="wb-node-type">${truncate(node.type || '', 24)}</text>`;
    }
    // Delete button
    const delX = isUser ? 44 : sz.w - 16;
    const del = document.createElementNS("http://www.w3.org/2000/svg", "g"); del.classList.add("wb-node-delete");
    del.innerHTML = `<rect x="${delX}" y="2" width="14" height="14" rx="3" fill="var(--accent-red)" opacity="0"/><text x="${delX + 7}" y="10" text-anchor="middle" dominant-baseline="central" style="font-size:10px;fill:var(--accent-red);opacity:0;cursor:pointer">✕</text>`;
    del.addEventListener("click", (e) => { e.stopPropagation(); removeNodeFromBoard(node.wbId); }); g.appendChild(del);
    // Port for link creation (right edge)
    const portX = isUser ? 56 : sz.w; const portY = isUser ? 30 : sz.h / 2;
    const port = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    port.setAttribute("cx", portX); port.setAttribute("cy", portY); port.setAttribute("r", 6); port.setAttribute("fill", "var(--accent-blue)"); port.setAttribute("opacity", "0"); port.style.cursor = "crosshair"; port.classList.add("wb-node-port");
    port.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); startLinkDrag(node.wbId, e); }); g.appendChild(port);
    // Resize handle (bottom-right, not for user/cloud)
    if (!isUser && !isCloud) {
      const rh = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rh.setAttribute("x", sz.w - 10); rh.setAttribute("y", sz.h - 10); rh.setAttribute("width", 10); rh.setAttribute("height", 10);
      rh.setAttribute("fill", color); rh.setAttribute("opacity", "0"); rh.setAttribute("rx", "2"); rh.style.cursor = "nwse-resize"; rh.classList.add("wb-node-resize");
      initNodeResize(rh, node, g); g.appendChild(rh);
    }
    if (isText) { g.addEventListener("dblclick", (e) => { e.stopPropagation(); document.getElementById("fwt_id").value = node.wbId; document.getElementById("fwt_text").value = node.text || ''; document.getElementById("dlgWbText").showModal(); }); }
    g.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); startLinkDrag(node.wbId, e); });
    ng.appendChild(g); initNodeDrag(g, node.wbId);
  }
}
function escSvg(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function truncate(s, m) { return s.length > m ? s.slice(0, m - 1) + '…' : s; }

/* ═══ NODE RESIZE ═══ */
function initNodeResize(handle, node, group) {
  let rs = false, sx, sy, ow, oh;
  handle.addEventListener("pointerdown", (e) => { e.stopPropagation(); rs = true; handle.setPointerCapture(e.pointerId); ow = node.width || NODE_W; oh = node.height || NODE_H; sx = e.clientX; sy = e.clientY; });
  handle.addEventListener("pointermove", (e) => {
    if (!rs) return;
    node.width = Math.max(MIN_NODE_W, ow + (e.clientX - sx) / viewport.zoom);
    node.height = Math.max(MIN_NODE_H, oh + (e.clientY - sy) / viewport.zoom);
    const sz = getNodeSize(node);
    // Update existing SVG elements in-place instead of rebuilding DOM (preserves pointer capture)
    const bg = group.querySelector('.wb-node-bg');
    if (bg) {
      if (bg.tagName === 'rect') { bg.setAttribute('width', sz.w); bg.setAttribute('height', sz.h); }
    }
    // Update left color bar
    const bars = group.querySelectorAll('rect');
    bars.forEach(r => { if (r.getAttribute('width') === '4') r.setAttribute('height', sz.h); });
    // Update resize handle position
    handle.setAttribute('x', sz.w - 10); handle.setAttribute('y', sz.h - 10);
    // Update port position
    const port = group.querySelector('.wb-node-port');
    if (port) { port.setAttribute('cx', sz.w); port.setAttribute('cy', sz.h / 2); }
    renderConnections();
  });
  handle.addEventListener("pointerup", () => { if (!rs) return; rs = false; save(); renderBoardNodes(); renderConnections(); });
}

/* ═══ LINK DRAG ═══ */
function startLinkDrag(fromId, e) {
  cancelLinkDrag(); linkDrag.active = true; linkDrag.fromId = fromId;
  const from = getNodeCenter(fromId); const ov = document.getElementById("wb-overlay");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  const p = svgPoint(e); line.setAttribute("x1", from.x); line.setAttribute("y1", from.y);
  line.setAttribute("x2", p.x); line.setAttribute("y2", p.y);
  line.setAttribute("stroke", "var(--accent-blue)"); line.setAttribute("stroke-width", "2"); line.setAttribute("stroke-dasharray", "6 3"); line.setAttribute("opacity", "0.6");
  ov.appendChild(line); linkDrag.line = line;
  // Drop handlers
  linkDrag.dropHandlers = [];
  document.querySelectorAll(".wb-node").forEach(g => {
    const handler = (ev) => { ev.stopPropagation(); const toId = g.getAttribute("data-id"); if (toId && toId !== fromId) { cancelLinkDrag(); createLinkDirect(fromId, toId); } };
    g.addEventListener("pointerup", handler, { once: true }); linkDrag.dropHandlers.push({ el: g, fn: handler });
  });
}
function cancelLinkDrag() {
  if (linkDrag.line) { linkDrag.line.remove(); linkDrag.line = null; }
  linkDrag.active = false;
  for (const { el, fn } of linkDrag.dropHandlers) el.removeEventListener("pointerup", fn);
  linkDrag.dropHandlers = [];
}

/* ═══ HANDLE DRAG (Bézier CP + Anchor) ═══ */
function startHandleDrag(connId, handle, el, e) {
  handleDrag.active = true; handleDrag.connId = connId; handleDrag.handle = handle; handleDrag.el = el;
  el.setPointerCapture(e.pointerId); el.style.cursor = "grabbing";
  const onMove = (ev) => {
    if (!handleDrag.active) return;
    const p = svgPoint(ev); const board = getBoard();
    const conn = (board.connections || []).find(c => c.id === connId); if (!conn) return;
    if (handle === 'cp1' || handle === 'cp2') {
      conn[handle] = { x: p.x, y: p.y };
      el.setAttribute("cx", p.x); el.setAttribute("cy", p.y);
    } else if (handle === 'fromAnchor') {
      conn.fromAnchor = angleFromCenter(conn.from, p);
      const fe = getNodeEdgeAtAngle(conn.from, conn.fromAnchor);
      el.setAttribute("x", fe.x - 4); el.setAttribute("y", fe.y - 4);
    } else if (handle === 'toAnchor') {
      conn.toAnchor = angleFromCenter(conn.to, p);
      const te = getNodeEdgeAtAngle(conn.to, conn.toAnchor);
      el.setAttribute("x", te.x - 4); el.setAttribute("y", te.y - 4);
    }
    // Update path inline (find the conn-group for this connection)
    updateConnPath(conn);
  };
  const onUp = () => {
    handleDrag.active = false; el.style.cursor = "grab";
    el.removeEventListener("pointermove", onMove); el.removeEventListener("pointerup", onUp);
    save(); renderConnections();
  };
  el.addEventListener("pointermove", onMove); el.addEventListener("pointerup", onUp);
  // Double-click to reset
  el.addEventListener("dblclick", (ev) => {
    ev.stopPropagation(); const board = getBoard();
    const conn = (board.connections || []).find(c => c.id === connId); if (!conn) return;
    if (handle === 'cp1' || handle === 'cp2') { delete conn[handle]; }
    else if (handle === 'fromAnchor') { delete conn.fromAnchor; }
    else if (handle === 'toAnchor') { delete conn.toAnchor; }
    save(); renderConnections(); toastRef("Point réinitialisé");
  });
}
function updateConnPath(conn) {
  const board = getBoard();
  const fn = (board.nodes || []).find(n => n.wbId === conn.from), tn = (board.nodes || []).find(n => n.wbId === conn.to); if (!fn || !tn) return;
  const fc = getNodeCenter(conn.from), tc = getNodeCenter(conn.to);
  const fe = conn.fromAnchor != null ? getNodeEdgeAtAngle(conn.from, conn.fromAnchor) : getNodeEdge(fc, tc, conn.from);
  const te = conn.toAnchor != null ? getNodeEdgeAtAngle(conn.to, conn.toAnchor) : getNodeEdge(tc, fc, conn.to);
  const routing = conn.routing || 'straight'; const pathD = buildPath(fe, te, routing, conn);
  // Update all path elements in the connection group
  const cg = document.getElementById("wb-connections"); if (!cg) return;
  const groups = cg.querySelectorAll('.wb-conn-group');
  // Find the matching group by connection index
  const idx = (board.connections || []).indexOf(conn); if (idx < 0 || idx >= groups.length) return;
  const paths = groups[idx].querySelectorAll('path');
  paths.forEach(p => p.setAttribute('d', pathD));
  // Update tangent lines in overlay
  if (routing === 'curve') {
    const ov = document.getElementById("wb-overlay"); if (!ov) return;
    const def = defaultCP(fe, te);
    const c1 = conn.cp1 || def.cp1, c2 = conn.cp2 || def.cp2;
    const lines = ov.querySelectorAll(`line.wb-handle`);
    // Lines come in pairs per curve connection — find the right ones by index
    let curveIdx = 0;
    for (let i = 0; i < idx; i++) {
      if ((board.connections[i].routing || 'straight') === 'curve') curveIdx++;
    }
    const l1 = lines[curveIdx * 2], l2 = lines[curveIdx * 2 + 1];
    if (l1) { l1.setAttribute("x1", fe.x); l1.setAttribute("y1", fe.y); l1.setAttribute("x2", c1.x); l1.setAttribute("y2", c1.y); }
    if (l2) { l2.setAttribute("x1", te.x); l2.setAttribute("y1", te.y); l2.setAttribute("x2", c2.x); l2.setAttribute("y2", c2.y); }
  }
}

/* ═══ NODE DRAG ═══ */
function initNodeDrag(nodeGroup, wbId) {
  let dr = false, sx, sy, offsets = [];
  nodeGroup.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest('.wb-node-delete') || e.target.closest('.wb-node-port') || e.target.closest('.wb-node-resize') || spaceHeld) return;
    e.stopPropagation(); dr = true; nodeGroup.setPointerCapture(e.pointerId);
    sx = e.clientX; sy = e.clientY; nodeGroup.classList.add("dragging"); deselectConn();
    if (!e.shiftKey && !selectedIds.has(wbId)) { selectedIds.clear(); applySelection(); }
    selectedIds.add(wbId); nodeGroup.classList.add("selected");
    // Store offsets for all selected nodes for group move
    const board = getBoard(); offsets = [];
    for (const id of selectedIds) { const p = (board.positions || {})[id]; if (p) offsets.push({ id, ox: p.x, oy: p.y }); }
  });
  nodeGroup.addEventListener("pointermove", (e) => {
    if (!dr) return; const dx = (e.clientX - sx) / viewport.zoom, dy = (e.clientY - sy) / viewport.zoom;
    const board = getBoard();
    for (const { id, ox, oy } of offsets) {
      board.positions[id] = { x: ox + dx, y: oy + dy };
      const g = document.querySelector(`.wb-node[data-id="${id}"]`);
      if (g) g.setAttribute("transform", `translate(${ox + dx},${oy + dy})`);
    }
    renderConnections();
  });
  nodeGroup.addEventListener("pointerup", () => { if (!dr) return; dr = false; nodeGroup.classList.remove("dragging"); save(); });
}

/* ═══ RENDER CONNECTIONS ═══ */
function getNodeCenter(wbId) {
  const board = getBoard(); const pos = (board.positions || {})[wbId] || { x: 0, y: 0 }; const nd = (board.nodes || []).find(n => n.wbId === wbId);
  if (!nd) return { x: pos.x, y: pos.y }; const sz = getNodeSize(nd);
  if (nd.nodeType === "user") return { x: pos.x + 30, y: pos.y + 30 };
  if (nd.nodeType === "cloud") return { x: pos.x + sz.w / 2, y: pos.y + 30 };
  return { x: pos.x + sz.w / 2, y: pos.y + sz.h / 2 };
}
function getNodeEdge(fromC, toC, wbId) {
  const board = getBoard(); const pos = (board.positions || {})[wbId] || { x: 0, y: 0 }; const nd = (board.nodes || []).find(n => n.wbId === wbId); if (!nd) return fromC;
  const sz = getNodeSize(nd);
  if (nd.nodeType === "user") { const r = 28, cx = pos.x + 30, cy = pos.y + 30; const dx = toC.x - cx, dy = toC.y - cy; const d = Math.sqrt(dx * dx + dy * dy) || 1; return { x: cx + dx / d * r, y: cy + dy / d * r }; }
  const hw = nd.nodeType === "cloud" ? sz.w / 2 - 5 : sz.w / 2, hh = nd.nodeType === "cloud" ? 28 : sz.h / 2;
  const cx = pos.x + sz.w / 2, cy = pos.y + (nd.nodeType === "cloud" ? 30 : sz.h / 2);
  const dx = toC.x - cx, dy = toC.y - cy; if (dx === 0 && dy === 0) return { x: cx + hw, y: cy };
  const s = Math.min(hw / (Math.abs(dx) || 1), hh / (Math.abs(dy) || 1)); return { x: cx + dx * s, y: cy + dy * s };
}
function getNodeEdgeAtAngle(wbId, angle) {
  const board = getBoard(); const pos = (board.positions || {})[wbId] || { x: 0, y: 0 }; const nd = (board.nodes || []).find(n => n.wbId === wbId);
  if (!nd) return { x: pos.x, y: pos.y };
  const sz = getNodeSize(nd); const rad = angle * Math.PI / 180;
  const dx = Math.cos(rad), dy = Math.sin(rad);
  if (nd.nodeType === "user") { const r = 28, cx = pos.x + 30, cy = pos.y + 30; return { x: cx + dx * r, y: cy + dy * r }; }
  const hw = nd.nodeType === "cloud" ? sz.w / 2 - 5 : sz.w / 2, hh = nd.nodeType === "cloud" ? 28 : sz.h / 2;
  const cx = pos.x + sz.w / 2, cy = pos.y + (nd.nodeType === "cloud" ? 30 : sz.h / 2);
  if (dx === 0 && dy === 0) return { x: cx + hw, y: cy };
  const s = Math.min(hw / (Math.abs(dx) || 1), hh / (Math.abs(dy) || 1)); return { x: cx + dx * s, y: cy + dy * s };
}
function angleFromCenter(wbId, point) {
  const c = getNodeCenter(wbId); return Math.atan2(point.y - c.y, point.x - c.x) * 180 / Math.PI;
}
function defaultCP(fe, te) {
  const dx = te.x - fe.x;
  return { cp1: { x: fe.x + dx * .4, y: fe.y }, cp2: { x: te.x - dx * .4, y: te.y } };
}
function buildPath(fe, te, routing, conn) {
  if (routing === 'curve') {
    const def = defaultCP(fe, te);
    const c1x = conn && conn.cp1 ? conn.cp1.x : def.cp1.x, c1y = conn && conn.cp1 ? conn.cp1.y : def.cp1.y;
    const c2x = conn && conn.cp2 ? conn.cp2.x : def.cp2.x, c2y = conn && conn.cp2 ? conn.cp2.y : def.cp2.y;
    return `M${fe.x},${fe.y} C${c1x},${c1y} ${c2x},${c2y} ${te.x},${te.y}`;
  }
  if (routing === 'ortho') { const mx = (fe.x + te.x) / 2; return `M${fe.x},${fe.y} L${mx},${fe.y} L${mx},${te.y} L${te.x},${te.y}`; }
  return `M${fe.x},${fe.y} L${te.x},${te.y}`;
}
function markerAttr(type, end) { if (!type || type === 'none') return ''; return `marker-${end}="url(#m-${type}-${end})"`; }
function selectConn(connId) {
  selectedConnId = selectedConnId === connId ? null : connId;
  renderConnections();
}
function deselectConn() {
  if (selectedConnId) { selectedConnId = null; renderConnections(); }
}
function renderConnections() {
  const board = getBoard(); const cg = document.getElementById("wb-connections"); if (!cg) return; cg.innerHTML = '';
  const ov = document.getElementById("wb-overlay");
  if (ov) ov.querySelectorAll('.wb-handle').forEach(h => h.remove());
  for (const conn of (board.connections || [])) {
    const fn = (board.nodes || []).find(n => n.wbId === conn.from), tn = (board.nodes || []).find(n => n.wbId === conn.to); if (!fn || !tn) continue;
    const fc = getNodeCenter(conn.from), tc = getNodeCenter(conn.to);
    const fe = conn.fromAnchor != null ? getNodeEdgeAtAngle(conn.from, conn.fromAnchor) : getNodeEdge(fc, tc, conn.from);
    const te = conn.toAnchor != null ? getNodeEdgeAtAngle(conn.to, conn.toAnchor) : getNodeEdge(tc, fc, conn.to);
    const color = fn.color || 'var(--accent-blue)'; const isDashed = conn.style === "dashed"; const routing = conn.routing || 'straight';
    const sm = conn.startMarker || 'none', em = conn.endMarker || 'arrow'; const pathD = buildPath(fe, te, routing, conn);
    const isSelected = conn.id === selectedConnId;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g"); g.classList.add("wb-conn-group"); if (isSelected) g.classList.add("wb-conn-selected");
    g.innerHTML = `<path d="${pathD}" class="wb-conn-line ${isDashed ? 'dashed' : ''}" stroke="${color}" ${markerAttr(sm, 'start')} ${markerAttr(em, 'end')}/><path d="${pathD}" stroke="transparent" stroke-width="14" fill="none" style="cursor:pointer"/>`;
    if (conn.label) { const mx = (fe.x + te.x) / 2, my = (fe.y + te.y) / 2, ll = conn.label.length * 5.5 + 12; g.innerHTML += `<rect x="${mx - ll / 2}" y="${my - 8}" width="${ll}" height="16" class="wb-conn-label-bg" fill="var(--bg-card)" stroke="${color}" stroke-opacity="0.3" stroke-width="0.5"/><text x="${mx}" y="${my}" class="wb-conn-label" fill="${color}">${escSvg(conn.label)}</text>`; }
    if (conn.fromLabel) { const fx = fe.x + (te.x - fe.x) * .15, fy = fe.y + (te.y - fe.y) * .15 - 10; g.innerHTML += `<text x="${fx}" y="${fy}" class="wb-conn-endpoint-label">${escSvg(conn.fromLabel)}</text>`; }
    if (conn.toLabel) { const tx = te.x - (te.x - fe.x) * .15, ty = te.y - (te.y - fe.y) * .15 - 10; g.innerHTML += `<text x="${tx}" y="${ty}" class="wb-conn-endpoint-label">${escSvg(conn.toLabel)}</text>`; }
    g.addEventListener("click", (e) => { e.stopPropagation(); selectConn(conn.id); });
    g.addEventListener("dblclick", (e) => { e.stopPropagation(); editConn(conn.id); }); g.style.cursor = "pointer"; cg.appendChild(g);
    // Handles only for the selected connection
    if (!isSelected || !ov) continue;
    // Bézier control point handles (only for 'curve' routing)
    if (routing === 'curve') {
      const def = defaultCP(fe, te);
      const c1 = conn.cp1 || def.cp1, c2 = conn.cp2 || def.cp2;
      const tl1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
      tl1.setAttribute("x1", fe.x); tl1.setAttribute("y1", fe.y); tl1.setAttribute("x2", c1.x); tl1.setAttribute("y2", c1.y);
      tl1.setAttribute("stroke", color); tl1.setAttribute("stroke-width", "1"); tl1.setAttribute("stroke-opacity", "0.3"); tl1.setAttribute("stroke-dasharray", "3 2");
      tl1.classList.add("wb-handle"); ov.appendChild(tl1);
      const tl2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
      tl2.setAttribute("x1", te.x); tl2.setAttribute("y1", te.y); tl2.setAttribute("x2", c2.x); tl2.setAttribute("y2", c2.y);
      tl2.setAttribute("stroke", color); tl2.setAttribute("stroke-width", "1"); tl2.setAttribute("stroke-opacity", "0.3"); tl2.setAttribute("stroke-dasharray", "3 2");
      tl2.classList.add("wb-handle"); ov.appendChild(tl2);
      const h1 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      h1.setAttribute("cx", c1.x); h1.setAttribute("cy", c1.y); h1.setAttribute("r", 5);
      h1.setAttribute("fill", color); h1.setAttribute("fill-opacity", "0.5"); h1.setAttribute("stroke", color); h1.setAttribute("stroke-width", "1.5");
      h1.classList.add("wb-handle", "wb-bezier-handle"); h1.style.cursor = "grab";
      h1.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); startHandleDrag(conn.id, 'cp1', h1, e); });
      ov.appendChild(h1);
      const h2 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      h2.setAttribute("cx", c2.x); h2.setAttribute("cy", c2.y); h2.setAttribute("r", 5);
      h2.setAttribute("fill", color); h2.setAttribute("fill-opacity", "0.5"); h2.setAttribute("stroke", color); h2.setAttribute("stroke-width", "1.5");
      h2.classList.add("wb-handle", "wb-bezier-handle"); h2.style.cursor = "grab";
      h2.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); startHandleDrag(conn.id, 'cp2', h2, e); });
      ov.appendChild(h2);
    }
    // Anchor handles on endpoints
    const ah1 = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    ah1.setAttribute("x", fe.x - 4); ah1.setAttribute("y", fe.y - 4); ah1.setAttribute("width", 8); ah1.setAttribute("height", 8);
    ah1.setAttribute("rx", 2); ah1.setAttribute("fill", color); ah1.setAttribute("fill-opacity", "0.4"); ah1.setAttribute("stroke", color); ah1.setAttribute("stroke-width", "1");
    ah1.classList.add("wb-handle", "wb-anchor-handle"); ah1.style.cursor = "grab";
    ah1.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); startHandleDrag(conn.id, 'fromAnchor', ah1, e); });
    ov.appendChild(ah1);
    const ah2 = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    ah2.setAttribute("x", te.x - 4); ah2.setAttribute("y", te.y - 4); ah2.setAttribute("width", 8); ah2.setAttribute("height", 8);
    ah2.setAttribute("rx", 2); ah2.setAttribute("fill", color); ah2.setAttribute("fill-opacity", "0.4"); ah2.setAttribute("stroke", color); ah2.setAttribute("stroke-width", "1");
    ah2.classList.add("wb-handle", "wb-anchor-handle"); ah2.style.cursor = "grab";
    ah2.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); startHandleDrag(conn.id, 'toAnchor', ah2, e); });
    ov.appendChild(ah2);
  }
}

/* ═══ CONCEPTION BAR (right panel) ═══ */
let barCollapsed = { doc: false, view: true, style: true };

function renderConceptionBar() {
  const S = stateRef; const bar = document.getElementById("wb-config-bar"); if (!bar) return;
  if (!configBarVisible) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const configs = S.conceptionConfigs || []; const activeId = S.activeConceptionConfig || '';

  bar.innerHTML = `
    <div class="wbcb-section">
      <div class="wbcb-title wb-collapsible" onclick="window.__wbToggleBar('doc')"><span class="wb-collapse-arrow ${barCollapsed.doc ? 'collapsed' : ''}">▼</span> Document</div>
      ${barCollapsed.doc ? '' : `<div class="wbcb-body">
        <select id="wb-config-select" onchange="window.__wbLoadConfig(this.value)"><option value="">— Sandbox —</option>${configs.map(c => `<option value="${c.id}" ${c.id === activeId ? 'selected' : ''}>${c.name}</option>`).join('')}</select>
        <div class="wbcb-row">
          <button onclick="window.__wbSaveConfig()" title="Sauvegarder">💾</button>
          <button onclick="window.__wbSaveConfigAs()">📋 Sauver sous…</button>
          <button onclick="window.__wbNewConfig()">✚ Nouveau</button>
        </div>
        <div class="wbcb-row">
          <button onclick="window.__wbResetBoard()" title="Vider le contenu">🧹 Vider canvas</button>
          <button onclick="window.__wbDeleteConfig()" class="wbcb-danger" title="Supprimer vue">🗑️ Suppr. vue</button>
        </div>
      </div>`}
    </div>
    <div class="wbcb-section">
      <div class="wbcb-title wb-collapsible" onclick="window.__wbToggleBar('view')"><span class="wb-collapse-arrow ${barCollapsed.view ? 'collapsed' : ''}">▼</span> Vue</div>
      ${barCollapsed.view ? '' : `<div class="wbcb-body">
        <div class="wbcb-row">
          <button onclick="window.__wbZoomIn()">+ Zoom</button>
          <button onclick="window.__wbZoomOut()">− Zoom</button>
        </div>
        <div class="wbcb-row">
          <button onclick="window.__wbFitAll()">⊞ Tout voir</button>
          <button onclick="window.__wbResetView()">↺ Reset</button>
        </div>
        <div class="wbcb-row">
          <button onclick="window.__wbToggleSidePanel()">${sidePanelVisible ? '◧ Masquer panneau' : '☰ Afficher panneau'}</button>
          <button onclick="window.__wbToggleFullscreen()" id="wb-fs-btn">${isFullscreen ? '⬇ Réduire' : '⬆ Plein écran'}</button>
        </div>
      </div>`}
    </div>
    <div class="wbcb-section">
      <div class="wbcb-title wb-collapsible" onclick="window.__wbToggleBar('style')"><span class="wb-collapse-arrow ${barCollapsed.style ? 'collapsed' : ''}">▼</span> Style</div>
      ${barCollapsed.style ? '' : (() => { const ws = getWbSettings(); return `<div class="wbcb-body">
        <label class="wbcb-label">Police <span class="wb-val">${Math.round(ws.fontScale * 100)}%</span></label>
        <input type="range" min="0.5" max="2.5" step="0.05" value="${ws.fontScale}" oninput="window.__wbSetStyle('fontScale', +this.value, this)">
        <label class="wbcb-label">Contour nodes <span class="wb-val">${ws.nodeStroke}</span></label>
        <input type="range" min="0.5" max="5" step="0.25" value="${ws.nodeStroke}" oninput="window.__wbSetStyle('nodeStroke', +this.value, this)">
        <label class="wbcb-label">Épaisseur liens <span class="wb-val">${ws.connStroke}</span></label>
        <input type="range" min="0.5" max="5" step="0.25" value="${ws.connStroke}" oninput="window.__wbSetStyle('connStroke', +this.value, this)">
        <label class="wbcb-label">Opacité liens <span class="wb-val">${Math.round(ws.connOpacity * 100)}%</span></label>
        <input type="range" min="0.1" max="1" step="0.05" value="${ws.connOpacity}" oninput="window.__wbSetStyle('connOpacity', +this.value, this)">
        <button onclick="window.__wbResetStyle()" style="margin-top:.25rem">↺ Réinitialiser</button>
      </div>`; })()}
    </div>`;
}
function toggleBarSection(s) { barCollapsed[s] = !barCollapsed[s]; renderConceptionBar(); }
function saveConfig() { if (!stateRef.activeConceptionConfig) { saveConfigAs(); return; } save(); toastRef("Sauvegardé"); }
async function saveConfigAs() {
  const name = await customPrompt("Nom du document :", "Sauver sous"); if (!name) return;
  if (!stateRef.conceptionConfigs) stateRef.conceptionConfigs = []; const board = getBoard();
  const cfg = { id: "cfg_" + Date.now(), name, createdAt: new Date().toISOString().slice(0, 10), nodes: structuredClone(board.nodes || []), zones: structuredClone(board.zones || []), connections: structuredClone(board.connections || []), positions: structuredClone(board.positions || {}) };
  stateRef.conceptionConfigs.push(cfg); stateRef.activeConceptionConfig = cfg.id; save(); renderConceptionBar(); toastRef(`"${name}" créé`);
}
async function newConfig() {
  const name = await customPrompt("Nom du nouveau document :", "Nouveau"); if (!name) return;
  if (!stateRef.conceptionConfigs) stateRef.conceptionConfigs = [];
  const cfg = { id: "cfg_" + Date.now(), name, createdAt: new Date().toISOString().slice(0, 10), nodes: [], zones: [], connections: [], positions: {} };
  stateRef.conceptionConfigs.push(cfg); stateRef.activeConceptionConfig = cfg.id; save();
  const wa = document.getElementById("wb-app"); if (wa) renderWhiteboard(wa); toastRef(`"${name}" créé`);
}
function loadConfig(id) { stateRef.activeConceptionConfig = id || ''; save(); const wa = document.getElementById("wb-app"); if (wa) renderWhiteboard(wa); if (id) { const c = (stateRef.conceptionConfigs || []).find(c => c.id === id); if (c) toastRef(`"${c.name}" chargé`); } }
async function deleteConfig() {
  const S = stateRef; const id = S.activeConceptionConfig; if (!id) { toastRef("Rien à supprimer"); return; }
  const c = (S.conceptionConfigs || []).find(c => c.id === id); if (!c) return;
  const ok = await customConfirm(`Supprimer "${c.name}" ?`, 'Supprimer'); if (!ok) return;
  S.conceptionConfigs = S.conceptionConfigs.filter(c => c.id !== id); S.activeConceptionConfig = '';
  save(); const wa = document.getElementById("wb-app"); if (wa) renderWhiteboard(wa); toastRef(`"${c.name}" supprimé`);
}

/* ═══ EXPOSE ═══ */
export function exposeWhiteboardGlobals() {
  window.__wbZoomIn = zoomIn; window.__wbZoomOut = zoomOut; window.__wbFitAll = fitAll; window.__wbResetView = resetView;
  window.__wbToggleFullscreen = toggleFullscreen; window.__wbResetBoard = resetBoard;
  window.__wbAddConn = () => addConn(); window.__wbAddZone = addZone;
  window.__wbAddServiceNode = addServiceNode; window.__wbAddAuxNode = addAuxNode;
  window.__wbTogglePanel = togglePanel; window.__wbSetServiceFilter = setServiceFilter;
  window.__wbToggleSidePanel = toggleSidePanel; window.__wbToggleConfigBar = toggleConfigBar;
  window.__wbToggleBar = toggleBarSection;
  window.__wbSetBg = setWbBg; window.__wbSetBgLive = setWbBgLive;
  window.__wbSetStyle = setWbStyle; window.__wbResetStyle = resetWbStyle;
  window.__wbSaveConfig = saveConfig; window.__wbSaveConfigAs = saveConfigAs;
  window.__wbNewConfig = newConfig; window.__wbLoadConfig = loadConfig; window.__wbDeleteConfig = deleteConfig;
  window.__wbSaveWbConn = saveWbConn; window.__wbDeleteWbConn = deleteWbConn;
  window.__wbSaveWbZone = saveWbZone; window.__wbDeleteWbZone = deleteWbZone; window.__wbSaveWbText = saveWbText;
}
