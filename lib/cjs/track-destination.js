"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionReplayTrackDestination = void 0;
var tslib_1 = require("tslib");
var analytics_core_1 = require("@amplitude/analytics-core");
var helpers_1 = require("./helpers");
var messages_1 = require("./messages");
var version_1 = require("./version");
var constants_1 = require("./constants");
var gzip_1 = require("./utils/gzip");
var utf8_byte_length_1 = require("./utils/utf8-byte-length");
// Bounded so a long-lived SDK instance can't accumulate kill records indefinitely;
// sessions are time-bounded in practice, this cap is just a defensive ceiling.
var MAX_KILLED_SESSIONS = 256;
// Defensive ceiling on retained timed-out worker requests (see timedOutWorkerRequests).
// In normal operation each entry is removed when the worker's late message arrives; this
// cap only guards the pathological case of a wedged worker that never replies at all.
var MAX_TIMED_OUT_WORKER_REQUESTS = 256;
// Settles with `promise`, but rejects early with an AbortError when `signal` fires. Used to apply
// the send timeout to a custom transport whose own promise can't be cancelled: a hung transport
// then surfaces as a retryable timeout (matching the built-in fetch and worker delegation paths)
// instead of blocking the serial flush loop. The transport's promise keeps running; we just stop
// awaiting it. `signal` is always supplied with the send-timeout controller's signal.
function abortable(promise, signal) {
    return new Promise(function (resolve, reject) {
        var onAbort = function () {
            // Match how browsers reject an aborted fetch (DOMException 'AbortError'); sendOnMainThread's
            // catch keys off the name to route it through the retry budget rather than failing fatally.
            var err = new Error('Custom session replay transport aborted by send timeout');
            err.name = 'AbortError';
            reject(err);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(function (value) {
            signal.removeEventListener('abort', onAbort);
            resolve(value);
        }, function (err) {
            signal.removeEventListener('abort', onAbort);
            reject(err);
        });
    });
}
var SessionReplayTrackDestination = /** @class */ (function () {
    function SessionReplayTrackDestination(_a) {
        var trackServerUrl = _a.trackServerUrl, loggerProvider = _a.loggerProvider, payloadBatcher = _a.payloadBatcher, workerScript = _a.workerScript, enableTransportCompression = _a.enableTransportCompression, sendTimeoutMs = _a.sendTimeoutMs, handleSendEvents = _a.handleSendEvents;
        var _this = this;
        this.storageKey = '';
        this.retryTimeout = 1000;
        this.scheduled = null;
        this.queue = [];
        this.sendIdCounter = 0;
        this.pendingWorkerRequests = new Map();
        // Requests the main thread stopped awaiting after SEND_TIMEOUT_MS (so the serial flush
        // loop could proceed) but whose worker may still be retrying in the background. We keep
        // the context — bounded, like killedSessions — so a *late* worker complete/payload_too_large
        // can still run completeRequest and settle the store record. Without this the late message
        // is dropped (its id is gone from pendingWorkerRequests), so a successful late delivery would
        // leave the IDB/memory record behind for sendStoredEvents to re-upload as duplicate replay data.
        this.timedOutWorkerRequests = new Map();
        // Server back-pressure state, fed by the X-Session-Replay-Event-Skipped header on 200s.
        // The server uses this header (instead of 4xx) to signal a deliberate no-retry drop so SDKs
        // don't retry-storm. We honor it here by slowing or stopping our flush schedule.
        this.flushPauseUntilMs = 0;
        // Set when schedule() defers a flush because we're inside a throttle pause; consumed by
        // flush() to merge same-session contexts before sending. Throttling is enforced by request
        // count, so collapsing N queued batches into one POST directly reduces throttle pressure.
        this.mergeOnNextFlush = false;
        // Set by markCoalesceNextFlush() before the page-load backlog is enqueued; consumed by
        // flush() to coalesce the drained persisted sequences. Distinct from
        // mergeOnNextFlush so the drain isn't conflated with a throttle pause for logging.
        this.coalesceNextFlush = false;
        // Gates the merge log to once per throttle pause window — mirroring the throttle log's
        // transition-only gating — so a sustained throttle scenario doesn't spam logs every cycle.
        this.mergeLogFiredThisPause = false;
        this.killedSessions = new Set();
        this.loggerProvider = loggerProvider;
        this.payloadBatcher = payloadBatcher ? payloadBatcher : function (payload) { return payload; };
        this.trackServerUrl = trackServerUrl;
        this.enableTransportCompression = enableTransportCompression !== null && enableTransportCompression !== void 0 ? enableTransportCompression : true;
        this.sendTimeoutMs = sendTimeoutMs !== null && sendTimeoutMs !== void 0 ? sendTimeoutMs : constants_1.SEND_TIMEOUT_MS;
        this.handleSendEvents = handleSendEvents;
        if (workerScript) {
            try {
                var blob = new Blob([workerScript], { type: 'application/javascript' });
                var blobUrl = URL.createObjectURL(blob);
                var worker_1 = new Worker(blobUrl);
                worker_1.onerror = function (e) {
                    var e_1, _a;
                    e.preventDefault();
                    loggerProvider.error("Track destination worker failed, falling back to main-thread sending: ".concat(e.message, " (").concat(e.filename, ":").concat(e.lineno, ")"));
                    worker_1.terminate();
                    _this.worker = undefined;
                    try {
                        // Resolve pending promises so flush() doesn't hang. Do NOT call completeRequest
                        // here — the events were never delivered, so onComplete must not fire and the
                        // IDB/memory store entries must remain intact for recovery by sendStoredEvents.
                        for (var _b = tslib_1.__values(_this.pendingWorkerRequests), _c = _b.next(); !_c.done; _c = _b.next()) {
                            var _d = tslib_1.__read(_c.value, 2), pending_1 = _d[1];
                            // Cancel the per-request timeout — onerror already settles every pending
                            // promise, so leaving the timer armed would fire a spurious timeout warn later.
                            if (pending_1.timeout)
                                clearTimeout(pending_1.timeout);
                            loggerProvider.warn("Session replay event send failed due to worker crash: ".concat(e.message));
                            pending_1.resolve();
                        }
                    }
                    catch (e_1_1) { e_1 = { error: e_1_1 }; }
                    finally {
                        try {
                            if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
                        }
                        finally { if (e_1) throw e_1.error; }
                    }
                    _this.pendingWorkerRequests.clear();
                    // The worker is gone, so no late completion can arrive for timed-out requests either.
                    // Drop the retained contexts to free memory; their store records stay intact (we never
                    // completeRequest here) so sendStoredEvents can recover them on next init.
                    _this.timedOutWorkerRequests.clear();
                };
                worker_1.onmessage = function (e) {
                    var msg = e.data;
                    if (msg.type === 'log') {
                        loggerProvider.log(msg.message);
                    }
                    else if (msg.type === 'warn') {
                        loggerProvider.warn(msg.message);
                    }
                    else if (msg.type === 'payload_too_large') {
                        var pending_2 = _this.pendingWorkerRequests.get(msg.id);
                        if (pending_2) {
                            if (pending_2.timeout)
                                clearTimeout(pending_2.timeout);
                            _this.handlePayloadTooLargeResponse(pending_2.context, msg.isWaf);
                            pending_2.resolve();
                            _this.pendingWorkerRequests.delete(msg.id);
                        }
                        else {
                            // Late message for a request the main thread already timed out: the worker still
                            // determined the payload was too large, so split-and-retry off the original record.
                            var timedOut = _this.timedOutWorkerRequests.get(msg.id);
                            if (timedOut) {
                                _this.timedOutWorkerRequests.delete(msg.id);
                                _this.handlePayloadTooLargeResponse(timedOut, msg.isWaf);
                            }
                        }
                    }
                    else if (msg.type === 'complete') {
                        var pending_3 = _this.pendingWorkerRequests.get(msg.id);
                        if (pending_3) {
                            if (pending_3.timeout)
                                clearTimeout(pending_3.timeout);
                            if (msg.skipCode !== undefined) {
                                _this.applyServerDirective(pending_3.context.sessionId, msg.skipCode);
                            }
                            _this.completeRequest({ context: pending_3.context });
                            pending_3.resolve();
                            _this.pendingWorkerRequests.delete(msg.id);
                        }
                        else {
                            // Late completion for a request the main thread already timed out. The worker's
                            // actual outcome (delivered, or retries exhausted) is authoritative, so settle the
                            // store record by it rather than leaving it behind for sendStoredEvents to re-upload.
                            var timedOut = _this.timedOutWorkerRequests.get(msg.id);
                            if (timedOut) {
                                _this.timedOutWorkerRequests.delete(msg.id);
                                if (msg.skipCode !== undefined) {
                                    _this.applyServerDirective(timedOut.sessionId, msg.skipCode);
                                }
                                _this.completeRequest({ context: timedOut });
                            }
                        }
                    }
                    else if (msg.type === 'fetch-request') {
                        // Worker is delegating one network attempt to the custom transport (which lives on
                        // the main thread). Run it and post the result back into the worker's retry loop.
                        // Guard the fire-and-forget call: if posting the result back fails (e.g. the worker
                        // was terminated mid-flight), surface it to the logger instead of leaving an
                        // unhandled rejection.
                        void _this.handleDelegatedFetch(worker_1, msg).catch(function (e) {
                            loggerProvider.warn('Failed to handle delegated session replay fetch:', e);
                        });
                    }
                };
                this.worker = worker_1;
            }
            catch (error) {
                loggerProvider.error('Failed to create track destination worker, falling back to main-thread sending:', error);
            }
        }
    }
    SessionReplayTrackDestination.prototype.sendEventsList = function (destinationData) {
        this.addToQueue(tslib_1.__assign(tslib_1.__assign({}, destinationData), { attempts: 0, timeout: 0 }));
    };
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
    SessionReplayTrackDestination.prototype.markCoalesceNextFlush = function () {
        this.coalesceNextFlush = true;
        this.schedule(0);
    };
    /**
     * Sends events via navigator.sendBeacon on page exit.
     * Beacon payloads are sent as uncompressed JSON because sendBeacon does not support
     * Content-Encoding, and small incremental batches don't benefit much from compression.
     * The full snapshot has already been sent eagerly via fetch, so the beacon only needs
     * to cover the remaining incremental events since the last fetch flush.
     */
    SessionReplayTrackDestination.prototype.sendBeacon = function (_a) {
        var _this = this;
        var _b, _c;
        var events = _a.events, sessionId = _a.sessionId, deviceId = _a.deviceId, apiKey = _a.apiKey, serverZone = _a.serverZone;
        var MAX_BEACON_BYTES = 64 * 1024;
        var byteLength = function (s) { return (0, utf8_byte_length_1.utf8ByteLength)(s); };
        var trimmedEvents = events;
        var payload = JSON.stringify({ version: 2, events: trimmedEvents });
        if (byteLength(payload) > MAX_BEACON_BYTES) {
            // Binary search for the largest prefix that fits within the beacon size limit.
            // Uses Blob.size to get the UTF-8 byte count, which is what sendBeacon measures.
            var lo = 0;
            var hi = trimmedEvents.length;
            while (lo < hi) {
                var mid = Math.floor((lo + hi + 1) / 2);
                if (byteLength(JSON.stringify({ version: 2, events: trimmedEvents.slice(0, mid) })) <= MAX_BEACON_BYTES) {
                    lo = mid;
                }
                else {
                    hi = mid - 1;
                }
            }
            trimmedEvents = trimmedEvents.slice(0, lo);
            payload = JSON.stringify({ version: 2, events: trimmedEvents });
            this.loggerProvider.warn("sendBeacon payload exceeded 64 KB limit, trimmed from ".concat(events.length, " to ").concat(trimmedEvents.length, " events"));
        }
        if (trimmedEvents.length === 0) {
            return;
        }
        // Custom-transport page-exit path: navigator.sendBeacon cannot carry custom headers, so a
        // JWT customer's exit batch would go out unauthenticated and be rejected by their proxy.
        // Instead, route it through the callback with keepalive (which survives unload AND carries
        // headers). Mirrors the main-send request shape: Authorization header + device_id/session_id/
        // type params (api_key is NOT placed in the URL, unlike the legacy beacon path below).
        if (this.handleSendEvents) {
            var exitParams = new URLSearchParams({
                device_id: deviceId,
                session_id: String(sessionId),
                type: 'replay',
            });
            var exitUrl = "".concat((0, helpers_1.getServerUrl)(serverZone, this.trackServerUrl), "?").concat(exitParams.toString());
            var headers = {
                'Content-Type': 'application/json',
                Accept: '*/*',
                Authorization: "Bearer ".concat(apiKey),
            };
            this.loggerProvider.debug("Routing session replay exit batch (".concat(trimmedEvents.length, " events) through custom transport for session id ").concat(sessionId, "."));
            try {
                // Fire-and-forget: we cannot await during unload. The request is well under 64 KB
                // (trimmed above) and keepalive: true is requested so it survives page teardown.
                void this.handleSendEvents({ url: exitUrl, method: 'POST', headers: headers, body: payload, keepalive: true }).catch(function (e) {
                    // best effort on exit, but still surface the failure so it's diagnosable in logs.
                    _this.loggerProvider.warn('Custom transport failed to send session replay exit batch:', e);
                });
            }
            catch (e) {
                this.loggerProvider.warn('Custom transport threw while sending session replay exit batch:', e);
            }
            return;
        }
        var urlParams = new URLSearchParams({
            device_id: deviceId,
            session_id: String(sessionId),
            type: 'replay',
            api_key: apiKey,
        });
        var serverUrl = "".concat((0, helpers_1.getServerUrl)(serverZone, this.trackServerUrl), "?").concat(urlParams.toString());
        var globalScope = (0, analytics_core_1.getGlobalScope)();
        try {
            // Wrap in a Blob to set Content-Type: application/json; a plain string would
            // cause the browser to send Content-Type: text/plain, which the server rejects.
            var payloadBlob = new Blob([payload], { type: 'application/json' });
            var sent = (_c = (_b = globalScope === null || globalScope === void 0 ? void 0 : globalScope.navigator) === null || _b === void 0 ? void 0 : _b.sendBeacon) === null || _c === void 0 ? void 0 : _c.call(_b, serverUrl, payloadBlob);
            if (sent === false) {
                this.loggerProvider.warn('sendBeacon failed to queue session replay payload');
            }
        }
        catch (_d) {
            // Best effort — no fallback on page exit.
        }
    };
    SessionReplayTrackDestination.prototype.addToQueue = function () {
        var _this = this;
        var list = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            list[_i] = arguments[_i];
        }
        var tryable = list.filter(function (context) {
            if (_this.killedSessions.has(context.sessionId)) {
                // Server has signaled capture_disabled or session_in_invalid_range for this session;
                // drop the batch (and clean up its IDB record via onComplete) instead of POSTing.
                _this.completeRequest({
                    context: context,
                    err: messages_1.SESSION_KILLED_MESSAGE,
                });
                return false;
            }
            if (context.attempts < (context.flushMaxRetries || 0)) {
                context.attempts += 1;
                return true;
            }
            _this.completeRequest({
                context: context,
                err: messages_1.MAX_RETRIES_EXCEEDED_MESSAGE,
            });
            return false;
        });
        tryable.forEach(function (context) {
            _this.queue = _this.queue.concat(context);
            _this.schedule(0);
        });
    };
    SessionReplayTrackDestination.prototype.schedule = function (timeout) {
        var _this = this;
        if (this.scheduled)
            return;
        // If the server signaled throttling on a recent 200, defer the next flush until the
        // pause window ends. This lets us keep batching events without retry-storming the server.
        var pauseRemaining = this.flushPauseUntilMs - Date.now();
        var isPaused = pauseRemaining > 0;
        var effectiveTimeout = pauseRemaining > timeout ? pauseRemaining : timeout;
        if (isPaused) {
            // Mark the upcoming flush for merge: contexts piling up during the pause should
            // be coalesced into one POST per (session, device, api, type, ...) group.
            this.mergeOnNextFlush = true;
        }
        this.scheduled = setTimeout(function () {
            void _this.flush(true).then(function () {
                if (_this.queue.length > 0) {
                    _this.schedule(timeout);
                }
            });
        }, effectiveTimeout);
    };
    SessionReplayTrackDestination.prototype.flush = function (useRetry) {
        if (useRetry === void 0) { useRetry = false; }
        return tslib_1.__awaiter(this, void 0, void 0, function () {
            var list, list_1, list_1_1, context, e_2_1;
            var e_2, _a;
            return tslib_1.__generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        list = this.queue;
                        this.queue = [];
                        if (this.scheduled) {
                            clearTimeout(this.scheduled);
                            this.scheduled = null;
                        }
                        if (this.mergeOnNextFlush) {
                            this.mergeOnNextFlush = false;
                            // A throttle merge already coalesces by identity; clear the drain flag too so the
                            // same backlog isn't passed through a redundant second merge on a later flush.
                            this.coalesceNextFlush = false;
                            list = this.mergeQueueAfterThrottle(list);
                        }
                        else if (this.coalesceNextFlush) {
                            this.coalesceNextFlush = false;
                            list = this.mergeDrainBacklog(list);
                        }
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 6, 7, 8]);
                        list_1 = tslib_1.__values(list), list_1_1 = list_1.next();
                        _b.label = 2;
                    case 2:
                        if (!!list_1_1.done) return [3 /*break*/, 5];
                        context = list_1_1.value;
                        return [4 /*yield*/, this.send(context, useRetry)];
                    case 3:
                        _b.sent();
                        _b.label = 4;
                    case 4:
                        list_1_1 = list_1.next();
                        return [3 /*break*/, 2];
                    case 5: return [3 /*break*/, 8];
                    case 6:
                        e_2_1 = _b.sent();
                        e_2 = { error: e_2_1 };
                        return [3 /*break*/, 8];
                    case 7:
                        try {
                            if (list_1_1 && !list_1_1.done && (_a = list_1.return)) _a.call(list_1);
                        }
                        finally { if (e_2) throw e_2.error; }
                        return [7 /*endfinally*/];
                    case 8: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Post-throttle release path: coalesce the queued contexts, then log once per pause window.
     * Delegates the actual merging to the shared coalesceByIdentity helper so the drain path
     * (mergeDrainBacklog) and this path stay byte-for-byte identical in how they merge.
     */
    SessionReplayTrackDestination.prototype.mergeQueueAfterThrottle = function (list) {
        var merged = this.coalesceByIdentity(list);
        if (merged.length < list.length && !this.mergeLogFiredThisPause) {
            this.mergeLogFiredThisPause = true;
            this.loggerProvider.log("Session replay throttle pause ended; merged ".concat(list.length, " queued batches into ").concat(merged.length, " request(s)"));
        }
        return merged;
    };
    /**
     * Page-load backlog drain path: on init the SDK replays every persisted sequence
     * from a prior session via sendStoredEvents. Enqueued back-to-back they would flush as N
     * separate POSTs — a request flood on page load that feeds volume spikes and throttling.
     * Reuses the exact same identity-grouped merge as the post-throttle path so the backlog
     * collapses into far fewer requests, with onComplete fanned out so each source IDB record
     * is still cleaned up exactly once on success.
     */
    SessionReplayTrackDestination.prototype.mergeDrainBacklog = function (list) {
        var merged = this.coalesceByIdentity(list);
        if (merged.length < list.length) {
            this.loggerProvider.log("Session replay coalesced ".concat(list.length, " persisted page-load backlog batches into ").concat(merged.length, " request(s)"));
        }
        return merged;
    };
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
    SessionReplayTrackDestination.prototype.coalesceByIdentity = function (list) {
        var e_3, _a, e_4, _b;
        var _this = this;
        var _c, _d, _e, _f, _g, _h, _j;
        if (list.length <= 1)
            return list;
        var groups = new Map();
        try {
            for (var list_2 = tslib_1.__values(list), list_2_1 = list_2.next(); !list_2_1.done; list_2_1 = list_2.next()) {
                var ctx = list_2_1.value;
                // Anything that can change the URL, headers, or backend routing must split groups.
                var key = [
                    ctx.sessionId,
                    (_c = ctx.deviceId) !== null && _c !== void 0 ? _c : '',
                    (_d = ctx.apiKey) !== null && _d !== void 0 ? _d : '',
                    ctx.type,
                    (_e = ctx.serverZone) !== null && _e !== void 0 ? _e : '',
                    ctx.sampleRate,
                    (_g = (_f = ctx.version) === null || _f === void 0 ? void 0 : _f.type) !== null && _g !== void 0 ? _g : '',
                    (_j = (_h = ctx.version) === null || _h === void 0 ? void 0 : _h.version) !== null && _j !== void 0 ? _j : '',
                ].join('|');
                var arr = groups.get(key);
                if (arr)
                    arr.push(ctx);
                else
                    groups.set(key, [ctx]);
            }
        }
        catch (e_3_1) { e_3 = { error: e_3_1 }; }
        finally {
            try {
                if (list_2_1 && !list_2_1.done && (_a = list_2.return)) _a.call(list_2);
            }
            finally { if (e_3) throw e_3.error; }
        }
        var merged = [];
        var _loop_1 = function (group) {
            var e_5, _m;
            if (group.length === 1) {
                merged.push(group[0]);
                return "continue";
            }
            var current = null;
            var currentBytes = 0;
            var flushCurrent = function () {
                if (current)
                    merged.push(current);
                current = null;
                currentBytes = 0;
            };
            var _loop_2 = function (ctx) {
                // UTF-8 byte size, matching how the events store enforces MAX_EVENT_LIST_SIZE
                // (see utils/utf8-byte-length.ts). Using char length would let a CJK/
                // emoji-heavy payload sneak past the cap.
                var ctxBytes = (0, utf8_byte_length_1.utf8ByteLengthOf)(ctx.events);
                if (current === null) {
                    // Reset attempts to 0 on the merged context so the post-throttle delivery gets a
                    // full retry budget. The throttle pause has already absorbed back-pressure; the
                    // alternative (Math.max of source attempts) would collapse N source budgets into
                    // one and end-of-life all N IDB records on a single retry exhaustion.
                    current = tslib_1.__assign(tslib_1.__assign({}, ctx), { events: tslib_1.__spreadArray([], tslib_1.__read(ctx.events), false), attempts: 0 });
                    currentBytes = ctxBytes;
                    return "continue";
                }
                if (currentBytes + ctxBytes > constants_1.MERGE_AFTER_THROTTLE_SOFT_CAP) {
                    flushCurrent();
                    current = tslib_1.__assign(tslib_1.__assign({}, ctx), { events: tslib_1.__spreadArray([], tslib_1.__read(ctx.events), false), attempts: 0 });
                    currentBytes = ctxBytes;
                    return "continue";
                }
                var prevOnComplete = current.onComplete;
                var ctxOnComplete = ctx.onComplete;
                current.events = current.events.concat(ctx.events);
                currentBytes += ctxBytes;
                current.onComplete = function () { return tslib_1.__awaiter(_this, void 0, void 0, function () {
                    return tslib_1.__generator(this, function (_a) {
                        switch (_a.label) {
                            case 0: 
                            // allSettled (not all): an underlying store cleanup failure in one shouldn't
                            // block the other, and the merged onComplete is invoked fire-and-forget via
                            // `void context.onComplete()` — a rejection from `Promise.all` would surface
                            // as an unhandled rejection. Errors stay encapsulated in the source callbacks.
                            return [4 /*yield*/, Promise.allSettled([prevOnComplete(), ctxOnComplete()])];
                            case 1:
                                // allSettled (not all): an underlying store cleanup failure in one shouldn't
                                // block the other, and the merged onComplete is invoked fire-and-forget via
                                // `void context.onComplete()` — a rejection from `Promise.all` would surface
                                // as an unhandled rejection. Errors stay encapsulated in the source callbacks.
                                _a.sent();
                                return [2 /*return*/];
                        }
                    });
                }); };
            };
            try {
                for (var group_1 = (e_5 = void 0, tslib_1.__values(group)), group_1_1 = group_1.next(); !group_1_1.done; group_1_1 = group_1.next()) {
                    var ctx = group_1_1.value;
                    _loop_2(ctx);
                }
            }
            catch (e_5_1) { e_5 = { error: e_5_1 }; }
            finally {
                try {
                    if (group_1_1 && !group_1_1.done && (_m = group_1.return)) _m.call(group_1);
                }
                finally { if (e_5) throw e_5.error; }
            }
            flushCurrent();
        };
        try {
            for (var _k = tslib_1.__values(groups.values()), _l = _k.next(); !_l.done; _l = _k.next()) {
                var group = _l.value;
                _loop_1(group);
            }
        }
        catch (e_4_1) { e_4 = { error: e_4_1 }; }
        finally {
            try {
                if (_l && !_l.done && (_b = _k.return)) _b.call(_k);
            }
            finally { if (e_4) throw e_4.error; }
        }
        return merged;
    };
    SessionReplayTrackDestination.prototype.send = function (context, useRetry) {
        if (useRetry === void 0) { useRetry = true; }
        return tslib_1.__awaiter(this, void 0, void 0, function () {
            var apiKey, deviceId, payload, worker;
            return tslib_1.__generator(this, function (_a) {
                // A kill directive can arrive between flush() snapshotting the queue and us reaching
                // each context. Re-check before hitting the network so we don't waste POSTs on a
                // session the server has already told us to stop sending for.
                if (this.killedSessions.has(context.sessionId)) {
                    return [2 /*return*/, this.completeRequest({ context: context, err: messages_1.SESSION_KILLED_MESSAGE })];
                }
                apiKey = context.apiKey;
                if (!apiKey) {
                    return [2 /*return*/, this.completeRequest({ context: context, err: messages_1.MISSING_API_KEY_MESSAGE })];
                }
                deviceId = context.deviceId;
                if (!deviceId) {
                    return [2 /*return*/, this.completeRequest({ context: context, err: messages_1.MISSING_DEVICE_ID_MESSAGE })];
                }
                payload = this.payloadBatcher({
                    version: 1,
                    events: context.events,
                });
                if (payload.events.length === 0) {
                    this.completeRequest({ context: context });
                    return [2 /*return*/];
                }
                worker = this.worker;
                if (worker) {
                    return [2 /*return*/, this.sendViaWorker(worker, context, payload, useRetry)];
                }
                return [2 /*return*/, this.sendOnMainThread(apiKey, deviceId, context, payload, useRetry)];
            });
        });
    };
    SessionReplayTrackDestination.prototype.sendViaWorker = function (worker, context, payload, useRetry) {
        return tslib_1.__awaiter(this, void 0, void 0, function () {
            var id;
            var _this = this;
            return tslib_1.__generator(this, function (_a) {
                id = "".concat(++this.sendIdCounter);
                return [2 /*return*/, new Promise(function (resolve) {
                        var _a;
                        // The worker only resolves this promise when it posts back complete/payload_too_large.
                        // If the worker's own fetch hangs, no message ever arrives, so this promise — and the
                        // serial flush loop awaiting it — would hang forever while pendingWorkerRequests grows
                        // unbounded. On timeout we resolve so flush() proceeds, but deliberately do NOT call
                        // completeRequest: like the worker-crash path above, the events were never confirmed
                        // delivered, so onComplete must not fire and the IDB/memory store must stay intact for
                        // recovery by sendStoredEvents.
                        // sendTimeoutMs <= 0 disables the wait timer entirely: we then rely solely on the
                        // worker's own complete/payload_too_large message to settle. This reintroduces the
                        // hang risk this timer guards against, so it is an explicit experiment opt-out.
                        var timeout = _this.sendTimeoutMs > 0
                            ? setTimeout(function () {
                                var pending = _this.pendingWorkerRequests.get(id);
                                if (!pending)
                                    return;
                                _this.pendingWorkerRequests.delete(id);
                                // Retain the context so a *late* worker complete/payload_too_large can still settle the
                                // store record (see timedOutWorkerRequests). Without this, a worker that ultimately
                                // delivers after we stopped awaiting would leave the record behind → duplicate upload.
                                _this.rememberTimedOutRequest(id, pending.context);
                                _this.loggerProvider.warn("Session replay worker send timed out after ".concat(_this.sendTimeoutMs, "ms; leaving events for retry"));
                                pending.resolve();
                            }, _this.sendTimeoutMs)
                            : undefined;
                        _this.pendingWorkerRequests.set(id, { context: context, resolve: resolve, timeout: timeout });
                        worker.postMessage({
                            type: 'send',
                            id: id,
                            payload: payload,
                            useRetry: useRetry,
                            // Tell the worker to delegate each network attempt back to the main thread, where the
                            // custom transport callback lives (functions can't cross postMessage). Absent/false
                            // keeps the worker's own internal fetch — the unchanged path for existing integrations.
                            useCustomTransport: !!_this.handleSendEvents,
                            context: {
                                apiKey: context.apiKey,
                                deviceId: context.deviceId,
                                sessionId: context.sessionId,
                                events: context.events,
                                eventType: context.type,
                                flushMaxRetries: (_a = context.flushMaxRetries) !== null && _a !== void 0 ? _a : 0,
                                sampleRate: context.sampleRate,
                                serverZone: context.serverZone,
                                trackServerUrl: _this.trackServerUrl,
                                version: context.version,
                                currentUrl: (0, helpers_1.getCurrentUrl)(),
                                sdkVersion: version_1.VERSION,
                                enableTransportCompression: _this.enableTransportCompression,
                                sendTimeoutMs: _this.sendTimeoutMs,
                            },
                        });
                    })];
            });
        });
    };
    SessionReplayTrackDestination.prototype.rememberTimedOutRequest = function (id, context) {
        var e_6, _a;
        this.timedOutWorkerRequests.set(id, context);
        // Bound memory: a wedged worker that never replies must not let this grow without limit.
        // Map preserves insertion order, so deleting the first key evicts the oldest entry.
        if (this.timedOutWorkerRequests.size > MAX_TIMED_OUT_WORKER_REQUESTS) {
            try {
                for (var _b = tslib_1.__values(this.timedOutWorkerRequests.keys()), _c = _b.next(); !_c.done; _c = _b.next()) {
                    var oldest = _c.value;
                    this.timedOutWorkerRequests.delete(oldest);
                    break;
                }
            }
            catch (e_6_1) { e_6 = { error: e_6_1 }; }
            finally {
                try {
                    if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
                }
                finally { if (e_6) throw e_6.error; }
            }
        }
    };
    // Runs the custom transport on the main thread for a single attempt the worker delegated,
    // then posts the result back into the worker's retry loop as a 'fetch-response'. We read only
    // what the worker's status handling needs: the skip header on a 2xx and the body text on a
    // 413 (for WAF detection). A thrown/rejected transport is reported as an error so the worker
    // surfaces it the same way a thrown fetch would (no retry) — matching the main-thread path.
    SessionReplayTrackDestination.prototype.handleDelegatedFetch = function (worker, msg) {
        var _a, _b, _c;
        return tslib_1.__awaiter(this, void 0, void 0, function () {
            var requestId, url, method, headers, body, keepalive, res, status_1, skipHeader, responseBody, _d, e_7;
            return tslib_1.__generator(this, function (_e) {
                switch (_e.label) {
                    case 0:
                        requestId = msg.requestId, url = msg.url, method = msg.method, headers = msg.headers, body = msg.body, keepalive = msg.keepalive;
                        _e.label = 1;
                    case 1:
                        _e.trys.push([1, 10, , 11]);
                        res = void 0;
                        if (!this.handleSendEvents) return [3 /*break*/, 3];
                        return [4 /*yield*/, this.handleSendEvents({ url: url, method: method, headers: headers, body: body, keepalive: keepalive })];
                    case 2:
                        res = _e.sent();
                        return [3 /*break*/, 5];
                    case 3:
                        // Defensive only: the worker emits 'fetch-request' solely when useCustomTransport is set,
                        // so this branch shouldn't be reachable. Warn so a regression that delegates without a
                        // transport is diagnosable rather than silently routing to the built-in fetch.
                        this.loggerProvider.warn('Delegated session replay fetch received without a custom transport configured; falling back to built-in fetch.');
                        return [4 /*yield*/, fetch(url, { method: method, headers: headers, body: body, keepalive: keepalive })];
                    case 4:
                        res = _e.sent();
                        _e.label = 5;
                    case 5:
                        status_1 = res.status;
                        skipHeader = null;
                        responseBody = '';
                        if (status_1 >= 200 && status_1 < 300) {
                            skipHeader = (_c = (_b = (_a = res.headers) === null || _a === void 0 ? void 0 : _a.get) === null || _b === void 0 ? void 0 : _b.call(_a, constants_1.EVENT_SKIPPED_HEADER)) !== null && _c !== void 0 ? _c : null;
                        }
                        if (!(status_1 === 413)) return [3 /*break*/, 9];
                        _e.label = 6;
                    case 6:
                        _e.trys.push([6, 8, , 9]);
                        return [4 /*yield*/, res.text()];
                    case 7:
                        responseBody = _e.sent();
                        return [3 /*break*/, 9];
                    case 8:
                        _d = _e.sent();
                        return [3 /*break*/, 9];
                    case 9:
                        this.loggerProvider.debug("Delegated session replay fetch (request ".concat(requestId, ") returned status ").concat(status_1, "."));
                        worker.postMessage({ type: 'fetch-response', requestId: requestId, status: status_1, skipHeader: skipHeader, body: responseBody });
                        return [3 /*break*/, 11];
                    case 10:
                        e_7 = _e.sent();
                        this.loggerProvider.debug("Delegated session replay fetch (request ".concat(requestId, ") failed:"), e_7);
                        worker.postMessage({
                            type: 'fetch-response',
                            requestId: requestId,
                            status: 0,
                            skipHeader: null,
                            body: String(e_7),
                            error: true,
                        });
                        return [3 /*break*/, 11];
                    case 11: return [2 /*return*/];
                }
            });
        });
    };
    SessionReplayTrackDestination.prototype.sendOnMainThread = function (apiKey, deviceId, context, payload, useRetry) {
        var _a, _b, _c, _d, _e, _f, _g;
        return tslib_1.__awaiter(this, void 0, void 0, function () {
            var url, version, sampleRate, urlParams, sessionReplayLibrary, payloadJson, globalScope, gzipped, _h, payloadSize, controller_1, headers, body, keepalive, options, serverUrl, sendTimeout, res, _j, skipCode, responseBody, responseBody, _k, e_8, isAbort;
            return tslib_1.__generator(this, function (_l) {
                switch (_l.label) {
                    case 0:
                        url = (0, helpers_1.getCurrentUrl)();
                        version = version_1.VERSION;
                        sampleRate = context.sampleRate;
                        urlParams = new URLSearchParams({
                            device_id: deviceId,
                            session_id: "".concat(context.sessionId),
                            type: "".concat(context.type),
                        });
                        sessionReplayLibrary = "".concat((_b = (_a = context.version) === null || _a === void 0 ? void 0 : _a.type) !== null && _b !== void 0 ? _b : 'standalone', "/").concat((_d = (_c = context.version) === null || _c === void 0 ? void 0 : _c.version) !== null && _d !== void 0 ? _d : version);
                        _l.label = 1;
                    case 1:
                        _l.trys.push([1, 19, , 23]);
                        payloadJson = JSON.stringify(payload);
                        globalScope = (0, analytics_core_1.getGlobalScope)();
                        if (!(this.enableTransportCompression && globalScope && 'CompressionStream' in globalScope)) return [3 /*break*/, 3];
                        return [4 /*yield*/, (0, gzip_1.gzipJson)(payloadJson, globalScope)];
                    case 2:
                        _h = _l.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        _h = null;
                        _l.label = 4;
                    case 4:
                        gzipped = _h;
                        payloadSize = gzipped ? gzipped.byteLength : (0, utf8_byte_length_1.utf8ByteLength)(payloadJson);
                        controller_1 = new AbortController();
                        headers = tslib_1.__assign({ 'Content-Type': 'application/json', Accept: '*/*', Authorization: "Bearer ".concat(apiKey), 'X-Client-Version': version, 'X-Client-Library': sessionReplayLibrary, 'X-Client-Url': url.substring(0, constants_1.MAX_URL_LENGTH), 'X-Client-Sample-Rate': "".concat(sampleRate), 'X-Sampling-Hash-Alg': 'xxhash32' }, (gzipped ? { 'Content-Encoding': 'gzip' } : {}));
                        body = gzipped !== null && gzipped !== void 0 ? gzipped : payloadJson;
                        keepalive = payloadSize <= constants_1.MAX_KEEPALIVE_BYTES;
                        options = {
                            headers: headers,
                            body: body,
                            method: 'POST',
                            keepalive: keepalive,
                            signal: controller_1.signal,
                        };
                        serverUrl = "".concat((0, helpers_1.getServerUrl)(context.serverZone, this.trackServerUrl), "?").concat(urlParams.toString());
                        // Final defensive guard: never POST a zero-event payload. Upper layers (events-manager
                        // oversize filter, send()'s post-batcher check, store-layer filters) should already
                        // have caught this — but SR-4284 fleet logs show ~416 empty-body 400s/24h slipping
                        // through somehow, so a cheap belt-and-braces check immediately before fetch prevents
                        // any future regression from re-introducing the same server rejection.
                        if (payload.events.length === 0) {
                            this.completeRequest({ context: context });
                            return [2 /*return*/];
                        }
                        sendTimeout = this.sendTimeoutMs > 0
                            ? setTimeout(function () {
                                controller_1.abort();
                            }, this.sendTimeoutMs)
                            : undefined;
                        res = void 0;
                        _l.label = 5;
                    case 5:
                        _l.trys.push([5, , 10, 11]);
                        if (!this.handleSendEvents) return [3 /*break*/, 7];
                        return [4 /*yield*/, abortable(this.handleSendEvents({ url: serverUrl, method: 'POST', headers: headers, body: body, keepalive: keepalive }), controller_1.signal)];
                    case 6:
                        _j = _l.sent();
                        return [3 /*break*/, 9];
                    case 7: return [4 /*yield*/, fetch(serverUrl, options)];
                    case 8:
                        _j = _l.sent();
                        _l.label = 9;
                    case 9:
                        // When a custom transport is configured, hand it the fully-formed request and let it own
                        // the network call (e.g. to attach a JWT and route through a proxy). Otherwise use the
                        // built-in fetch. Retry/response handling below is identical for both paths. The built-in
                        // fetch cancels directly on controller.signal; the custom callback can't be cancelled, so
                        // we race it against the abort — a hung/never-settling transport then rejects with an
                        // AbortError (retryable, like the worker delegation path) instead of blocking the serial
                        // flush loop forever. The callback's own promise keeps running; we just stop awaiting it.
                        res = _j;
                        return [3 /*break*/, 11];
                    case 10:
                        // Clear on success and on error alike so a settled request never leaves an armed
                        // timer that would abort a later reused controller or fire a stray callback.
                        if (sendTimeout)
                            clearTimeout(sendTimeout);
                        return [7 /*endfinally*/];
                    case 11:
                        if (res === null) {
                            this.completeRequest({ context: context, err: messages_1.UNEXPECTED_ERROR_MESSAGE });
                            return [2 /*return*/];
                        }
                        if (res.status >= 200 && res.status < 300) {
                            skipCode = (_g = (_f = (_e = res.headers) === null || _e === void 0 ? void 0 : _e.get) === null || _f === void 0 ? void 0 : _f.call(_e, constants_1.EVENT_SKIPPED_HEADER)) !== null && _g !== void 0 ? _g : null;
                            this.applyServerDirective(context.sessionId, skipCode);
                        }
                        if (!!useRetry) return [3 /*break*/, 12];
                        responseBody = '';
                        try {
                            responseBody = JSON.stringify(res.body, null, 2);
                        }
                        catch (_m) {
                            // to avoid crash, but don't care about the error, add comment to avoid empty block lint error
                        }
                        this.completeRequest({ context: context, success: "".concat(res.status, ": ").concat(responseBody) });
                        return [3 /*break*/, 18];
                    case 12:
                        responseBody = '';
                        if (!(res.status === 413)) return [3 /*break*/, 16];
                        _l.label = 13;
                    case 13:
                        _l.trys.push([13, 15, , 16]);
                        return [4 /*yield*/, res.text()];
                    case 14:
                        responseBody = _l.sent();
                        return [3 /*break*/, 16];
                    case 15:
                        _k = _l.sent();
                        return [3 /*break*/, 16];
                    case 16: return [4 /*yield*/, this.handleReponse(res.status, context, responseBody)];
                    case 17:
                        _l.sent();
                        _l.label = 18;
                    case 18: return [3 /*break*/, 23];
                    case 19:
                        e_8 = _l.sent();
                        isAbort = !!e_8 && typeof e_8 === 'object' && e_8.name === 'AbortError';
                        if (!(isAbort && useRetry)) return [3 /*break*/, 21];
                        return [4 /*yield*/, this.handleOtherResponse(context)];
                    case 20:
                        _l.sent();
                        return [3 /*break*/, 22];
                    case 21:
                        this.completeRequest({ context: context, err: e_8 });
                        _l.label = 22;
                    case 22: return [3 /*break*/, 23];
                    case 23: return [2 /*return*/];
                }
            });
        });
    };
    SessionReplayTrackDestination.prototype.handleReponse = function (status, context, responseBody) {
        if (responseBody === void 0) { responseBody = ''; }
        return tslib_1.__awaiter(this, void 0, void 0, function () {
            var parsedStatus, _a;
            return tslib_1.__generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        parsedStatus = new analytics_core_1.BaseTransport().buildStatus(status);
                        _a = parsedStatus;
                        switch (_a) {
                            case analytics_core_1.Status.Success: return [3 /*break*/, 1];
                            case analytics_core_1.Status.Failed: return [3 /*break*/, 2];
                            case analytics_core_1.Status.Timeout: return [3 /*break*/, 2];
                            case analytics_core_1.Status.RateLimit: return [3 /*break*/, 2];
                            case analytics_core_1.Status.PayloadTooLarge: return [3 /*break*/, 4];
                        }
                        return [3 /*break*/, 5];
                    case 1:
                        this.handleSuccessResponse(context);
                        return [3 /*break*/, 8];
                    case 2: // 429: retry with existing backoff rather than silently dropping
                    return [4 /*yield*/, this.handleOtherResponse(context)];
                    case 3:
                        _b.sent();
                        return [3 /*break*/, 8];
                    case 4:
                        this.handlePayloadTooLargeResponse(context, constants_1.WAF_PAYLOAD_TOO_LARGE_PATTERN.test(responseBody));
                        return [3 /*break*/, 8];
                    case 5:
                        if (!(status === 499)) return [3 /*break*/, 7];
                        return [4 /*yield*/, this.handleOtherResponse(context)];
                    case 6:
                        _b.sent();
                        return [3 /*break*/, 8];
                    case 7:
                        this.completeRequest({ context: context, err: messages_1.UNEXPECTED_NETWORK_ERROR_MESSAGE });
                        _b.label = 8;
                    case 8: return [2 /*return*/];
                }
            });
        });
    };
    SessionReplayTrackDestination.prototype.handlePayloadTooLargeResponse = function (context, isWaf) {
        var source = isWaf ? 'WAF (compressed payload too large)' : 'server (event too large)';
        var totalSizeKB = Math.round(context.events.reduce(function (sum, e) { return sum + e.length; }, 0) / constants_1.KB_SIZE);
        if (!isWaf) {
            this.completeRequest({
                context: context,
                err: "Session replay event batch dropped: ".concat(source, " rejected payload (").concat(context.events.length, " events, ").concat(totalSizeKB, " KB) \u2014 not retrying non-WAF 413"),
            });
            return;
        }
        if (context.events.length === 1) {
            this.completeRequest({
                context: context,
                err: "Session replay event dropped: single event (".concat(totalSizeKB, " KB, 1 event) rejected by ").concat(source, " \u2014 cannot split further"),
            });
            return;
        }
        this.loggerProvider.warn("Session replay event batch rejected by ".concat(source, " (").concat(context.events.length, " events, ").concat(totalSizeKB, " KB total) \u2014 splitting and retrying"));
        // Clean up the original IDB record, then re-enqueue both halves as new in-memory batches.
        // For a merged-on-throttle context (mergeQueueAfterThrottle), this onComplete is the
        // fanned-out callback covering N source IDB records — they'll all be cleaned up here.
        // Halves get noop onCompletes, so a page-close between this cleanup and a half delivery
        // means up to N source sequences are lost. The merge soft cap (1.4MB chars) is well under
        // the 10MB compressed 413 ceiling, so a 413 on a merged context is exceedingly rare in
        // practice; the alternative — deferring source cleanup until both halves complete — would
        // significantly complicate the retry path for marginal benefit.
        void context.onComplete();
        var noop = function () { return Promise.resolve(); };
        var mid = Math.floor(context.events.length / 2);
        this.sendEventsList(tslib_1.__assign(tslib_1.__assign({}, context), { events: context.events.slice(0, mid), onComplete: noop }));
        this.sendEventsList(tslib_1.__assign(tslib_1.__assign({}, context), { events: context.events.slice(mid), onComplete: noop }));
    };
    SessionReplayTrackDestination.prototype.handleSuccessResponse = function (context) {
        var sizeOfEventsList = Math.round((0, utf8_byte_length_1.utf8ByteLengthOf)(context.events) / constants_1.KB_SIZE);
        this.completeRequest({
            context: context,
            success: "Session replay event batch tracked successfully for session id ".concat(context.sessionId, ", size of events: ").concat(sizeOfEventsList, " KB"),
        });
    };
    SessionReplayTrackDestination.prototype.handleOtherResponse = function (context) {
        return tslib_1.__awaiter(this, void 0, void 0, function () {
            var delay;
            return tslib_1.__generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        delay = Math.random() * context.attempts * this.retryTimeout;
                        context.attempts++;
                        if (context.attempts > (context.flushMaxRetries || 0)) {
                            this.completeRequest({ context: context, err: messages_1.MAX_RETRIES_EXCEEDED_MESSAGE });
                            return [2 /*return*/];
                        }
                        return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, delay); })];
                    case 1:
                        _a.sent();
                        return [4 /*yield*/, this.send(context, true)];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    SessionReplayTrackDestination.prototype.completeRequest = function (_a) {
        var context = _a.context, err = _a.err, success = _a.success;
        void context.onComplete();
        if (err) {
            this.loggerProvider.warn(err);
        }
        else if (success) {
            this.loggerProvider.log(success);
        }
    };
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
    SessionReplayTrackDestination.prototype.applyServerDirective = function (sessionId, skipCode) {
        if (skipCode === null) {
            this.flushPauseUntilMs = 0;
            this.mergeLogFiredThisPause = false;
            return;
        }
        if (skipCode === constants_1.EVENT_SKIP_CODE_THROTTLED) {
            var wasInPause = this.flushPauseUntilMs > Date.now();
            this.flushPauseUntilMs = Date.now() + constants_1.THROTTLED_FLUSH_PAUSE_MS;
            // Log only on pause-state transitions — a throttled server may reply to many
            // batches per minute, and one log per batch would flood the console.
            if (!wasInPause) {
                this.loggerProvider.log("Session replay throttled by server; pausing flush schedule for ".concat(constants_1.THROTTLED_FLUSH_PAUSE_MS / 1000, "s"));
            }
            return;
        }
        if (skipCode === constants_1.EVENT_SKIP_CODE_CAPTURE_DISABLED || skipCode === constants_1.EVENT_SKIP_CODE_INVALID_RANGE) {
            this.killSession(sessionId, skipCode);
        }
        // Unknown skip codes are ignored — the server may add new ones, and our default
        // behavior (treat as a normal 200) preserves throughput rather than penalizing the
        // session for a code we don't recognize.
    };
    SessionReplayTrackDestination.prototype.killSession = function (sessionId, skipCode) {
        var e_9, _a, e_10, _b;
        if (this.killedSessions.has(sessionId))
            return;
        this.killedSessions.add(sessionId);
        // Set preserves insertion order, so deleting the first key evicts the oldest entry.
        if (this.killedSessions.size > MAX_KILLED_SESSIONS) {
            try {
                for (var _c = tslib_1.__values(this.killedSessions), _d = _c.next(); !_d.done; _d = _c.next()) {
                    var oldest = _d.value;
                    this.killedSessions.delete(oldest);
                    break;
                }
            }
            catch (e_9_1) { e_9 = { error: e_9_1 }; }
            finally {
                try {
                    if (_d && !_d.done && (_a = _c.return)) _a.call(_c);
                }
                finally { if (e_9) throw e_9.error; }
            }
        }
        this.loggerProvider.log("Session replay capture stopped for session ".concat(sessionId, " by server directive ").concat(skipCode, "; remaining events will be dropped"));
        // Drain any queued contexts for this session so their IDB records get cleaned up
        // via onComplete, instead of sitting in the queue waiting for a flush we'll never make.
        var remaining = [];
        try {
            for (var _e = tslib_1.__values(this.queue), _f = _e.next(); !_f.done; _f = _e.next()) {
                var queued = _f.value;
                if (queued.sessionId === sessionId) {
                    this.completeRequest({ context: queued, err: messages_1.SESSION_KILLED_MESSAGE });
                }
                else {
                    remaining.push(queued);
                }
            }
        }
        catch (e_10_1) { e_10 = { error: e_10_1 }; }
        finally {
            try {
                if (_f && !_f.done && (_b = _e.return)) _b.call(_e);
            }
            finally { if (e_10) throw e_10.error; }
        }
        this.queue = remaining;
    };
    return SessionReplayTrackDestination;
}());
exports.SessionReplayTrackDestination = SessionReplayTrackDestination;
//# sourceMappingURL=track-destination.js.map