/**
 * Seed: auto-generate a whiteboard document from your dashboard data on first launch.
 * Copy this file to seed-infra.js and customize for your infrastructure.
 *
 * This function is called once at startup if no conception document exists yet.
 * It reads nodes from S.nodes (populated by data.js) and lays them out on the whiteboard.
 */

export const SEED_CONFIG_ID = "cfg_infra_overview";

export function buildInfraDocument(S) {
  // Don't re-create if the document already exists
  if ((S.conceptionConfigs || []).some(c => c.id === SEED_CONFIG_ID)) return false;

  const catColors = {};
  (S.categories || []).forEach(c => { catColors[c.id] = c.color; });

  // ─── Helper: create a service node from the catalog ───
  function svc(sourceId) {
    const n = S.nodes.find(n => n.id === sourceId);
    if (!n) return null;
    return {
      wbId: "wb_" + sourceId,
      sourceId,
      nodeType: n.nodeType || "service",
      name: n.name,
      icon: n.icon,
      type: n.type || '',
      color: catColors[n.category] || "#64748b",
      width: 180,
      height: 60,
    };
  }

  // ─── Helper: create an auxiliary node ───
  let auxCounter = 1;
  function aux(type, name, icon, color) {
    return {
      wbId: "wb_aux_" + type + "_" + (auxCounter++),
      nodeType: type,
      name,
      icon,
      color,
    };
  }

  // ─── Helper: create a connection ───
  let connCounter = 1;
  function conn(from, to, label, opts = {}) {
    return {
      id: "conn_seed_" + (connCounter++),
      from,
      to,
      label: label || '',
      fromLabel: opts.fromLabel || '',
      toLabel: opts.toLabel || '',
      style: opts.style || 'solid',
      routing: opts.routing || 'straight',
      startMarker: opts.startMarker || 'none',
      endMarker: opts.endMarker || 'arrow',
    };
  }

  // ════════════════════════════════════════════════════════
  //  EXAMPLE: build your nodes, positions, zones, connections
  // ════════════════════════════════════════════════════════

  // Actors
  const internet = aux("cloud", "Internet", "🌍", "#64748b");
  const user = aux("user", "User", "👤", "#10b981");

  // Services from your catalog (must match IDs in data.js)
  // const myServer = svc("my_server");
  // const myApp = svc("my_app");

  const allNodes = [internet, user].filter(Boolean);

  const positions = {};
  positions[internet.wbId] = { x: 60, y: 260 };
  positions[user.wbId] = { x: 100, y: 420 };

  const zones = [
    // { id: "zone_example", label: "My Zone", color: "#3b82f6", x: 30, y: 220, width: 400, height: 300 },
  ];

  const connections = [
    // conn(internet.wbId, myServer.wbId, "HTTPS"),
  ];

  // ════════════════════════════════════════════════════════
  //  ASSEMBLE CONFIG
  // ════════════════════════════════════════════════════════

  const cfg = {
    id: SEED_CONFIG_ID,
    name: "Infrastructure Overview",
    createdAt: new Date().toISOString().slice(0, 10),
    nodes: allNodes,
    zones,
    connections,
    positions,
    wbSettings: {
      bgColor: '',
      gradientOn: true,
      gradColor1: '#0b1120',
      gradColor2: '#1a1040',
      gradType: 'linear',
      gradAngle: 135,
      gridType: 'dots',
      gridSize: 30,
      gridWidth: 1,
      gridColor: '#ffffff',
      gridOpacity: 0.06,
      fontScale: 1,
      nodeStroke: 1.5,
      connStroke: 1.5,
      connOpacity: 0.5,
    },
  };

  if (!S.conceptionConfigs) S.conceptionConfigs = [];
  S.conceptionConfigs.push(cfg);
  S.activeConceptionConfig = cfg.id;
  return true;
}
