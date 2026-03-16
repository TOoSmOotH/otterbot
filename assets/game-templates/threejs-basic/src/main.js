import * as THREE from "three";
import { InputManager } from "./input.js";

// --- Scene setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, 10);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 10, 5);
scene.add(directionalLight);

// --- Game objects ---
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshStandardMaterial({ color: 0x00ff88 });
const cube = new THREE.Mesh(geometry, material);
cube.position.y = 0.5;
scene.add(cube);

const groundGeometry = new THREE.PlaneGeometry(20, 20);
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x333366 });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// --- Input ---
const input = new InputManager();

// --- Game state ---
const gameState = {
  score: 0,
  running: true,
};

// Expose game state for playtesting instrumentation
window.__GAME_STATE__ = gameState;
window.__GAME_API__ = {
  getScene: () => scene,
  getCamera: () => camera,
  getRenderer: () => renderer,
};

// --- Game loop ---
const clock = new THREE.Clock();

function update(delta) {
  cube.rotation.y += delta;

  const speed = 5;
  if (input.isKeyDown("KeyW") || input.isKeyDown("ArrowUp")) cube.position.z -= speed * delta;
  if (input.isKeyDown("KeyS") || input.isKeyDown("ArrowDown")) cube.position.z += speed * delta;
  if (input.isKeyDown("KeyA") || input.isKeyDown("ArrowLeft")) cube.position.x -= speed * delta;
  if (input.isKeyDown("KeyD") || input.isKeyDown("ArrowRight")) cube.position.x += speed * delta;
}

function animate() {
  if (!gameState.running) return;
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  update(delta);
  renderer.render(scene, camera);
}

animate();

// --- Resize handling ---
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
