import * as THREE from 'three';

// Rhino is Z-up; Three.js is Y-up.  (rx, ry, rz) → (rx, rz, -ry)
function rhinoToThree(rx, ry, rz) {
  return [rx, rz, -ry];
}

export const rhinoObjects = new Map(); // rhinoId → THREE.Mesh
let rhinoGroup = null;

// ── Debug panel ────────────────────────────────────────────────────────────
const debugPanel  = document.getElementById('debug-panel');
const debugBody   = document.getElementById('debug-body');
const debugHeader = document.getElementById('debug-header');
const debugToggle = document.getElementById('debug-toggle');
let debugCollapsed = false;
let debugVisible   = false;

debugPanel.style.display = 'none';

debugHeader.addEventListener('click', () => {
  debugCollapsed = !debugCollapsed;
  debugBody.style.display = debugCollapsed ? 'none' : '';
  debugToggle.textContent  = debugCollapsed ? '▶' : '▼';
});

document.addEventListener('keydown', e => {
  if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.altKey && !e.metaKey) {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    debugVisible = !debugVisible;
    debugPanel.style.display = debugVisible ? '' : 'none';
  }
});

function debugShow(text, isError = false) {
  debugBody.className = isError ? 'error' : '';
  debugBody.textContent = text;
  if (debugCollapsed) {
    debugCollapsed = false;
    debugBody.style.display = '';
    debugToggle.textContent = '▼';
  }
}

// ── Selection ──────────────────────────────────────────────────────────────
let _selectedIds = new Set();

export function getSelectedIds() {
  return [..._selectedIds];
}

export function updateSelection(selectedIds) {
  _selectedIds = selectedIds;
  for (const [id, mesh] of rhinoObjects) {
    const edges = mesh.children.find(c => c.isLineSegments);
    if (edges) edges.visible = _selectedIds.has(id);
  }
  window.dispatchEvent(new CustomEvent('rhino-selection', { detail: { count: _selectedIds.size } }));
}

// ── Sync ───────────────────────────────────────────────────────────────────
const QUALITY_LABELS = ['', 'Coarse', 'Low', 'Medium', 'High', 'Ultra'];

let _appendMessage = null;

export async function triggerSync(autoFocus = false) {
  if (_appendMessage) await syncScene(_appendMessage, autoFocus);
}

export function initSync(scene, appendMessage) {
  _appendMessage = appendMessage;
  rhinoGroup = new THREE.Group();
  scene.add(rhinoGroup);

  const slider = document.getElementById('mesh-quality');
  const label  = document.getElementById('quality-label');
  slider.addEventListener('input', () => { label.textContent = QUALITY_LABELS[slider.value]; });

  document.getElementById('sync-btn').addEventListener('click', () =>
    syncScene(appendMessage)
  );
}

async function syncScene(appendMessage, autoFocus = false) {
  const btn = document.getElementById('sync-btn');
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  debugShow('Fetching /api/sync …');

  let rawText = '';
  try {
    const quality = document.getElementById('mesh-quality').value;
    const res = await fetch(`/api/sync?q=${quality}`);
    rawText = await res.text();

    debugShow(rawText);

    if (!res.ok) {
      let errMsg;
      try { errMsg = JSON.parse(rawText).error; } catch { errMsg = rawText; }
      throw new Error(errMsg || `HTTP ${res.status}`);
    }

    const data = JSON.parse(rawText);
    debugShow(JSON.stringify(data, null, 2));
    updateScene(data, autoFocus);
    appendMessage(`Synced ${data.length} object(s) from Rhino.`, 'assistant');
    btn.textContent = '✓ Synced';
    setTimeout(() => { btn.textContent = 'Sync'; btn.disabled = false; }, 1500);
  } catch (err) {
    debugShow(`ERROR: ${err.message}\n\nRaw response:\n${rawText}`, true);
    appendMessage(`Sync failed: ${err.message}`, 'assistant');
    btn.textContent = 'Sync';
    btn.disabled = false;
  }
}

// ── Scene update ───────────────────────────────────────────────────────────
function updateScene(objects, autoFocus = false) {
  const newIds = new Set(objects.map(o => o.id));

  for (const [id, mesh] of rhinoObjects) {
    if (!newIds.has(id)) {
      rhinoGroup.remove(mesh);
      mesh.geometry.dispose();
      rhinoObjects.delete(id);
    }
  }

  for (const obj of objects) {
    if (rhinoObjects.has(obj.id)) {
      const old = rhinoObjects.get(obj.id);
      rhinoGroup.remove(old);
      old.geometry.dispose();
    }
    const mesh = buildMesh(obj);
    rhinoGroup.add(mesh);
    rhinoObjects.set(obj.id, mesh);
  }

  // Reapply wireframe state after rebuild
  updateSelection(_selectedIds);

  if (autoFocus && objects.length > 0) {
    window.dispatchEvent(new CustomEvent('rhino-focus', {
      detail: { ids: objects.map(o => o.id) }
    }));
  }
}

function buildMesh({ vertices, faces, color }) {
  const geo = new THREE.BufferGeometry();

  const positions = new Float32Array(vertices.length * 3);
  for (let i = 0; i < vertices.length; i++) {
    const [x, y, z] = rhinoToThree(...vertices[i]);
    positions[i * 3]     = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const indices = [];
  for (const f of faces) {
    if (f.length === 3) {
      indices.push(f[0], f[1], f[2]);
    } else {
      indices.push(f[0], f[1], f[2], f[0], f[2], f[3]);
    }
  }
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const rhinoColor = color
    ? new THREE.Color(color[0] / 255, color[1] / 255, color[2] / 255)
    : new THREE.Color(0x7a9cbf);
  const mat = new THREE.MeshStandardMaterial({ color: rhinoColor, roughness: 0.5, metalness: 0.05, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // Edges shown only when selected (yellow highlight)
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 25),
    new THREE.LineBasicMaterial({ color: 0xffcc00 })
  );
  edges.visible = false;
  mesh.add(edges);

  return mesh;
}
