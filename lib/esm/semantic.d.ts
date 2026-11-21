import type { SemanticCaptureConfig, SemanticCaptureFactory, SemanticCaptureHost } from './semantic-types';
/** Transport startup queue bound, independent of recorder-specific event budgets. */
export declare const MAX_PENDING_SEMANTIC_SNAPSHOTS = 200;
import { eventWithTime } from '@amplitude/rrweb-types';
/** Starts capture only after rrweb can accept custom events. */
export declare class ReplaySemanticAdapter {
    readonly createCapture: SemanticCaptureFactory;
    private readonly capture;
    private sessionId?;
    private ready;
    private pendingSnapshots;
    private pendingUrls;
    private pendingEvents;
    private config;
    constructor(createCapture: SemanticCaptureFactory, host: SemanticCaptureHost);
    prepare(config: SemanticCaptureConfig, sessionId: string | number): void;
    recordingReady(): void;
    /** Called only for replay events accepted for delivery; custom events cannot recurse. */
    event(event: eventWithTime): void;
    private url;
    private snapshot;
    stop(): void;
}
//# sourceMappingURL=semantic.d.ts.map