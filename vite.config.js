import { defineConfig, loadEnv } from 'vite';
import { rhinoCall } from './server/rhino.js';
import { chat, listConversations, createConversation, deleteConversation } from './server/claude.js';

// Per-quality preset: [gridMinCount, gridMaxCount]
// GridMinCount forces minimum subdivisions even on nearly-flat NURBS where
// angle-based refinement alone would produce only 2 triangles.
const QUALITY_PRESETS = {
  1: { gridMin: 1,  gridMax: 4  },  // Coarse
  2: { gridMin: 2,  gridMax: 8  },  // Low
  3: { gridMin: 4,  gridMax: 16 },  // Medium
  4: { gridMin: 8,  gridMax: 32 },  // High
  5: { gridMin: 16, gridMax: 64 },  // Ultra
};

function buildScript({ gridMin, gridMax }) {
  return `
import rhinoscriptsyntax as rs
import json
import math
import Rhino

mp = Rhino.Geometry.MeshingParameters()
mp.GridMinCount = ${gridMin}
mp.GridMaxCount = ${gridMax}
mp.RefineGrid = True

result = []
for obj_id in (rs.AllObjects() or []):
    try:
        mesh = None
        if rs.IsMesh(obj_id):
            mesh = rs.coercemesh(obj_id)
        elif rs.IsBrep(obj_id) or rs.IsSurface(obj_id) or rs.IsPolysurface(obj_id) or rs.IsExtrusion(obj_id):
            brep = rs.coercebrep(obj_id)
            if brep:
                parts = Rhino.Geometry.Mesh.CreateFromBrep(brep, mp)
                if parts:
                    mesh = Rhino.Geometry.Mesh()
                    for m in parts:
                        mesh.Append(m)
        if mesh is None:
            continue

        verts = [
            [float(mesh.Vertices[i].X), float(mesh.Vertices[i].Y), float(mesh.Vertices[i].Z)]
            for i in range(mesh.Vertices.Count)
        ]
        faces = []
        for i in range(mesh.Faces.Count):
            f = mesh.Faces[i]
            faces.append([f.A, f.B, f.C] if f.IsTriangle else [f.A, f.B, f.C, f.D])

        c = rs.ObjectColor(obj_id)
        result.append({
            'id':       str(obj_id),
            'name':     rs.ObjectName(obj_id) or '',
            'layer':    rs.ObjectLayer(obj_id) or '',
            'color':    [int(c.R), int(c.G), int(c.B)],
            'vertices': verts,
            'faces':    faces,
        })
    except Exception:
        pass

print(json.dumps(result))
`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export default defineConfig(({ mode }) => {
  // Load .env so ANTHROPIC_API_KEY is available to server-side code
  const env = loadEnv(mode, process.cwd(), '');
  if (env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;

  return {
    plugins: [
      {
        name: 'rhino-api',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const { pathname, searchParams } = new URL(req.url, 'http://localhost');

            // ── GET /api/sync ───────────────────────────────────────────────
            if (pathname === '/api/sync' && req.method === 'GET') {
              const q = Math.min(5, Math.max(1, parseInt(searchParams.get('q') || '3', 10)));
              const preset = QUALITY_PRESETS[q];
              console.log(`[rhino-api] sync quality=${q} (gridMin=${preset.gridMin}, gridMax=${preset.gridMax})`);

              res.setHeader('Content-Type', 'application/json');
              try {
                const response = await rhinoCall('execute_rhinoscript_python_code', { code: buildScript(preset) });
                if (response.status !== 'success' || !response.result?.success) {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: 'Rhino returned an error', rhinoResponse: response }));
                  return;
                }
                const firstLine = response.result.output.trim().split('\n')[0];
                res.end(firstLine);
              } catch (err) {
                console.error('[rhino-api] error:', err.message);
                res.statusCode = 503;
                res.end(JSON.stringify({ error: err.message }));
              }
              return;
            }

            // ── GET /api/conversations ──────────────────────────────────────
            if (pathname === '/api/conversations' && req.method === 'GET') {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(listConversations()));
              return;
            }

            // ── POST /api/conversations ─────────────────────────────────────
            if (pathname === '/api/conversations' && req.method === 'POST') {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(createConversation()));
              return;
            }

            // ── DELETE /api/conversations/:id ───────────────────────────────
            const delMatch = pathname.match(/^\/api\/conversations\/([^/]+)$/);
            if (delMatch && req.method === 'DELETE') {
              res.setHeader('Content-Type', 'application/json');
              deleteConversation(delMatch[1]);
              res.end(JSON.stringify({ ok: true }));
              return;
            }

            // ── POST /api/chat ──────────────────────────────────────────────
            if (pathname === '/api/chat' && req.method === 'POST') {
              res.setHeader('Content-Type', 'application/json');
              try {
                const body = await readBody(req);
                const { conversationId, message, selectedIds } = JSON.parse(body);
                const selLabel = selectedIds?.length ? ` [${selectedIds.length} selected]` : '';
                console.log(`[chat-api] user:${selLabel} ${message}`);
                const result = await chat(conversationId, message, selectedIds);
                console.log(`[chat-api] assistant: ${result.text} (toolsUsed=${result.toolsUsed})`);
                res.end(JSON.stringify(result));
              } catch (err) {
                console.error('[chat-api] error:', err.message);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
              }
              return;
            }

            next();
          });
        },
      },
    ],
  };
});
