// The real engine can't crash on demand once the validator is in front of it, so these
// use a stand-in worker to check how the client handles each kind of trouble.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILD_BUDGET_MS, EngineClient, FIRST_BUILD_BUDGET_MS, RESTART_ABOVE_MB, type EngineEvents } from "../src/app/engineClient.js";
import type { BuildPlan } from "../src/validate.js";

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  terminated = false;
  received: any[] = [];

  constructor() {
    FakeWorker.all.push(this);
  }

  postMessage(message: any) {
    this.received.push(message);
    if (message.type === "init") queueMicrotask(() => this.reply(message.id, {}));
  }

  terminate() {
    this.terminated = true;
  }

  reply(id: number, result: unknown) {
    this.onmessage?.({ data: { id, ok: true, result } });
  }

  fail(id: number, error: string) {
    this.onmessage?.({ data: { id, ok: false, error } });
  }

  get builds() {
    return this.received.filter((m) => m.type === "build");
  }
}

const planNamed = (name: string) => ({ name }) as unknown as BuildPlan;
const built = (heapMB = 100) => ({ meshes: [], partCount: 2, partKinds: ["shell", "shell"], partColors: ["#ccc", "#ccc"], rebuilt: "all", buildMs: 1, heapMB });
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const current = () => FakeWorker.all.at(-1)!;

describe("the engine client", () => {
  let events: { [K in keyof EngineEvents]: ReturnType<typeof vi.fn> };
  let client: EngineClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.all = [];
    events = { onBuilt: vi.fn(), onBusy: vi.fn(), onFailure: vi.fn(), onRestart: vi.fn() };
    client = new EngineClient(events as unknown as EngineEvents);
  });

  afterEach(() => {
    client.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends a plan once the engine is ready, and reports the result", async () => {
    client.submit(planNamed("a"));
    await settle();
    expect(current().builds).toHaveLength(1);
    current().reply(current().builds[0].id, built());
    await settle();
    expect(events.onBuilt).toHaveBeenCalledOnce();
    expect(events.onBusy).toHaveBeenLastCalledWith(false);
  });

  it("drops plans overtaken while a build runs, keeping only the newest", async () => {
    client.submit(planNamed("a"));
    await settle();
    for (const name of ["b", "c", "d"]) client.submit(planNamed(name));
    current().reply(current().builds[0].id, built());
    await settle();
    expect(current().builds.map((m) => m.plan.name)).toEqual(["a", "d"]);
  });

  it("replaces the engine when its memory runs high, then rebuilds", async () => {
    client.submit(planNamed("a"));
    await settle();
    const first = current();
    first.reply(first.builds[0].id, built(RESTART_ABOVE_MB + 1));
    await settle();
    expect(first.terminated).toBe(true);
    expect(events.onRestart).toHaveBeenCalledWith("memory");
    expect(current()).not.toBe(first);
    expect(current().builds.map((m) => m.plan.name)).toEqual(["a"]);
  });

  it("keeps the engine when memory is under the limit", async () => {
    client.submit(planNamed("a"));
    await settle();
    current().reply(current().builds[0].id, built(RESTART_ABOVE_MB));
    await settle();
    expect(FakeWorker.all).toHaveLength(1);
  });

  it("retries once on a fresh engine after an exception, without reporting failure", async () => {
    client.submit(planNamed("a"));
    await settle();
    const first = current();
    first.fail(first.builds[0].id, "memory access out of bounds");
    await settle();
    expect(first.terminated).toBe(true);
    expect(events.onRestart).toHaveBeenCalledWith("failure");
    expect(events.onFailure).not.toHaveBeenCalled();
    current().reply(current().builds[0].id, built());
    await settle();
    expect(events.onBuilt).toHaveBeenCalledOnce();
  });

  it("reports failure when the retry fails too, and stops", async () => {
    client.submit(planNamed("a"));
    await settle();
    current().fail(current().builds[0].id, "boom");
    await settle();
    current().fail(current().builds[0].id, "boom again");
    await settle();
    expect(events.onFailure).toHaveBeenCalledWith("boom again");
    expect(FakeWorker.all.at(-1)!.builds).toHaveLength(0);
  });

  it("recovers on the next plan after a reported failure", async () => {
    client.submit(planNamed("bad"));
    await settle();
    current().fail(current().builds[0].id, "boom");
    await settle();
    current().fail(current().builds[0].id, "boom");
    await settle();
    client.submit(planNamed("good"));
    await settle();
    current().reply(current().builds[0].id, built());
    await settle();
    expect(events.onBuilt).toHaveBeenCalledOnce();
  });

  it("abandons a build that overruns, allowing longer for the first", async () => {
    client.submit(planNamed("a"));
    await settle();
    current().reply(current().builds[0].id, built());
    await settle();
    client.submit(planNamed("b"));
    await settle();
    const worker = current();
    await vi.advanceTimersByTimeAsync(BUILD_BUDGET_MS - 1);
    expect(worker.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(worker.terminated).toBe(true);
    expect(current().builds.map((m) => m.plan.name)).toEqual(["b"]);

    // The fresh engine counts as a first build again, so it gets the longer budget.
    await vi.advanceTimersByTimeAsync(BUILD_BUDGET_MS + 1);
    expect(current().terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(FIRST_BUILD_BUDGET_MS);
    expect(events.onFailure).toHaveBeenCalledOnce();
  });

  it("holds an export until the newest plan has finished", async () => {
    client.submit(planNamed("a"));
    await settle();
    const exporting = client.exportPart(planNamed("a"), 0, "stl");
    await settle();
    expect(current().received.some((m) => m.type === "export")).toBe(false);
    current().reply(current().builds[0].id, built());
    await settle();
    await vi.advanceTimersByTimeAsync(25);
    const request = current().received.find((m) => m.type === "export");
    expect(request).toMatchObject({ index: 0, format: "stl" });
    const bytes = new ArrayBuffer(4);
    current().reply(request.id, bytes);
    await expect(exporting).resolves.toBe(bytes);
  });
});
