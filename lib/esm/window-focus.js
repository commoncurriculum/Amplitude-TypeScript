import { getGlobalScope } from '@amplitude/analytics-core';
/**
 * Decides when focus arrived from outside this window.
 *
 * A blur whose next frame lands on an iframe stayed in this page. Anything else
 * left the window. The parent is already blurred once an iframe is focused, so
 * that iframe's window is watched too: moving into a nested frame is not a
 * leave, and moving from the frame to another visible window is.
 */
var WindowFocusTracker = /** @class */ (function () {
    function WindowFocusTracker() {
        this.focusLeftWindow = false;
    }
    /** Call from the window `blur` listener. `activeElement` is not updated yet. */
    WindowFocusTracker.prototype.noteBlur = function () {
        var _this = this;
        this.focusLeftWindow = false;
        this.cancelFocusDestinationCheck();
        var scope = getGlobalScope();
        this.scheduleFocusInspect(scope, function () {
            var _a;
            var active = (_a = scope === null || scope === void 0 ? void 0 : scope.document) === null || _a === void 0 ? void 0 : _a.activeElement;
            if ((active === null || active === void 0 ? void 0 : active.tagName) === 'IFRAME') {
                _this.watchFocusedFrame(active);
                return;
            }
            _this.releaseFocusedFrame();
            _this.focusLeftWindow = true;
        });
    };
    /** The document hid. Drop the iframe watcher; visibility owns the checkout. */
    WindowFocusTracker.prototype.onDocumentHidden = function () {
        this.releaseFocusedFrame();
    };
    /**
     * The document was shown. Drop the external-focus flag so the focus event
     * that follows a tab return does not take a second checkout.
     */
    WindowFocusTracker.prototype.onDocumentVisible = function () {
        this.focusLeftWindow = false;
        this.cancelFocusDestinationCheck();
        this.releaseFocusedFrame();
    };
    /**
     * Call from the window `focus` listener. True when focus arrived from outside
     * this window while the document stayed visible.
     */
    WindowFocusTracker.prototype.consumeArrivedFromOutside = function () {
        var _a, _b;
        var arrivedFromOutside = this.focusLeftWindow && ((_b = (_a = getGlobalScope()) === null || _a === void 0 ? void 0 : _a.document) === null || _b === void 0 ? void 0 : _b.visibilityState) === 'visible';
        this.focusLeftWindow = false;
        this.releaseFocusedFrame();
        return arrivedFromOutside;
    };
    WindowFocusTracker.prototype.stop = function () {
        this.focusLeftWindow = false;
        this.cancelFocusDestinationCheck();
        this.releaseFocusedFrame();
    };
    WindowFocusTracker.prototype.noteFrameBlur = function () {
        var _this = this;
        this.cancelFocusDestinationCheck();
        var scope = getGlobalScope();
        this.scheduleFocusInspect(scope, function () {
            var _a;
            var active = (_a = scope === null || scope === void 0 ? void 0 : scope.document) === null || _a === void 0 ? void 0 : _a.activeElement;
            var parentDocument = scope === null || scope === void 0 ? void 0 : scope.document;
            var parentHasFocus = typeof (parentDocument === null || parentDocument === void 0 ? void 0 : parentDocument.hasFocus) === 'function' && parentDocument.hasFocus();
            if (parentHasFocus || (active === null || active === void 0 ? void 0 : active.tagName) !== 'IFRAME') {
                _this.releaseFocusedFrame();
                return;
            }
            var holder = _this.focusHolder(active);
            if (holder) {
                _this.watchFocusedFrame(holder);
                return;
            }
            _this.focusLeftWindow = true;
        });
    };
    /**
     * The iframe that still holds focus, walking into nested frames. Undefined means
     * the frame's document is visible and neither it nor a child frame is focused.
     */
    WindowFocusTracker.prototype.focusHolder = function (frame, seen) {
        if (seen === null || seen === void 0 ? void 0 : seen.has(frame)) {
            return frame;
        }
        var visited = seen !== null && seen !== void 0 ? seen : new Set();
        visited.add(frame);
        var doc;
        try {
            doc = frame.contentDocument;
        }
        catch (_a) {
            // A cross-origin frame is still part of this page.
            return frame;
        }
        if (doc == null) {
            return frame;
        }
        if (typeof doc.hasFocus === 'function' && doc.hasFocus()) {
            return frame;
        }
        var inner = doc.activeElement;
        if ((inner === null || inner === void 0 ? void 0 : inner.tagName) === 'IFRAME') {
            return this.focusHolder(inner, visited);
        }
        return undefined;
    };
    WindowFocusTracker.prototype.watchFocusedFrame = function (frame) {
        var _this = this;
        this.releaseFocusedFrame();
        var child;
        var onBlur = function () {
            _this.noteFrameBlur();
        };
        try {
            child = frame.contentWindow;
            // Reading `addEventListener` on a cross-origin Window throws a SecurityError.
            if (child == null || typeof child.addEventListener !== 'function') {
                return;
            }
            child.addEventListener('blur', onBlur);
        }
        catch (_a) {
            return;
        }
        this.focusedFrameWindow = child;
        this.focusedFrameBlur = onBlur;
    };
    WindowFocusTracker.prototype.releaseFocusedFrame = function () {
        var child = this.focusedFrameWindow;
        var onBlur = this.focusedFrameBlur;
        this.focusedFrameWindow = undefined;
        this.focusedFrameBlur = undefined;
        if (child === undefined) {
            return;
        }
        try {
            child.removeEventListener('blur', onBlur);
        }
        catch (_a) {
            // The frame can reject listener removal once it is cross-origin.
        }
    };
    WindowFocusTracker.prototype.scheduleFocusInspect = function (scope, inspect) {
        var _this = this;
        var run = function () {
            _this.focusDestinationFrame = undefined;
            try {
                inspect();
            }
            catch (_a) {
                // This runs from a rAF callback, so a throw would surface as an uncaught
                // error on the host page. Focus tracking is best effort: stop watching.
                _this.releaseFocusedFrame();
            }
        };
        if (typeof (scope === null || scope === void 0 ? void 0 : scope.requestAnimationFrame) === 'function') {
            this.focusDestinationFrame = scope.requestAnimationFrame(run);
            return;
        }
        run();
    };
    WindowFocusTracker.prototype.cancelFocusDestinationCheck = function () {
        if (this.focusDestinationFrame === undefined) {
            return;
        }
        var scope = getGlobalScope();
        if (typeof (scope === null || scope === void 0 ? void 0 : scope.cancelAnimationFrame) === 'function') {
            scope.cancelAnimationFrame(this.focusDestinationFrame);
        }
        this.focusDestinationFrame = undefined;
    };
    return WindowFocusTracker;
}());
export { WindowFocusTracker };
//# sourceMappingURL=window-focus.js.map