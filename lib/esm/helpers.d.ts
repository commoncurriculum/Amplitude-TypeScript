import { SessionReplayJoinedConfig, UGCFilterRule } from './config/types';
import { StorageData } from './typings/session-replay';
export { getServerUrl } from './utils/server-url';
export declare const getCurrentUrl: () => string;
export declare const generateSessionReplayId: (sessionId: string | number, deviceId: string) => string;
export declare const validateUGCFilterRules: (ugcFilterRules: UGCFilterRule[]) => void;
export declare const getPageUrl: (pageUrl: string, ugcFilterRules: UGCFilterRule[]) => string;
export declare const getStorageSize: () => Promise<StorageData>;
export declare const getDebugConfig: (config: SessionReplayJoinedConfig) => SessionReplayJoinedConfig;
//# sourceMappingURL=helpers.d.ts.map