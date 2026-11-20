import { SessionReplayEventsManager as AmplitudeSessionReplayEventsManager, EventType, StoreType } from '../typings/session-replay';
import { SessionReplayJoinedConfig } from '../config/types';
import { PayloadBatcher, SessionReplayTrackDestination } from '../track-destination';
export type EventsManagerWithBeacon<Type extends EventType> = AmplitudeSessionReplayEventsManager<Type, string> & {
    /**
     * Returns current pending events (since last flush) for synchronous access on page exit.
     * Used to populate a sendBeacon payload when the page is unloading.
     */
    getBeaconEvents(): string[];
    trackDestination: SessionReplayTrackDestination;
};
export declare const createEventsManager: <Type extends EventType>({ config, minInterval, maxInterval, type, payloadBatcher, storeType, trackDestinationWorkerScript, }: {
    config: SessionReplayJoinedConfig;
    type: Type;
    minInterval?: number | undefined;
    maxInterval?: number | undefined;
    payloadBatcher?: PayloadBatcher | undefined;
    storeType: StoreType;
    trackDestinationWorkerScript?: string | undefined;
}) => Promise<EventsManagerWithBeacon<Type>>;
//# sourceMappingURL=events-manager.d.ts.map