/**
 * Copyright 2023-present DreamNum Co., Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Modified by Carenode, 2026 — CNT-5176 ios-hangul-replace: added file, the edit a platform made to the hidden input's text

/**
 * The edit the platform made to the hidden input's text between two reads.
 */
export interface IHiddenInputEdit {
    /** The text the platform took out. */
    removed: string;
    /** The text the platform put in its place. */
    inserted: string;
    /**
     * Whether the edit ends at the end of the text. The hidden input's caret sits at the end of its text, which is the
     * document caret, so only an edit that ends there maps onto the text right before the document caret.
     */
    atEnd: boolean;
}

/**
 * Finds the edit that turned `before` into `after`: the part between their common start and their common end. The
 * common start is taken first, so a removal of the last of several equal characters is read as an edit at the end.
 */
export function diffHiddenInputText(before: string, after: string): IHiddenInputEdit {
    const shorter = Math.min(before.length, after.length);
    let start = 0;
    while (start < shorter && before.charCodeAt(start) === after.charCodeAt(start)) {
        start++;
    }

    let end = 0;
    while (
        end < shorter - start &&
        before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)
    ) {
        end++;
    }

    return {
        removed: before.slice(start, before.length - end),
        inserted: after.slice(start, after.length - end),
        atEnd: end === 0,
    };
}
