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

// Modified by Carenode, 2026 — the currency panels start at the region's symbol (xlsxkit currency-panel-locale-first)

import type { LocaleType } from '@univerjs/core';
import { currencySymbols, RegionService } from '@univerjs/core';
import { localeCurrencySymbolMap } from '@univerjs/sheets-numfmt';
import { useDependency } from '@univerjs/ui';
import { useEffect, useState } from 'react';
import { UserHabitController } from '../../controllers/user-habit.controller';

const key = 'numfmtCurrency';

// Carenode xlsxkit currency-panel-locale-first: the 통화·회계 panels default to the first symbol of this list. Upstream
// starts it with Univer's fixed `currencySymbols` order, `$` first, and only a symbol confirmed in the panel before
// moves ahead, so a Korean screen defaulted to `$`. Put the region's symbol first (the same table and region the
// number-format list reads); the habit sort is stable, so a confirmed symbol still comes first.
const xlsxkitRegionFirstCurrencySymbols = (region: LocaleType): string[] => {
    const symbol = localeCurrencySymbolMap.get(region);
    if (!symbol || !currencySymbols.includes(symbol)) {
        return [...currencySymbols];
    }
    return [symbol, ...currencySymbols.filter((item) => item !== symbol)];
};

export const useCurrencyOptions = (onOptionChange?: (options: string[]) => void) => {
    const userHabitController = useDependency(UserHabitController);
    const regionService = useDependency(RegionService);
    // Carenode xlsxkit currency-panel-locale-first: the first render, before the habit list loads, starts from it too.
    const [options, setOptions] = useState(() => xlsxkitRegionFirstCurrencySymbols(regionService.getCurrentRegion()));

    useEffect(() => {
        userHabitController.addHabit('numfmtCurrency', []).then(() => {
            userHabitController.getHabit(key, xlsxkitRegionFirstCurrencySymbols(regionService.getCurrentRegion())).then((list) => {
                setOptions(list as string[]);
                onOptionChange && onOptionChange(list as string[]);
            });
        });
    }, []);

    const mark = (v: string) => {
        userHabitController.markHabit(key, v);
    };

    return { userHabitCurrency: options, mark };
};
