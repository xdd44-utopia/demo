import * as THREE from 'three';

// Right-drag → orbit | Shift+right-drag → pan | Scroll → zoom
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

    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', this._down.bind(this));
    el.addEventListener('pointermove', this._move.bind(this));
    el.addEventListener('pointerup', this._up.bind(this));
    el.addEventListener('pointercancel', this._up.bind(this));
    el.addEventListener('wheel', this._wheel.bind(this), { passive: false });
  }

  _down(e) {
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
    if (e.type !== 'pointercancel' && e.button !== 2) return;
    this._state = null;
    try { this.el.releasePointerCapture(e.pointerId); } catch (_) {}
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
