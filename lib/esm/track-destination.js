import { __assign, __awaiter, __generator, __read, __values } from "tslib";
import { BaseTransport, getGlobalScope, Status } from '@amplitude/analytics-core';
import { getCurrentUrl, getServerUrl } from './helpers';
import { MAX_RETRIES_EXCEEDED_MESSAGE, MISSING_API_KEY_MESSAGE, MISSING_DEVICE_ID_MESSAGE, SESSION_KILLED_MESSAGE, UNEXPECTED_ERROR_MESSAGE, UNEXPECTED_NETWORK_ERROR_MESSAGE, } from './messages';
import { VERSION } from './version';
import { MAX_URL_LENGTH, KB_SIZE, MAX_KEEPALIVE_BYTES, WAF_PAYLOAD_TOO_LARGE_PATTERN, EVENT_SKIPPED_HEADER, EVENT_SKIP_CODE_THROTTLED, EVENT_SKIP_CODE_INVALID_RANGE, EVENT_SKIP_CODE_CAPTURE_DISABLED, THROTTLED_FLUSH_PAUSE_MS, } from './constants';
import { gzipJson } from './utils/gzip';
// Bounded so a long-lived SDK instance can't accumulate kill records indefinitely;
// sessions are time-bounded in practice, this cap is just a defensive ceiling.
var MAX_KILLED_SESSIONS = 256;
var SessionReplayTrackDestination = /** @class */ (function () {
    function SessionReplayTrackDestination(_a) {
        var trackServerUrl = _a.trackServerUrl, loggerProvider = _a.loggerProvider, payloadBatcher = _a.payloadBatcher, workerScript = _a.workerScript;
        var _this = this;
        this.storageKey = '';
        this.retryTimeout = 1000;
        this.scheduled = null;
        this.queue = [];
        this.sendIdCounter = 0;
        this.pendingWorkerRequests = new Map();
        // Server back-pressure state, fed by the X-Session-Replay-Event-Skipped header on 200s.
        // The server uses this header (instead of 4xx) to signal a deliberate no-retry drop so SDKs
        // don't retry-storm. We honor it here by slowing or stopping our flush schedule.
        this.flushPauseUntilMs = 0;
        this.killedSessions = new Set();
        this.loggerProvider = loggerProvider;
        this.payloadBatcher = payloadBatcher ? payloadBatcher : function (payload) { return payload; };
        this.trackServerUrl = trackServerUrl;
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
                        for (var _b = __values(_this.pendingWorkerRequests), _c = _b.next(); !_c.done; _c = _b.next()) {
                            var _d = __read(_c.value, 2), pending_1 = _d[1];
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
                            _this.handlePayloadTooLargeResponse(pending_2.context, msg.isWaf);
                            pending_2.resolve();
                            _this.pendingWorkerRequests.delete(msg.id);
                        }
                    }
                    else if (msg.type === 'complete') {
                        var pending_3 = _this.pendingWorkerRequests.get(msg.id);
                        if (pending_3) {
                            if (msg.skipCode !== undefined) {
                                _this.applyServerDirective(pending_3.context.sessionId, msg.skipCode);
                            }
                            _this.completeRequest({ context: pending_3.context });
                            pending_3.resolve();
                            _this.pendingWorkerRequests.delete(msg.id);
                        }
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
        this.addToQueue(__assign(__assign({}, destinationData), { attempts: 0, timeout: 0 }));
    };
    /**
     * Sends events via navigator.sendBeacon on page exit.
     * Beacon payloads are sent as uncompressed JSON because sendBeacon does not support
     * Content-Encoding, and small incremental batches don't benefit much from compression.
     * The full snapshot has already been sent eagerly via fetch, so the beacon only needs
     * to cover the remaining incremental events since the last fetch flush.
     */
    SessionReplayTrackDestination.prototype.sendBeacon = function (_a) {
        var _b, _c;
        var events = _a.events, sessionId = _a.sessionId, deviceId = _a.deviceId, apiKey = _a.apiKey, serverZone = _a.serverZone;
        var MAX_BEACON_BYTES = 64 * 1024;
        var byteLength = function (s) { return new Blob([s]).size; };
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
        var urlParams = new URLSearchParams({
            device_id: deviceId,
            session_id: String(sessionId),
            type: 'replay',
            api_key: apiKey,
        });
        var serverUrl = "".concat(getServerUrl(serverZone, this.trackServerUrl), "?").concat(urlParams.toString());
        var globalScope = getGlobalScope();
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
                    err: SESSION_KILLED_MESSAGE,
                });
                return false;
            }
            if (context.attempts < (context.flushMaxRetries || 0)) {
                context.attempts += 1;
                return true;
            }
            _this.completeRequest({
                context: context,
                err: MAX_RETRIES_EXCEEDED_MESSAGE,
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
        var effectiveTimeout = pauseRemaining > timeout ? pauseRemaining : timeout;
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
        return __awaiter(this, void 0, void 0, function () {
            var list, list_1, list_1_1, context, e_2_1;
            var e_2, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        list = this.queue;
                        this.queue = [];
                        if (this.scheduled) {
                            clearTimeout(this.scheduled);
                            this.scheduled = null;
                        }
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 6, 7, 8]);
                        list_1 = __values(list), list_1_1 = list_1.next();
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
    SessionReplayTrackDestination.prototype.send = function (context, useRetry) {
        if (useRetry === void 0) { useRetry = true; }
        return __awaiter(this, void 0, void 0, function () {
            var apiKey, deviceId, payload, worker;
            return __generator(this, function (_a) {
                // A kill directive can arrive between flush() snapshotting the queue and us reaching
                // each context. Re-check before hitting the network so we don't waste POSTs on a
                // session the server has already told us to stop sending for.
                if (this.killedSessions.has(context.sessionId)) {
                    return [2 /*return*/, this.completeRequest({ context: context, err: SESSION_KILLED_MESSAGE })];
                }
                apiKey = context.apiKey;
                if (!apiKey) {
                    return [2 /*return*/, this.completeRequest({ context: context, err: MISSING_API_KEY_MESSAGE })];
                }
                deviceId = context.deviceId;
                if (!deviceId) {
                    return [2 /*return*/, this.completeRequest({ context: context, err: MISSING_DEVICE_ID_MESSAGE })];
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
        return __awaiter(this, void 0, void 0, function () {
            var id;
            var _this = this;
            return __generator(this, function (_a) {
                id = "".concat(++this.sendIdCounter);
                return [2 /*return*/, new Promise(function (resolve) {
                        var _a;
                        _this.pendingWorkerRequests.set(id, { context: context, resolve: resolve });
                        worker.postMessage({
                            type: 'send',
                            id: id,
                            payload: payload,
                            useRetry: useRetry,
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
                                currentUrl: getCurrentUrl(),
                                sdkVersion: VERSION,
                            },
                        });
                    })];
            });
        });
    };
    SessionReplayTrackDestination.prototype.sendOnMainThread = function (apiKey, deviceId, context, payload, useRetry) {
        var _a, _b, _c, _d, _e, _f, _g;
        return __awaiter(this, void 0, void 0, function () {
            var url, version, sampleRate, urlParams, sessionReplayLibrary, payloadJson, globalScope, gzipped, _h, payloadSize, options, serverUrl, res, skipCode, responseBody, responseBody, _j, e_3;
            return __generator(this, function (_k) {
                switch (_k.label) {
                    case 0:
                        url = getCurrentUrl();
                        version = VERSION;
                        sampleRate = context.sampleRate;
                        urlParams = new URLSearchParams({
                            device_id: deviceId,
                            session_id: "".concat(context.sessionId),
                            type: "".concat(context.type),
                        });
                        sessionReplayLibrary = "".concat((_b = (_a = context.version) === null || _a === void 0 ? void 0 : _a.type) !== null && _b !== void 0 ? _b : 'standalone', "/").concat((_d = (_c = context.version) === null || _c === void 0 ? void 0 : _c.version) !== null && _d !== void 0 ? _d : version);
                        _k.label = 1;
                    case 1:
                        _k.trys.push([1, 13, , 14]);
                        payloadJson = JSON.stringify(payload);
                        globalScope = getGlobalScope();
                        if (!(globalScope && 'CompressionStream' in globalScope)) return [3 /*break*/, 3];
                        return [4 /*yield*/, gzipJson(payloadJson, globalScope)];
                    case 2:
                        _h = _k.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        _h = null;
                        _k.label = 4;
                    case 4:
                        gzipped = _h;
                        payloadSize = gzipped ? gzipped.byteLength : new Blob([payloadJson]).size;
                        options = {
                            headers: __assign({ 'Content-Type': 'application/json', Accept: '*/*', Authorization: "Bearer ".concat(apiKey), 'X-Client-Version': version, 'X-Client-Library': sessionReplayLibrary, 'X-Client-Url': url.substring(0, MAX_URL_LENGTH), 'X-Client-Sample-Rate': "".concat(sampleRate), 'X-Sampling-Hash-Alg': 'xxhash32' }, (gzipped ? { 'Content-Encoding': 'gzip' } : {})),
                            body: (gzipped !== null && gzipped !== void 0 ? gzipped : payloadJson),
                            method: 'POST',
                            // keepalive lets the request survive page navigation, preventing 499 (client-closed) errors.
                            // Must stay under the browser's 64 KB keepalive budget; large payloads skip it.
                            keepalive: payloadSize <= MAX_KEEPALIVE_BYTES,
                        };
                        serverUrl = "".concat(getServerUrl(context.serverZone, this.trackServerUrl), "?").concat(urlParams.toString());
                        return [4 /*yield*/, fetch(serverUrl, options)];
                    case 5:
                        res = _k.sent();
                        if (res === null) {
                            this.completeRequest({ context: context, err: UNEXPECTED_ERROR_MESSAGE });
                            return [2 /*return*/];
                        }
                        if (res.status >= 200 && res.status < 300) {
                            skipCode = (_g = (_f = (_e = res.headers) === null || _e === void 0 ? void 0 : _e.get) === null || _f === void 0 ? void 0 : _f.call(_e, EVENT_SKIPPED_HEADER)) !== null && _g !== void 0 ? _g : null;
                            this.applyServerDirective(context.sessionId, skipCode);
                        }
                        if (!!useRetry) return [3 /*break*/, 6];
                        responseBody = '';
                        try {
                            responseBody = JSON.stringify(res.body, null, 2);
                        }
                        catch (_l) {
                            // to avoid crash, but don't care about the error, add comment to avoid empty block lint error
                        }
                        this.completeRequest({ context: context, success: "".concat(res.status, ": ").concat(responseBody) });
                        return [3 /*break*/, 12];
                    case 6:
                        responseBody = '';
                        if (!(res.status === 413)) return [3 /*break*/, 10];
                        _k.label = 7;
                    case 7:
                        _k.trys.push([7, 9, , 10]);
                        return [4 /*yield*/, res.text()];
                    case 8:
                        responseBody = _k.sent();
                        return [3 /*break*/, 10];
                    case 9:
                        _j = _k.sent();
                        return [3 /*break*/, 10];
                    case 10: return [4 /*yield*/, this.handleReponse(res.status, context, responseBody)];
                    case 11:
                        _k.sent();
                        _k.label = 12;
                    case 12: return [3 /*break*/, 14];
                    case 13:
                        e_3 = _k.sent();
                        this.completeRequest({ context: context, err: e_3 });
                        return [3 /*break*/, 14];
                    case 14: return [2 /*return*/];
                }
            });
        });
    };
    SessionReplayTrackDestination.prototype.handleReponse = function (status, context, responseBody) {
        if (responseBody === void 0) { responseBody = ''; }
        return __awaiter(this, void 0, void 0, function () {
            var parsedStatus, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        parsedStatus = new BaseTransport().buildStatus(status);
                        _a = parsedStatus;
                        switch (_a) {
                            case Status.Success: return [3 /*break*/, 1];
                            case Status.Failed: return [3 /*break*/, 2];
                            case Status.Timeout: return [3 /*break*/, 2];
                            case Status.RateLimit: return [3 /*break*/, 2];
                            case Status.PayloadTooLarge: return [3 /*break*/, 4];
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
                        this.handlePayloadTooLargeResponse(context, WAF_PAYLOAD_TOO_LARGE_PATTERN.test(responseBody));
                        return [3 /*break*/, 8];
                    case 5:
                        if (!(status === 499)) return [3 /*break*/, 7];
                        return [4 /*yield*/, this.handleOtherResponse(context)];
                    case 6:
                        _b.sent();
                        return [3 /*break*/, 8];
                    case 7:
                        this.completeRequest({ context: context, err: UNEXPECTED_NETWORK_ERROR_MESSAGE });
                        _b.label = 8;
                    case 8: return [2 /*return*/];
                }
            });
        });
    };
    SessionReplayTrackDestination.prototype.handlePayloadTooLargeResponse = function (context, isWaf) {
        var source = isWaf ? 'WAF (compressed payload too large)' : 'server (event too large)';
        var totalSizeKB = Math.round(context.events.reduce(function (sum, e) { return sum + e.length; }, 0) / KB_SIZE);
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
        // Clean up the original IDB record, then re-enqueue both halves as new in-memory batches
        void context.onComplete();
        var noop = function () { return Promise.resolve(); };
        var mid = Math.floor(context.events.length / 2);
        this.sendEventsList(__assign(__assign({}, context), { events: context.events.slice(0, mid), onComplete: noop }));
        this.sendEventsList(__assign(__assign({}, context), { events: context.events.slice(mid), onComplete: noop }));
    };
    SessionReplayTrackDestination.prototype.handleSuccessResponse = function (context) {
        var sizeOfEventsList = Math.round(new Blob(context.events).size / KB_SIZE);
        this.completeRequest({
            context: context,
            success: "Session replay event batch tracked successfully for session id ".concat(context.sessionId, ", size of events: ").concat(sizeOfEventsList, " KB"),
        });
    };
    SessionReplayTrackDestination.prototype.handleOtherResponse = function (context) {
        return __awaiter(this, void 0, void 0, function () {
            var delay;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        delay = Math.random() * context.attempts * this.retryTimeout;
                        context.attempts++;
                        if (context.attempts > (context.flushMaxRetries || 0)) {
                            this.completeRequest({ context: context, err: MAX_RETRIES_EXCEEDED_MESSAGE });
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
            return;
        }
        if (skipCode === EVENT_SKIP_CODE_THROTTLED) {
            var wasInPause = this.flushPauseUntilMs > Date.now();
            this.flushPauseUntilMs = Date.now() + THROTTLED_FLUSH_PAUSE_MS;
            // Log only on pause-state transitions — a throttled server may reply to many
            // batches per minute, and one log per batch would flood the console.
            if (!wasInPause) {
                this.loggerProvider.log("Session replay throttled by server; pausing flush schedule for ".concat(THROTTLED_FLUSH_PAUSE_MS / 1000, "s"));
            }
            return;
        }
        if (skipCode === EVENT_SKIP_CODE_CAPTURE_DISABLED || skipCode === EVENT_SKIP_CODE_INVALID_RANGE) {
            this.killSession(sessionId, skipCode);
        }
        // Unknown skip codes are ignored — the server may add new ones, and our default
        // behavior (treat as a normal 200) preserves throughput rather than penalizing the
        // session for a code we don't recognize.
    };
    SessionReplayTrackDestination.prototype.killSession = function (sessionId, skipCode) {
        var e_4, _a, e_5, _b;
        if (this.killedSessions.has(sessionId))
            return;
        this.killedSessions.add(sessionId);
        // Set preserves insertion order, so deleting the first key evicts the oldest entry.
        if (this.killedSessions.size > MAX_KILLED_SESSIONS) {
            try {
                for (var _c = __values(this.killedSessions), _d = _c.next(); !_d.done; _d = _c.next()) {
                    var oldest = _d.value;
                    this.killedSessions.delete(oldest);
                    break;
                }
            }
            catch (e_4_1) { e_4 = { error: e_4_1 }; }
            finally {
                try {
                    if (_d && !_d.done && (_a = _c.return)) _a.call(_c);
                }
                finally { if (e_4) throw e_4.error; }
            }
        }
        this.loggerProvider.log("Session replay capture stopped for session ".concat(sessionId, " by server directive ").concat(skipCode, "; remaining events will be dropped"));
        // Drain any queued contexts for this session so their IDB records get cleaned up
        // via onComplete, instead of sitting in the queue waiting for a flush we'll never make.
        var remaining = [];
        try {
            for (var _e = __values(this.queue), _f = _e.next(); !_f.done; _f = _e.next()) {
                var queued = _f.value;
                if (queued.sessionId === sessionId) {
                    this.completeRequest({ context: queued, err: SESSION_KILLED_MESSAGE });
                }
                else {
                    remaining.push(queued);
                }
            }
        }
        catch (e_5_1) { e_5 = { error: e_5_1 }; }
        finally {
            try {
                if (_f && !_f.done && (_b = _e.return)) _b.call(_e);
            }
            finally { if (e_5) throw e_5.error; }
        }
        this.queue = remaining;
    };
    return SessionReplayTrackDestination;
}());
export { SessionReplayTrackDestination };
//# sourceMappingURL=track-destination.js.map