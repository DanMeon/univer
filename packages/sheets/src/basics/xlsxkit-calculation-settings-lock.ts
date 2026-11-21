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

// Modified by Carenode, 2026 — CNT-5176: added file, the calculation-settings lock seam a Carenode host plugs into.

// Carenode CNT-5176 (user decision of 2026-11-22). In Carenode's work-log and approval xlsx bodies a workbook's
// calculation settings belong to its template, while the workbook itself stays editable (WorkbookEditablePermission
// is on). The host registers a resolver in IConfigService under XLSXKIT_CALCULATION_SETTINGS_LOCK_RESOLVER_CONFIG_KEY;
// when it answers a lock for a workbook, SetWorkbookCalculationSettingsCommand refuses and the calculation options
// dialog (@univerjs/sheets-formula-ui) opens read-only with the host's notice. Both read the lock through
// getXlsxkitCalculationSettingsLock, the one owner of the rule. With no resolver registered, a value that is not a
// function, or a resolver that answers nothing, both behave as upstream. The mutation is not guarded, so a change
// applied from a peer or a remote source still takes effect. Exported from the package index.

import type { IConfigService } from '@univerjs/core';

/** Must equal the key Carenode's editor (apps/xlsxkit/packages/editor) registers its resolver under. */
export const XLSXKIT_CALCULATION_SETTINGS_LOCK_RESOLVER_CONFIG_KEY = 'xlsxkit.calculationSettings.lockResolver';

export interface IXlsxkitCalculationSettingsLockProbe {
    unitId: string;
}

export interface IXlsxkitCalculationSettingsLock {
    /** The sentence the dialog shows, already localized by the host. */
    notice: string;
}

/** Answers a lock to keep the workbook's calculation settings as they are, or nothing to keep upstream behaviour. */
export type XlsxkitCalculationSettingsLockResolver = (
    probe: IXlsxkitCalculationSettingsLockProbe
) => IXlsxkitCalculationSettingsLock | null | undefined;

/** The lock the host's resolver answers for the workbook, or null when the settings are not locked. */
export function getXlsxkitCalculationSettingsLock(
    configService: IConfigService,
    unitId: string
): IXlsxkitCalculationSettingsLock | null {
    const resolve = configService.getConfig<unknown>(XLSXKIT_CALCULATION_SETTINGS_LOCK_RESOLVER_CONFIG_KEY);
    if (typeof resolve !== 'function') {
        return null;
    }
    return (resolve as XlsxkitCalculationSettingsLockResolver)({ unitId }) || null;
}
