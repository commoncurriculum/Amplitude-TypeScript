import { ILogger } from '@amplitude/analytics-core';
import { LoggingConfig, SessionReplayJoinedConfig, SessionReplayJoinedConfigGenerator } from './config/types';
import { CustomRRwebEvent } from './constants';
import { EventCompressor } from './events/event-compressor';
import { EventsManagerWithBeacon } from './events/events-manager';
import { AmplitudeSessionReplay, SessionReplayEventsManager as AmplitudeSessionReplayEventsManager, SessionIdentifiers as ISessionIdentifiers, SessionReplayOptions, SessionReplayTargetingInput } from './typings/session-replay';
import type { RecordFunction } from './utils/rrweb';
type PageLeaveFn = (e: PageTransitionEvent | Event) => void;
export declare class SessionReplay implements AmplitudeSessionReplay {
    name: string;
    config: SessionReplayJoinedConfig | undefined;
    joinedConfigGenerator: SessionReplayJoinedConfigGenerator | undefined;
    identifiers: ISessionIdentifiers | undefined;
    eventsManager?: AmplitudeSessionReplayEventsManager<'replay' | 'interaction', string>;
    loggerProvider: ILogger;
    recordCancelCallback: ReturnType<RecordFunction> | null;
    eventCount: number;
    eventCompressor: EventCompressor | undefined;
    sessionTargetingMatch: boolean;
    private lastTargetingParams?;
    private lastShouldRecordDecision?;
    pageLeaveFns: PageLeaveFn[];
    sessionStartTime: number | undefined;
    rrwebEventManager: EventsManagerWithBeacon<'replay'> | undefined;
    /**
     * Count of sendEvents() calls suppressed by the min-session-duration gate for the
     * current session. Drives the REPLAY_GATE_DECISION rrweb event on first send-after-pass.
     */
    private suppressedSendCount;
    /** True once REPLAY_GATE_DECISION has been emitted for the current session. */
    private hasEmittedGateDecision;
    private scrollHook?;
    private clickHandler?;
    private networkObservers?;
    private metadata;
    private recordFunction;
    private semanticAdapter?;
    private recordEventsInFlight;
    /**
     * When false, capture is paused by a customer `stop()` (or `shutdown()`) call.
     * Focus/targeting/session-change paths still invoke `recordEvents()`, but
     * `getShouldRecord()` will refuse to start rrweb until `start()` or a new `init()`.
     */
    private recordingEnabled;
    /**
     * Bumped by `stop()` / `shutdown()` so an in-flight `_recordEvents()` that already
     * passed `getShouldRecord()` cannot start rrweb after capture was paused.
     */
    private recordingGeneration;
    /**
     * Set by customer `start()` so coordinated child iframes self-start instead of
     * waiting for a parent signal that may never be resent. Kept until recording
     * actually starts so a gated `start()` (targeting, sampling, remote capture)
     * still self-starts when those gates later pass.
     */
    private startChildRecordingOnSetup;
    private pendingEmitEvents;
    /**
     * Tab hide/blur uploads are deferred by one macrotask. `visibilitychange` (hidden)
     * fires before `pagehide`, and the default memory store clears the beacon buffer
     * as soon as `sendEvents` resolves. If that happens first, the page-leave beacon
     * is empty and the fetch it raced is cancelled on unload.
     */
    private hiddenFlushTimer;
    private windowFocus;
    /** Current page URL, kept in sync with SPA navigations for URL-based masking */
    private currentPageUrl;
    private recordEventsPendingShouldLogMetadata;
    /** Cleanup for URL change listener used to re-evaluate targeting on SPA route changes */
    private urlChangeCleanup;
    private crossOriginIframeCoordinator;
    private crossOriginParentSignalCleanup;
    /** Monotonic counter to ignore stale URL-change targeting results */
    private latestUrlChangeTargetingEvaluationId;
    constructor();
    init(apiKey: string, options: SessionReplayOptions): import("@amplitude/analytics-core").AmplitudeReturn<void>;
    private teardownEventListeners;
    /**
     * Subscribes to SPA URL changes via the URL tracking plugin. Always keeps
     * `currentPageUrl` in sync (needed for URL-based masking). When a targeting
     * config is present it also re-evaluates targeting on every navigation.
     */
    private setupUrlChangeListener;
    /**
     * Single source of truth for the min_session_duration_ms gate. Returns true when the
     * current session has not yet reached the configured threshold (and we have both a
     * configured value and a recorded start time). Returns false when there's no
     * threshold, no recorded start time, or the threshold has been met — i.e. it
     * answers "should this batch be suppressed?".
     *
     * Centralizing the check means future changes (clock-skew tolerance, switching to
     * performance.now(), etc.) are one-line edits.
     */
    private isBelowMinSessionDuration;
    private getCurrentPageForTargeting;
    protected _init(apiKey: string, options: SessionReplayOptions): Promise<void>;
    setSessionId(sessionId: string | number, deviceId?: string): import("@amplitude/analytics-core").AmplitudeReturn<void>;
    asyncSetSessionId(sessionId: string | number, deviceId?: string, options?: {
        userProperties?: {
            [key: string]: any;
        };
    }): Promise<void>;
    getSessionReplayProperties(): {
        [key: string]: string | null;
    };
    blurListener: () => void;
    /**
     * Tab show/hide. `focus` is the wrong signal for this: it also fires for iframes
     * and editors, which is why `captureFullSnapshotOnFocus` defaults off. A document
     * visibility change happens once per real tab switch.
     *
     * Hidden: flush queued mutations so playback is not left on the last snapshot that
     * happened to be in the store.
     * Visible: take one checkout snapshot of this document and send it. Incremental
     * events from another tab use that tab's node ids and are dropped, so without a
     * fresh checkout the player stays on whichever snapshot it last applied.
     */
    visibilityListener: () => void;
    focusListener: () => void;
    /** Move idle-queued rrweb events into the store, then ship the current sequence. */
    private flushPendingReplayEvents;
    /**
     * Flush now, upload on the next macrotask. The flush is synchronous so a
     * following `pagehide` still sees the events in the beacon buffer. The upload
     * waits so a memory-store `sendEvents` cannot clear that buffer before the
     * beacon copies it. A tab switch never reaches `pagehide`, so the timer uploads.
     */
    private scheduleHiddenSend;
    private cancelHiddenSend;
    private hostSetTimeout;
    private hostClearTimeout;
    /**
     * Checkout the DOM the user can actually see, then send it. Queued mutations are
     * flushed first so they stay ordered ahead of the new snapshot.
     */
    private captureVisibleTab;
    /**
     * This is an instance member so that if init is called multiple times
     * it doesn't add another listener to the page leave event. This is to
     * prevent duplicate listener actions from firing.
     */
    private pageLeaveListener;
    evaluateTargetingAndCapture: (targetingParams: SessionReplayTargetingInput, isInit?: boolean, forceRestart?: boolean, forceTargetingReevaluation?: boolean) => Promise<void>;
    sendEvents(sessionId?: string | number): void;
    initialize(shouldSendStoredEvents?: boolean): Promise<void>;
    shouldOptOut(): boolean | undefined;
    getShouldRecord(): boolean;
    getBlockSelectors(): string | string[] | undefined;
    getMaskTextSelectors(): string | undefined;
    getRecordingPlugins(loggingConfig: LoggingConfig | undefined): Promise<(import("@amplitude/rrweb-types").RecordPlugin<import("./plugins/url-tracking-plugin").URLTrackingPluginOptions> | import("@amplitude/rrweb-types").RecordPlugin<unknown>)[] | undefined>;
    private getRecordFunction;
    recordEvents(shouldLogMetadata?: boolean): Promise<void>;
    private shouldAbandonRecordStart;
    private _recordEvents;
    private useSemanticAdapter;
    private prepareSemanticCapture;
    private buildRRWebRecordOptions;
    private _recordEventsInChildMode;
    addCustomRRWebEvent: (eventName: CustomRRwebEvent, eventData?: {
        [key: string]: any;
    }, addStorageInfo?: boolean) => Promise<void>;
    stopRecordingEvents: () => void;
    getDeviceId(): string | undefined;
    getSessionId(): string | number | undefined;
    start(): import("@amplitude/analytics-core").AmplitudeReturn<void>;
    private _start;
    stop(): void;
    flush(useRetry?: boolean): Promise<void | undefined>;
    shutdown(): void;
    private mapSDKType;
    private setMetadata;
    private initializeNetworkObservers;
}
export {};
//# sourceMappingURL=session-replay.d.ts.map