"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureSerializedBody = exports.applyBodyMasking = exports.getBodyMaskingLists = exports.isBodyCaptureEnabled = void 0;
var analytics_core_1 = require("@amplitude/analytics-core");
var isBodyCaptureEnabled = function (config) {
    if (config === undefined) {
        return false;
    }
    if (typeof config === 'boolean') {
        return config;
    }
    return config.enabled !== false;
};
exports.isBodyCaptureEnabled = isBodyCaptureEnabled;
var getBodyMaskingLists = function (config) {
    var _a;
    if (typeof config === 'object' && config !== null) {
        return {
            allowlist: (_a = config.allowlist) !== null && _a !== void 0 ? _a : [],
            excludelist: config.excludelist || config.blocklist || [],
        };
    }
    return { allowlist: [], excludelist: [] };
};
exports.getBodyMaskingLists = getBodyMaskingLists;
var applyBodyMasking = function (serialized, allowlist, excludelist) {
    if (allowlist.length === 0 && excludelist.length === 0) {
        return serialized;
    }
    var effectiveAllowlist = allowlist.length > 0 ? allowlist : ['/**'];
    try {
        var json = JSON.parse(serialized);
        (0, analytics_core_1.pruneJson)(json, effectiveAllowlist, excludelist);
        return JSON.stringify(json);
    }
    catch (_a) {
        return serialized;
    }
};
exports.applyBodyMasking = applyBodyMasking;
var captureSerializedBody = function (serialized, config, maxBytes, truncate) {
    var _a = (0, exports.getBodyMaskingLists)(config), allowlist = _a.allowlist, excludelist = _a.excludelist;
    var masked = (0, exports.applyBodyMasking)(serialized, allowlist, excludelist);
    return truncate(masked, maxBytes);
};
exports.captureSerializedBody = captureSerializedBody;
//# sourceMappingURL=network-body-capture.js.map