import { __assign, __awaiter, __generator, __read, __spreadArray, __values } from "tslib";
import { ReplaySemanticAdapter } from './semantic';
import { getSemanticIdentity } from './semantic-identity';
import { createPrivacyRecorderOptions, getBlockSelectors, getMaskTextSelectors, } from '@amplitude/session-replay-dom-privacy';
import { getAnalyticsConnector, getGlobalScope, Logger, returnWrapper, SpecialEventType, generateHashCode, getOrCreateWindowMessenger, enableBackgroundCapture, AMPLITUDE_ORIGINS_MAP, } from '@amplitude/analytics-core';
// Import only specific types to avoid pulling in the entire rrweb-types package
import { EventType as RRWebEventType } from '@amplitude/rrweb-types';
import { createSessionReplayJoinedConfigGenerator } from './config/joined-config';
import { CustomRRwebEvent, DEFAULT_SESSION_REPLAY_PROPERTY, INTERACTION_MAX_INTERVAL, INTERACTION_MIN_INTERVAL, SESSION_REPLAY_DEBUG_PROPERTY, SESSION_REPLAY_EU_URL, SESSION_REPLAY_SERVER_URL, SESSION_REPLAY_STAGING_URL, } from './constants';
import { getServerUrl, getDebugConfig, getPageUrl, getStorageSize, getCurrentUrl } from './helpers';
import { EventCompressor } from './events/event-compressor';
import { createEventsManager } from './events/events-manager';
import { MultiEventManager } from './events/multi-manager';
import { clickBatcher, ClickHandler, clickNonBatcher } from './hooks/click';
import { ScrollWatcher } from './hooks/scroll';
import { SessionIdentifiers } from './identifiers';
import { SafeLoggerProvider } from './logger';
import { getOrInitReplayStartTime, pruneStaleReplayStartTimes, removeReplayStartTime, setReplayStartTime, } from './replay-start-time-store';
import { evaluateTargetingAndStore } from './targeting/targeting-manager';
import { isSessionInSample } from './sampling';
import { VERSION } from './version';
import { createUrlTrackingPlugin, subscribeToUrlChanges } from './plugins/url-tracking-plugin';
import { isInIframe, CrossOriginIframeCoordinator, listenForParentSignals } from './cross-origin-iframes';
import { WindowFocusTracker } from './window-focus';
var SessionReplay = /** @class */ (function () {
    function SessionReplay() {
        var _this = this;
        this.name = '@amplitude/session-replay-browser';
        this.recordCancelCallback = null;
        this.eventCount = 0;
        this.sessionTargetingMatch = false;
        // Public on purpose. `pageLeaveFns` is iterated by `pageLeaveListener`,
        // `rrwebEventManager` is dereferenced in `asyncSetSessionId` to drop the beacon buffer
        // at a session boundary, and `sessionStartTime` drives `isBelowMinSessionDuration()`.
        // Tests also stub/inspect these — privatizing them would break both production callers
        // and the gate's test coverage.
        this.pageLeaveFns = [];
        /**
         * Count of sendEvents() calls suppressed by the min-session-duration gate for the
         * current session. Drives the REPLAY_GATE_DECISION rrweb event on first send-after-pass.
         */
        this.suppressedSendCount = 0;
        /** True once REPLAY_GATE_DECISION has been emitted for the current session. */
        this.hasEmittedGateDecision = false;
        // Cache the dynamically imported record function
        this.recordFunction = null;
        this.recordEventsInFlight = false;
        /**
         * When false, capture is paused by a customer `stop()` (or `shutdown()`) call.
         * Focus/targeting/session-change paths still invoke `recordEvents()`, but
         * `getShouldRecord()` will refuse to start rrweb until `start()` or a new `init()`.
         */
        this.recordingEnabled = true;
        /**
         * Bumped by `stop()` / `shutdown()` so an in-flight `_recordEvents()` that already
         * passed `getShouldRecord()` cannot start rrweb after capture was paused.
         */
        this.recordingGeneration = 0;
        /**
         * Set by customer `start()` so coordinated child iframes self-start instead of
         * waiting for a parent signal that may never be resent. Kept until recording
         * actually starts so a gated `start()` (targeting, sampling, remote capture)
         * still self-starts when those gates later pass.
         */
        this.startChildRecordingOnSetup = false;
        this.pendingEmitEvents = [];
        this.windowFocus = new WindowFocusTracker();
        /** Current page URL, kept in sync with SPA navigations for URL-based masking */
        this.currentPageUrl = '';
        this.recordEventsPendingShouldLogMetadata = null;
        /** Cleanup for URL change listener used to re-evaluate targeting on SPA route changes */
        this.urlChangeCleanup = null;
        this.crossOriginIframeCoordinator = null;
        this.crossOriginParentSignalCleanup = null;
        /** Monotonic counter to ignore stale URL-change targeting results */
        this.latestUrlChangeTargetingEvaluationId = 0;
        this.teardownEventListeners = function (teardown) {
            var globalScope = getGlobalScope();
            if (globalScope) {
                globalScope.removeEventListener('blur', _this.blurListener);
                globalScope.removeEventListener('focus', _this.focusListener);
                !teardown && globalScope.addEventListener('blur', _this.blurListener);
                !teardown && globalScope.addEventListener('focus', _this.focusListener);
                // prefer pagehide to unload events, this is the standard going forward. it is not
                // 100% reliable, but is bfcache-compatible.
                if (globalScope.self && 'onpagehide' in globalScope.self) {
                    globalScope.removeEventListener('pagehide', _this.pageLeaveListener);
                    !teardown && globalScope.addEventListener('pagehide', _this.pageLeaveListener);
                }
                else {
                    // this has performance implications, but is the only way we can reliably send events
                    // in browser that don't support pagehide.
                    globalScope.removeEventListener('beforeunload', _this.pageLeaveListener);
                    !teardown && globalScope.addEventListener('beforeunload', _this.pageLeaveListener);
                }
                // Tab switches fire visibilitychange on the document. Focus does not: a background
                // tab can stay blurred without ever hiding, and hidden tabs often never regain focus
                // until this event. Guarded because unit-test scopes sometimes stub document.
                var documentRef = globalScope.document;
                if ((documentRef === null || documentRef === void 0 ? void 0 : documentRef.addEventListener) && documentRef.removeEventListener) {
                    documentRef.removeEventListener('visibilitychange', _this.visibilityListener);
                    !teardown && documentRef.addEventListener('visibilitychange', _this.visibilityListener);
                }
            }
        };
        this.blurListener = function () {
            // Blur covers window switches that do not hide the document (a second window
            // beside this one). Drain the idle queue first: sendEvents only ships what is
            // already in the store, and the mutations for the screen the user just left
            // are often still waiting on requestIdleCallback.
            _this.scheduleHiddenSend();
            _this.windowFocus.noteBlur();
        };
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
        this.visibilityListener = function () {
            var _a, _b;
            var visibilityState = (_b = (_a = getGlobalScope()) === null || _a === void 0 ? void 0 : _a.document) === null || _b === void 0 ? void 0 : _b.visibilityState;
            if (visibilityState === 'hidden') {
                _this.windowFocus.onDocumentHidden();
                _this.scheduleHiddenSend();
                return;
            }
            if (visibilityState === 'visible') {
                // The deferred hide upload has not run. This send includes those events
                // plus the checkout snapshot. Drop the external-focus flag so the focus
                // event that follows a tab return does not take a second checkout.
                _this.windowFocus.onDocumentVisible();
                _this.cancelHiddenSend();
                _this.captureVisibleTab();
            }
        };
        this.focusListener = function () {
            var _a;
            if (!_this.recordingEnabled) {
                return;
            }
            var focusFromOutside = _this.windowFocus.consumeArrivedFromOutside();
            // Another window of the same session stayed visible, so visibilitychange never
            // fired. One checkout replaces the replayed document; otherwise that window's
            // incremental adds share node ids and append onto this one.
            if (focusFromOutside) {
                _this.captureVisibleTab();
                return;
            }
            if (_this.recordCancelCallback && _this.recordFunction) {
                // Recording is already active. The on-focus full snapshot is tunable: when
                // `captureFullSnapshotOnFocus` is false we skip it entirely so high focus-churn pages
                // don't generate a full snapshot (and, with eager send, a network request) per focus.
                // Returning to a backgrounded tab is handled by visibilityListener instead.
                if (((_a = _this.config) === null || _a === void 0 ? void 0 : _a.captureFullSnapshotOnFocus) === false) {
                    return;
                }
                try {
                    _this.recordFunction.takeFullSnapshot(true);
                }
                catch (error) {
                    _this.loggerProvider.warn('Failed to take full snapshot on focus:', error);
                }
            }
            else if (!_this.recordEventsInFlight) {
                void _this.recordEvents(false);
            }
        };
        /**
         * This is an instance member so that if init is called multiple times
         * it doesn't add another listener to the page leave event. This is to
         * prevent duplicate listener actions from firing.
         */
        this.pageLeaveListener = function (e) {
            // Drop the deferred hide upload. It must not resolve before the beacon below
            // copies the buffer. Unload order is visibilitychange(hidden), then pagehide.
            _this.cancelHiddenSend();
            // Synchronously drain any events still queued in the requestIdleCallback
            // pipeline so they are available to send before the page unloads.
            _this.flushPendingReplayEvents();
            _this.pageLeaveFns.forEach(function (fn) {
                fn(e);
            });
        };
        this.evaluateTargetingAndCapture = function (targetingParams, isInit, forceRestart, forceTargetingReevaluation) {
            if (isInit === void 0) { isInit = false; }
            if (forceRestart === void 0) { forceRestart = false; }
            if (forceTargetingReevaluation === void 0) { forceTargetingReevaluation = false; }
            return __awaiter(_this, void 0, void 0, function () {
                var targetingConfig, shouldReEvaluate, urlChangeEvaluationId, eventForTargeting, pageUrl, pageForTargeting, targetingMatch;
                var _a, _b, _c, _d, _e, _f;
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0:
                            if (!this.identifiers || !this.identifiers.sessionId || !this.config) {
                                if (this.identifiers && !this.identifiers.sessionId) {
                                    this.loggerProvider.log('Session ID has not been set yet, cannot evaluate targeting for Session Replay.');
                                }
                                else {
                                    this.loggerProvider.warn('Session replay init has not been called, cannot evaluate targeting.');
                                }
                                return [2 /*return*/];
                            }
                            // Handle cases where there's no targeting config
                            if (!this.config.targetingConfig) {
                                if (isInit) {
                                    this.loggerProvider.log('Targeting config has not been set yet, cannot evaluate targeting.');
                                }
                                else {
                                    this.loggerProvider.log('No targeting config set, skipping initialization/recording for event.');
                                    return [2 /*return*/];
                                }
                            }
                            // Store targeting parameters for use in getShouldRecord
                            this.lastTargetingParams = targetingParams;
                            targetingConfig = this.config.targetingConfig;
                            shouldReEvaluate = targetingConfig && !this.sessionTargetingMatch;
                            if (!shouldReEvaluate) return [3 /*break*/, 2];
                            urlChangeEvaluationId = forceTargetingReevaluation ? this.latestUrlChangeTargetingEvaluationId : undefined;
                            eventForTargeting = targetingParams.event;
                            if (eventForTargeting &&
                                Object.values(SpecialEventType).includes(eventForTargeting.event_type)) {
                                eventForTargeting = undefined;
                            }
                            pageUrl = (_e = (_b = (_a = targetingParams.page) === null || _a === void 0 ? void 0 : _a.url) !== null && _b !== void 0 ? _b : (_d = (_c = getGlobalScope()) === null || _c === void 0 ? void 0 : _c.location) === null || _d === void 0 ? void 0 : _d.href) !== null && _e !== void 0 ? _e : '';
                            pageForTargeting = (_f = targetingParams.page) !== null && _f !== void 0 ? _f : (pageUrl !== '' ? { url: pageUrl } : undefined);
                            return [4 /*yield*/, evaluateTargetingAndStore({
                                    sessionId: this.identifiers.sessionId,
                                    targetingConfig: targetingConfig,
                                    loggerProvider: this.loggerProvider,
                                    apiKey: this.config.apiKey,
                                    targetingParams: {
                                        userProperties: targetingParams.userProperties,
                                        event: eventForTargeting,
                                        page: pageForTargeting,
                                    },
                                    urlChange: forceTargetingReevaluation,
                                })];
                        case 1:
                            targetingMatch = _g.sent();
                            if (forceTargetingReevaluation &&
                                urlChangeEvaluationId !== undefined &&
                                urlChangeEvaluationId !== this.latestUrlChangeTargetingEvaluationId) {
                                this.loggerProvider.debug("Ignoring stale URL-change targeting result #".concat(urlChangeEvaluationId, "; latest is #").concat(this.latestUrlChangeTargetingEvaluationId, "."));
                                return [2 /*return*/];
                            }
                            // Keep targeting match monotonic within a session: once true, always true.
                            // This avoids races where an older in-flight evaluation resolves false after
                            // a newer evaluation already resolved true.
                            this.sessionTargetingMatch = this.sessionTargetingMatch || targetingMatch;
                            this.loggerProvider.debug(JSON.stringify({
                                name: 'targeted replay capture config',
                                sessionTargetingMatch: this.sessionTargetingMatch,
                                event: eventForTargeting,
                                targetingParams: targetingParams,
                            }, null, 2));
                            _g.label = 2;
                        case 2:
                            if (!isInit) return [3 /*break*/, 3];
                            void this.initialize(true);
                            return [3 /*break*/, 5];
                        case 3:
                            if (!(forceRestart || !this.recordCancelCallback)) return [3 /*break*/, 5];
                            this.loggerProvider.log('Recording events for session due to forceRestart or no ongoing recording.');
                            return [4 /*yield*/, this.recordEvents()];
                        case 4:
                            _g.sent();
                            _g.label = 5;
                        case 5: return [2 /*return*/];
                    }
                });
            });
        };
        this.addCustomRRWebEvent = function (eventName, eventData, addStorageInfo) {
            if (eventData === void 0) { eventData = {}; }
            if (addStorageInfo === void 0) { addStorageInfo = true; }
            return __awaiter(_this, void 0, void 0, function () {
                var debugInfo, config, storageSizeData, e_1;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            _a.trys.push([0, 3, , 4]);
                            debugInfo = undefined;
                            config = this.config;
                            if (!(config && eventName !== CustomRRwebEvent.METADATA)) return [3 /*break*/, 2];
                            debugInfo = {
                                config: getDebugConfig(config),
                                version: VERSION,
                            };
                            if (!addStorageInfo) return [3 /*break*/, 2];
                            return [4 /*yield*/, getStorageSize()];
                        case 1:
                            storageSizeData = _a.sent();
                            debugInfo = __assign(__assign({}, storageSizeData), debugInfo);
                            _a.label = 2;
                        case 2:
                            // Check first to ensure we are recording
                            if (this.recordCancelCallback && this.recordFunction) {
                                this.recordFunction.addCustomEvent(eventName, __assign(__assign({}, eventData), debugInfo));
                            }
                            else {
                                this.loggerProvider.debug("Not able to add custom replay capture event ".concat(eventName, " due to no ongoing recording."));
                            }
                            return [3 /*break*/, 4];
                        case 3:
                            e_1 = _a.sent();
                            this.loggerProvider.debug('Error while adding custom replay capture event: ', e_1);
                            return [3 /*break*/, 4];
                        case 4: return [2 /*return*/];
                    }
                });
            });
        };
        this.stopRecordingEvents = function () {
            var _a, _b, _c;
            try {
                _this.useSemanticAdapter(function (adapter) { return adapter.stop(); });
                _this.loggerProvider.log('Session Replay capture stopping.');
                _this.recordCancelCallback && _this.recordCancelCallback();
                _this.recordCancelCallback = null;
                (_a = _this.networkObservers) === null || _a === void 0 ? void 0 : _a.stop();
                (_b = _this.crossOriginIframeCoordinator) === null || _b === void 0 ? void 0 : _b.stop();
                _this.crossOriginIframeCoordinator = null;
                // Remove the child-mode parent signal listener so a later mode change
                // (e.g. crossOriginIframes disabled) does not leave a stale listener.
                (_c = _this.crossOriginParentSignalCleanup) === null || _c === void 0 ? void 0 : _c.call(_this);
                _this.crossOriginParentSignalCleanup = null;
            }
            catch (error) {
                var typedError = error;
                _this.loggerProvider.warn("Error occurred while stopping replay capture: ".concat(typedError.toString()));
            }
        };
        this.loggerProvider = new SafeLoggerProvider(new Logger());
    }
    SessionReplay.prototype.init = function (apiKey, options) {
        return returnWrapper(this._init(apiKey, options));
    };
    /**
     * Subscribes to SPA URL changes via the URL tracking plugin. Always keeps
     * `currentPageUrl` in sync (needed for URL-based masking). When a targeting
     * config is present it also re-evaluates targeting on every navigation.
     */
    SessionReplay.prototype.setupUrlChangeListener = function () {
        var _this = this;
        var _a, _b;
        // If init() runs multiple times, remove the previous URL-change subscription first
        // so we don't leak callbacks and trigger duplicate targeting evaluations.
        (_a = this.urlChangeCleanup) === null || _a === void 0 ? void 0 : _a.call(this);
        var globalScope = getGlobalScope();
        if (!(globalScope === null || globalScope === void 0 ? void 0 : globalScope.location)) {
            return;
        }
        var hasTargeting = !!((_b = this.config) === null || _b === void 0 ? void 0 : _b.targetingConfig);
        var onUrlChange = function (href) {
            _this.currentPageUrl = href;
            if (hasTargeting) {
                var evaluationId = ++_this.latestUrlChangeTargetingEvaluationId;
                void _this.evaluateTargetingAndCapture({
                    userProperties: {},
                    event: undefined,
                    page: { url: href },
                }, false, false, true);
                _this.loggerProvider.debug("Queued URL-change targeting re-evaluation #".concat(evaluationId, " for ").concat(href, "."));
            }
        };
        var unsubscribe = subscribeToUrlChanges(globalScope, onUrlChange);
        this.urlChangeCleanup = function () {
            unsubscribe();
            _this.urlChangeCleanup = null;
        };
    };
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
    SessionReplay.prototype.isBelowMinSessionDuration = function () {
        var _a;
        var minSessionDurationMs = (_a = this.config) === null || _a === void 0 ? void 0 : _a.minSessionDurationMs;
        if (minSessionDurationMs === undefined || this.sessionStartTime === undefined) {
            return false;
        }
        return Date.now() - this.sessionStartTime < minSessionDurationMs;
    };
    SessionReplay.prototype.getCurrentPageForTargeting = function () {
        var _a, _b;
        var currentUrl = (_b = (_a = getGlobalScope()) === null || _a === void 0 ? void 0 : _a.location) === null || _b === void 0 ? void 0 : _b.href;
        return currentUrl != null ? { url: currentUrl } : undefined;
    };
    SessionReplay.prototype._init = function (apiKey, options) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
        return __awaiter(this, void 0, void 0, function () {
            var now, _r, _s, joinedConfig, localConfig, remoteConfig, scrollWatcher, managers, storeType, compressionWorkerScript, trackDestinationWorkerScript, globalScope, _t, compressionScript, trackDestinationScript, rrwebEventManager, error_1, typedError, payloadBatcher, interactionEventManager, error_2, typedError, onFullSnapshotProcessed, pending_2, pending_1, pending_1_1, _u, event_1, sessionId, messenger, needsUrlTracking;
            var e_2, _v;
            var _this = this;
            return __generator(this, function (_w) {
                switch (_w.label) {
                    case 0:
                        // Re-init should always tear down any previous URL-change subscription, even when the
                        // next config has no targeting config and we don't subscribe again.
                        (_a = this.urlChangeCleanup) === null || _a === void 0 ? void 0 : _a.call(this);
                        this.useSemanticAdapter(function (adapter) { return adapter.stop(); });
                        this.semanticAdapter = undefined;
                        // A new init always allows capture again. `stop()` only pauses the current instance.
                        this.recordingEnabled = true;
                        this.startChildRecordingOnSetup = false;
                        this.loggerProvider = new SafeLoggerProvider(options.loggerProvider || new Logger());
                        Object.prototype.hasOwnProperty.call(options, 'logLevel') &&
                            this.loggerProvider.enable(options.logLevel);
                        this.currentPageUrl = getCurrentUrl();
                        this.identifiers = new SessionIdentifiers({ sessionId: options.sessionId, deviceId: options.deviceId });
                        now = Date.now();
                        pruneStaleReplayStartTimes(apiKey, now, this.loggerProvider);
                        this.sessionStartTime =
                            options.sessionId !== undefined
                                ? (_b = getOrInitReplayStartTime(apiKey, options.sessionId, now, this.loggerProvider)) !== null && _b !== void 0 ? _b : now
                                : now;
                        this.recordFunction = (_c = options.record) !== null && _c !== void 0 ? _c : null;
                        _r = this;
                        return [4 /*yield*/, createSessionReplayJoinedConfigGenerator(apiKey, options)];
                    case 1:
                        _r.joinedConfigGenerator = _w.sent();
                        return [4 /*yield*/, this.joinedConfigGenerator.generateJoinedConfig()];
                    case 2:
                        _s = _w.sent(), joinedConfig = _s.joinedConfig, localConfig = _s.localConfig, remoteConfig = _s.remoteConfig;
                        this.config = joinedConfig;
                        this.setMetadata(options.sessionId, joinedConfig, localConfig, remoteConfig, (_d = options.version) === null || _d === void 0 ? void 0 : _d.version, VERSION, (_e = options.version) === null || _e === void 0 ? void 0 : _e.type);
                        this.pageLeaveFns = [];
                        if (options.sessionId && ((_f = this.config.interactionConfig) === null || _f === void 0 ? void 0 : _f.enabled)) {
                            scrollWatcher = ScrollWatcher.default({
                                sessionId: options.sessionId,
                                type: 'interaction',
                            }, this.config);
                            this.pageLeaveFns = [scrollWatcher.send(this.getDeviceId.bind(this)).bind(scrollWatcher)];
                            this.scrollHook = scrollWatcher.hook.bind(scrollWatcher);
                            this.clickHandler = new ClickHandler(this.loggerProvider, scrollWatcher);
                        }
                        managers = [];
                        storeType = this.config.storeType;
                        if (storeType === 'idb' && !((_g = getGlobalScope()) === null || _g === void 0 ? void 0 : _g.indexedDB)) {
                            storeType = 'memory';
                            this.loggerProvider.warn('Could not use preferred indexedDB storage, reverting to in memory option.');
                        }
                        this.loggerProvider.log("Using ".concat(storeType, " for event storage."));
                        globalScope = getGlobalScope();
                        if (!(this.config.useWebWorker && globalScope && globalScope.Worker)) return [3 /*break*/, 4];
                        return [4 /*yield*/, import('./worker')];
                    case 3:
                        _t = _w.sent(), compressionScript = _t.compressionScript, trackDestinationScript = _t.trackDestinationScript;
                        compressionWorkerScript = compressionScript;
                        trackDestinationWorkerScript = trackDestinationScript;
                        _w.label = 4;
                    case 4:
                        _w.trys.push([4, 6, , 7]);
                        return [4 /*yield*/, createEventsManager({
                                config: this.config,
                                type: 'replay',
                                minInterval: (_h = this.config.flushIntervalConfig) === null || _h === void 0 ? void 0 : _h.minIntervalMs,
                                maxInterval: (_j = this.config.flushIntervalConfig) === null || _j === void 0 ? void 0 : _j.maxIntervalMs,
                                maxPersistedEventsSize: this.config.maxPersistedEventsSizeBytes,
                                storeType: storeType,
                                trackDestinationWorkerScript: trackDestinationWorkerScript,
                                shouldSend: function () { return !_this.isBelowMinSessionDuration(); },
                            })];
                    case 5:
                        rrwebEventManager = _w.sent();
                        this.rrwebEventManager = rrwebEventManager;
                        managers.push({ name: 'replay', manager: rrwebEventManager });
                        return [3 /*break*/, 7];
                    case 6:
                        error_1 = _w.sent();
                        typedError = error_1;
                        this.loggerProvider.warn("Error occurred while creating replay events manager: ".concat(typedError.toString()));
                        return [3 /*break*/, 7];
                    case 7:
                        if (!((_k = this.config.interactionConfig) === null || _k === void 0 ? void 0 : _k.enabled)) return [3 /*break*/, 11];
                        payloadBatcher = this.config.interactionConfig.batch ? clickBatcher : clickNonBatcher;
                        _w.label = 8;
                    case 8:
                        _w.trys.push([8, 10, , 11]);
                        return [4 /*yield*/, createEventsManager({
                                config: this.config,
                                type: 'interaction',
                                minInterval: (_l = this.config.interactionConfig.trackEveryNms) !== null && _l !== void 0 ? _l : INTERACTION_MIN_INTERVAL,
                                maxInterval: INTERACTION_MAX_INTERVAL,
                                maxPersistedEventsSize: this.config.maxPersistedEventsSizeBytes,
                                payloadBatcher: payloadBatcher,
                                storeType: storeType,
                                trackDestinationWorkerScript: trackDestinationWorkerScript,
                            })];
                    case 9:
                        interactionEventManager = _w.sent();
                        managers.push({ name: 'interaction', manager: interactionEventManager });
                        return [3 /*break*/, 11];
                    case 10:
                        error_2 = _w.sent();
                        typedError = error_2;
                        this.loggerProvider.warn("Error occurred while creating interaction events manager: ".concat(typedError.toString()));
                        return [3 /*break*/, 11];
                    case 11:
                        this.eventsManager = new (MultiEventManager.bind.apply(MultiEventManager, __spreadArray([void 0], __read(managers), false)))();
                        // To prevent too many threads.
                        if (this.eventCompressor) {
                            this.eventCompressor.terminate();
                        }
                        onFullSnapshotProcessed = this.config.eagerFullSnapshotSend === true ? function () { return _this.sendEvents(); } : undefined;
                        this.eventCompressor = new EventCompressor(this.eventsManager, this.config, this.getDeviceId(), compressionWorkerScript, onFullSnapshotProcessed);
                        // Flush any events that arrived while eventCompressor was not yet ready
                        // (e.g. a concurrent setSessionId() call that raced _init()'s async setup).
                        if (this.pendingEmitEvents.length > 0) {
                            pending_2 = this.pendingEmitEvents.splice(0);
                            try {
                                for (pending_1 = __values(pending_2), pending_1_1 = pending_1.next(); !pending_1_1.done; pending_1_1 = pending_1.next()) {
                                    _u = pending_1_1.value, event_1 = _u.event, sessionId = _u.sessionId;
                                    this.eventCompressor.enqueueEvent(event_1, sessionId);
                                }
                            }
                            catch (e_2_1) { e_2 = { error: e_2_1 }; }
                            finally {
                                try {
                                    if (pending_1_1 && !pending_1_1.done && (_v = pending_1.return)) _v.call(pending_1);
                                }
                                finally { if (e_2) throw e_2.error; }
                            }
                        }
                        // Register beacon fallback for page exit. sendBeacon survives page unload
                        // and delivers any incremental events that haven't been flushed via fetch yet.
                        //
                        // Known cross-session race: if asyncSetSessionId fired and its async
                        // storeCurrentSequence hasn't resolved before unload, the beacon buffer can still
                        // hold previous-session events. The gate below reads the *new* session's
                        // sessionStartTime, so legitimately-sendable old-session events get suppressed.
                        // Follow-up: track start time per buffered batch instead of globally.
                        this.pageLeaveFns = __spreadArray(__spreadArray([], __read(this.pageLeaveFns), false), [
                            function () {
                                var _a;
                                if (!_this.config || !((_a = _this.identifiers) === null || _a === void 0 ? void 0 : _a.sessionId) || !rrwebEventManager)
                                    return;
                                var events = rrwebEventManager.getBeaconEvents();
                                if (!events.length)
                                    return;
                                var deviceId = _this.getDeviceId();
                                if (!deviceId)
                                    return;
                                if (_this.isBelowMinSessionDuration())
                                    return;
                                rrwebEventManager.trackDestination.sendBeacon({
                                    events: events,
                                    sessionId: _this.identifiers.sessionId,
                                    deviceId: deviceId,
                                    apiKey: _this.config.apiKey,
                                    serverZone: _this.config.serverZone,
                                });
                            },
                        ], false);
                        return [4 /*yield*/, this.initializeNetworkObservers()];
                    case 12:
                        _w.sent();
                        // Enable background capture when this page is opened by the Amplitude app
                        // (window.opener exists). Uses the shared messenger singleton so that if
                        // autocapture is also loaded, both share a single messenger and script load.
                        if ((_m = getGlobalScope()) === null || _m === void 0 ? void 0 : _m.opener) {
                            messenger = getOrCreateWindowMessenger();
                            enableBackgroundCapture(messenger);
                            messenger.setup(__assign({ logger: this.loggerProvider }, (this.config.serverZone && { endpoint: AMPLITUDE_ORIGINS_MAP[this.config.serverZone] })));
                        }
                        this.loggerProvider.log('Installing @amplitude/session-replay-browser.');
                        this.teardownEventListeners(false);
                        return [4 /*yield*/, this.evaluateTargetingAndCapture({ userProperties: options.userProperties, page: this.getCurrentPageForTargeting() }, true)];
                    case 13:
                        _w.sent();
                        needsUrlTracking = this.config.targetingConfig || ((_q = (_p = (_o = this.config.privacyConfig) === null || _o === void 0 ? void 0 : _o.urlMaskLevels) === null || _p === void 0 ? void 0 : _p.length) !== null && _q !== void 0 ? _q : 0) > 0;
                        if (needsUrlTracking) {
                            this.setupUrlChangeListener();
                        }
                        return [2 /*return*/];
                }
            });
        });
    };
    SessionReplay.prototype.setSessionId = function (sessionId, deviceId) {
        return returnWrapper(this.asyncSetSessionId(sessionId, deviceId));
    };
    SessionReplay.prototype.asyncSetSessionId = function (sessionId, deviceId, options) {
        var _a, _b, _c, _d, _e, _f;
        return __awaiter(this, void 0, void 0, function () {
            var previousSessionId, currentDeviceId, isSessionChange, deviceIdForReplayId, joinedConfig;
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0:
                        previousSessionId = (_a = this.identifiers) === null || _a === void 0 ? void 0 : _a.sessionId;
                        currentDeviceId = this.getDeviceId();
                        // Standalone SDK callers may poll setSessionId with a stable bucket id (e.g. hour-aligned
                        // timestamps) and only need a no-op when the bucket hasn't rolled. Without this guard,
                        // the rest of asyncSetSessionId still runs: sendEvents, targeting reset, config refetch,
                        // and recordEvents (stop + restart rrweb). Proceed when deviceId changes or
                        // non-empty userProperties are passed so targeting can re-evaluate on Identify.
                        if (previousSessionId !== undefined &&
                            previousSessionId === sessionId &&
                            (deviceId === undefined || deviceId === currentDeviceId) &&
                            ((options === null || options === void 0 ? void 0 : options.userProperties) === undefined || Object.keys(options.userProperties).length === 0)) {
                            return [2 /*return*/];
                        }
                        // Invalidate any in-flight URL-change re-evaluations from the previous session.
                        this.latestUrlChangeTargetingEvaluationId++;
                        this.sessionTargetingMatch = false;
                        this.lastShouldRecordDecision = undefined; // Reset targeting decision for new session
                        if (previousSessionId) {
                            this.sendEvents(previousSessionId);
                        }
                        isSessionChange = previousSessionId !== sessionId;
                        if (isSessionChange && ((_c = (_b = this.config) === null || _b === void 0 ? void 0 : _b.semanticCapture) === null || _c === void 0 ? void 0 : _c.enabled) && this.semanticAdapter) {
                            // Keep rrweb recording through the async config/targeting pass, as it does
                            // without semantic capture. Only detach the old session's semantic runtime.
                            this.useSemanticAdapter(function (adapter) { return adapter.stop(); });
                        }
                        // Drop any beacon-buffered events from the previous session BEFORE installing the
                        // new identifiers / start time. Otherwise the page-leave beacon path could attribute
                        // old-session events to the new session id, and the gate (using the new start time)
                        // would compute the wrong elapsed duration. Skip on a redundant same-sessionId call —
                        // the buffer belongs to the *continuing* session and should ship via beacon as normal.
                        if (isSessionChange) {
                            (_d = this.rrwebEventManager) === null || _d === void 0 ? void 0 : _d.dropPendingBeaconEvents();
                        }
                        deviceIdForReplayId = deviceId || this.getDeviceId();
                        this.identifiers = new SessionIdentifiers({
                            sessionId: sessionId,
                            deviceId: deviceIdForReplayId,
                        });
                        // Gate state and persisted start time only get reset on an actual session boundary.
                        // A redundant setSessionId(currentId) call would otherwise overwrite both the in-memory
                        // and stored start time with a fresh Date.now() — restarting the gate clock for what is
                        // supposed to be a continuing session.
                        if (isSessionChange) {
                            this.sessionStartTime = Date.now();
                            this.suppressedSendCount = 0;
                            this.hasEmittedGateDecision = false;
                            if ((_e = this.config) === null || _e === void 0 ? void 0 : _e.apiKey) {
                                setReplayStartTime(this.config.apiKey, sessionId, this.sessionStartTime, this.loggerProvider);
                                if (previousSessionId !== undefined) {
                                    removeReplayStartTime(this.config.apiKey, previousSessionId, this.loggerProvider);
                                }
                            }
                        }
                        if (!(this.joinedConfigGenerator && previousSessionId)) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.joinedConfigGenerator.generateJoinedConfig()];
                    case 1:
                        joinedConfig = (_g.sent()).joinedConfig;
                        this.config = joinedConfig;
                        _g.label = 2;
                    case 2:
                        if (!((_f = this.config) === null || _f === void 0 ? void 0 : _f.targetingConfig)) return [3 /*break*/, 4];
                        return [4 /*yield*/, this.evaluateTargetingAndCapture({ userProperties: options === null || options === void 0 ? void 0 : options.userProperties, page: this.getCurrentPageForTargeting() }, false, true)];
                    case 3:
                        _g.sent();
                        return [3 /*break*/, 6];
                    case 4: return [4 /*yield*/, this.recordEvents()];
                    case 5:
                        _g.sent();
                        _g.label = 6;
                    case 6: return [2 /*return*/];
                }
            });
        });
    };
    SessionReplay.prototype.getSessionReplayProperties = function () {
        var _a;
        var config = this.config;
        var identifiers = this.identifiers;
        if (!config || !identifiers) {
            this.loggerProvider.warn('Session replay init has not been called, cannot get session replay properties.');
            return {};
        }
        var shouldRecord = this.getShouldRecord();
        var eventProperties = {};
        if (shouldRecord) {
            eventProperties = (_a = {},
                _a[DEFAULT_SESSION_REPLAY_PROPERTY] = identifiers.sessionReplayId ? identifiers.sessionReplayId : null,
                _a);
            if (config.debugMode) {
                eventProperties[SESSION_REPLAY_DEBUG_PROPERTY] = JSON.stringify({
                    appHash: generateHashCode(config.apiKey).toString(),
                });
            }
        }
        void this.addCustomRRWebEvent(CustomRRwebEvent.GET_SR_PROPS, {
            shouldRecord: shouldRecord,
            eventProperties: eventProperties,
        }, this.eventCount === 10);
        if (this.eventCount === 10) {
            this.eventCount = 0;
        }
        this.eventCount++;
        return eventProperties;
    };
    /** Move idle-queued rrweb events into the store, then ship the current sequence. */
    SessionReplay.prototype.flushPendingReplayEvents = function () {
        var _a;
        (_a = this.eventCompressor) === null || _a === void 0 ? void 0 : _a.flushQueue();
        this.sendEvents();
    };
    /**
     * Flush now, upload on the next macrotask. The flush is synchronous so a
     * following `pagehide` still sees the events in the beacon buffer. The upload
     * waits so a memory-store `sendEvents` cannot clear that buffer before the
     * beacon copies it. A tab switch never reaches `pagehide`, so the timer uploads.
     */
    SessionReplay.prototype.scheduleHiddenSend = function () {
        var _this = this;
        var _a;
        (_a = this.eventCompressor) === null || _a === void 0 ? void 0 : _a.flushQueue();
        if (this.hiddenFlushTimer !== undefined) {
            return;
        }
        var schedule = this.hostSetTimeout();
        this.hiddenFlushTimer = schedule(function () {
            _this.hiddenFlushTimer = undefined;
            _this.sendEvents();
        }, 0);
    };
    SessionReplay.prototype.cancelHiddenSend = function () {
        if (this.hiddenFlushTimer === undefined) {
            return;
        }
        this.hostClearTimeout()(this.hiddenFlushTimer);
        this.hiddenFlushTimer = undefined;
    };
    SessionReplay.prototype.hostSetTimeout = function () {
        var globalScope = getGlobalScope();
        if (typeof (globalScope === null || globalScope === void 0 ? void 0 : globalScope.setTimeout) === 'function') {
            return globalScope.setTimeout.bind(globalScope);
        }
        return setTimeout;
    };
    SessionReplay.prototype.hostClearTimeout = function () {
        var globalScope = getGlobalScope();
        if (typeof (globalScope === null || globalScope === void 0 ? void 0 : globalScope.clearTimeout) === 'function') {
            return globalScope.clearTimeout.bind(globalScope);
        }
        return clearTimeout;
    };
    /**
     * Checkout the DOM the user can actually see, then send it. Queued mutations are
     * flushed first so they stay ordered ahead of the new snapshot.
     */
    SessionReplay.prototype.captureVisibleTab = function () {
        var _a;
        if (!this.recordingEnabled) {
            return;
        }
        (_a = this.eventCompressor) === null || _a === void 0 ? void 0 : _a.flushQueue();
        if (this.recordCancelCallback && this.recordFunction) {
            try {
                // `true` is an rrweb checkout: the player drops the previous mirror and
                // paints this snapshot instead of applying it onto an older document.
                this.recordFunction.takeFullSnapshot(true);
            }
            catch (error) {
                this.loggerProvider.warn('Failed to take full snapshot when the tab became visible:', error);
            }
            this.sendEvents();
            return;
        }
        if (!this.recordEventsInFlight) {
            void this.recordEvents(false);
        }
    };
    SessionReplay.prototype.sendEvents = function (sessionId) {
        var _a, _b;
        var sessionIdToSend = sessionId || ((_a = this.identifiers) === null || _a === void 0 ? void 0 : _a.sessionId);
        var deviceId = this.getDeviceId();
        if (this.eventsManager && sessionIdToSend && deviceId) {
            if (this.isBelowMinSessionDuration()) {
                // Safe to dereference: isBelowMinSessionDuration() only returns true when both
                // this.config and this.sessionStartTime are defined.
                var startTime = this.sessionStartTime;
                var minMs = this.config.minSessionDurationMs;
                this.loggerProvider.log("Session ".concat(sessionIdToSend, " not sent: duration ").concat(Date.now() - startTime, "ms is below minimum ").concat(minMs, "ms."));
                // We deliberately do NOT clear the beacon buffer here. Blur/visibility-change
                // can call sendEvents() mid-session; if the session later crosses the threshold
                // those buffered events are legitimately sendable via beacon on page exit.
                // Cross-session leak is prevented in asyncSetSessionId, which drops the buffer
                // at the session transition. The page-leave path also gates independently.
                this.suppressedSendCount++;
                return;
            }
            // On the first send-after-pass for the session, emit a custom rrweb event so the
            // payload itself carries the gate verdict. Lets backend ingestion diff intended
            // vs actual replay counts to spot start-time-tracking regressions.
            //
            // Gate on recording being active too: addCustomRRWebEvent is a no-op when
            // recordCancelCallback/recordFunction aren't set yet (e.g. a blur-listener-fired
            // sendEvents reaches us before _recordEvents() activates on a reloaded long-lived
            // session). Tripping hasEmittedGateDecision unconditionally would lose the signal
            // for that session's first real send.
            if (!this.hasEmittedGateDecision &&
                ((_b = this.config) === null || _b === void 0 ? void 0 : _b.minSessionDurationMs) !== undefined &&
                this.recordCancelCallback &&
                this.recordFunction) {
                this.hasEmittedGateDecision = true;
                var elapsedMs = this.sessionStartTime !== undefined ? Date.now() - this.sessionStartTime : undefined;
                void this.addCustomRRWebEvent(CustomRRwebEvent.REPLAY_GATE_DECISION, {
                    sessionId: sessionIdToSend,
                    suppressedSendCount: this.suppressedSendCount,
                    elapsedMs: elapsedMs,
                    minSessionDurationMs: this.config.minSessionDurationMs,
                }, false);
            }
            this.eventsManager.sendCurrentSequenceEvents({ sessionId: sessionIdToSend, deviceId: deviceId });
        }
    };
    SessionReplay.prototype.initialize = function (shouldSendStoredEvents) {
        var _a;
        if (shouldSendStoredEvents === void 0) { shouldSendStoredEvents = false; }
        return __awaiter(this, void 0, void 0, function () {
            var deviceId;
            return __generator(this, function (_b) {
                if (!((_a = this.identifiers) === null || _a === void 0 ? void 0 : _a.sessionId)) {
                    this.loggerProvider.log("Session is not being recorded due to lack of session id.");
                    return [2 /*return*/, Promise.resolve()];
                }
                deviceId = this.getDeviceId();
                if (!deviceId) {
                    this.loggerProvider.log("Session is not being recorded due to lack of device id.");
                    return [2 /*return*/, Promise.resolve()];
                }
                this.eventsManager && shouldSendStoredEvents && void this.eventsManager.sendStoredEvents({ deviceId: deviceId });
                return [2 /*return*/, this.recordEvents()];
            });
        });
    };
    SessionReplay.prototype.shouldOptOut = function () {
        var _a, _b;
        var identityStoreOptOut;
        if ((_a = this.config) === null || _a === void 0 ? void 0 : _a.instanceName) {
            var identityStore = getAnalyticsConnector(this.config.instanceName).identityStore;
            identityStoreOptOut = identityStore.getIdentity().optOut;
        }
        return identityStoreOptOut !== undefined ? identityStoreOptOut : (_b = this.config) === null || _b === void 0 ? void 0 : _b.optOut;
    };
    SessionReplay.prototype.getShouldRecord = function () {
        if (!this.identifiers || !this.config || !this.identifiers.sessionId) {
            this.loggerProvider.warn("Session is not being recorded due to lack of config, please call sessionReplay.init.");
            return false;
        }
        if (!this.recordingEnabled) {
            this.loggerProvider.log("Session ".concat(this.identifiers.sessionId, " not being captured because recording was stopped."));
            return false;
        }
        if (!this.config.captureEnabled) {
            this.loggerProvider.log("Session ".concat(this.identifiers.sessionId, " not being captured due to capture being disabled for project or because the remote config could not be fetched."));
            return false;
        }
        if (this.shouldOptOut()) {
            this.loggerProvider.log("Opting session ".concat(this.identifiers.sessionId, " out of recording due to optOut config."));
            return false;
        }
        var shouldRecord = false;
        var message = '';
        var matched = false;
        // If targetingConfig exists, we'll use the sessionTargetingMatch to determine whether to record
        // Otherwise, we'll evaluate the session against the overall sample rate
        if (this.config.targetingConfig) {
            if (!this.sessionTargetingMatch) {
                message = "Not capturing replays for session ".concat(this.identifiers.sessionId, " due to not matching targeting conditions.");
                this.loggerProvider.log(message);
                shouldRecord = false;
                matched = false;
            }
            else {
                message = "Capturing replays for session ".concat(this.identifiers.sessionId, " due to matching targeting conditions.");
                this.loggerProvider.log(message);
                shouldRecord = true;
                matched = true;
            }
        }
        else {
            var isInSample = isSessionInSample(this.identifiers.sessionId, this.config.sampleRate);
            if (!isInSample) {
                message = "Opting session ".concat(this.identifiers.sessionId, " out of recording due to sample rate.");
                this.loggerProvider.log(message);
                shouldRecord = false;
                matched = false;
            }
            else {
                shouldRecord = true;
                matched = true;
            }
        }
        // Only send custom rrweb event for targeting decision when the decision changes
        if (this.lastShouldRecordDecision !== shouldRecord && this.config.targetingConfig) {
            void this.addCustomRRWebEvent(CustomRRwebEvent.TARGETING_DECISION, {
                message: message,
                sessionId: this.identifiers.sessionId,
                matched: matched,
                targetingParams: this.lastTargetingParams,
            });
            this.lastShouldRecordDecision = shouldRecord;
        }
        return shouldRecord;
    };
    SessionReplay.prototype.getBlockSelectors = function () {
        var _a;
        return getBlockSelectors((_a = this.config) === null || _a === void 0 ? void 0 : _a.privacyConfig);
    };
    SessionReplay.prototype.getMaskTextSelectors = function () {
        var _a;
        return getMaskTextSelectors((_a = this.config) === null || _a === void 0 ? void 0 : _a.privacyConfig, this.currentPageUrl);
    };
    SessionReplay.prototype.getRecordingPlugins = function (loggingConfig) {
        var _a, _b, _c, _d, _e, _f;
        return __awaiter(this, void 0, void 0, function () {
            var plugins, urlTrackingPlugin, getRecordConsolePlugin, error_3;
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0:
                        plugins = [];
                        // Add URL tracking plugin
                        try {
                            urlTrackingPlugin = createUrlTrackingPlugin({
                                ugcFilterRules: ((_b = (_a = this.config) === null || _a === void 0 ? void 0 : _a.interactionConfig) === null || _b === void 0 ? void 0 : _b.ugcFilterRules) || [],
                                enablePolling: ((_c = this.config) === null || _c === void 0 ? void 0 : _c.enableUrlChangePolling) || false,
                                pollingInterval: (_d = this.config) === null || _d === void 0 ? void 0 : _d.urlChangePollingInterval,
                                captureDocumentTitle: (_e = this.config) === null || _e === void 0 ? void 0 : _e.captureDocumentTitle,
                            });
                            plugins.push(urlTrackingPlugin);
                        }
                        catch (error) {
                            this.loggerProvider.warn('Failed to create URL tracking plugin:', error);
                        }
                        if (!((_f = loggingConfig === null || loggingConfig === void 0 ? void 0 : loggingConfig.console) === null || _f === void 0 ? void 0 : _f.enabled)) return [3 /*break*/, 4];
                        _g.label = 1;
                    case 1:
                        _g.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, import('@amplitude/rrweb-plugin-console-record')];
                    case 2:
                        getRecordConsolePlugin = (_g.sent()).getRecordConsolePlugin;
                        plugins.push(getRecordConsolePlugin({ level: loggingConfig.console.levels }));
                        return [3 /*break*/, 4];
                    case 3:
                        error_3 = _g.sent();
                        this.loggerProvider.warn('Failed to load console plugin:', error_3);
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/, plugins.length > 0 ? plugins : undefined];
                }
            });
        });
    };
    SessionReplay.prototype.getRecordFunction = function () {
        return __awaiter(this, void 0, void 0, function () {
            var record, error_4;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.recordFunction) {
                            return [2 /*return*/, this.recordFunction];
                        }
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, import('@amplitude/rrweb-record')];
                    case 2:
                        record = (_a.sent()).record;
                        this.recordFunction = record;
                        return [2 /*return*/, record];
                    case 3:
                        error_4 = _a.sent();
                        this.loggerProvider.warn('Failed to load rrweb-record module:', error_4);
                        return [2 /*return*/, null];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    SessionReplay.prototype.recordEvents = function (shouldLogMetadata) {
        if (shouldLogMetadata === void 0) { shouldLogMetadata = true; }
        return __awaiter(this, void 0, void 0, function () {
            var pendingArgs;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.recordEventsInFlight) {
                            this.recordEventsPendingShouldLogMetadata = shouldLogMetadata;
                            return [2 /*return*/];
                        }
                        this.recordEventsInFlight = true;
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, , 6, 7]);
                        return [4 /*yield*/, this._recordEvents(shouldLogMetadata)];
                    case 2:
                        _a.sent();
                        _a.label = 3;
                    case 3:
                        if (!(this.recordEventsPendingShouldLogMetadata !== null)) return [3 /*break*/, 5];
                        pendingArgs = this.recordEventsPendingShouldLogMetadata;
                        this.recordEventsPendingShouldLogMetadata = null;
                        return [4 /*yield*/, this._recordEvents(pendingArgs)];
                    case 4:
                        _a.sent();
                        return [3 /*break*/, 3];
                    case 5: return [3 /*break*/, 7];
                    case 6:
                        this.recordEventsInFlight = false;
                        this.recordEventsPendingShouldLogMetadata = null;
                        return [7 /*endfinally*/];
                    case 7: return [2 /*return*/];
                }
            });
        });
    };
    SessionReplay.prototype.shouldAbandonRecordStart = function (generation) {
        return !this.recordingEnabled || generation !== this.recordingGeneration;
    };
    SessionReplay.prototype._recordEvents = function (shouldLogMetadata) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        if (shouldLogMetadata === void 0) { shouldLogMetadata = true; }
        return __awaiter(this, void 0, void 0, function () {
            var config, shouldRecord, sessionId, generation, recordFunction, networkLoggingConfig, trackUrl, ignoredUrls, interactionConfig, loggingConfig, hooks, ugcFilterRules, crossOriginIframesEnabled, coordinateChildren, childMode, plugins, error_5;
            var _this = this;
            return __generator(this, function (_j) {
                switch (_j.label) {
                    case 0:
                        config = this.config;
                        shouldRecord = this.getShouldRecord();
                        sessionId = (_a = this.identifiers) === null || _a === void 0 ? void 0 : _a.sessionId;
                        if (!shouldRecord || !sessionId || !config) {
                            if (this.semanticAdapter && this.recordCancelCallback)
                                this.stopRecordingEvents();
                            return [2 /*return*/];
                        }
                        this.stopRecordingEvents();
                        generation = this.recordingGeneration;
                        return [4 /*yield*/, this.getRecordFunction()];
                    case 1:
                        recordFunction = _j.sent();
                        // May be undefined if cannot import rrweb-record
                        if (!recordFunction || this.shouldAbandonRecordStart(generation)) {
                            return [2 /*return*/];
                        }
                        return [4 /*yield*/, this.initializeNetworkObservers()];
                    case 2:
                        _j.sent();
                        if (this.shouldAbandonRecordStart(generation)) {
                            return [2 /*return*/];
                        }
                        networkLoggingConfig = (_b = config.loggingConfig) === null || _b === void 0 ? void 0 : _b.network;
                        trackUrl = getServerUrl(config.serverZone, config.trackServerUrl);
                        ignoredUrls = [SESSION_REPLAY_SERVER_URL, SESSION_REPLAY_EU_URL, SESSION_REPLAY_STAGING_URL, trackUrl];
                        (_c = this.networkObservers) === null || _c === void 0 ? void 0 : _c.start(function (event) {
                            if (ignoredUrls.some(function (url) { return event.url.startsWith(url); }))
                                return;
                            void _this.addCustomRRWebEvent(CustomRRwebEvent.FETCH_REQUEST, event);
                        }, networkLoggingConfig);
                        interactionConfig = config.interactionConfig, loggingConfig = config.loggingConfig;
                        hooks = (interactionConfig === null || interactionConfig === void 0 ? void 0 : interactionConfig.enabled)
                            ? {
                                mouseInteraction: this.eventsManager &&
                                    ((_d = this.clickHandler) === null || _d === void 0 ? void 0 : _d.createHook({
                                        eventsManager: this.eventsManager,
                                        sessionId: sessionId,
                                        deviceIdFn: this.getDeviceId.bind(this),
                                        mirror: recordFunction.mirror,
                                        ugcFilterRules: (_e = interactionConfig.ugcFilterRules) !== null && _e !== void 0 ? _e : [],
                                        performanceOptions: (_f = config.performanceConfig) === null || _f === void 0 ? void 0 : _f.interaction,
                                    })),
                                scroll: this.scrollHook,
                            }
                            : {};
                        ugcFilterRules = (interactionConfig === null || interactionConfig === void 0 ? void 0 : interactionConfig.enabled) && interactionConfig.ugcFilterRules ? interactionConfig.ugcFilterRules : [];
                        this.loggerProvider.log("Session Replay capture beginning for ".concat(sessionId, "."));
                        _j.label = 3;
                    case 3:
                        _j.trys.push([3, 5, , 6]);
                        crossOriginIframesEnabled = !!((_g = config.crossOriginIframes) === null || _g === void 0 ? void 0 : _g.enabled);
                        coordinateChildren = ((_h = config.crossOriginIframes) === null || _h === void 0 ? void 0 : _h.coordinateChildren) !== false;
                        childMode = crossOriginIframesEnabled && isInIframe();
                        if (childMode && coordinateChildren) {
                            // Child mode: don't self-start; wait for a start signal from the parent.
                            // (The previous listener, if any, was already removed by stopRecordingEvents above.)
                            this.crossOriginParentSignalCleanup = listenForParentSignals({
                                onStart: function () {
                                    if (!_this.recordingEnabled) {
                                        return;
                                    }
                                    _this._recordEventsInChildMode(recordFunction, sessionId, config, hooks);
                                },
                                onStop: function () {
                                    try {
                                        // Only cancel the rrweb recording — do NOT call stopRecordingEvents() here,
                                        // which would clear crossOriginParentSignalCleanup and make the child deaf
                                        // to subsequent start/stop cycles from the parent.
                                        _this.recordCancelCallback && _this.recordCancelCallback();
                                        _this.recordCancelCallback = null;
                                    }
                                    catch (error) {
                                        var typedError = error;
                                        _this.loggerProvider.warn("Error occurred while stopping child iframe replay capture: ".concat(typedError.toString()));
                                    }
                                },
                            });
                            // Customer start() must not wait for a parent signal: the parent may already
                            // be recording and will not send another start. Init still waits.
                            if (this.startChildRecordingOnSetup) {
                                this.startChildRecordingOnSetup = false;
                                this._recordEventsInChildMode(recordFunction, sessionId, config, hooks);
                            }
                            return [2 /*return*/];
                        }
                        this.startChildRecordingOnSetup = false;
                        return [4 /*yield*/, this.getRecordingPlugins(loggingConfig)];
                    case 4:
                        plugins = _j.sent();
                        if (this.shouldAbandonRecordStart(generation)) {
                            return [2 /*return*/];
                        }
                        this.prepareSemanticCapture(config, sessionId);
                        this.recordCancelCallback = recordFunction(__assign(__assign({}, this.buildRRWebRecordOptions(config, hooks, function (event) {
                            if (_this.shouldOptOut() || !_this.recordingEnabled) {
                                _this.loggerProvider.log(_this.shouldOptOut()
                                    ? "Opting session ".concat(sessionId, " out of recording due to optOut config.")
                                    : "Session Replay capture stopping for ".concat(sessionId, "."));
                                _this.stopRecordingEvents();
                                _this.sendEvents();
                                return;
                            }
                            if (event.type === RRWebEventType.Meta) {
                                event.data.href = getPageUrl(event.data.href, ugcFilterRules);
                            }
                            if (_this.eventCompressor) {
                                // Schedule processing during idle time if the browser supports requestIdleCallback
                                _this.eventCompressor.enqueueEvent(event, sessionId);
                            }
                            else {
                                // eventCompressor is not yet ready (concurrent call racing _init()).
                                // Buffer the event so it can be flushed once the compressor is initialized.
                                _this.pendingEmitEvents.push({ event: event, sessionId: sessionId });
                            }
                            _this.useSemanticAdapter(function (adapter) { return adapter.event(event); });
                        }, 'Error while capturing replay: ')), { plugins: plugins, recordCrossOriginIframes: crossOriginIframesEnabled }));
                        if (this.recordCancelCallback)
                            this.useSemanticAdapter(function (adapter) { return adapter.recordingReady(); });
                        if (crossOriginIframesEnabled && !childMode && coordinateChildren) {
                            if (!this.crossOriginIframeCoordinator) {
                                this.crossOriginIframeCoordinator = new CrossOriginIframeCoordinator();
                            }
                            this.crossOriginIframeCoordinator.start();
                        }
                        void this.addCustomRRWebEvent(CustomRRwebEvent.DEBUG_INFO);
                        if (shouldLogMetadata) {
                            void this.addCustomRRWebEvent(CustomRRwebEvent.METADATA, this.metadata);
                        }
                        return [3 /*break*/, 6];
                    case 5:
                        error_5 = _j.sent();
                        this.useSemanticAdapter(function (adapter) { return adapter.stop(); });
                        this.loggerProvider.warn('Failed to initialize session replay:', error_5);
                        return [3 /*break*/, 6];
                    case 6: return [2 /*return*/];
                }
            });
        });
    };
    SessionReplay.prototype.useSemanticAdapter = function (operation) {
        var adapter = this.semanticAdapter;
        if (!adapter)
            return;
        try {
            operation(adapter);
        }
        catch (error) {
            // A supplied controller must not interrupt rrweb recording or its teardown.
            this.semanticAdapter = undefined;
            this.loggerProvider.debug('Semantic capture failed:', error);
            try {
                adapter.stop();
            }
            catch (stopError) {
                this.loggerProvider.debug('Semantic capture stop failed:', stopError);
            }
        }
    };
    SessionReplay.prototype.prepareSemanticCapture = function (config, sessionId) {
        var _this = this;
        var _a;
        var scope = getGlobalScope();
        if (!(scope === null || scope === void 0 ? void 0 : scope.document))
            return;
        var semanticCapture = config.semanticCapture;
        var createCapture = semanticCapture === null || semanticCapture === void 0 ? void 0 : semanticCapture.createCapture;
        if (!(semanticCapture === null || semanticCapture === void 0 ? void 0 : semanticCapture.enabled) || typeof createCapture !== 'function') {
            this.useSemanticAdapter(function (adapter) { return adapter.stop(); });
            this.useSemanticAdapter(function (adapter) { return adapter.prepare({ enabled: false }, sessionId); });
            return;
        }
        if (((_a = this.semanticAdapter) === null || _a === void 0 ? void 0 : _a.createCapture) !== createCapture) {
            this.useSemanticAdapter(function (adapter) { return adapter.stop(); });
            this.semanticAdapter = undefined;
            try {
                this.semanticAdapter = new ReplaySemanticAdapter(createCapture, {
                    document: scope.document,
                    window: scope,
                    sdk: "@amplitude/session-replay-browser@".concat(VERSION),
                    getPrivacy: function () { var _a, _b; return (_b = (_a = _this.config) === null || _a === void 0 ? void 0 : _a.privacyConfig) !== null && _b !== void 0 ? _b : {}; },
                    getIdentity: function () { return getSemanticIdentity(scope); },
                    getAnalyticsContext: function () { var _a, _b; return (_b = (_a = _this.config) === null || _a === void 0 ? void 0 : _a.semanticAnalyticsContext) !== null && _b !== void 0 ? _b : { present: false, autocapture: [] }; },
                    inlineStylesheet: config.shouldInlineStylesheet,
                    emit: function (event) {
                        if (_this.recordCancelCallback && _this.recordFunction) {
                            try {
                                _this.recordFunction.addCustomEvent("amp-semantic/".concat(event.name), event.payload);
                            }
                            catch (error) {
                                _this.loggerProvider.debug('Error while adding semantic replay capture event:', error);
                            }
                        }
                    },
                    onError: function (error) { return _this.loggerProvider.debug('Semantic capture error:', error); },
                });
            }
            catch (error) {
                this.loggerProvider.debug('Semantic capture initialization failed:', error);
                return;
            }
        }
        this.useSemanticAdapter(function (adapter) { return adapter.prepare(semanticCapture, sessionId); });
    };
    SessionReplay.prototype.buildRRWebRecordOptions = function (config, hooks, emit, errorLogPrefix) {
        var _this = this;
        var privacyConfig = config.privacyConfig;
        return __assign(__assign(__assign(__assign({ emit: emit, inlineStylesheet: config.shouldInlineStylesheet, inlineImages: config.inlineImages, hooks: hooks }, createPrivacyRecorderOptions(privacyConfig, function () { return _this.currentPageUrl; })), { applyBackgroundColorToBlockedElements: config.applyBackgroundColorToBlockedElements }), (config.fullSnapshotIntervalMs !== undefined && { checkoutEveryNms: config.fullSnapshotIntervalMs })), { recordCanvas: false, captureAdoptedStyleSheets: config.captureAdoptedStyleSheets, 
            // Strip nodes that are never rendered by the rrweb replay player.
            // None of these affect visual fidelity; omitting them reduces snapshot size.
            slimDOMOptions: {
                script: true,
                comment: true,
                headFavicon: true,
                headWhitespace: true,
                headMetaDescKeywords: true,
                headMetaSocial: true,
                headMetaRobots: true,
                headMetaHttpEquiv: true,
                headMetaAuthorship: true,
                headMetaVerification: true,
            }, errorHandler: function (error) {
                var typedError = error;
                // styled-components relies on this error being thrown and bubbled up, rrweb is otherwise suppressing it
                if (typedError.message.includes('insertRule') && typedError.message.includes('CSSStyleSheet')) {
                    throw typedError;
                }
                // rrweb monkey-patches window functions like CSSStyleSheet.insertRule; errors from external callers
                // (e.g. styled-components) must be re-thrown so they aren't silently swallowed.
                if (typedError._external_) {
                    throw typedError;
                }
                _this.loggerProvider.warn(errorLogPrefix, typedError.toString());
                // Return true so that we don't clutter user's consoles with internal rrweb errors
                return true;
            } });
    };
    SessionReplay.prototype._recordEventsInChildMode = function (recordFunction, sessionId, config, hooks) {
        // In child mode, rrweb detects window.parent !== window and routes events via
        // postMessage to the parent instead of calling emit. The emit callback is unused.
        // Note: recording plugins (URL tracking, console capture) are intentionally omitted
        // here — the child's events are merged into the parent stream, so URL changes inside
        // the iframe should not be recorded as parent page-view events.
        try {
            // Stop only the previous rrweb recording. Do NOT call stopRecordingEvents() here:
            // that would clear crossOriginParentSignalCleanup — the very listener that invoked
            // this method — making the child permanently deaf to subsequent stop/start cycles.
            this.recordCancelCallback && this.recordCancelCallback();
            this.recordCancelCallback = null;
            this.recordCancelCallback = recordFunction(__assign(__assign({}, this.buildRRWebRecordOptions(config, hooks, function () {
                // no-op: child events are forwarded to parent via postMessage by rrweb
            }, 'Error while capturing replay (child iframe): ')), { recordCrossOriginIframes: true }));
            this.loggerProvider.log("Session Replay child iframe capture beginning for session ".concat(sessionId, "."));
        }
        catch (error) {
            this.loggerProvider.warn('Failed to initialize session replay in child iframe mode:', error);
        }
    };
    SessionReplay.prototype.getDeviceId = function () {
        var _a;
        return (_a = this.identifiers) === null || _a === void 0 ? void 0 : _a.deviceId;
    };
    SessionReplay.prototype.getSessionId = function () {
        var _a;
        return (_a = this.identifiers) === null || _a === void 0 ? void 0 : _a.sessionId;
    };
    SessionReplay.prototype.start = function () {
        return returnWrapper(this._start());
    };
    SessionReplay.prototype._start = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        this.recordingEnabled = true;
                        this.startChildRecordingOnSetup = true;
                        return [4 /*yield*/, this.recordEvents()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    SessionReplay.prototype.stop = function () {
        this.recordingEnabled = false;
        this.startChildRecordingOnSetup = false;
        this.recordingGeneration++;
        this.cancelHiddenSend();
        this.windowFocus.stop();
        this.stopRecordingEvents();
        this.sendEvents();
    };
    SessionReplay.prototype.flush = function (useRetry) {
        var _a;
        if (useRetry === void 0) { useRetry = false; }
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_b) {
                // Intentionally not gated on min_session_duration_ms. flush() forwards payloads
                // already queued in trackDestination, and every code path that queues into it —
                // sendCurrentSequenceEvents, addEvent's batch-split path, sendStoredEvents reading
                // sequencesToSend from IDB — has already passed the gate at the time of queuing.
                // A duplicate gate here would be unreachable.
                return [2 /*return*/, (_a = this.eventsManager) === null || _a === void 0 ? void 0 : _a.flush(useRetry)];
            });
        });
    };
    SessionReplay.prototype.shutdown = function () {
        var _a, _b;
        this.recordingEnabled = false;
        this.startChildRecordingOnSetup = false;
        this.recordingGeneration++;
        this.cancelHiddenSend();
        this.windowFocus.stop();
        (_a = this.urlChangeCleanup) === null || _a === void 0 ? void 0 : _a.call(this);
        (_b = this.crossOriginParentSignalCleanup) === null || _b === void 0 ? void 0 : _b.call(this);
        this.crossOriginParentSignalCleanup = null;
        this.teardownEventListeners(true);
        this.stopRecordingEvents();
        this.sendEvents();
    };
    SessionReplay.prototype.mapSDKType = function (sdkType) {
        if (sdkType === 'plugin') {
            return '@amplitude/plugin-session-replay-browser';
        }
        if (sdkType === 'segment') {
            return '@amplitude/segment-session-replay-plugin';
        }
        return null;
    };
    SessionReplay.prototype.setMetadata = function (sessionId, joinedConfig, localConfig, remoteConfig, replaySDKVersion, standaloneSDKVersion, sdkType) {
        var hashValue = (sessionId === null || sessionId === void 0 ? void 0 : sessionId.toString()) ? generateHashCode(sessionId.toString()) : undefined;
        this.metadata = {
            joinedConfig: joinedConfig,
            localConfig: localConfig,
            remoteConfig: remoteConfig,
            sessionId: sessionId,
            hashValue: hashValue,
            sampleRate: joinedConfig.sampleRate,
            replaySDKType: this.mapSDKType(sdkType),
            replaySDKVersion: replaySDKVersion,
            standaloneSDKType: '@amplitude/session-replay-browser',
            standaloneSDKVersion: standaloneSDKVersion,
        };
    };
    SessionReplay.prototype.initializeNetworkObservers = function () {
        var _a, _b, _c;
        return __awaiter(this, void 0, void 0, function () {
            var NetworkObserversClass, error_6;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        if (!(((_c = (_b = (_a = this.config) === null || _a === void 0 ? void 0 : _a.loggingConfig) === null || _b === void 0 ? void 0 : _b.network) === null || _c === void 0 ? void 0 : _c.enabled) && !this.networkObservers)) return [3 /*break*/, 4];
                        _d.label = 1;
                    case 1:
                        _d.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, import('./observers')];
                    case 2:
                        NetworkObserversClass = (_d.sent()).NetworkObservers;
                        this.networkObservers = new NetworkObserversClass();
                        return [3 /*break*/, 4];
                    case 3:
                        error_6 = _d.sent();
                        this.loggerProvider.warn('Failed to import or instantiate NetworkObservers:', error_6);
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    return SessionReplay;
}());
export { SessionReplay };
//# sourceMappingURL=session-replay.js.map