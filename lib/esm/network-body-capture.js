import { pruneJson } from '@amplitude/analytics-core';
export var isBodyCaptureEnabled = function (config) {
    if (config === undefined) {
        return false;
    }
    if (typeof config === 'boolean') {
        return config;
    }
    return config.enabled !== false;
};
export var getBodyMaskingLists = function (config) {
    var _a;
    if (typeof config === 'object' && config !== null) {
        return {
            allowlist: (_a = config.allowlist) !== null && _a !== void 0 ? _a : [],
            excludelist: config.excludelist || config.blocklist || [],
        };
    }
    return { allowlist: [], excludelist: [] };
};
export var applyBodyMasking = function (serialized, allowlist, excludelist) {
    if (allowlist.length === 0 && excludelist.length === 0) {
        return serialized;
    }
    var effectiveAllowlist = allowlist.length > 0 ? allowlist : ['/**'];
    try {
        var json = JSON.parse(serialized);
        pruneJson(json, effectiveAllowlist, excludelist);
        return JSON.stringify(json);
    }
    catch (_a) {
        return serialized;
    }
};
export var captureSerializedBody = function (serialized, config, maxBytes, truncate) {
    var _a = getBodyMaskingLists(config), allowlist = _a.allowlist, excludelist = _a.excludelist;
    var masked = applyBodyMasking(serialized, allowlist, excludelist);
    return truncate(masked, maxBytes);
};
//# sourceMappingURL=network-body-capture.js.map