export class InputManager {
  constructor() {
    this.keys = new Set();
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseDown = false;

    window.addEventListener("keydown", (e) => this.keys.add(e.code));
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("mousemove", (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
    window.addEventListener("mousedown", () => (this.mouseDown = true));
    window.addEventListener("mouseup", () => (this.mouseDown = false));
  }

  isKeyDown(code) {
    return this.keys.has(code);
  }
}
