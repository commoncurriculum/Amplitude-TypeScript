"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseEventsStore = void 0;
var constants_1 = require("../constants");
var utf8_byte_length_1 = require("../utils/utf8-byte-length");
var BaseEventsStore = /** @class */ (function () {
    function BaseEventsStore(args) {
        var _this = this;
        var _a, _b, _c;
        this.minInterval = constants_1.MIN_INTERVAL;
        this.maxInterval = constants_1.MAX_INTERVAL;
        this.maxPersistedEventsSize = constants_1.DEFAULT_MAX_PERSISTED_EVENTS_SIZE_BYTES;
        this._timeAtLastSplit = Date.now(); // Initialize this so we have a point of comparison when events are recorded
        // Running UTF-8 sizes so shouldSplitEventsList only measures newly appended events.
        // The IDB store loads a fresh array on every add, so it also keeps a per-session entry.
        this.eventsContentBytes = new WeakMap();
        this.sequenceContentBytes = new Map();
        /**
         * Determines whether to send the events list to the backend and start a new
         * empty events list, based on the size of the list as well as the last time sent
         * @param nextEventString
         * @returns boolean
         */
        this.shouldSplitEventsList = function (events, nextEventString) {
            var sizeOfEventsList = _this.getEventsArraySize(events);
            // 1–3 UTF-8 bytes per code unit: only scan the event when `length` alone cannot decide.
            var room = _this.maxPersistedEventsSize - sizeOfEventsList;
            var exceedsCap = nextEventString.length >= room;
            if (!exceedsCap && nextEventString.length * 3 >= room) {
                exceedsCap = (0, utf8_byte_length_1.utf8ByteLength)(nextEventString) >= room;
            }
            if (exceedsCap) {
                return true;
            }
            if (Date.now() - _this.timeAtLastSplit > _this.interval && events.length) {
                _this.interval = Math.min(_this.maxInterval, _this.interval + _this.minInterval);
                _this._timeAtLastSplit = Date.now();
                return true;
            }
            return false;
        };
        this.loggerProvider = args.loggerProvider;
        this.minInterval = (_a = args.minInterval) !== null && _a !== void 0 ? _a : this.minInterval;
        this.maxInterval = (_b = args.maxInterval) !== null && _b !== void 0 ? _b : this.maxInterval;
        this.maxPersistedEventsSize = (_c = args.maxPersistedEventsSize) !== null && _c !== void 0 ? _c : this.maxPersistedEventsSize;
        this.interval = this.minInterval;
    }
    Object.defineProperty(BaseEventsStore.prototype, "timeAtLastSplit", {
        get: function () {
            return this._timeAtLastSplit;
        },
        enumerable: false,
        configurable: true
    });
    // `prev` is only reused when `events` still starts with the list it measured; the tail
    // check catches a same-length rewrite of the last element.
    BaseEventsStore.prototype.isPrefixOf = function (prev, events) {
        if (events.length < prev.length)
            return false;
        return prev.length === 0 || events[prev.length - 1] === prev.tail;
    };
    BaseEventsStore.prototype.measureContentBytes = function (prev, events) {
        if (prev && prev.length === events.length && this.isPrefixOf(prev, events))
            return prev;
        var contentBytes = 0;
        var start = 0;
        if (prev && this.isPrefixOf(prev, events)) {
            contentBytes = prev.contentBytes;
            start = prev.length;
        }
        for (var i = start; i < events.length; i++) {
            contentBytes += (0, utf8_byte_length_1.utf8ByteLength)(events[i]);
        }
        return { length: events.length, contentBytes: contentBytes, tail: events.length > 0 ? events[events.length - 1] : undefined };
    };
    BaseEventsStore.prototype.getEventsContentBytes = function (events) {
        var entry = this.measureContentBytes(this.eventsContentBytes.get(events), events);
        this.eventsContentBytes.set(events, entry);
        return entry.contentBytes;
    };
    /**
     * Calculates the total UTF-8 byte size of events array
     * Accounts for JSON serialization overhead when sent to backend
     */
    BaseEventsStore.prototype.getEventsArraySize = function (events) {
        var totalSize = this.getEventsContentBytes(events);
        // Approximate overhead from the array portion of the JSON payload:
        // - Array brackets: [] = 2 bytes
        // - Commas between events: events.length - 1 bytes
        // - Double quotes wrapping each event string: events.length * 2 bytes
        // Note: does not include the outer { version, events } wrapper (~22 bytes) or
        // per-event JSON-escaping of " and \ characters; the 2 MB MAX_EVENT_LIST_SIZE cap
        // stays well under the server's 10 MB decompressed split threshold even with those.
        var overhead = 2 + Math.max(0, events.length - 1) + events.length * 2;
        return totalSize + overhead;
    };
    BaseEventsStore.prototype.recallSequenceContentBytes = function (sessionId, events) {
        var cached = this.sequenceContentBytes.get(sessionId);
        if (!cached || cached.length !== events.length || !this.isPrefixOf(cached, events))
            return;
        this.eventsContentBytes.set(events, cached);
    };
    BaseEventsStore.prototype.rememberSequenceContentBytes = function (sessionId, events) {
        var entry = this.measureContentBytes(this.sequenceContentBytes.get(sessionId), events);
        this.sequenceContentBytes.set(sessionId, entry);
        this.eventsContentBytes.set(events, entry);
    };
    BaseEventsStore.prototype.forgetSequenceContentBytes = function (sessionId) {
        this.sequenceContentBytes.delete(sessionId);
    };
    return BaseEventsStore;
}());
exports.BaseEventsStore = BaseEventsStore;
//# sourceMappingURL=base-events-store.js.map