/**
 * Decides when focus arrived from outside this window.
 *
 * A blur whose next frame lands on an iframe stayed in this page. Anything else
 * left the window. The parent is already blurred once an iframe is focused, so
 * that iframe's window is watched too: moving into a nested frame is not a
 * leave, and moving from the frame to another visible window is.
 */
export declare class WindowFocusTracker {
    private focusLeftWindow;
    private focusDestinationFrame;
    private focusedFrameWindow;
    private focusedFrameBlur;
    /** Call from the window `blur` listener. `activeElement` is not updated yet. */
    noteBlur(): void;
    /** The document hid. Drop the iframe watcher; visibility owns the checkout. */
    onDocumentHidden(): void;
    /**
     * The document was shown. Drop the external-focus flag so the focus event
     * that follows a tab return does not take a second checkout.
     */
    onDocumentVisible(): void;
    /**
     * Call from the window `focus` listener. True when focus arrived from outside
     * this window while the document stayed visible.
     */
    consumeArrivedFromOutside(): boolean;
    stop(): void;
    private noteFrameBlur;
    /**
     * The iframe that still holds focus, walking into nested frames. Undefined means
     * the frame's document is visible and neither it nor a child frame is focused.
     */
    private focusHolder;
    private watchFocusedFrame;
    private releaseFocusedFrame;
    private scheduleFocusInspect;
    private cancelFocusDestinationCheck;
}
//# sourceMappingURL=window-focus.d.ts.map