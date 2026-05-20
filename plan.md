# Project Plan: Rhino MCP Web Interface

## What We're Building

A web-based replacement for Claude Desktop that lets users type natural language commands,
executes them against a running Rhino instance via RhinoMCP, and mirrors the resulting 3D
scene in a Three.js viewport — all without the user ever touching Rhino directly.

This is a demo project so no need to take care of maintainability.

---

## How the MCP Pipeline Actually Works

Understanding this is the key to knowing what to replace.

### The full chain in Claude Desktop:

```
User types "create a cube"
        ↓
Claude Desktop starts the Python MCP server as a subprocess
        ↓
MCP server advertises its tools via tools/list (names + JSON schemas + docstrings)
        ↓
Claude Desktop injects those tool descriptions into Claude's context
        ↓
Claude (the AI model) reasons: "create_object with type=BOX seems right" → emits a tool call
        ↓
Claude Desktop receives the tool call JSON and forwards it to the Python MCP server
        ↓
Python MCP server calls create_object(), which sends over TCP:
    { "type": "create_object", "params": { "type": "BOX", "params": {"width":1,"length":1,"height":1} } }
        ↓
Rhino plugin receives JSON, calls Rhino's geometry kernel, returns { "status": "ok", "result": {...} }
        ↓
Python MCP server returns result to Claude Desktop → Claude sees it and replies to user
```

### The critical insight

Claude does ALL the natural-language-to-tool-call translation.
The MCP server only defines the schema (via Python function signatures + docstrings).
Claude reads those schemas and decides which function to call and with what arguments.

There is no separate "command parser" — Claude is the parser.

---

## Available Tools (from the MCP server)

Key tools exposed by rhinomcp that we care about:

| Tool | What it does |
|---|---|
| `create_object` | Creates primitives: BOX, SPHERE, CYLINDER, CONE, POINT, LINE, CIRCLE, CURVE, SURFACE |
| `modify_object` | Move, rotate, scale an existing object |
| `delete_object` | Remove an object by ID |
| `get_document_summary` | Returns object counts, layer hierarchy, bounding box — lightweight |
| `get_objects` | Returns objects with optional filters (name, type, layer) |
| `get_object_info` | Full details on a specific object |
| `select_objects` | Filter/select objects by name, color, category |
| `boolean_operations` | Union, difference, intersection |
| `capture_viewport` | Screenshot of the Rhino viewport |
| `execute_rhinoscript_python_code` | Run arbitrary Python in Rhino |

The TCP socket protocol (Rhino plugin side):
```json
→ { "type": "create_object", "params": { "type": "BOX", "params": {"width": 1, "length": 1, "height": 1} } }
← { "status": "ok", "result": { "id": "abc123", "name": "Box01", "type": "BOX" } }
```

---


## Interaction

Rhino like mouse control for designers

Select to edit function for more detailed control over verbally describe what to change

## Replacing Claude Desktop: Our Architecture

```
Browser (Three.js + chat panel)
        ↕  WebSocket or HTTP
Node.js backend (Express)
        ↕  Anthropic SDK (Claude API with tool_use)
Claude API  ←→  tool schemas (fetched or hardcoded from MCP server)
        ↓  when Claude returns a tool_call
Node.js backend
        ↕  TCP socket to localhost:1999   (or MCP client library)
Rhino plugin (running in background, user never sees it)
        ↓  after tool executes
Node.js queries get_document_summary / get_objects
        ↓
Converts Rhino mesh/geometry data → Three.js-compatible JSON
        ↓
Pushes scene update to browser via WebSocket
        ↓
Three.js viewport re-renders
```

### Reaching the Rhino plugin

The Rhino plugin (TCP socket on localhost:1999) MUST always be running — it's what
actually executes commands inside Rhino.

Node.js backend  ──TCP JSON──▶  Rhino plugin (:1999)
- Node.js opens a TCP socket to localhost:1999 and sends JSON commands directly
- Hardcode the tool schemas in the backend (they don't change)
- No Python process needed at runtime — just Rhino with the plugin installed

---

## Scene Synchronization Strategy

After every tool call completes:
1. Call `get_document_summary` — get the list of object IDs and types
2. Call `get_objects` — get positions, bounding boxes, basic mesh data
3. For mesh geometry, use `execute_rhinoscript_python_code` to extract mesh vertices/faces
4. Send the diff (added/removed/modified objects) to the browser
5. Three.js creates or updates meshes accordingly

For simple primitives (BOX, SPHERE, CYLINDER), Three.js can reconstruct the geometry
natively from the type + params returned by Rhino — no mesh export needed.
For complex geometry (booleans, NURBS, free-form curves), we need Rhino's tessellated mesh.

---

## Implementation Phases

### Phase 1 (current) — UI shell ✓
- Three.js viewport with Rhino-style camera controls
- Chat panel interface

### Phase 2 — Backend + Claude integration
- Node.js/Express server with WebSocket
- Claude API with tool_use, tool schemas from rhinomcp
- TCP client to Rhino socket

### Phase 3 — Scene sync
- After each tool call, query Rhino scene state
- Push updates to Three.js
- Handle primitives natively, meshes via tessellation export

### Phase 4 — Polish
- Object selection (click in Three.js → highlight in Rhino and vice versa)
- Undo/redo passthrough
- Layer panel
