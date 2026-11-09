// Talks to the engine worker. Only the newest plan matters, so while one build runs,
// later plans replace each other instead of queueing. The worker is replaced when its
// memory runs high, a build overruns, or it throws.
import type { BuildPlan } from "../validate.js";
import type { FitTestPlan } from "../fitTest.js";
import type { PartPrintReport } from "../printing.js";
import type { BedView, BuildResult, EngineRequest, FitTestMesh, PartKind, PartMesh, ReferenceMesh } from "./engine.worker.js";

export const RESTART_ABOVE_MB = 1000;
export const BUILD_BUDGET_MS = 5000;
export const FIRST_BUILD_BUDGET_MS = 30000;

export type { BedView, BuildResult, FitTestMesh, PartKind, PartMesh, ReferenceMesh };

export interface EngineEvents {
  onBuilt(result: BuildResult, shownAt: number): void;
  onBusy(busy: boolean): void;
  onFailure(message: string): void;
  onRestart(reason: string): void;
}

interface Pending {
  resolve(value: any): void;
  reject(error: Error): void;
}

type RequestBody = EngineRequest extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;

export class EngineClient {
  private worker!: Worker;
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private ready!: Promise<unknown>;
  private latest: BuildPlan | null = null;
  private latestAt = 0;
  private queued = false;
  private running = false;
  private failures = 0;
  private firstBuild = true;
  private disposed = false;

  constructor(private events: EngineEvents) {
    this.start();
  }

  private start() {
    this.worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = ({ data: { id, ok, result, error } }) => {
      const entry = this.pending.get(id);
      this.pending.delete(id);
      if (ok) entry?.resolve(result);
      else entry?.reject(new Error(error));
    };
    this.worker.onerror = (event) => {
      for (const entry of this.pending.values()) entry.reject(new Error(event.message || "The engine stopped."));
      this.pending.clear();
    };
    this.firstBuild = true;
    this.ready = this.call({ type: "init" });
  }

  private call<T>(body: RequestBody): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...body, id });
    });
  }

  private restart(reason: string) {
    this.worker.terminate();
    for (const entry of this.pending.values()) entry.reject(new Error("The engine restarted."));
    this.pending.clear();
    this.start();
    this.events.onRestart(reason);
  }

  // Asks for this plan to be shown. Plans sent while busy overwrite each other.
  submit(plan: BuildPlan) {
    this.latest = plan;
    this.latestAt = performance.now();
    this.queued = true;
    void this.pump();
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    this.events.onBusy(true);
    while (this.queued && !this.disposed) {
      this.queued = false;
      await this.buildLatest();
    }
    this.running = false;
    if (!this.disposed) this.events.onBusy(false);
  }

  private async buildLatest() {
    const plan = this.latest!;
    const submittedAt = this.latestAt;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await this.ready;
      const budget = this.firstBuild ? FIRST_BUILD_BUDGET_MS : BUILD_BUDGET_MS;
      const overrun = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`A build took over ${budget / 1000} seconds.`)), budget);
      });
      const result = await Promise.race([this.call<BuildResult>({ type: "build", plan }), overrun]);
      clearTimeout(timer);
      this.firstBuild = false;
      this.failures = 0;
      this.events.onBuilt(result, submittedAt);
      if (result.heapMB > RESTART_ABOVE_MB) {
        this.restart("memory");
        await this.ready;
        // A fresh engine has no model, and the viewport still shows the old one.
        // Rebuild now, so that a later move or export doesn't pay for it.
        this.queued = true;
      }
    } catch (error) {
      clearTimeout(timer);
      if (this.disposed) return;
      this.failures++;
      const message = (error as Error).message;
      this.restart("failure");
      // Retry once on a fresh engine. A second failure means it's this plan.
      if (this.failures === 1) this.queued = true;
      else this.events.onFailure(message);
    }
  }

  // Waits for the newest plan to finish, so the file matches what's on screen.
  async exportPart(plan: BuildPlan, index: number, format: "stl" | "step"): Promise<ArrayBuffer> {
    await this.settled();
    return this.call<ArrayBuffer>({ type: "export", plan, index, format });
  }

  private async settled() {
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 20));
    await this.ready;
  }

  async printReports(plan: BuildPlan): Promise<PartPrintReport[]> {
    await this.settled();
    return this.call<PartPrintReport[]>({ type: "print", plan });
  }

  async bedView(plan: BuildPlan, index: number): Promise<BedView> {
    await this.settled();
    return this.call<BedView>({ type: "bedView", plan, index });
  }

  async bundle(plan: BuildPlan, only?: string[]): Promise<ArrayBuffer> {
    await this.settled();
    return this.call<ArrayBuffer>({ type: "bundle", plan, ...(only ? { only } : {}) });
  }

  async buildFitTest(plan: FitTestPlan): Promise<FitTestMesh[]> {
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 20));
    await this.ready;
    return this.call<FitTestMesh[]>({ type: "fitTest", plan });
  }

  async exportFitTest(plan: FitTestPlan, index: number, format: "stl" | "step"): Promise<ArrayBuffer> {
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 20));
    await this.ready;
    return this.call<ArrayBuffer>({ type: "exportFitTest", plan, index, format });
  }

  // Reads a STEP file to show beside the design. It doesn't wait for a build, since it's separate.
  async importReference(bytes: ArrayBuffer): Promise<ReferenceMesh> {
    await this.ready;
    return this.call<ReferenceMesh>({ type: "reference", bytes });
  }

  dispose() {
    this.disposed = true;
    this.worker.terminate();
  }
}
