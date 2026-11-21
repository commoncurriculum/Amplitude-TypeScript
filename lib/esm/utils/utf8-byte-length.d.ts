/**
 * UTF-8 byte length of `str`, matching `TextEncoder` / `new Blob([str]).size` without
 * allocating. Unpaired surrogates count as U+FFFD (3 bytes), like the platform encoder.
 */
export declare function utf8ByteLength(str: string): number;
export declare function utf8ByteLengthOf(parts: readonly string[]): number;
/**
 * Byte length when `str` exceeds `maxBytes`, otherwise `undefined`. A UTF-16 code unit is
 * at most 3 UTF-8 bytes, so strings with `length * 3 <= maxBytes` are not scanned at all.
 */
export declare function utf8ByteLengthIfOver(str: string, maxBytes: number): number | undefined;
/** Longest prefix of `str` within `maxBytes` of UTF-8, never splitting a surrogate pair. */
export declare function truncateUtf8(str: string, maxBytes: number): {
    value: string;
    truncated: boolean;
};
//# sourceMappingURL=utf8-byte-length.d.ts.map