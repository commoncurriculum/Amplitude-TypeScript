import { ILogger, ServerZone } from '@amplitude/analytics-core';
import { SessionReplayTrackDestination as AmplitudeSessionReplayTrackDestination, SessionReplayDestination, SessionReplayDestinationContext } from './typings/session-replay';
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
    private scheduled;
    payloadBatcher: PayloadBatcher;
    queue: SessionReplayDestinationContext[];
    private worker?;
    private sendIdCounter;
    private pendingWorkerRequests;
    private flushPauseUntilMs;
    private killedSessions;
    constructor({ trackServerUrl, loggerProvider, payloadBatcher, workerScript, }: {
        trackServerUrl?: string;
        loggerProvider: ILogger;
        payloadBatcher?: PayloadBatcher;
        workerScript?: string;
    });
    sendEventsList(destinationData: SessionReplayDestination): void;
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
    send(context: SessionReplayDestinationContext, useRetry?: boolean): Promise<void>;
    private sendViaWorker;
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