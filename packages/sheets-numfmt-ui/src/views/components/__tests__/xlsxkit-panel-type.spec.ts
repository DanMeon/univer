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

// Modified by Carenode, 2026 — xlsxkit panel-type-keeps-format: added file, which cells open as accounting or currency.

import { describe, expect, it } from 'vitest';
import { isAccountingPanel } from '../Accounting';
import { isCurrencyPanel } from '../Currency';

describe('xlsxkit panel-type-keeps-format', () => {
    it('opens as accounting only the one format the accounting panel writes', () => {
        expect(isAccountingPanel('_("₩"* #,##0.00_)')).toBe(true);
        expect(isAccountingPanel('_("₩"* #,##0_)')).toBe(true);
        expect(isAccountingPanel('_("₩"* #,##0_);_("₩"* (#,##0);_("₩"* "-"_);_(@_)')).toBe(false);
    });

    it('opens as currency only a cell one of the currency lines shows as it is', () => {
        expect(isCurrencyPanel('"₩"#,##0')).toBe(true);
        expect(isCurrencyPanel('₩#,##0')).toBe(true);
        expect(isCurrencyPanel('"₩"#,##0.00_);[Red]("₩"#,##0.00)')).toBe(true);
        expect(isCurrencyPanel('"₩"#,##0.00_);"₩"#,##0.00')).toBe(false);
        expect(isCurrencyPanel('_("₩"* #,##0.00_)')).toBe(false);
    });
});
