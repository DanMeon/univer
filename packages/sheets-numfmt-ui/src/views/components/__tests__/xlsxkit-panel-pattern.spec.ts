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

// Modified by Carenode, 2026 — xlsxkit panel-negative-match: added file, cases for the panel's own format match.

import { isPatternEqualWithoutDecimal } from '@univerjs/core';
import { describe, expect, it } from 'vitest';
import { xlsxkitIsSamePanelPattern } from '../xlsxkit-panel-pattern';

describe('xlsxkitIsSamePanelPattern', () => {
    it('ignores the number of decimal zeros', () => {
        expect(xlsxkitIsSamePanelPattern('"₩"#,##0.00', '"₩"#,##0')).toBe(true);
        expect(xlsxkitIsSamePanelPattern('#,##0.00_);[Red]-#,##0.00', '#,##0.000_);[Red]-#,##0.000')).toBe(true);
    });

    it('keeps the minus after a colour, which the core match drops', () => {
        const redMinus = '#,##0.00_);[Red]-#,##0.00';
        const red = '#,##0.00_);[Red]#,##0.00';
        expect(isPatternEqualWithoutDecimal(redMinus, red)).toBe(true);
        expect(xlsxkitIsSamePanelPattern(redMinus, red)).toBe(false);
    });

    it('keeps the colour', () => {
        expect(xlsxkitIsSamePanelPattern('"₩"#,##0.00_);[Red]-"₩"#,##0.00', '"₩"#,##0.00_);-"₩"#,##0.00')).toBe(false);
    });

    it('counts the sections and the pads', () => {
        expect(xlsxkitIsSamePanelPattern('#,##0.00_);-#,##0.00', '#,##0.00')).toBe(false);
        expect(xlsxkitIsSamePanelPattern('#,##0_);(#,##0)', '#,##0 ;(#,##0)')).toBe(false);
    });

    it('keeps a point with no zero after it, and does not match sections with different decimals', () => {
        expect(xlsxkitIsSamePanelPattern('#,##0.', '#,##0')).toBe(false);
        expect(xlsxkitIsSamePanelPattern('#,##0.00_);(#,##0.0)', '#,##0_);(#,##0)')).toBe(false);
    });

    it('matches two empty formats only', () => {
        expect(xlsxkitIsSamePanelPattern('', undefined)).toBe(true);
        expect(xlsxkitIsSamePanelPattern('', '0')).toBe(false);
    });
});
