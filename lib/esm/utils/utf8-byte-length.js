/**
 * UTF-8 byte length of `str`, matching `TextEncoder` / `new Blob([str]).size` without
 * allocating. Unpaired surrogates count as U+FFFD (3 bytes), like the platform encoder.
 */
export function utf8ByteLength(str) {
    var len = str.length;
    var i = 0;
    // ASCII fast path: rrweb payloads are mostly ASCII JSON.
    for (; i < len; i++) {
        if (str.charCodeAt(i) > 0x7f)
            break;
    }
    if (i === len)
        return len;
    var bytes = i;
    for (; i < len; i++) {
        var code = str.charCodeAt(i);
        if (code <= 0x7f) {
            bytes++;
        }
        else if (code <= 0x7ff) {
            bytes += 2;
        }
        else if (code >= 0xd800 && code <= 0xdbff) {
            var next = i + 1 < len ? str.charCodeAt(i + 1) : NaN;
            if (next >= 0xdc00 && next <= 0xdfff) {
                bytes += 4;
                i++;
            }
            else {
                bytes += 3;
            }
        }
        else {
            bytes += 3;
        }
    }
    return bytes;
}
export function utf8ByteLengthOf(parts) {
    var total = 0;
    for (var i = 0; i < parts.length; i++) {
        total += utf8ByteLength(parts[i]);
    }
    return total;
}
/**
 * Byte length when `str` exceeds `maxBytes`, otherwise `undefined`. A UTF-16 code unit is
 * at most 3 UTF-8 bytes, so strings with `length * 3 <= maxBytes` are not scanned at all.
 */
export function utf8ByteLengthIfOver(str, maxBytes) {
    if (str.length * 3 <= maxBytes)
        return undefined;
    var bytes = utf8ByteLength(str);
    return bytes > maxBytes ? bytes : undefined;
}
/** Longest prefix of `str` within `maxBytes` of UTF-8, never splitting a surrogate pair. */
export function truncateUtf8(str, maxBytes) {
    if (maxBytes < 0)
        maxBytes = 0;
    var len = str.length;
    var bytes = 0;
    var i = 0;
    for (; i < len; i++) {
        var code = str.charCodeAt(i);
        var width = 1;
        var units = 1;
        if (code <= 0x7f) {
            width = 1;
        }
        else if (code <= 0x7ff) {
            width = 2;
        }
        else if (code >= 0xd800 && code <= 0xdbff) {
            var next = i + 1 < len ? str.charCodeAt(i + 1) : NaN;
            if (next >= 0xdc00 && next <= 0xdfff) {
                width = 4;
                units = 2;
            }
            else {
                width = 3;
            }
        }
        else {
            width = 3;
        }
        if (bytes + width > maxBytes)
            break;
        bytes += width;
        if (units === 2)
            i++;
    }
    if (i >= len)
        return { value: str, truncated: false };
    return { value: str.slice(0, i), truncated: true };
}
//# sourceMappingURL=utf8-byte-length.js.map