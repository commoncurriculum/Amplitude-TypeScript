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
// Raw (uncompressed) UTF-8 byte cap for a single batched events list before the store splits
// it into its own request. Larger batches mean fewer requests — the primary steady-state lever
// for request volume — while the time-based flush (flushIntervalConfig) still controls send
// cadence, so this only decides whether a single high-activity flush gets split into multiple
// requests. Set to 2 MB: gzipped on the wire that's ~0.2 MB, far under the SR ingest service's
// 10,000,000-byte decompressed split threshold (nova SessionReplayServletV2 splits batches above
// it server-side and only 413s a single >10 MB event), and well clear of the ~10-30% wrapper/
// JSON-escaping overhead. Kept at 2 MB (not higher) so it stays a safe POST body on the
// no-CompressionStream fallback path (raw == wire there) and keeps per-session memory/IDB
// buffering modest on low-end devices. A smaller cap (e.g. 700 KB) splits busy-page flushes
// into several more requests/session and drives SR ingest request-rate throttling.
export var MAX_EVENT_LIST_SIZE = 2000000;
// Default raw (uncompressed) UTF-8 byte cap for a single buffered events list when the
// consumer does not set `maxPersistedEventsSizeBytes`. Set to 6 MB — the value validated in
// the amp-on-amp canary (appid 187520, session-replay-sdk-perf-config onenav-prod payload):
// larger batches mean fewer requests and materially less SR ingest request-rate throttling
// (rc3 0.02% throttle vs prod 1.31.0 2.95%) while staying under the server's 10 MB
// decompressed split threshold. Kept distinct from MAX_EVENT_LIST_SIZE (2 MB) because that
// constant is still used to derive MERGE_AFTER_THROTTLE_SOFT_CAP and as a documented per-batch
// reference; this constant only governs the default buffer cap. Reverses PR #1814's 2 MB default.
export var DEFAULT_MAX_PERSISTED_EVENTS_SIZE_BYTES = 6000000;
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
// Default flush-interval bounds applied when the consumer does not pass `flushIntervalConfig`.
// Set to the values validated in the amp-on-amp canary (session-replay-sdk-perf-config
// onenav-prod payload, SR-4646): a 1s floor (up from the MIN_INTERVAL 500ms hard floor) reduces
// request volume on busy pages while the 10s ceiling matches MAX_INTERVAL. MIN_INTERVAL/
// MAX_INTERVAL remain the absolute clamp bounds and partial-config cross-validation defaults.
export var DEFAULT_FLUSH_MIN_INTERVAL_MS = 1000; // 1 second
export var DEFAULT_FLUSH_MAX_INTERVAL_MS = 10 * 1000; // 10 seconds
export var MAX_IDB_STORAGE_LENGTH = 1000 * 60 * 60 * 24 * 3; // 3 days
export var KB_SIZE = 1024;
export var MAX_URL_LENGTH = 1000;
export var RETRY_TIMEOUT_MS = 1000;
export var MAX_KEEPALIVE_BYTES = 64 * 1024; // browser keepalive budget shared with sendBeacon
// Per-request send timeout. fetch() has no native timeout, so a single hung request
// (stuck "pending" forever) would otherwise block the serial flush loop indefinitely —
// head-of-line blocking that stalls every queued batch behind it. We abort after this
// many ms so each send always settles and the queue keeps draining.
export var SEND_TIMEOUT_MS = 10000;
// Server returns 200 + this header for "no-retry" drops (throttle / capture disabled / out-of-range).
// See projects/sessionreplay/sessionreplay-ingestion/.../SessionReplayError.java.
// Header value is the numeric error code as a string.
export var EVENT_SKIPPED_HEADER = 'X-Session-Replay-Event-Skipped';
export var EVENT_SKIP_CODE_THROTTLED = '429';
export var EVENT_SKIP_CODE_INVALID_RANGE = '4004';
export var EVENT_SKIP_CODE_CAPTURE_DISABLED = '4005';
// How long to pause the flush schedule after the server signals a throttle.
export var THROTTLED_FLUSH_PAUSE_MS = 60000;
// Soft UTF-8 byte cap for merging same-session contexts after a throttle pause.
// Set to 2 * MAX_EVENT_LIST_SIZE so we'll merge at most ~2 max-size sequences (or many
// small ones) into one POST — fewer requests during recovery without pushing close to
// the server's 10MB-compressed 413 ceiling. Compared against UTF-8 byte size (via Blob)
// to match the per-sequence limit's units enforced upstream by base-events-store.
export var MERGE_AFTER_THROTTLE_SOFT_CAP = 2 * MAX_EVENT_LIST_SIZE;
export var CROSS_ORIGIN_IFRAME_MESSAGE_TYPE = 'amplitude-sr-iframe';
export var CustomRRwebEvent;
(function (CustomRRwebEvent) {
    CustomRRwebEvent["GET_SR_PROPS"] = "get-sr-props";
    CustomRRwebEvent["DEBUG_INFO"] = "debug-info";
    CustomRRwebEvent["FETCH_REQUEST"] = "fetch-request";
    CustomRRwebEvent["METADATA"] = "metadata";
    CustomRRwebEvent["TARGETING_DECISION"] = "targeting-decision";
    /**
     * Emitted once per session, on the first send that passes the min_session_duration_ms
     * gate. Captures how many sends were suppressed before passing and the elapsed time
     * spent below the threshold. Lets backend ingestion diff intended replay count vs
     * actual ingestion so on-call can spot start-time-tracking regressions.
     *
     * Sessions that bounce before crossing the threshold never emit this event by design
     * (the whole payload is suppressed); their absence is the signal.
     */
    CustomRRwebEvent["REPLAY_GATE_DECISION"] = "replay-gate-decision";
})(CustomRRwebEvent || (CustomRRwebEvent = {}));
//# sourceMappingURL=constants.js.map