import { AMPLITUDE_PREFIX, ServerZone } from '@amplitude/analytics-core';
export var DEFAULT_EVENT_PROPERTY_PREFIX = '[Amplitude]';
export var DEFAULT_SESSION_REPLAY_PROPERTY = "".concat(DEFAULT_EVENT_PROPERTY_PREFIX, " Session Replay ID");
export var DEFAULT_SESSION_START_EVENT = 'session_start';
export var DEFAULT_SESSION_END_EVENT = 'session_end';
export var DEFAULT_SAMPLE_RATE = 0;
export var DEFAULT_SERVER_ZONE = ServerZone.US;
export var DEFAULT_PERFORMANCE_CONFIG = { enabled: true };
export var DEFAULT_URL_CHANGE_POLLING_INTERVAL = 1000;
export var SESSION_REPLAY_DEBUG_PROPERTY = "".concat(DEFAULT_EVENT_PROPERTY_PREFIX, " Session Replay Debug");
export var BLOCK_CLASS = 'amp-block';
export var MASK_TEXT_CLASS = 'amp-mask';
export var UNMASK_TEXT_CLASS = 'amp-unmask';
export var SESSION_REPLAY_SERVER_URL = 'https://api-sr.amplitude.com/sessions/v2/track';
export var SESSION_REPLAY_EU_URL = 'https://api-sr.eu.amplitude.com/sessions/v2/track';
export var SESSION_REPLAY_STAGING_URL = 'https://api-sr.stag2.amplitude.com/sessions/v2/track';
export var STORAGE_PREFIX = "".concat(AMPLITUDE_PREFIX, "_replay_unsent");
// Reduced from 1,000,000 to leave headroom for double-JSON-encoding overhead and the
// uncompressed fallback path. The HTTP body is ~10-30% larger than raw string length
// because events are re-serialized inside the { version, events } wrapper at send time.
export var MAX_EVENT_LIST_SIZE = 700000;
// 9 MB UTF-8 bytes — just under the server's 10 MB per-event threshold. Compared against the
// UTF-8 byte length of the serialized event (via Blob/TextEncoder), not the JS string length,
// so multi-byte payloads (CJK, emoji) are gated correctly.
export var MAX_SINGLE_EVENT_SIZE = 9 * 1000000;
// WAF rejects oversized compressed payloads with a body containing wording like
// "Payload exceeds the maximum allowed size of 10MB". Match loosely so vendor wording
// tweaks (rule updates, capitalization, etc.) don't silently disable bisect-retry.
export var WAF_PAYLOAD_TOO_LARGE_PATTERN = /payload.*exceed/i;
export var INTERACTION_MIN_INTERVAL = 30000; // 30 seconds
export var INTERACTION_MAX_INTERVAL = 60000; // 1 minute
export var MIN_INTERVAL = 500; // 500 ms
export var MAX_INTERVAL = 10 * 1000; // 10 seconds
export var MAX_IDB_STORAGE_LENGTH = 1000 * 60 * 60 * 24 * 3; // 3 days
export var KB_SIZE = 1024;
export var MAX_URL_LENGTH = 1000;
export var RETRY_TIMEOUT_MS = 1000;
export var MAX_KEEPALIVE_BYTES = 64 * 1024; // browser keepalive budget shared with sendBeacon
// Server returns 200 + this header for "no-retry" drops (throttle / capture disabled / out-of-range).
// See projects/sessionreplay/sessionreplay-ingestion/.../SessionReplayError.java.
// Header value is the numeric error code as a string.
export var EVENT_SKIPPED_HEADER = 'X-Session-Replay-Event-Skipped';
export var EVENT_SKIP_CODE_THROTTLED = '429';
export var EVENT_SKIP_CODE_INVALID_RANGE = '4004';
export var EVENT_SKIP_CODE_CAPTURE_DISABLED = '4005';
// How long to pause the flush schedule after the server signals a throttle.
export var THROTTLED_FLUSH_PAUSE_MS = 60000;
export var CROSS_ORIGIN_IFRAME_MESSAGE_TYPE = 'amplitude-sr-iframe';
export var CustomRRwebEvent;
(function (CustomRRwebEvent) {
    CustomRRwebEvent["GET_SR_PROPS"] = "get-sr-props";
    CustomRRwebEvent["DEBUG_INFO"] = "debug-info";
    CustomRRwebEvent["FETCH_REQUEST"] = "fetch-request";
    CustomRRwebEvent["METADATA"] = "metadata";
    CustomRRwebEvent["TARGETING_DECISION"] = "targeting-decision";
})(CustomRRwebEvent || (CustomRRwebEvent = {}));
//# sourceMappingURL=constants.js.map