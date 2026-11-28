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

// Modified by Carenode, 2026 — CNT-5176 ios-hangul-replace: added file, the edit read from the hidden input's text

import { describe, expect, it } from 'vitest';
import { diffHiddenInputText } from '../hidden-input-edit';

describe('diffHiddenInputText', () => {
    it('reads a typed character as an insertion at the end', () => {
        expect(diffHiddenInputText('한', '한ㄱ')).toEqual({ removed: '', inserted: 'ㄱ', atEnd: true });
    });

    it('reads the removal of the last syllable as a removal at the end', () => {
        expect(diffHiddenInputText('한ㄱ', '한')).toEqual({ removed: 'ㄱ', inserted: '', atEnd: true });
        expect(diffHiddenInputText('ㅎ', '')).toEqual({ removed: 'ㅎ', inserted: '', atEnd: true });
    });

    it('reads the removal of the last of equal characters as a removal at the end', () => {
        expect(diffHiddenInputText('하하', '하')).toEqual({ removed: '하', inserted: '', atEnd: true });
    });

    it('reads an autocorrect replacement of the last word as a replacement at the end', () => {
        expect(diffHiddenInputText('Teh', 'The')).toEqual({ removed: 'eh', inserted: 'he', atEnd: true });
    });

    it('marks an edit before the end as not at the end', () => {
        expect(diffHiddenInputText('abc', 'ac')).toEqual({ removed: 'b', inserted: '', atEnd: false });
        expect(diffHiddenInputText('ac', 'abc')).toEqual({ removed: '', inserted: 'b', atEnd: false });
    });

    it('reads no edit for the same text', () => {
        expect(diffHiddenInputText('한글', '한글')).toEqual({ removed: '', inserted: '', atEnd: true });
    });
});
