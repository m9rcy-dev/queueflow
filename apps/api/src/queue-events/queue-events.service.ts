import { Injectable } from "@nestjs/common";
import { EventEmitter } from "node:events";

/**
 * In-process pub/sub for "something changed in this queue" — deliberately
 * plain Node EventEmitter, not Redis, since a single API instance (D-06)
 * doesn't need cross-process fan-out. The event carries no payload; every
 * SSE watcher refetches the current state itself on each signal (G-27 —
 * never trust that a client caught every event, so there's no reason to
 * pretend the event itself needs to carry data). Swapping this for a
 * Redis-backed implementation later — if a second API instance ever
 * exists — is a change behind this same interface, not a rewrite
 * (ADR-007).
 */
@Injectable()
export class QueueEventsService {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Unbounded — one listener per open SSE connection, which can
    // legitimately be many.
    this.emitter.setMaxListeners(0);
  }

  emitQueueChanged(queueId: string): void {
    this.emitter.emit(channelFor(queueId));
  }

  /** Returns an unsubscribe function — callers must invoke it when the SSE connection closes. */
  onQueueChanged(queueId: string, listener: () => void): () => void {
    const channel = channelFor(queueId);
    this.emitter.on(channel, listener);
    return () => this.emitter.off(channel, listener);
  }
}

function channelFor(queueId: string): string {
  return `queue:${queueId}`;
}
