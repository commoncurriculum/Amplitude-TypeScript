import { ILogger } from '@amplitude/analytics-core';
import { Events, EventsStore, SendingSequencesReturn } from '../typings/session-replay';
export type InstanceArgs = {
    loggerProvider: ILogger;
    minInterval?: number;
    maxInterval?: number;
    maxPersistedEventsSize?: number;
};
export declare abstract class BaseEventsStore<KeyType> implements EventsStore<KeyType> {
    protected readonly loggerProvider: ILogger;
    private minInterval;
    private maxInterval;
    private maxPersistedEventsSize;
    private interval;
    private _timeAtLastSplit;
    private readonly eventsContentBytes;
    private readonly sequenceContentBytes;
    get timeAtLastSplit(): number;
    constructor(args: InstanceArgs);
    abstract addEventToCurrentSequence(sessionId: string | number, event: string): Promise<SendingSequencesReturn<KeyType> | undefined>;
    abstract getSequencesToSend(): Promise<SendingSequencesReturn<KeyType>[] | undefined>;
    abstract storeCurrentSequence(sessionId: number): Promise<SendingSequencesReturn<KeyType> | undefined>;
    abstract storeSendingEvents(sessionId: string | number, events: Events): Promise<KeyType | undefined>;
    abstract cleanUpSessionEventsStore(sessionId: number, sequenceId: KeyType): Promise<void>;
    private isPrefixOf;
    private measureContentBytes;
    private getEventsContentBytes;
    /**
     * Calculates the total UTF-8 byte size of events array
     * Accounts for JSON serialization overhead when sent to backend
     */
    private getEventsArraySize;
    protected recallSequenceContentBytes(sessionId: string | number, events: Events): void;
    protected rememberSequenceContentBytes(sessionId: string | number, events: Events): void;
    protected forgetSequenceContentBytes(sessionId: string | number): void;
    /**
     * Determines whether to send the events list to the backend and start a new
     * empty events list, based on the size of the list as well as the last time sent
     * @param nextEventString
     * @returns boolean
     */
    shouldSplitEventsList: (events: Events, nextEventString: string) => boolean;
}
//# sourceMappingURL=base-events-store.d.ts.map