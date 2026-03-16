const canvas = document.getElementById("application");
const app = new pc.Application(canvas, {
  mouse: new pc.Mouse(canvas),
  keyboard: new pc.Keyboard(window),
});

app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);

// Camera
const cameraEntity = new pc.Entity("camera");
cameraEntity.addComponent("camera", { clearColor: new pc.Color(0.1, 0.1, 0.18) });
cameraEntity.setPosition(0, 8, 12);
cameraEntity.lookAt(0, 0, 0);
app.root.addChild(cameraEntity);

// Light
const light = new pc.Entity("light");
light.addComponent("light", { type: "directional" });
light.setEulerAngles(45, 30, 0);
app.root.addChild(light);

const ambientLight = new pc.Entity("ambientLight");
ambientLight.addComponent("light", { type: "omni", color: new pc.Color(0.3, 0.3, 0.4), intensity: 0.5 });
ambientLight.setPosition(0, 5, 0);
app.root.addChild(ambientLight);

// Ground
const ground = new pc.Entity("ground");
ground.addComponent("render", { type: "plane" });
ground.setLocalScale(20, 1, 20);
const groundMat = new pc.StandardMaterial();
groundMat.diffuse = new pc.Color(0.2, 0.2, 0.4);
groundMat.update();
ground.render.meshInstances[0].material = groundMat;
app.root.addChild(ground);

// Player
const player = new pc.Entity("player");
player.addComponent("render", { type: "box" });
player.setPosition(0, 0.5, 0);
const playerMat = new pc.StandardMaterial();
playerMat.diffuse = new pc.Color(0, 1, 0.53);
playerMat.update();
player.render.meshInstances[0].material = playerMat;
app.root.addChild(player);

// Game state
const gameState = { score: 0, running: true };
window.__GAME_STATE__ = gameState;
window.__GAME_API__ = {
  getApp: () => app,
  getPlayer: () => player,
};

// Game loop
const speed = 5;
app.on("update", (dt) => {
  if (!gameState.running) return;

  player.rotateLocal(0, dt * 60, 0);

  const keyboard = app.keyboard;
  if (keyboard.isPressed(pc.KEY_W) || keyboard.isPressed(pc.KEY_UP)) player.translateLocal(0, 0, -speed * dt);
  if (keyboard.isPressed(pc.KEY_S) || keyboard.isPressed(pc.KEY_DOWN)) player.translateLocal(0, 0, speed * dt);
  if (keyboard.isPressed(pc.KEY_A) || keyboard.isPressed(pc.KEY_LEFT)) player.translateLocal(-speed * dt, 0, 0);
  if (keyboard.isPressed(pc.KEY_D) || keyboard.isPressed(pc.KEY_RIGHT)) player.translateLocal(speed * dt, 0, 0);
});

app.start();

window.addEventListener("resize", () => {
  app.resizeCanvas();
});
