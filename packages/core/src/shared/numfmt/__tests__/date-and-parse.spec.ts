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

// Derived from numfmt 3.2.6 (MIT), commit c2cfdfa01bb1f24df51e985825671eb480daed4c.
// See packages/core/src/shared/numfmt/LICENSE.

// @vitest-environment node

// Modified by Carenode, 2026 — CNT-5176: a month name that starts with a digit followed by two digits stays text

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateSystem } from '../../../types/enum/date-system';
import {
    isValidDate,
    parseBool,
    parseDate,
    parseNumber,
    parseTime,
    parseValue,
} from '../parse-value';
import { dateFromSerial, dateToSerial } from '../serial-date';
import { getNumfmtParseValueFilter } from '../utils';

afterEach(() => {
    vi.useRealTimers();
});

describe('numfmt dates and value parsing', () => {
    it('converts the spreadsheet serial epoch', () => {
        expect(dateFromSerial(28627)).toEqual([1978, 5, 17, 0, 0, 0]);
        expect(dateToSerial([1978, 5, 17])).toBe(28627);
    });

    it('keeps the Excel 1900 leap-day contract', () => {
        expect(dateFromSerial(60)).toEqual([1900, 2, 29, 0, 0, 0]);
        expect(dateFromSerial(60, { leap1900: false })).toEqual([1900, 2, 28, 0, 0, 0]);
    });

    it('parses dates into the selected Excel date system', () => {
        expect(parseDate('1904-1-1', { dateSystem: DateSystem.Date1904 })).toEqual({ v: 0, z: 'yyyy-m-d' });
        expect(parseDate('1/0/1900', { dateSystem: DateSystem.Date1900 })).toEqual({ v: 0, z: 'mm/dd/yyyy' });
        expect(parseDate('2/29/1900', { dateSystem: DateSystem.Date1900 })).toEqual({ v: 60, z: 'm/d/yyyy' });
        expect(parseDate('2/29/1900', { dateSystem: DateSystem.Date1904 })).toBeNull();
    });

    it('resolves an omitted year when parsing instead of when loading the module', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2031-06-01T00:00:00Z'));

        expect(parseDate('1/2', { dateSystem: DateSystem.Date1900 })).toEqual({ v: 47850, z: 'm/d' });
    });

    it('passes workbook parsing options through the common value filter', () => {
        expect(getNumfmtParseValueFilter('31/12/2025', {
            locale: 'en_GB',
            dateSystem: DateSystem.Date1904,
        })).toEqual({ v: 44560, z: 'dd/mm/yyyy' });
    });

    it('parses representative values', () => {
        expect(parseNumber('1,234.50')).toEqual({ v: 1234.5, z: '#,##0.00' });
        expect(parseDate('3/13/1989')).toEqual({ v: 32580, z: 'm/d/yyyy' });
        expect(parseTime('5:30 PM')).toEqual({ v: 0.7291666666666666, z: 'h:mm AM/PM' });
        expect(parseBool('TRUE')).toEqual({ v: true });
        expect(parseValue('$1,000')).toEqual({ v: 1000, z: '$#,##0' });
        expect(isValidDate(2024, 2, 29)).toBe(true);
        expect(isValidDate(2023, 2, 29)).toBe(false);
    });
});

// Carenode CNT-5176: with the workbook locale passed in, `12월 25` matched `F-y` and was stored as December 2025.
describe('month name that starts with a digit followed by two digits', () => {
    const koMonths = Array.from({ length: 12 }, (_, index) => `${index + 1}월`);
    // Every number the two-digit-year token reads: 10..99 and 00..09.
    const twoDigitNumbers = [
        ...Array.from({ length: 90 }, (_, index) => String(index + 10)),
        ...Array.from({ length: 10 }, (_, index) => `0${index}`),
    ];

    it('does not read ko `N월 DD` as month + two-digit year', () => {
        for (const month of koMonths) {
            for (const number of twoDigitNumbers) {
                const input = `${month} ${number}`;
                expect(parseDate(input, { locale: 'ko' }), input).toBeNull();
                expect(getNumfmtParseValueFilter(input, { locale: 'ko' }), input).toBeNull();
            }
        }
    });

    it('also leaves the separator, day-name and time variants as text', () => {
        for (const input of ['12월-25', '12월/25', '12월, 25', '12월 25 10:00', '수요일 12월 25', '12월 25 수요일', '1월 31 1:30 오후']) {
            expect(parseDate(input, { locale: 'ko' }), input).toBeNull();
            expect(getNumfmtParseValueFilter(input, { locale: 'ko' }), input).toBeNull();
        }
    });

    it('applies to ja and zh month names such as `1月`', () => {
        for (const locale of ['ja', 'zh-CN', 'zh-TW']) {
            expect(parseDate('1月 31', { locale }), locale).toBeNull();
            expect(getNumfmtParseValueFilter('1月 31', { locale }), locale).toBeNull();
            expect(parseDate('12月 25', { locale }), locale).toBeNull();
        }
    });

    it('keeps the other readings unchanged', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));

        // English month names keep the month + two-digit-year reading.
        expect(parseDate('Jan 31', { locale: 'en' })).toEqual({ v: 11324, z: 'mmm yy' });
        expect(parseDate('Dec 25', { locale: 'en' })).toEqual({ v: 45992, z: 'mmm yy' });
        expect(parseDate('January 31', { locale: 'en' })).toEqual({ v: 11324, z: 'mmmm yy' });

        // Other ko shapes.
        expect(parseDate('12월 2026', { locale: 'ko' })).toEqual({ v: 46357, z: 'mmmm yyyy' });
        expect(parseDate('31 1월', { locale: 'ko' })).toEqual({ v: 46053, z: 'dd mmmm' });
        expect(parseDate('2026 12월 25', { locale: 'ko' })).toEqual({ v: 46381, z: 'yyyy mmmm d' });
        expect(parseDate('2026-12-25', { locale: 'ko' })).toEqual({ v: 46381, z: 'yyyy-mm-dd' });
        expect(parseDate('2026. 12. 25.', { locale: 'ko' })).toEqual({ v: 46381, z: 'yyyy. mm. dd' });
        expect(parseDate('12/25', { locale: 'ko' })).toEqual({ v: 46381, z: 'mm/dd' });

        // Shapes that were already text stay text.
        expect(parseDate('3월 5', { locale: 'ko' })).toBeNull();
        expect(parseDate('12월 25일', { locale: 'ko' })).toBeNull();
        expect(parseDate('2026년 12월 25일', { locale: 'ko' })).toBeNull();
    });
});
