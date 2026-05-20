import * as THREE from 'three';
import { rhinoObjects, updateSelection } from './sync.js';

// Right-drag → orbit | Shift+right-drag → pan | Scroll → zoom
// Left-click → select | Shift+left-click → add | Ctrl+left-click → remove
export class RhinoControls {
  constructor(cam, el) {
    this.cam = cam;
    this.el = el;
    this.target = new THREE.Vector3(0, 0, 0);

    this._sph = new THREE.Spherical();
    this._sph.setFromVector3(new THREE.Vector3().subVectors(cam.position, this.target));

    this._state = null;
    this._lx = 0;
    this._ly = 0;

    this._selectedIds = new Set();
    this._raycaster = new THREE.Raycaster();
    this._selStart = null;

    this._zoomBtn = document.getElementById('zoom-selected');
    if (this._zoomBtn) {
      this._zoomBtn.addEventListener('click', () => this._zoomToSelected());
    }

    window.addEventListener('rhino-focus', e => this._zoomToObjects(e.detail.ids));

    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', this._down.bind(this));
    el.addEventListener('pointermove', this._move.bind(this));
    el.addEventListener('pointerup', this._up.bind(this));
    el.addEventListener('pointercancel', this._up.bind(this));
    el.addEventListener('wheel', this._wheel.bind(this), { passive: false });
  }

  _down(e) {
    if (e.button === 0) {
      this._selStart = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 2) return;
    e.preventDefault();
    this.el.setPointerCapture(e.pointerId);
    this._state = e.shiftKey ? 'pan' : 'rotate';
    this._lx = e.clientX;
    this._ly = e.clientY;
  }

  _move(e) {
    if (!this._state) return;
    const dx = e.clientX - this._lx;
    const dy = e.clientY - this._ly;
    this._lx = e.clientX;
    this._ly = e.clientY;

    if (this._state === 'rotate') {
      this._sph.theta -= dx * 0.006;
      this._sph.phi   -= dy * 0.006;
      this._sph.phi = Math.max(0.02, Math.min(Math.PI - 0.02, this._sph.phi));
      this._commit();
    } else {
      const speed = this._sph.radius * 0.0012;
      const right = new THREE.Vector3().setFromMatrixColumn(this.cam.matrix, 0);
      const up    = new THREE.Vector3().setFromMatrixColumn(this.cam.matrix, 1);
      this.cam.position.add(
        new THREE.Vector3().addScaledVector(right, -dx * speed).addScaledVector(up, dy * speed)
      );
      this.target.add(
        new THREE.Vector3().addScaledVector(right, -dx * speed).addScaledVector(up, dy * speed)
      );
    }
  }

  _up(e) {
    if (e.type === 'pointercancel') {
      this._state = null;
      this._selStart = null;
      try { this.el.releasePointerCapture(e.pointerId); } catch (_) {}
      return;
    }

    if (e.button === 0 && this._selStart) {
      const dx = e.clientX - this._selStart.x;
      const dy = e.clientY - this._selStart.y;
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) this._doSelect(e);
      this._selStart = null;
      return;
    }

    if (e.button === 2) {
      this._state = null;
      try { this.el.releasePointerCapture(e.pointerId); } catch (_) {}
    }
  }

  _doSelect(e) {
    const rect = this.el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this._raycaster.setFromCamera(new THREE.Vector2(x, y), this.cam);
    const meshes = Array.from(rhinoObjects.values());
    const intersects = this._raycaster.intersectObjects(meshes, false);

    let hitId = null;
    if (intersects.length > 0) {
      const hitMesh = intersects[0].object;
      for (const [id, mesh] of rhinoObjects) {
        if (mesh === hitMesh) { hitId = id; break; }
      }
    }

    if (e.shiftKey) {
      if (hitId !== null) this._selectedIds.add(hitId);
    } else if (e.ctrlKey) {
      if (hitId !== null) this._selectedIds.delete(hitId);
    } else {
      this._selectedIds.clear();
      if (hitId !== null) this._selectedIds.add(hitId);
    }

    updateSelection(this._selectedIds);
    this._updateZoomBtn();
  }

  _updateZoomBtn() {
    if (this._zoomBtn) {
      this._zoomBtn.style.display = this._selectedIds.size > 0 ? 'block' : 'none';
    }
  }

  _zoomToSelected() {
    this._zoomToObjects([...this._selectedIds]);
  }

  _zoomToObjects(ids) {
    const meshes = ids.map(id => rhinoObjects.get(id)).filter(Boolean);
    if (meshes.length === 0) return;

    const box = new THREE.Box3();
    for (const mesh of meshes) box.expandByObject(mesh);

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.1);

    this.target.copy(center);
    this._sph.radius = maxDim * 2.5;
    this._commit();
  }

  _wheel(e) {
    e.preventDefault();
    this._sph.radius *= 1 + e.deltaY * 0.001;
    this._sph.radius = Math.max(0.5, Math.min(250, this._sph.radius));
    this._commit();
  }

  _commit() {
    this.cam.position.setFromSpherical(this._sph).add(this.target);
    this.cam.lookAt(this.target);
  }
}
