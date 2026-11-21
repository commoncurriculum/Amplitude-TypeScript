export declare const init: (apiKey: string, options: import("./typings/session-replay").SessionReplayOptions) => import("@amplitude/analytics-core").AmplitudeReturn<void>, setSessionId: (sessionId: string | number, deviceId?: string | undefined) => import("@amplitude/analytics-core").AmplitudeReturn<void>, getSessionId: () => string | number | undefined, getSessionReplayProperties: () => {
    [key: string]: string | boolean | null;
}, flush: (useRetry: boolean) => Promise<void>, start: () => import("@amplitude/analytics-core").AmplitudeReturn<void>, stop: () => void, shutdown: () => void, evaluateTargetingAndCapture: (targetingParams: import("./typings/session-replay").SessionReplayTargetingInput, isInit?: boolean | undefined, forceRestart?: boolean | undefined, forceTargetingReevaluation?: boolean | undefined) => Promise<void>;
export { SessionReplayOptions, StoreType } from './typings/session-replay';
export { SafeLoggerProvider } from './logger';
export type { RecordFunction } from './utils/rrweb';
export { AmplitudeSessionReplay } from './typings/session-replay';
export { SendEventsRequest, FetchConfigRequest, SessionReplaySendEventsHandler, SessionReplayFetchConfigHandler, } from './config/types';
export type { SemanticCaptureConfig, SemanticCaptureOptions, SemanticCaptureFactory, SemanticCaptureHost, SemanticCaptureController, } from './semantic-types';
//# sourceMappingURL=index.d.ts.map