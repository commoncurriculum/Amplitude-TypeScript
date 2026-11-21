export type BodyCaptureRuleConfig = boolean | {
    enabled?: boolean;
    allowlist?: string[];
    /** @deprecated use excludelist */
    blocklist?: string[];
    excludelist?: string[];
};
export declare const isBodyCaptureEnabled: (config: BodyCaptureRuleConfig | undefined) => boolean;
export declare const getBodyMaskingLists: (config: BodyCaptureRuleConfig | undefined) => {
    allowlist: string[];
    excludelist: string[];
};
export declare const applyBodyMasking: (serialized: string, allowlist: string[], excludelist: string[]) => string;
export declare const captureSerializedBody: (serialized: string, config: BodyCaptureRuleConfig | undefined, maxBytes: number, truncate: (value: string, max: number) => {
    value: string;
    truncated: boolean;
}) => {
    value: string;
    truncated: boolean;
};
//# sourceMappingURL=network-body-capture.d.ts.map