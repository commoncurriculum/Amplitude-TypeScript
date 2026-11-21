"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReplaySemanticAdapter = exports.MAX_PENDING_SEMANTIC_SNAPSHOTS = void 0;
var tslib_1 = require("tslib");
/** Transport startup queue bound, independent of recorder-specific event budgets. */
exports.MAX_PENDING_SEMANTIC_SNAPSHOTS = 200;
var rrweb_types_1 = require("@amplitude/rrweb-types");
/** Starts capture only after rrweb can accept custom events. */
var ReplaySemanticAdapter = /** @class */ (function () {
    function ReplaySemanticAdapter(createCapture, host) {
        this.createCapture = createCapture;
        this.ready = false;
        this.pendingSnapshots = 0;
        this.pendingUrls = 0;
        this.pendingEvents = [];
        this.config = { enabled: false };
        this.capture = createCapture(this.config, host);
    }
    ReplaySemanticAdapter.prototype.prepare = function (config, sessionId) {
        this.stop();
        this.config = config;
        this.capture.updateConfig(config);
        if (this.sessionId !== sessionId)
            this.capture.resetSession();
        this.sessionId = sessionId;
    };
    ReplaySemanticAdapter.prototype.recordingReady = function () {
        var e_1, _a;
        if (!this.config.enabled || this.ready)
            return;
        this.ready = true;
        this.capture.start();
        var pending = this.pendingEvents;
        this.pendingEvents = [];
        this.pendingSnapshots = 0;
        this.pendingUrls = 0;
        try {
            for (var pending_1 = tslib_1.__values(pending), pending_1_1 = pending_1.next(); !pending_1_1.done; pending_1_1 = pending_1.next()) {
                var event_1 = pending_1_1.value;
                if (event_1.type === 'snapshot')
                    this.snapshot();
                else
                    this.url(event_1.url, event_1.timestamp);
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (pending_1_1 && !pending_1_1.done && (_a = pending_1.return)) _a.call(pending_1);
            }
            finally { if (e_1) throw e_1.error; }
        }
    };
    /** Called only for replay events accepted for delivery; custom events cannot recurse. */
    ReplaySemanticAdapter.prototype.event = function (event) {
        if (event.type === rrweb_types_1.EventType.FullSnapshot)
            this.snapshot();
        if (event.type === rrweb_types_1.EventType.Plugin && event.data.plugin === 'amplitude/url-tracking@1') {
            var payload = event.data.payload;
            if ((payload === null || payload === void 0 ? void 0 : payload.type) === 'url-change-event' && typeof payload.href === 'string') {
                this.url(payload.href, event.timestamp);
            }
        }
    };
    ReplaySemanticAdapter.prototype.url = function (url, timestamp) {
        if (!this.config.enabled)
            return;
        if (!this.ready) {
            if (this.pendingUrls < exports.MAX_PENDING_SEMANTIC_SNAPSHOTS) {
                this.pendingUrls++;
                this.pendingEvents.push({ type: 'url', url: url, timestamp: timestamp });
            }
            return;
        }
        if (this.capture.isActive())
            this.capture.notify('url', { url: url, timestamp: timestamp });
    };
    ReplaySemanticAdapter.prototype.snapshot = function () {
        if (!this.config.enabled)
            return;
        if (!this.ready) {
            // No DOM retention; bound deferred work before the supplied runtime is ready.
            if (this.pendingSnapshots < exports.MAX_PENDING_SEMANTIC_SNAPSHOTS) {
                this.pendingSnapshots++;
                this.pendingEvents.push({ type: 'snapshot' });
            }
            return;
        }
        if (this.capture.isActive())
            this.capture.notify('snapshot', undefined);
    };
    ReplaySemanticAdapter.prototype.stop = function () {
        this.ready = false;
        this.pendingSnapshots = 0;
        this.pendingUrls = 0;
        this.pendingEvents = [];
        this.capture.stop();
    };
    return ReplaySemanticAdapter;
}());
exports.ReplaySemanticAdapter = ReplaySemanticAdapter;
//# sourceMappingURL=semantic.js.map