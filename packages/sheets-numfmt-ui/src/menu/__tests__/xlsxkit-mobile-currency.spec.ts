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

// Modified by Carenode, 2026 — added file, the mobile currency paths write what the desktop ones write.

import { LocaleType } from '@univerjs/core';
import { getCurrencyFormat, getCurrencySymbolByLocale } from '@univerjs/sheets-numfmt';
import { describe, expect, it } from 'vitest';
import { SetMobileNumfmtCommand } from '../../commands/commands/set-mobile-numfmt.command';
import { createMobileNumberFormatMenuConfig } from '../mobile-menu';

describe('mobile currency paths', () => {
    const symbol = getCurrencySymbolByLocale(LocaleType.KO_KR);

    it('records what upstream SetCurrencyCommand writes on a Korean region', () => {
        expect(getCurrencyFormat(LocaleType.KO_KR)).toBe('"₩"#,##0.00_);[Red]("₩"#,##0.00)');
    });

    it('writes the number-format list currency entry from the quick option', () => {
        const config = createMobileNumberFormatMenuConfig(symbol);
        const currency = config.quickOptions.find((item) => item.label === 'sheets-numfmt-ui.currency');
        expect(currency).toEqual({ label: 'sheets-numfmt-ui.currency', commandId: SetMobileNumfmtCommand.id, value: '₩#,##0' });
        expect(config.detailOptions.find((item) => item.label === 'sheets-numfmt-ui.currency')?.value).toBe('₩#,##0');
    });

    it('offers the currency rows at no decimals in the custom view', () => {
        const { customPatterns } = createMobileNumberFormatMenuConfig(symbol);
        expect(customPatterns[0]).toBe('"₩"#,##0');
        expect(customPatterns.filter((pattern) => pattern.includes('₩') && pattern.includes('.00'))).toEqual([]);
    });
});
