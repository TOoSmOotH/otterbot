const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true);

const createScene = () => {
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.1, 0.1, 0.18, 1);

  // Camera
  const camera = new BABYLON.ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 3, 15, BABYLON.Vector3.Zero(), scene);
  camera.attachControl(canvas, true);

  // Lighting
  const hemisphericLight = new BABYLON.HemisphericLight("hemiLight", new BABYLON.Vector3(0, 1, 0), scene);
  hemisphericLight.intensity = 0.5;

  const directionalLight = new BABYLON.DirectionalLight("dirLight", new BABYLON.Vector3(-1, -2, -1), scene);
  directionalLight.intensity = 0.7;

  // Ground
  const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 20, height: 20 }, scene);
  const groundMat = new BABYLON.StandardMaterial("groundMat", scene);
  groundMat.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.4);
  ground.material = groundMat;

  // Player cube
  const player = BABYLON.MeshBuilder.CreateBox("player", { size: 1 }, scene);
  player.position.y = 0.5;
  const playerMat = new BABYLON.StandardMaterial("playerMat", scene);
  playerMat.diffuseColor = new BABYLON.Color3(0, 1, 0.53);
  player.material = playerMat;

  // Input
  const inputMap = {};
  scene.actionManager = new BABYLON.ActionManager(scene);
  scene.actionManager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyDownTrigger, (e) => {
    inputMap[e.sourceEvent.code] = true;
  }));
  scene.actionManager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyUpTrigger, (e) => {
    inputMap[e.sourceEvent.code] = false;
  }));

  // Game state
  const gameState = { score: 0, running: true };
  window.__GAME_STATE__ = gameState;
  window.__GAME_API__ = {
    getScene: () => scene,
    getEngine: () => engine,
    getPlayer: () => player,
  };

  // Game loop
  const speed = 5;
  scene.onBeforeRenderObservable.add(() => {
    const delta = engine.getDeltaTime() / 1000;
    player.rotation.y += delta;

    if (inputMap["KeyW"] || inputMap["ArrowUp"]) player.position.z -= speed * delta;
    if (inputMap["KeyS"] || inputMap["ArrowDown"]) player.position.z += speed * delta;
    if (inputMap["KeyA"] || inputMap["ArrowLeft"]) player.position.x -= speed * delta;
    if (inputMap["KeyD"] || inputMap["ArrowRight"]) player.position.x += speed * delta;
  });

  return scene;
};

const scene = createScene();

engine.runRenderLoop(() => {
  scene.render();
});

window.addEventListener("resize", () => {
  engine.resize();
});
