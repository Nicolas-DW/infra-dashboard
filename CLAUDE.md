# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Infrastructure documentation dashboard. Vanilla JS SPA built with Vite — no framework, no runtime dependencies.

## Commands

```bash
npm run dev      # Start dev server (hot reload)
npm run build    # Production build → dist/
npm run preview  # Preview production build locally
```

## Architecture

```
index.html              # App shell: layout + all dialog modals (pure HTML)
src/
  main.js               # Entry point: state, view switching, dashboard render, CRUD, drag & drop
  config.js              # Company-specific config (gitignored), see config.example.js
  js/
    data.js             # Default data (categories, nodes, connections, alerts, auxiliary templates) (gitignored)
    data.example.js     # Template with empty defaults + AUXILIARY_NODES
    ui.js               # Custom confirm/prompt dialogs (avoids circular imports)
    whiteboard.js       # SVG whiteboard engine (canvas, side panel, drag, pan/zoom, CRUD, undo/redo)
  css/
    variables.css       # CSS custom properties (colors, fonts, radius) — includes elevated variants
    base.css            # Reset + body background gradients
    layout.css          # Dashboard header, toolbar, filters, search, conception layout (flexbox fill)
    cards.css           # Category sections, node cards grid, collapsible cards, drag & drop
    connections.css     # Text connections list, alerts section
    dialog.css          # Modals, form fields, repeaters, buttons, toast
    whiteboard.css      # SVG whiteboard (canvas, panels, nodes, zones, connections, style controls)
```

## Technical Philosophy

- **Zero runtime dependencies** — vanilla JS, CSS, HTML only. No frameworks.
- **Native web APIs first** — use `<dialog>` instead of custom modals, HTML5 Drag & Drop instead of libraries, SVG for canvas, `localStorage` for persistence.
- **No build-time transforms** — no TypeScript, no JSX, no CSS preprocessors. Vite bundles ES modules only.
- **Company data is gitignored** — `src/config.js` and `src/js/data.js` contain company-specific data and are in `.gitignore`. `*.example.js` templates exist for public use.

## Two Views

Switchable via tabs:

1. **Dashboard** — card grid with collapsible categories and cards, drag & drop reordering, text connections list, alerts
2. **Conception** — SVG whiteboard filling the viewport, with collapsible left panel (catalog) and right panel (document/view/style controls)

## Dashboard

- Categories are collapsible (click title) and reorderable (drag handle)
- Node cards are compact by default (icon, name, type, description). Extra details/tags/links expand on click.
- Cards can be dragged to reorder within a category or moved across categories
- Double-click card to edit, category edit button appears on hover
- HTML5 native Drag & Drop API — drag only starts from the `⠿` handle

## Whiteboard (Conception mode)

- Starts empty — user adds elements from the **side panel** (service nodes from dashboard catalog, or auxiliary: user, admin, terminal, database, internet, text note)
- **Connections** created by drag from port (right-click or hover port), double-click to edit
- **Zones** — draggable + resizable dashed rectangles, double-click to edit, hover ✕ to delete
- **Nodes** — draggable, hover shows delete button, connections follow in real-time
- **Pan/zoom** — wheel + drag on empty canvas. Space held = camera-only mode (pan even over elements)
- **Multi-select** — Shift+drag draws selection rectangle, Delete removes selected
- **Configs** — save/load named documents, or work in unnamed sandbox
- **Undo/Redo** — Ctrl+Z / Ctrl+Shift+Z (snapshot stack, max 50)
- **Ctrl+S** — save current document
- **Background** — customizable color/gradient (manual color pickers, linear/radial, angle), grid pattern (dots/lines/grid/cross with size/thickness/color/opacity sliders). Grid follows the camera.
- **Style** — font scale, node stroke width, connection thickness and opacity (live CSS custom properties)
- **Fullscreen** — via right panel button

## State

Global state `S` persisted to `localStorage` key `hjdash_v6`:
- `categories`, `nodes`, `connections`, `alerts` — dashboard data (order matters for display)
- `sandbox` — unsaved whiteboard state `{ nodes, zones, connections, positions, wbSettings }`
- `conceptionConfigs` — saved whiteboard documents (each has its own nodes/zones/connections/positions/wbSettings)
- `activeConceptionConfig` — currently loaded config id
- `whiteboardViewport` — pan/zoom

## Conventions

- UI and comments in French
- No frameworks — vanilla JS + CSS only
- Dark theme via CSS custom properties (with `--*-elevated` variants for layered surfaces)
- Fonts: JetBrains Mono + Outfit (Google Fonts CDN)
- Inline event handlers use `window.__` prefixed functions exposed from ES modules
- Avoid circular imports — shared utilities go in `ui.js`
