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

// Modified by Carenode, 2026 — CNT-4833 permission-panel-open: the detail panel remounts on every open.

import { IUniverInstanceService } from '@univerjs/core';
import { serializeRangeWithSheet } from '@univerjs/engine-formula';
import { getSheetCommandTarget, SheetsSelectionsService } from '@univerjs/sheets';
import { useDependency } from '@univerjs/ui';
import type { IPermissionPanelRule } from '../../services/permission/sheet-permission-panel.model';
import { SheetPermissionPanelModel } from '../../services/permission/sheet-permission-panel.model';
import { SheetPermissionPanelDetail } from './panel-detail/PermissionDetailPanel';
import { SheetPermissionPanelList } from './SheetPermissionPanelList';

export interface ISheetPermissionPanelProps {
    showDetail: boolean;
    fromSheetBar: boolean;
    rule?: IPermissionPanelRule;
    oldRule?: IPermissionPanelRule;
    /** Carenode CNT-4833 permission-panel-open: the open this render belongs to (SheetPermissionOpenPanelOperation). */
    openId?: number;
    DetailComponent?: typeof SheetPermissionPanelDetail;
    ListComponent?: typeof SheetPermissionPanelList;
};

export const SheetPermissionPanel = ({
    showDetail,
    fromSheetBar,
    rule,
    oldRule,
    openId,
    DetailComponent = SheetPermissionPanelDetail,
    ListComponent = SheetPermissionPanelList,
}: ISheetPermissionPanelProps) => {
    const univerInstanceService = useDependency(IUniverInstanceService);
    const sheetsSelectionsService = useDependency(SheetsSelectionsService);
    const sheetPermissionPanelModel = useDependency(SheetPermissionPanelModel);

    if (!sheetPermissionPanelModel.getVisible()) return null;

    const target = getSheetCommandTarget(univerInstanceService);
    if (!target) return null;
    const { worksheet } = target;

    const selectionRanges = sheetsSelectionsService.getCurrentSelections()?.map((selection) => selection.range);
    const key = selectionRanges.reduce((acc, range) => acc + serializeRangeWithSheet(worksheet.getName(), range), '');

    return (
        showDetail
            ? (
                <DetailComponent
                    fromSheetBar={fromSheetBar}
                    rule={rule}
                    oldRule={oldRule}
                    // Carenode CNT-4833 permission-panel-open: a new open remounts the detail panel, whose state is seeded
                    // from its first rule.
                    key={`${fromSheetBar ? 'sheet-bar' : 'normal'}${openId === undefined ? '' : `-${openId}`}`}
                />
            )
            : <ListComponent key={key} />
    );
};
