import type { PathNode } from "./pathfinding";

export interface InterpolatorState {
  position: [number, number, number];
  rotationY: number;
  isMoving: boolean;
  progress: number; // 0..1
}

export class PathInterpolator {
  private path: PathNode[];
  private speed: number;
  private segmentLengths: number[];
  private totalLength: number;
  private elapsed: number = 0;
  private totalDuration: number;
  private _finished: boolean = false;

  constructor(path: PathNode[], speed: number = 3) {
    this.path = path;
    this.speed = speed;
    this.segmentLengths = [];
    this.totalLength = 0;

    // Precompute segment lengths
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i].position;
      const b = path[i + 1].position;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const dz = b[2] - a[2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      this.segmentLengths.push(len);
      this.totalLength += len;
    }

    this.totalDuration = this.totalLength / this.speed;
  }

  get finished(): boolean {
    return this._finished;
  }

  update(delta: number): InterpolatorState {
    if (this.path.length < 2 || this._finished) {
      const lastPos = this.path[this.path.length - 1].position;
      return {
        position: [...lastPos],
        rotationY: 0,
        isMoving: false,
        progress: 1,
      };
    }

    this.elapsed += delta;
    const distanceTraveled = this.elapsed * this.speed;

    if (distanceTraveled >= this.totalLength) {
      this._finished = true;
      const lastPos = this.path[this.path.length - 1].position;
      // Face direction of last segment
      const prev = this.path[this.path.length - 2].position;
      const rotationY = Math.atan2(lastPos[0] - prev[0], lastPos[2] - prev[2]);
      return {
        position: [...lastPos],
        rotationY,
        isMoving: false,
        progress: 1,
      };
    }

    // Find which segment we're on
    let accumulated = 0;
    for (let i = 0; i < this.segmentLengths.length; i++) {
      const segLen = this.segmentLengths[i];
      if (accumulated + segLen >= distanceTraveled) {
        const segProgress = (distanceTraveled - accumulated) / segLen;
        const a = this.path[i].position;
        const b = this.path[i + 1].position;

        const position: [number, number, number] = [
          a[0] + (b[0] - a[0]) * segProgress,
          a[1] + (b[1] - a[1]) * segProgress,
          a[2] + (b[2] - a[2]) * segProgress,
        ];

        const rotationY = Math.atan2(b[0] - a[0], b[2] - a[2]);

        return {
          position,
          rotationY,
          isMoving: true,
          progress: distanceTraveled / this.totalLength,
        };
      }
      accumulated += segLen;
    }

    // Fallback (shouldn't reach here)
    const lastPos = this.path[this.path.length - 1].position;
    return {
      position: [...lastPos],
      rotationY: 0,
      isMoving: false,
      progress: 1,
    };
  }
}
