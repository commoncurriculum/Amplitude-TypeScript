import { __assign, __awaiter, __generator, __rest, __values } from "tslib";
import { getGlobalScope } from '@amplitude/analytics-core';
import { KB_SIZE } from './constants';
import { globToRegex } from '@amplitude/session-replay-dom-privacy';
export { getServerUrl } from './utils/server-url';
export var getCurrentUrl = function () {
    var globalScope = getGlobalScope();
    return (globalScope === null || globalScope === void 0 ? void 0 : globalScope.location) ? globalScope.location.href : '';
};
export var generateSessionReplayId = function (sessionId, deviceId) {
    return "".concat(deviceId, "/").concat(sessionId);
};
var isValidGlobUrl = function (globUrl) {
    if (typeof globUrl !== 'string' || globUrl.trim() === '')
        return false;
    var urlPattern = /^\/|^https?:\/\/[^\s]+$/;
    if (!urlPattern.test(globUrl))
        return false;
    return true;
};
export var validateUGCFilterRules = function (ugcFilterRules) {
    // validate ugcFilterRules
    if (!ugcFilterRules.every(function (rule) { return typeof rule.selector === 'string' && typeof rule.replacement === 'string'; })) {
        throw new Error('ugcFilterRules must be an array of objects with selector and replacement properties');
    }
    // validate ugcFilterRules are valid globs
    if (!ugcFilterRules.every(function (rule) { return isValidGlobUrl(rule.selector); })) {
        throw new Error('ugcFilterRules must be an array of objects with valid globs');
    }
};
export var getPageUrl = function (pageUrl, ugcFilterRules) {
    var e_1, _a;
    try {
        // apply ugcFilterRules, order is important, first rule wins
        for (var ugcFilterRules_1 = __values(ugcFilterRules), ugcFilterRules_1_1 = ugcFilterRules_1.next(); !ugcFilterRules_1_1.done; ugcFilterRules_1_1 = ugcFilterRules_1.next()) {
            var rule = ugcFilterRules_1_1.value;
            var regex = globToRegex(rule.selector);
            if (regex.test(pageUrl)) {
                return pageUrl.replace(regex, rule.replacement);
            }
        }
    }
    catch (e_1_1) { e_1 = { error: e_1_1 }; }
    finally {
        try {
            if (ugcFilterRules_1_1 && !ugcFilterRules_1_1.done && (_a = ugcFilterRules_1.return)) _a.call(ugcFilterRules_1);
        }
        finally { if (e_1) throw e_1.error; }
    }
    return pageUrl;
};
export var getStorageSize = function () { return __awaiter(void 0, void 0, void 0, function () {
    var globalScope, _a, usage, quota, usageDetails, totalStorageSize, percentOfQuota, e_2;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _b.trys.push([0, 3, , 4]);
                globalScope = getGlobalScope();
                if (!globalScope) return [3 /*break*/, 2];
                return [4 /*yield*/, globalScope.navigator.storage.estimate()];
            case 1:
                _a = _b.sent(), usage = _a.usage, quota = _a.quota, usageDetails = _a.usageDetails;
                totalStorageSize = usage ? Math.round(usage / KB_SIZE) : 0;
                percentOfQuota = usage && quota ? Math.round((usage / quota + Number.EPSILON) * 1000) / 1000 : 0;
                return [2 /*return*/, { totalStorageSize: totalStorageSize, percentOfQuota: percentOfQuota, usageDetails: JSON.stringify(usageDetails) }];
            case 2: return [3 /*break*/, 4];
            case 3:
                e_2 = _b.sent();
                return [3 /*break*/, 4];
            case 4: return [2 /*return*/, { totalStorageSize: 0, percentOfQuota: 0, usageDetails: '' }];
        }
    });
}); };
export var getDebugConfig = function (config) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    var loggerProvider = config.loggerProvider, rest = __rest(config, ["loggerProvider"]);
    var debugConfig = __assign(__assign({}, rest), { apiKey: "****".concat(config.apiKey.substring(config.apiKey.length - 4)) });
    // Debug config is attached to custom rrweb events, which a cross-origin iframe child
    // forwards to its parent via postMessage. Round-trip through JSON so runtime values
    // (logger, transport/handler functions, class instances) can't break structured clone.
    return JSON.parse(JSON.stringify(debugConfig));
};
//# sourceMappingURL=helpers.js.map