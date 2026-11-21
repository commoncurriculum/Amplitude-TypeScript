import sessionReplay from './session-replay-factory';
export var init = sessionReplay.init, setSessionId = sessionReplay.setSessionId, getSessionId = sessionReplay.getSessionId, getSessionReplayProperties = sessionReplay.getSessionReplayProperties, flush = sessionReplay.flush, start = sessionReplay.start, stop = sessionReplay.stop, shutdown = sessionReplay.shutdown, evaluateTargetingAndCapture = sessionReplay.evaluateTargetingAndCapture;
export { SafeLoggerProvider } from './logger';
//# sourceMappingURL=index.js.map