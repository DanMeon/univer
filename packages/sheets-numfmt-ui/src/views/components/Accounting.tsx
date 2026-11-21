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

// Modified by Carenode, 2026 — only a cell showing the accounting format opens as accounting (xlsxkit panel-type-keeps-format)

import { LocaleService } from '@univerjs/core';
import { InputNumber, Select } from '@univerjs/design';
import { getCurrencyType, getDecimalFromPattern, setPatternDecimal } from '@univerjs/sheets-numfmt';
import { useDependency } from '@univerjs/ui';
import { useContext, useLayoutEffect, useMemo, useState } from 'react';
import type { LocaleKey } from '../../locale/types';
import type { IBusinessComponentProps } from './interface';
import { UserHabitCurrencyContext } from '../../controllers/user-habit.controller';
import { xlsxkitIsSamePanelPattern } from './xlsxkit-panel-pattern';

// Carenode xlsxkit panel-type-keeps-format: the accounting panel writes one format, `_("<symbol>"* #,##0.00_)` with the
// cell's symbol and decimals (the action below), so only a cell that shows the same opens as accounting (upstream: any
// `_(` format with a symbol, so Excel's four-section accounting lost its parentheses and its dash for zero on confirm).
export const isAccountingPanel = (pattern: string) => {
    const type = getCurrencyType(pattern);
    return !!type && xlsxkitIsSamePanelPattern(`_("${type}"* #,##0.00_)`, pattern);
};

export function AccountingPanel(props: IBusinessComponentProps) {
    const { defaultPattern, onActionChange, onChange } = props;

    const [decimal, setDecimal] = useState(() => getDecimalFromPattern(defaultPattern || '', 2));
    const userHabitCurrency = useContext(UserHabitCurrencyContext);
    const [suffix, setSuffix] = useState(() => getCurrencyType(defaultPattern) || userHabitCurrency[0]);
    const options = useMemo(() => userHabitCurrency.map((key) => ({ label: key, value: key })), []);

    const localeService = useDependency(LocaleService);

    useLayoutEffect(() => {
        onActionChange(() => setPatternDecimal(`_("${suffix}"* #,##0${decimal > 0 ? '.0' : ''}_)`, decimal));
    }, [decimal, onActionChange, suffix]);

    const handleSelect = (v: string) => {
        setSuffix(v);
        onChange(setPatternDecimal(`_("${v}"* #,##0${decimal > 0 ? '.0' : ''}_)`, decimal));
    };

    const handleDecimalChange = (v: number | null) => {
        const decimal = v || 0;
        setDecimal(decimal);
        onChange(setPatternDecimal(`_("${suffix}"* #,##0${decimal > 0 ? '.0' : ''}_)`, decimal));
    };

    return (
        <div>
            <div className="univer-mt-4 univer-flex univer-justify-between">
                <div className="option">
                    <div className="univer-text-sm univer-text-gray-400">
                        {localeService.t<LocaleKey>('sheets-numfmt-ui.decimalLength')}
                    </div>

                    <div className="univer-mt-2 univer-w-32">
                        <InputNumber
                            value={decimal}
                            step={1}
                            precision={0}
                            max={20}
                            min={0}
                            onChange={handleDecimalChange}
                        />
                    </div>
                </div>
                <div className="option">
                    <div className="univer-text-sm univer-text-gray-400">
                        {localeService.t<LocaleKey>('sheets-numfmt-ui.currencyType')}
                    </div>

                    <div className="univer-mt-2 univer-w-36">
                        <Select
                            options={options}
                            value={suffix}
                            onChange={handleSelect}
                        />
                    </div>
                </div>
            </div>

            <div className="univer-mt-4 univer-text-sm univer-text-gray-400">
                {localeService.t<LocaleKey>('sheets-numfmt-ui.accountingDes')}
            </div>
        </div>
    );
};
