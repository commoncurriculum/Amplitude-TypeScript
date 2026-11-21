import { __assign } from "tslib";
import { UUID } from '@amplitude/analytics-core';
export var SEMANTIC_TAB_STORAGE_KEY = 'AMP_semantic_tab_v1';
var identities = new WeakMap();
var uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Called only when semantic capture accepts an event. Shared by SDK instances in this document. */
export function getSemanticIdentity(scope) {
    var document = scope.document;
    var existing = identities.get(document);
    if (existing)
        return existing;
    var fallback = Object.freeze({ tab_id: UUID(), document_id: UUID() });
    var identity = fallback;
    // Child frames share their parent's sessionStorage. Do not claim its tab record.
    if (scope.top === scope) {
        try {
            var storage_1 = scope.sessionStorage;
            var read_1 = function () {
                var _a;
                try {
                    var value = JSON.parse((_a = storage_1.getItem(SEMANTIC_TAB_STORAGE_KEY)) !== null && _a !== void 0 ? _a : 'null');
                    if (value && uuidPattern.test(value.tab_id) && (value.owner === null || typeof value.owner === 'string')) {
                        return value;
                    }
                }
                catch (_b) {
                    // Corrupt or blocked storage is equivalent to no saved identity.
                }
                return undefined;
            };
            var stored = read_1();
            // A copied record still owned by a live document belongs to the opener/duplicated tab.
            if ((stored === null || stored === void 0 ? void 0 : stored.owner) === null)
                identity = Object.freeze(__assign(__assign({}, identity), { tab_id: stored.tab_id }));
            var write_1 = function (owner) {
                try {
                    storage_1.setItem(SEMANTIC_TAB_STORAGE_KEY, JSON.stringify({ tab_id: identity.tab_id, owner: owner }));
                }
                catch (_a) {
                    // Keep the current in-memory identity stable if storage becomes unavailable.
                }
            };
            storage_1.setItem(SEMANTIC_TAB_STORAGE_KEY, JSON.stringify({ tab_id: identity.tab_id, owner: identity.document_id }));
            scope.addEventListener('pagehide', function () {
                var _a;
                // Release on actual navigation, not beforeunload (which can be cancelled).
                // This also allows same-tab navigation while the current document enters bfcache.
                if (((_a = read_1()) === null || _a === void 0 ? void 0 : _a.owner) === identity.document_id)
                    write_1(null);
            });
            scope.addEventListener('pageshow', function (event) {
                if (event.persisted)
                    write_1(identity.document_id);
            });
        }
        catch (_a) {
            // No storage access: identity lasts for this document only.
            identity = fallback;
        }
    }
    identities.set(document, identity);
    return identity;
}
//# sourceMappingURL=semantic-identity.js.map