import { scene, camera, renderer } from './scene.js';
import { RhinoControls } from './controls.js';
import { appendMessage, initUI } from './ui.js';
import { initSync } from './sync.js';

new RhinoControls(camera, renderer.domElement);
initUI();
initSync(scene, appendMessage);

(function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
})();
