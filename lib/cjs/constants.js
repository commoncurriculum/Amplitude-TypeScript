"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomRRwebEvent = exports.CROSS_ORIGIN_IFRAME_MESSAGE_TYPE = exports.THROTTLED_FLUSH_PAUSE_MS = exports.EVENT_SKIP_CODE_CAPTURE_DISABLED = exports.EVENT_SKIP_CODE_INVALID_RANGE = exports.EVENT_SKIP_CODE_THROTTLED = exports.EVENT_SKIPPED_HEADER = exports.MAX_KEEPALIVE_BYTES = exports.RETRY_TIMEOUT_MS = exports.MAX_URL_LENGTH = exports.KB_SIZE = exports.MAX_IDB_STORAGE_LENGTH = exports.MAX_INTERVAL = exports.MIN_INTERVAL = exports.INTERACTION_MAX_INTERVAL = exports.INTERACTION_MIN_INTERVAL = exports.WAF_PAYLOAD_TOO_LARGE_PATTERN = exports.MAX_SINGLE_EVENT_SIZE = exports.MAX_EVENT_LIST_SIZE = exports.STORAGE_PREFIX = exports.SESSION_REPLAY_STAGING_URL = exports.SESSION_REPLAY_EU_URL = exports.SESSION_REPLAY_SERVER_URL = exports.UNMASK_TEXT_CLASS = exports.MASK_TEXT_CLASS = exports.BLOCK_CLASS = exports.SESSION_REPLAY_DEBUG_PROPERTY = exports.DEFAULT_URL_CHANGE_POLLING_INTERVAL = exports.DEFAULT_PERFORMANCE_CONFIG = exports.DEFAULT_SERVER_ZONE = exports.DEFAULT_SAMPLE_RATE = exports.DEFAULT_SESSION_END_EVENT = exports.DEFAULT_SESSION_START_EVENT = exports.DEFAULT_SESSION_REPLAY_PROPERTY = exports.DEFAULT_EVENT_PROPERTY_PREFIX = void 0;
var analytics_core_1 = require("@amplitude/analytics-core");
exports.DEFAULT_EVENT_PROPERTY_PREFIX = '[Amplitude]';
exports.DEFAULT_SESSION_REPLAY_PROPERTY = "".concat(exports.DEFAULT_EVENT_PROPERTY_PREFIX, " Session Replay ID");
exports.DEFAULT_SESSION_START_EVENT = 'session_start';
exports.DEFAULT_SESSION_END_EVENT = 'session_end';
exports.DEFAULT_SAMPLE_RATE = 0;
exports.DEFAULT_SERVER_ZONE = analytics_core_1.ServerZone.US;
exports.DEFAULT_PERFORMANCE_CONFIG = { enabled: true };
exports.DEFAULT_URL_CHANGE_POLLING_INTERVAL = 1000;
exports.SESSION_REPLAY_DEBUG_PROPERTY = "".concat(exports.DEFAULT_EVENT_PROPERTY_PREFIX, " Session Replay Debug");
exports.BLOCK_CLASS = 'amp-block';
exports.MASK_TEXT_CLASS = 'amp-mask';
exports.UNMASK_TEXT_CLASS = 'amp-unmask';
exports.SESSION_REPLAY_SERVER_URL = 'https://api-sr.amplitude.com/sessions/v2/track';
exports.SESSION_REPLAY_EU_URL = 'https://api-sr.eu.amplitude.com/sessions/v2/track';
exports.SESSION_REPLAY_STAGING_URL = 'https://api-sr.stag2.amplitude.com/sessions/v2/track';
exports.STORAGE_PREFIX = "".concat(analytics_core_1.AMPLITUDE_PREFIX, "_replay_unsent");
// Reduced from 1,000,000 to leave headroom for double-JSON-encoding overhead and the
// uncompressed fallback path. The HTTP body is ~10-30% larger than raw string length
// because events are re-serialized inside the { version, events } wrapper at send time.
exports.MAX_EVENT_LIST_SIZE = 700000;
// 9 MB UTF-8 bytes — just under the server's 10 MB per-event threshold. Compared against the
// UTF-8 byte length of the serialized event (via Blob/TextEncoder), not the JS string length,
// so multi-byte payloads (CJK, emoji) are gated correctly.
exports.MAX_SINGLE_EVENT_SIZE = 9 * 1000000;
// WAF rejects oversized compressed payloads with a body containing wording like
// "Payload exceeds the maximum allowed size of 10MB". Match loosely so vendor wording
// tweaks (rule updates, capitalization, etc.) don't silently disable bisect-retry.
exports.WAF_PAYLOAD_TOO_LARGE_PATTERN = /payload.*exceed/i;
exports.INTERACTION_MIN_INTERVAL = 30000; // 30 seconds
exports.INTERACTION_MAX_INTERVAL = 60000; // 1 minute
exports.MIN_INTERVAL = 500; // 500 ms
exports.MAX_INTERVAL = 10 * 1000; // 10 seconds
exports.MAX_IDB_STORAGE_LENGTH = 1000 * 60 * 60 * 24 * 3; // 3 days
exports.KB_SIZE = 1024;
exports.MAX_URL_LENGTH = 1000;
exports.RETRY_TIMEOUT_MS = 1000;
exports.MAX_KEEPALIVE_BYTES = 64 * 1024; // browser keepalive budget shared with sendBeacon
// Server returns 200 + this header for "no-retry" drops (throttle / capture disabled / out-of-range).
// See projects/sessionreplay/sessionreplay-ingestion/.../SessionReplayError.java.
// Header value is the numeric error code as a string.
exports.EVENT_SKIPPED_HEADER = 'X-Session-Replay-Event-Skipped';
exports.EVENT_SKIP_CODE_THROTTLED = '429';
exports.EVENT_SKIP_CODE_INVALID_RANGE = '4004';
exports.EVENT_SKIP_CODE_CAPTURE_DISABLED = '4005';
// How long to pause the flush schedule after the server signals a throttle.
exports.THROTTLED_FLUSH_PAUSE_MS = 60000;
exports.CROSS_ORIGIN_IFRAME_MESSAGE_TYPE = 'amplitude-sr-iframe';
var CustomRRwebEvent;
(function (CustomRRwebEvent) {
    CustomRRwebEvent["GET_SR_PROPS"] = "get-sr-props";
    CustomRRwebEvent["DEBUG_INFO"] = "debug-info";
    CustomRRwebEvent["FETCH_REQUEST"] = "fetch-request";
    CustomRRwebEvent["METADATA"] = "metadata";
    CustomRRwebEvent["TARGETING_DECISION"] = "targeting-decision";
})(CustomRRwebEvent = exports.CustomRRwebEvent || (exports.CustomRRwebEvent = {}));
//# sourceMappingURL=constants.js.map