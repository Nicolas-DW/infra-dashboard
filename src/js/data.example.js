/**
 * Default data — company-specific infrastructure nodes, categories, connections, alerts.
 * Copy this file to data.js and customize for your organization.
 */

export const DEFAULT_CATEGORIES = [
  { id: "cloud", label: "Cloud & Hosting", color: "#3b82f6", icon: "☁️" },
  { id: "network", label: "Network & Security", color: "#f59e0b", icon: "🔒" },
  { id: "apps", label: "Applications", color: "#10b981", icon: "📱" },
  { id: "monitoring", label: "Monitoring & Backups", color: "#06b6d4", icon: "📊" },
  { id: "dev", label: "Development", color: "#ec4899", icon: "💻" },
  { id: "external", label: "External Services", color: "#64748b", icon: "🌐" },
];

export const DEFAULT_NODES = [
  // Add your infrastructure nodes here
  // { id: "example", name: "Example Server", category: "cloud", icon: "🟣", type: "IaaS", description: "...", details: {}, tags: [], links: [] },
];

export const DEFAULT_CONNECTIONS = [
  // "Source → Destination · Description"
];

export const DEFAULT_ALERTS = [
  // { severity: "warn", text: "..." },
];

/* ═══ AUXILIARY NODE TEMPLATES (for whiteboard) ═══ */
export const AUXILIARY_NODES = [
  { id: "aux_user", name: "Utilisateur", icon: "👤", nodeType: "user", color: "#10b981" },
  { id: "aux_admin", name: "Admin", icon: "🔑", nodeType: "user", color: "#f59e0b" },
  { id: "aux_internet", name: "Internet", icon: "🌍", nodeType: "cloud", color: "#64748b" },
  { id: "aux_terminal", name: "Terminal SSH", icon: "🔐", nodeType: "terminal", color: "#8b5cf6" },
  { id: "aux_database", name: "Base de données", icon: "🗄️", nodeType: "database", color: "#06b6d4" },
  { id: "aux_browser", name: "Navigateur", icon: "🌐", nodeType: "user", color: "#3b82f6" },
  { id: "aux_mobile", name: "Mobile", icon: "📱", nodeType: "user", color: "#10b981" },
  { id: "aux_text", name: "Note", icon: "📝", nodeType: "text", color: "#64748b" },
];
