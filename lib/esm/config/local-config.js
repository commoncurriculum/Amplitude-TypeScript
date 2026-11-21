import { __assign, __extends, __read, __spreadArray } from "tslib";
import { Config, Logger, FetchTransport, LogLevel } from '@amplitude/analytics-core';
import { DEFAULT_FLUSH_MAX_INTERVAL_MS, DEFAULT_FLUSH_MIN_INTERVAL_MS, DEFAULT_PERFORMANCE_CONFIG, DEFAULT_SAMPLE_RATE, DEFAULT_SERVER_ZONE, DEFAULT_URL_CHANGE_POLLING_INTERVAL, MAX_INTERVAL, MIN_INTERVAL, UNMASK_TEXT_CLASS, } from '../constants';
import { SafeLoggerProvider } from '../logger';
import { validateUGCFilterRules } from '../helpers';
export var getDefaultConfig = function () { return ({
    flushMaxRetries: 2,
    logLevel: LogLevel.Warn,
    loggerProvider: new Logger(),
    transportProvider: new FetchTransport(),
}); };
var SessionReplayLocalConfig = /** @class */ (function (_super) {
    __extends(SessionReplayLocalConfig, _super);
    function SessionReplayLocalConfig(apiKey, options) {
        var _this = this;
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
        var defaultConfig = getDefaultConfig();
        _this = _super.call(this, __assign(__assign({ transportProvider: defaultConfig.transportProvider, loggerProvider: new SafeLoggerProvider(options.loggerProvider || defaultConfig.loggerProvider) }, options), { apiKey: apiKey })) || this;
        _this.flushMaxRetries =
            options.flushMaxRetries !== undefined && options.flushMaxRetries <= defaultConfig.flushMaxRetries
                ? options.flushMaxRetries
                : defaultConfig.flushMaxRetries;
        _this.apiKey = apiKey;
        _this.sampleRate = options.sampleRate || DEFAULT_SAMPLE_RATE;
        _this.semanticCapture = options.semanticCapture;
        _this.semanticAnalyticsContext = options.semanticAnalyticsContext;
        _this.serverZone = options.serverZone || DEFAULT_SERVER_ZONE;
        _this.configServerUrl = options.configServerUrl;
        _this.trackServerUrl = options.trackServerUrl;
        _this.shouldInlineStylesheet = options.shouldInlineStylesheet;
        _this.inlineImages = options.inlineImages;
        _this.version = options.version;
        _this.performanceConfig = options.performanceConfig || DEFAULT_PERFORMANCE_CONFIG;
        _this.storeType = (_a = options.storeType) !== null && _a !== void 0 ? _a : 'memory';
        _this.applyBackgroundColorToBlockedElements = (_b = options.applyBackgroundColorToBlockedElements) !== null && _b !== void 0 ? _b : false;
        _this.enableUrlChangePolling = (_c = options.enableUrlChangePolling) !== null && _c !== void 0 ? _c : false;
        _this.urlChangePollingInterval = (_d = options.urlChangePollingInterval) !== null && _d !== void 0 ? _d : DEFAULT_URL_CHANGE_POLLING_INTERVAL;
        _this.captureDocumentTitle = (_e = options.captureDocumentTitle) !== null && _e !== void 0 ? _e : false;
        if (options.fullSnapshotIntervalMs !== undefined) {
            _this.fullSnapshotIntervalMs = options.fullSnapshotIntervalMs;
        }
        if (options.eagerFullSnapshotSend !== undefined) {
            _this.eagerFullSnapshotSend = options.eagerFullSnapshotSend;
        }
        // Defaults to false: the on-focus full
        // snapshot is off unless the consumer explicitly opts in. A focus that arrives from
        // another visible window still takes one checkout, including a return from a window
        // switch that started while an iframe in this page was focused. Same-page iframe
        // focus does not.
        _this.captureFullSnapshotOnFocus = (_f = options.captureFullSnapshotOnFocus) !== null && _f !== void 0 ? _f : false;
        if (options.maxPersistedEventsSizeBytes !== undefined) {
            _this.maxPersistedEventsSizeBytes = sanitizeByteSize(options.maxPersistedEventsSizeBytes, MIN_EVENT_BYTE_SIZE, MAX_PERSISTED_EVENTS_SIZE_CEILING, 'maxPersistedEventsSizeBytes', _this.loggerProvider);
        }
        if (options.maxSingleEventSizeBytes !== undefined) {
            _this.maxSingleEventSizeBytes = sanitizeByteSize(options.maxSingleEventSizeBytes, MIN_EVENT_BYTE_SIZE, MAX_SINGLE_EVENT_SIZE_CEILING, 'maxSingleEventSizeBytes', _this.loggerProvider);
        }
        // Auto-include .amp-unmask as a default unmaskSelector entry so it works
        // symmetrically with amp-mask/amp-block without requiring explicit config (SR-2945).
        _this.privacyConfig = __assign(__assign({}, ((_g = options.privacyConfig) !== null && _g !== void 0 ? _g : {})), { unmaskSelector: Array.from(new Set(__spreadArray([".".concat(UNMASK_TEXT_CLASS)], __read(((_j = (_h = options.privacyConfig) === null || _h === void 0 ? void 0 : _h.unmaskSelector) !== null && _j !== void 0 ? _j : [])), false))) });
        if (options.interactionConfig) {
            _this.interactionConfig = options.interactionConfig;
            // validate ugcFilterRules, throw error if invalid - throw error at the beginning of the config
            if (_this.interactionConfig.ugcFilterRules) {
                validateUGCFilterRules(_this.interactionConfig.ugcFilterRules);
            }
        }
        if (options.debugMode) {
            _this.debugMode = options.debugMode;
        }
        // Support both new useWebWorker and legacy experimental.useWebWorker for backwards
        // compatibility. Defaults to true per the validated amp-on-amp perf config (SR-4646):
        // compression runs off the main thread unless the consumer explicitly sets either flag
        // to false. The top-level option wins over the legacy experimental one when both are set.
        var legacyOptions = options;
        _this.useWebWorker = (_m = (_k = options.useWebWorker) !== null && _k !== void 0 ? _k : (_l = legacyOptions.experimental) === null || _l === void 0 ? void 0 : _l.useWebWorker) !== null && _m !== void 0 ? _m : true;
        _this.enableTransportCompression = (_o = options.enableTransportCompression) !== null && _o !== void 0 ? _o : true;
        // Pass through undefined so the track destination applies its SEND_TIMEOUT_MS default;
        // an explicit 0 is preserved (disables the timeout).
        _this.sendTimeoutMs = options.sendTimeoutMs;
        _this.captureAdoptedStyleSheets = (_p = options.captureAdoptedStyleSheets) !== null && _p !== void 0 ? _p : true;
        if (options.crossOriginIframes) {
            _this.crossOriginIframes = options.crossOriginIframes;
        }
        if (options.flushIntervalConfig) {
            _this.flushIntervalConfig = sanitizeFlushIntervalConfig(options.flushIntervalConfig, _this.loggerProvider);
        }
        else {
            // Default to the validated amp-on-amp perf config (SR-4646). The values are known-valid
            // (min <= max, both above the floor), so no sanitization is required.
            _this.flushIntervalConfig = {
                minIntervalMs: DEFAULT_FLUSH_MIN_INTERVAL_MS,
                maxIntervalMs: DEFAULT_FLUSH_MAX_INTERVAL_MS,
            };
        }
        _this.handleSendEvents = options.handleSendEvents;
        _this.handleFetchConfig = options.handleFetchConfig;
        return _this;
    }
    return SessionReplayLocalConfig;
}(Config));
export { SessionReplayLocalConfig };
// 100ms floor avoids degenerate configs (0/negative) that would split on every event.
// Customers wanting fewer requests should be raising the value, not lowering it; the floor
// is just a defensive guard against typos and unsigned-int rollovers.
var MIN_FLUSH_INTERVAL_FLOOR_MS = 100;
// Shared 1 KB floor for the byte-size overrides — small enough to exercise splitting/drops
// while debugging, large enough to avoid a 0/negative config that splits on every event.
var MIN_EVENT_BYTE_SIZE = 1000;
// Batch cap ceiling: stay under the SR ingest service's 10 MB decompressed split threshold
// (above which the server splits the batch itself) with headroom for the request wrapper.
var MAX_PERSISTED_EVENTS_SIZE_CEILING = 8000000;
// Single-event ceiling: the server rejects a single event above ~10 MB, so never allow an
// override to exceed that.
var MAX_SINGLE_EVENT_SIZE_CEILING = 10000000;
// Defensive bounds for the byte-size overrides. Non-finite inputs are ignored (fall back to
// the SDK default); out-of-range values are clamped and logged so a typo can't silently
// disable splitting or push past the server's limits.
function sanitizeByteSize(raw, min, max, name, loggerProvider) {
    if (!Number.isFinite(raw)) {
        loggerProvider.warn("".concat(name, " value is not a finite number (got ").concat(String(raw), "); ignoring."));
        return undefined;
    }
    if (raw < min) {
        loggerProvider.warn("".concat(name, " ").concat(raw, " is below floor ").concat(min, "; clamping."));
        return min;
    }
    if (raw > max) {
        loggerProvider.warn("".concat(name, " ").concat(raw, " exceeds ceiling ").concat(max, "; clamping."));
        return max;
    }
    return raw;
}
function sanitizeFlushIntervalConfig(raw, loggerProvider) {
    var _a, _b;
    var sanitized = {};
    if (raw.minIntervalMs !== undefined) {
        if (!Number.isFinite(raw.minIntervalMs) || raw.minIntervalMs < MIN_FLUSH_INTERVAL_FLOOR_MS) {
            loggerProvider.warn("flushIntervalConfig.minIntervalMs ".concat(raw.minIntervalMs, " is below floor ").concat(MIN_FLUSH_INTERVAL_FLOOR_MS, "ms; clamping."));
            sanitized.minIntervalMs = MIN_FLUSH_INTERVAL_FLOOR_MS;
        }
        else {
            sanitized.minIntervalMs = raw.minIntervalMs;
        }
    }
    if (raw.maxIntervalMs !== undefined) {
        // Unlike min, `Infinity` is a meaningful value here: it means "no upper bound on interval
        // growth" (Math.min(Infinity, x) === x in BaseEventsStore.shouldSplitEventsList). Reject
        // only NaN and sub-floor values; pass Infinity through.
        if (Number.isNaN(raw.maxIntervalMs) || raw.maxIntervalMs < MIN_FLUSH_INTERVAL_FLOOR_MS) {
            loggerProvider.warn("flushIntervalConfig.maxIntervalMs ".concat(raw.maxIntervalMs, " is below floor ").concat(MIN_FLUSH_INTERVAL_FLOOR_MS, "ms; clamping."));
            sanitized.maxIntervalMs = MIN_FLUSH_INTERVAL_FLOOR_MS;
        }
        else {
            sanitized.maxIntervalMs = raw.maxIntervalMs;
        }
    }
    // Cross-validate against the SDK's effective defaults so that a partial config (only one of
    // {minIntervalMs, maxIntervalMs}) doesn't get silently clamped by the unspecified default.
    // Concrete failure mode without this: customer sets only `minIntervalMs: 30_000`, the store's
    // `maxInterval` falls back to `MAX_INTERVAL = 10_000`, and `shouldSplitEventsList` then
    // caps the effective interval at 10s — silently negating the customer's tune-up.
    // The user-supplied value always wins; we fill in the other side to match.
    if (sanitized.minIntervalMs !== undefined || sanitized.maxIntervalMs !== undefined) {
        var effectiveMin = (_a = sanitized.minIntervalMs) !== null && _a !== void 0 ? _a : MIN_INTERVAL;
        var effectiveMax = (_b = sanitized.maxIntervalMs) !== null && _b !== void 0 ? _b : MAX_INTERVAL;
        if (effectiveMax < effectiveMin) {
            if (sanitized.maxIntervalMs === undefined) {
                loggerProvider.warn("flushIntervalConfig.minIntervalMs (".concat(effectiveMin, ") exceeds the default maxIntervalMs (").concat(MAX_INTERVAL, "); raising max to match min."));
                sanitized.maxIntervalMs = effectiveMin;
            }
            else if (sanitized.minIntervalMs === undefined) {
                loggerProvider.warn("flushIntervalConfig.maxIntervalMs (".concat(effectiveMax, ") is below the default minIntervalMs (").concat(MIN_INTERVAL, "); lowering min to match max."));
                sanitized.minIntervalMs = effectiveMax;
            }
            else {
                loggerProvider.warn("flushIntervalConfig.maxIntervalMs (".concat(sanitized.maxIntervalMs, ") is less than minIntervalMs (").concat(sanitized.minIntervalMs, "); raising max to match min."));
                sanitized.maxIntervalMs = sanitized.minIntervalMs;
            }
        }
    }
    return sanitized;
}
//# sourceMappingURL=local-config.js.map