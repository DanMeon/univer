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

// Modified by Carenode, 2026 — the $ opening a [$…] locale tag is not a dollar (xlsxkit currency-symbol-locale-tag)

import { currencySymbols } from '@univerjs/core';

// Carenode xlsxkit currency-symbol-locale-tag: the `$` that opens a `[$…]` locale tag is not a dollar. Upstream found
// `$` in any pattern holding `$`, so Korean Excel's `[$-412]yyyy"년" m"월" d"일"` and `[$₩-412]#,##0` read as dollar
// formats: confirming the 「기타 서식」 panel on such a cell put `$` first in the panel's currency habit list, and 통화·회계
// then started at `$`. A symbol inside the tag (`[$₩-412]`, `[$$-409]`) is still the format's symbol, and a `$` outside
// one is a dollar as before.
export const getCurrencyType = (pattern: string) => {
    const withoutLocaleTagOpeners = pattern.replace(/\[\$/g, '[');
    const item = currencySymbols.find((code) => withoutLocaleTagOpeners.includes(code));
    return item;
};
