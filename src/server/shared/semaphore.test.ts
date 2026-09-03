import { describe, expect, it } from "vitest";
import { createSemaphore } from "./semaphore.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("semaphore", () => {
  it("allows up to max concurrent acquisitions", async () => {
    const semaphore = createSemaphore(2);
    await semaphore.acquire();
    await semaphore.acquire();
    expect(semaphore.active).toBe(2);
    expect(semaphore.waiting).toBe(0);
  });

  it("queues excess acquisitions until a slot is released", async () => {
    const semaphore = createSemaphore(2);
    const gate1 = deferred();
    const gate2 = deferred();
    const gate3 = deferred();
    const started: string[] = [];
    const order: string[] = [];

    const run = async (name: string, gate: { promise: Promise<void>; resolve: () => void }) => {
      await semaphore.acquire();
      started.push(name);
      await gate.promise;
      semaphore.release();
      order.push(name);
    };

    const p1 = run("first", gate1);
    const p2 = run("second", gate2);
    const p3 = run("third", gate3);

    await tick();
    expect(started).toEqual(["first", "second"]); // 前两个立刻拿到槽位
    expect(semaphore.active).toBe(2);
    expect(semaphore.waiting).toBe(1); // 第三个排队

    gate1.resolve();
    await tick();
    await tick();
    expect(started).toEqual(["first", "second", "third"]); // 释放一个槽位后第三个进入
    expect(order).toEqual(["first"]);

    gate3.resolve();
    await tick();
    await tick();
    expect(order).toEqual(["first", "third"]);

    gate2.resolve();
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual(["first", "third", "second"]);
    expect(semaphore.active).toBe(0);
    expect(semaphore.waiting).toBe(0);
  });

  it("release without waiters decrements active, never below zero", () => {
    const semaphore = createSemaphore(1);
    semaphore.release();
    expect(semaphore.active).toBe(0);
  });
});
