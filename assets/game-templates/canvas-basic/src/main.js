const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

canvas.width = 800;
canvas.height = 600;

// Input
const keys = new Set();
window.addEventListener("keydown", (e) => keys.add(e.code));
window.addEventListener("keyup", (e) => keys.delete(e.code));

// Game state
const gameState = {
  score: 0,
  running: true,
};

const player = {
  x: canvas.width / 2 - 16,
  y: canvas.height / 2 - 16,
  width: 32,
  height: 32,
  speed: 200,
  color: "#00ff88",
};

window.__GAME_STATE__ = gameState;
window.__GAME_API__ = {
  getCanvas: () => canvas,
  getContext: () => ctx,
  getPlayer: () => player,
};

// Game loop
let lastTime = performance.now();

function update(delta) {
  if (keys.has("KeyW") || keys.has("ArrowUp")) player.y -= player.speed * delta;
  if (keys.has("KeyS") || keys.has("ArrowDown")) player.y += player.speed * delta;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) player.x -= player.speed * delta;
  if (keys.has("KeyD") || keys.has("ArrowRight")) player.x += player.speed * delta;

  // Clamp to bounds
  player.x = Math.max(0, Math.min(canvas.width - player.width, player.x));
  player.y = Math.max(0, Math.min(canvas.height - player.height, player.y));
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw grid
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // Draw player
  ctx.fillStyle = player.color;
  ctx.fillRect(player.x, player.y, player.width, player.height);

  // Draw score
  ctx.fillStyle = "#fff";
  ctx.font = "18px monospace";
  ctx.fillText(`Score: ${gameState.score}`, 16, 30);
}

function loop(now) {
  if (!gameState.running) return;
  const delta = (now - lastTime) / 1000;
  lastTime = now;
  update(delta);
  draw();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

// Resize handling
window.addEventListener("resize", () => {
  // Keep fixed game resolution, CSS scales
});
