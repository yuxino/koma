// 极简信号量：限制同时执行的任务数量，超出部分排队等待。
// 用于限制 ffmpeg 抽帧/转写等重活儿的并发度，避免多个大视频把服务拖垮。
export interface Semaphore {
  acquire(): Promise<void>;
  release(): void;
  readonly active: number;
  readonly waiting: number;
}

export function createSemaphore(max: number): Semaphore {
  let active = 0;
  const queue: Array<() => void> = [];
  return {
    get active() { return active; },
    get waiting() { return queue.length; },
    acquire(): Promise<void> {
      if (active < max) {
        active += 1;
        return Promise.resolve();
      }
      return new Promise((resolve) => queue.push(resolve));
    },
    release(): void {
      const next = queue.shift();
      if (next) {
        next();
      } else {
        active = Math.max(0, active - 1);
      }
    }
  };
}
