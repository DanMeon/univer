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

// Modified by Carenode, 2026 — xlsxkit panel-negative-match: added file, the number format panel's own format match.

import { numfmt } from '@univerjs/core';

// Carenode xlsxkit panel-negative-match: the number format panel matches a cell's format to a line of its negative
// number lists (the line the currency and thousands panels open on, and whether a format is one of them - the type
// checks, which also match the accounting panel's one format with it). Upstream used `@univerjs/core`'s
// `isPatternEqualWithoutDecimal`, which drops the colour and a minus right after it: a red-minus cell opened on the red
// line without a minus and a red cell on the black line, so confirming lost the minus or the red. Here two formats
// match only when their sections are the same token for token, apart from the number of decimal zeros: the colour,
// that minus, the `_)` / `_ ` pads (a pad shows as a space) and the number of sections count, so a two-section `X;-X`
// is not the one-section `X` (a negative that rounds to zero shows `-₩0` under the first, `₩0` under the second), and a
// point with no zero after it stays (`#,##0.` shows `1,235.`). Decimals do not count, because the panel writes the
// cell's own decimal count into every section; a format whose sections differ in decimals therefore matches no line.
// The number-format list's label keeps the upstream rule.
const xlsxkitPanelPatternKey = (pattern: string): string => {
    const sections = [''];
    const decimals = [0];
    let isDecimalPart = false;
    const endDecimalPart = () => {
        if (isDecimalPart && decimals[decimals.length - 1] === 0) {
            sections[sections.length - 1] += '.';
        }
        isDecimalPart = false;
    };

    for (const token of numfmt.tokenize(pattern)) {
        if (token.type === numfmt.tokenTypes.BREAK) {
            endDecimalPart();
            sections.push('');
            decimals.push(0);
            continue;
        }
        if (token.type === numfmt.tokenTypes.POINT) {
            isDecimalPart = true;
            continue;
        }
        if (isDecimalPart && token.type === numfmt.tokenTypes.ZERO) {
            decimals[decimals.length - 1] += 1;
            continue;
        }
        endDecimalPart();
        if (token.type === numfmt.tokenTypes.COLOR) {
            sections[sections.length - 1] += `[${String(token.value).toLowerCase()}]`;
        } else if (token.type === numfmt.tokenTypes.SKIP || token.type === numfmt.tokenTypes.FILL) {
            sections[sections.length - 1] += token.raw;
        } else {
            sections[sections.length - 1] += token.value || '';
        }
    }
    endDecimalPart();

    const key = sections.join(';');
    return new Set(decimals).size > 1 ? `${key} decimals ${decimals.join(',')}` : key;
};

/** Whether the panel treats two formats as the same line (see above); two empty formats match. */
export const xlsxkitIsSamePanelPattern = (patternA: string | undefined, patternB: string | undefined): boolean => {
    if (!patternA || !patternB) {
        return !patternA && !patternB;
    }
    return xlsxkitPanelPatternKey(patternA) === xlsxkitPanelPatternKey(patternB);
};
