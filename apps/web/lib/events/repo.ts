import { z } from "zod";
import type { SyncStore } from "../sync/store";
import { SKIP } from "../sync/store";
import { Global } from "../sync/names";
import { type EventConfigInput, type EventState, EventSchema, type PortraitEvent } from "./schema";

/** Allowed manual state changes (SPEC §4.1; no automatic switching, §2.2). */
const TRANSITIONS: Record<EventState, readonly EventState[]> = {
  draft: ["live"],
  live: ["break", "ended", "draft"],
  break: ["live", "ended", "draft"],
  ended: ["draft", "live"],
};

export function canTransition(from: EventState, to: EventState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class EventNotFound extends Error {
  constructor(readonly slug: string) {
    super(`Event ${slug} not found`);
  }
}
export class SlugTaken extends Error {
  constructor(readonly slug: string) {
    super(`An event with code ${slug} already exists`);
  }
}
export class InvalidTransition extends Error {
  constructor(readonly from: EventState, readonly to: EventState) {
    super(`Cannot change an event from ${from} to ${to}`);
  }
}

/** Events in the global `events` map (SPEC §3.4). Every write is If-Match guarded. */
export class EventRepo {
  private readonly map;
  /**
   * Runs after every successful write (e.g. publishing the booth document, D-17).
   * Errors are the caller's to handle; they never undo the write.
   */
  onChange?: (event: PortraitEvent) => Promise<void>;

  constructor(private readonly sync: SyncStore, private readonly now: () => Date = () => new Date()) {
    this.map = sync.map(Global.events, EventSchema);
  }

  private async changed(event: PortraitEvent) {
    await this.onChange?.(event);
  }

  async init() {
    await this.sync.ensureMap(Global.events);
  }

  get(slug: string): Promise<PortraitEvent | null> {
    return this.map.get(slug);
  }

  async require(slug: string): Promise<PortraitEvent> {
    const e = await this.get(slug);
    if (!e) throw new EventNotFound(slug);
    return e;
  }

  async list(): Promise<PortraitEvent[]> {
    const out: PortraitEvent[] = [];
    for await (const [, e] of this.map.entries()) out.push(e);
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async create(slug: string, config: EventConfigInput): Promise<PortraitEvent> {
    const ts = this.now().toISOString();
    const event: PortraitEvent = {
      slug,
      state: "draft",
      config,
      uploads: { frame: null, background: null },
      printerTokenHash: null,
      printerTokenCreatedAt: null,
      createdAt: ts,
      updatedAt: ts,
    };
    // Slug is immutable and unique (SPEC §4.2): create-if-absent, never overwrite.
    if (!(await this.map.create(slug, event))) throw new SlugTaken(slug);
    await this.changed(event);
    return event;
  }

  /** Read-modify-write of one event. `fn` must be side-effect free (it may re-run). */
  async mutate(slug: string, fn: (e: PortraitEvent) => PortraitEvent): Promise<PortraitEvent> {
    let missing = false;
    const result = await this.map.update(slug, (current) => {
      if (!current) {
        missing = true;
        return SKIP;
      }
      return { ...fn(current), slug: current.slug, createdAt: current.createdAt, updatedAt: this.now().toISOString() };
    });
    if (missing || !result) throw new EventNotFound(slug);
    await this.changed(result);
    return result;
  }

  updateConfig(slug: string, config: EventConfigInput) {
    return this.mutate(slug, (e) => ({ ...e, config }));
  }

  setState(slug: string, to: EventState) {
    return this.mutate(slug, (e) => {
      if (e.state === to) return e;
      if (!canTransition(e.state, to)) throw new InvalidTransition(e.state, to);
      return { ...e, state: to };
    });
  }

  setUpload(slug: string, kind: "frame" | "background", asset: PortraitEvent["uploads"]["frame"]) {
    return this.mutate(slug, (e) => ({ ...e, uploads: { ...e.uploads, [kind]: asset } }));
  }

  setPrinterTokenHash(slug: string, hash: string) {
    return this.mutate(slug, (e) => ({ ...e, printerTokenHash: hash, printerTokenCreatedAt: this.now().toISOString() }));
  }

  remove(slug: string) {
    return this.map.delete(slug);
  }
}

export const StateChangeSchema = z.enum(["live", "break", "ended", "draft"]);
