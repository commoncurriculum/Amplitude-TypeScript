"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BeaconTransport = void 0;
var analytics_core_1 = require("@amplitude/analytics-core");
var helpers_1 = require("./helpers");
/**
 * For very small payloads it's preferable to use the [Beacon API](https://developer.mozilla.org/en-US/docs/Web/API/Beacon_API).
 * While it doesn't provide 100% guarantees on sends, it greatly helps with overall reliability and page load performance. As
 * the Beacon API has a potential to fail due to size constraints we want to fall back to XHR if need be. This is mostly to
 * be used with 'pagehide' or 'beforeunload' events.
 *
 * Note there are only 3 CORS safelisted Content-Types you can send:
 *
 * - application/x-www-form-urlencoded
 * - multipart/form-data
 * - text/plain
 *
 * If we do not send one of these, some browsers like Chrome may not send this at all. Also we incur the overhead of a preflight
 * request. In our case we will add no additional content-type header. If you are trying to ping a server that requires this
 * header, you may want to use the regular fetch API or a different mechanism.
 */
var BeaconTransport = /** @class */ (function () {
    function BeaconTransport(context, config) {
        var globalScope = (0, analytics_core_1.getGlobalScope)();
        if (globalScope && globalScope.navigator && typeof globalScope.navigator.sendBeacon === 'function') {
            this.sendBeacon = function (pageUrl, payload) {
                try {
                    if (globalScope.navigator.sendBeacon(pageUrl, JSON.stringify(payload))) {
                        return true;
                    }
                }
                catch (e) {
                    // not logging error, since it would be hard to view and just adds overhead.
                }
                return false;
            };
        }
        else {
            this.sendBeacon = function () { return false; };
        }
        this.sendXhr = function (pageUrl, payload) {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', pageUrl, true);
            xhr.setRequestHeader('Accept', '*/*');
            xhr.send(JSON.stringify(payload));
            return true;
        };
        this.basePageUrl = (0, helpers_1.getServerUrl)(config.serverZone, config.trackServerUrl);
        this.apiKey = config.apiKey;
        this.context = context;
        this.handleSendEvents = config.handleSendEvents;
        this.loggerProvider = config.loggerProvider;
    }
    BeaconTransport.prototype.send = function (deviceId, payload) {
        var _this = this;
        var _a;
        var _b = this.context, sessionId = _b.sessionId, type = _b.type;
        // Custom-transport path: navigator.sendBeacon/XHR cannot attach custom headers, so an
        // interaction beacon would otherwise leave unauthenticated and be rejected by an
        // authenticating proxy. When handleSendEvents is set, route the beacon through it instead —
        // a keepalive fetch (survives page unload) that carries the customer's auth. Mirrors the
        // replay page-exit path: api_key goes in the Authorization header, not the URL.
        if (this.handleSendEvents) {
            var params = new URLSearchParams({
                device_id: deviceId,
                session_id: String(sessionId),
                type: String(type),
            });
            var url = "".concat(this.basePageUrl, "?").concat(params.toString());
            var headers = {
                'Content-Type': 'application/json',
                Accept: '*/*',
                Authorization: "Bearer ".concat(this.apiKey),
            };
            try {
                void this.handleSendEvents({
                    url: url,
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(payload),
                    keepalive: true,
                }).catch(function (e) {
                    var _a;
                    (_a = _this.loggerProvider) === null || _a === void 0 ? void 0 : _a.warn('Custom transport failed to send session replay interaction beacon:', e);
                });
            }
            catch (e) {
                (_a = this.loggerProvider) === null || _a === void 0 ? void 0 : _a.warn('Custom transport threw while sending session replay interaction beacon:', e);
            }
            return;
        }
        var urlParams = new URLSearchParams({
            device_id: deviceId,
            session_id: String(sessionId),
            type: String(type),
            api_key: this.apiKey,
        });
        var pageUrl = "".concat(this.basePageUrl, "?").concat(urlParams.toString());
        // ideally send using the beacon API, but there is a chance it may fail, possibly due to a payload
        // size limit. in this case, try best effort to send using xhr.
        this.sendBeacon(pageUrl, payload) || this.sendXhr(pageUrl, payload);
    };
    return BeaconTransport;
}());
exports.BeaconTransport = BeaconTransport;
//# sourceMappingURL=beacon-transport.js.map