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

// Modified by Carenode, 2026 — CNT-4833 permission-panel-open: each open of the protection panel carries its own openId.

import type { ICommand } from '@univerjs/core';
import { CommandType } from '@univerjs/core';
import { ISidebarService } from '@univerjs/ui';
import type { IPermissionPanelRule } from '../../services/permission/sheet-permission-panel.model';
import { UNIVER_SHEET_PERMISSION_PANEL } from '../../consts/permission';
import { SheetPermissionPanelModel } from '../../services/permission/sheet-permission-panel.model';
import { SheetPermissionUserManagerService } from '../../services/permission/sheet-permission-user-list.service';

export interface IPermissionOpenPanelParam {
    fromSheetBar?: boolean;
    showDetail?: boolean;
    rule?: IPermissionPanelRule;
    oldRule?: IPermissionPanelRule;
}

// Carenode CNT-4833 permission-panel-open: every open of the panel gets its own number, so the detail panel mounts
// afresh instead of keeping the ranges, name and states of the rule it was first opened for.
let xlsxkitPermissionPanelOpenSeq = 0;

export const SheetPermissionOpenPanelOperation: ICommand<IPermissionOpenPanelParam> = {
    type: CommandType.OPERATION,
    id: 'sheet-permission.operation.openPanel',
    async handler(accessor, _params = {}) {
        const sidebarService = accessor.get(ISidebarService);
        const sheetPermissionPanelModel = accessor.get(SheetPermissionPanelModel);
        const sheetPermissionUserManagerService = accessor.get(SheetPermissionUserManagerService);

        const { showDetail = true, fromSheetBar = false, rule, oldRule } = _params;

        const sidebarProps = {
            header: { title: 'sheets-ui.permission.panel.title' },
            children: {
                label: UNIVER_SHEET_PERMISSION_PANEL,
                showDetail,
                fromSheetBar,
                rule,
                oldRule,
                openId: ++xlsxkitPermissionPanelOpenSeq, // Carenode CNT-4833 permission-panel-open
            },
            width: 330,
            onClose: () => {
                sheetPermissionPanelModel.reset();
                sheetPermissionUserManagerService.reset();
            },
        };

        sheetPermissionPanelModel.setVisible(true);
        sidebarService.open(sidebarProps);

        return true;
    },
};
