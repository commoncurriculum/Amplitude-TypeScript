import { ILogger, ServerZone } from '@amplitude/analytics-core';
import { SessionReplayTrackDestination as AmplitudeSessionReplayTrackDestination, SessionReplayDestination, SessionReplayDestinationContext } from './typings/session-replay';
import { SessionReplaySendEventsHandler } from './config/types';
export type PayloadBatcher = ({ version, events }: {
    version: number;
    events: string[];
}) => {
    version: number;
    events: unknown[];
};
export declare class SessionReplayTrackDestination implements AmplitudeSessionReplayTrackDestination {
    loggerProvider: ILogger;
    storageKey: string;
    trackServerUrl?: string;
    retryTimeout: number;
    private enableTransportCompression;
    private sendTimeoutMs;
    private scheduled;
    payloadBatcher: PayloadBatcher;
    queue: SessionReplayDestinationContext[];
    private worker?;
    private sendIdCounter;
    private pendingWorkerRequests;
    private timedOutWorkerRequests;
    private flushPauseUntilMs;
    private mergeOnNextFlush;
    private coalesceNextFlush;
    private mergeLogFiredThisPause;
    private killedSessions;
    private handleSendEvents?;
    constructor({ trackServerUrl, loggerProvider, payloadBatcher, workerScript, enableTransportCompression, sendTimeoutMs, handleSendEvents, }: {
        trackServerUrl?: string;
        loggerProvider: ILogger;
        payloadBatcher?: PayloadBatcher;
        workerScript?: string;
        enableTransportCompression?: boolean;
        sendTimeoutMs?: number;
        handleSendEvents?: SessionReplaySendEventsHandler;
    });
    sendEventsList(destinationData: SessionReplayDestination): void;
    /**
     * Marks the next scheduled flush to coalesce its queued contexts by destination identity.
     * Callers use this immediately before enqueuing the page-load backlog drain (many persisted
     * sequences replayed back-to-back on init via sendStoredEvents). Because those enqueues are
     * synchronous and the flush is deferred to the next tick via schedule(0), the whole backlog
     * lands in the queue before the flag is consumed — collapsing N small POSTs into far fewer
     * and avoiding the request flood observed on page load. Steady-state live capture
     * never sets this flag, so its sending behavior is unchanged.
     *
     * Schedules a flush so the flag is always consumed by the next flush, even when every
     * backlog sequence is dropped before reaching the queue (e.g. all events oversized) and no
     * enqueue schedules one itself. Otherwise the flag would stick and a later unrelated live
     * flush could coalesce live batches as if they were a page-load drain.
     */
    markCoalesceNextFlush(): void;
    /**
     * Sends events via navigator.sendBeacon on page exit.
     * Beacon payloads are sent as uncompressed JSON because sendBeacon does not support
     * Content-Encoding, and small incremental batches don't benefit much from compression.
     * The full snapshot has already been sent eagerly via fetch, so the beacon only needs
     * to cover the remaining incremental events since the last fetch flush.
     */
    sendBeacon({ events, sessionId, deviceId, apiKey, serverZone, }: {
        events: string[];
        sessionId: string | number;
        deviceId: string;
        apiKey: string;
        serverZone?: keyof typeof ServerZone;
    }): void;
    addToQueue(...list: SessionReplayDestinationContext[]): void;
    schedule(timeout: number): void;
    flush(useRetry?: boolean): Promise<void>;
    /**
     * Post-throttle release path: coalesce the queued contexts, then log once per pause window.
     * Delegates the actual merging to the shared coalesceByIdentity helper so the drain path
     * (mergeDrainBacklog) and this path stay byte-for-byte identical in how they merge.
     */
    private mergeQueueAfterThrottle;
    /**
     * Page-load backlog drain path: on init the SDK replays every persisted sequence
     * from a prior session via sendStoredEvents. Enqueued back-to-back they would flush as N
     * separate POSTs — a request flood on page load that feeds volume spikes and throttling.
     * Reuses the exact same identity-grouped merge as the post-throttle path so the backlog
     * collapses into far fewer requests, with onComplete fanned out so each source IDB record
     * is still cleaned up exactly once on success.
     */
    private mergeDrainBacklog;
    /**
     * Coalesces queued contexts that share the same destination identity into fewer requests.
     * Identity covers everything that affects the request URL, routing, or per-request semantics
     * — splitting on any difference keeps each merged POST indistinguishable from the source
     * contexts it replaced.
     *
     * Greedy concat with a soft byte-length cap (`MERGE_AFTER_THROTTLE_SOFT_CAP`) keeps merged
     * payloads well under the 413 ceiling; on the rare oversized merge, the existing
     * split-and-retry path still bisects safely.
     *
     * The merged context's `onComplete` fans out to every source context's callback so each
     * underlying IDB sequence record is cleaned up exactly once on success.
     */
    private coalesceByIdentity;
    send(context: SessionReplayDestinationContext, useRetry?: boolean): Promise<void>;
    private sendViaWorker;
    private rememberTimedOutRequest;
    private handleDelegatedFetch;
    private sendOnMainThread;
    handleReponse(status: number, context: SessionReplayDestinationContext, responseBody?: string): Promise<void>;
    handlePayloadTooLargeResponse(context: SessionReplayDestinationContext, isWaf: boolean): void;
    handleSuccessResponse(context: SessionReplayDestinationContext): void;
    handleOtherResponse(context: SessionReplayDestinationContext): Promise<void>;
    completeRequest({ context, err, success, }: {
        context: SessionReplayDestinationContext;
        err?: string;
        success?: string;
    }): void;
    /**
     * Applies the server's back-pressure signal carried on a 200 response.
     *
     * - `EVENT_SKIP_CODE_THROTTLED` (server-side rate limit): pause the flush schedule
     *   for `THROTTLED_FLUSH_PAUSE_MS` so we keep batching events instead of retry-storming.
     * - `EVENT_SKIP_CODE_CAPTURE_DISABLED` / `EVENT_SKIP_CODE_INVALID_RANGE`: hard kill
     *   switch for this session — drop the queued contexts and stop accepting new ones.
     *   New sessions are unaffected.
     * - `null` (clean 200, no header): clear any throttle pause; subsequent flushes resume
     *   on the normal cadence.
     */
    private applyServerDirective;
    private killSession;
}
//# sourceMappingURL=track-destination.d.ts.map