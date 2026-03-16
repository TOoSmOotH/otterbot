class MainScene extends Phaser.Scene {
  constructor() {
    super("MainScene");
  }

  preload() {
    // Generate a simple player texture procedurally
    const gfx = this.add.graphics();
    gfx.fillStyle(0x00ff88, 1);
    gfx.fillRect(0, 0, 32, 32);
    gfx.generateTexture("player", 32, 32);
    gfx.destroy();
  }

  create() {
    // Background
    this.cameras.main.setBackgroundColor("#1a1a2e");

    // Player
    this.player = this.physics.add.sprite(400, 300, "player");
    this.player.setCollideWorldBounds(true);

    // Input
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    });

    // Score text
    this.scoreText = this.add.text(16, 16, "Score: 0", {
      fontSize: "18px",
      fill: "#fff",
    });

    // Game state
    this.gameState = { score: 0, running: true };
    window.__GAME_STATE__ = this.gameState;
    window.__GAME_API__ = {
      getScene: () => this,
      getPlayer: () => this.player,
    };
  }

  update() {
    if (!this.gameState.running) return;

    const speed = 200;
    this.player.setVelocity(0);

    if (this.cursors.left.isDown || this.wasd.left.isDown) this.player.setVelocityX(-speed);
    else if (this.cursors.right.isDown || this.wasd.right.isDown) this.player.setVelocityX(speed);

    if (this.cursors.up.isDown || this.wasd.up.isDown) this.player.setVelocityY(-speed);
    else if (this.cursors.down.isDown || this.wasd.down.isDown) this.player.setVelocityY(speed);
  }
}

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  physics: {
    default: "arcade",
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scene: MainScene,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

const game = new Phaser.Game(config);
