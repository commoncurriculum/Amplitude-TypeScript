import type { SemanticAnalyticsContext, SemanticCaptureOptions } from '../semantic-types';
import { Config, Logger, FetchTransport, LogLevel } from '@amplitude/analytics-core';
import { SessionReplayOptions, StoreType } from '../typings/session-replay';
import { SessionReplayLocalConfig as ISessionReplayLocalConfig, CrossOriginIframesConfig, FlushIntervalConfig, InteractionConfig, PrivacyConfig, SessionReplayPerformanceConfig, SessionReplayVersion, SessionReplaySendEventsHandler, SessionReplayFetchConfigHandler } from './types';
export declare const getDefaultConfig: () => {
    flushMaxRetries: number;
    logLevel: LogLevel;
    loggerProvider: Logger;
    transportProvider: FetchTransport;
};
export declare class SessionReplayLocalConfig extends Config implements ISessionReplayLocalConfig {
    apiKey: string;
    sampleRate: number;
    privacyConfig?: PrivacyConfig;
    semanticCapture?: SemanticCaptureOptions;
    semanticAnalyticsContext?: SemanticAnalyticsContext;
    interactionConfig?: InteractionConfig;
    debugMode?: boolean;
    configServerUrl?: string;
    trackServerUrl?: string;
    shouldInlineStylesheet?: boolean;
    inlineImages?: boolean;
    version?: SessionReplayVersion;
    storeType: StoreType;
    performanceConfig?: SessionReplayPerformanceConfig;
    useWebWorker?: boolean;
    enableTransportCompression?: boolean;
    sendTimeoutMs?: number;
    applyBackgroundColorToBlockedElements?: boolean;
    enableUrlChangePolling?: boolean;
    urlChangePollingInterval?: number;
    captureDocumentTitle?: boolean;
    captureAdoptedStyleSheets?: boolean;
    crossOriginIframes?: CrossOriginIframesConfig;
    fullSnapshotIntervalMs?: number;
    flushIntervalConfig?: FlushIntervalConfig;
    eagerFullSnapshotSend?: boolean;
    captureFullSnapshotOnFocus?: boolean;
    maxPersistedEventsSizeBytes?: number;
    maxSingleEventSizeBytes?: number;
    handleSendEvents?: SessionReplaySendEventsHandler;
    handleFetchConfig?: SessionReplayFetchConfigHandler;
    constructor(apiKey: string, options: SessionReplayOptions);
}
//# sourceMappingURL=local-config.d.ts.map