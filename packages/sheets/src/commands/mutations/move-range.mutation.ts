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

// Modified by Carenode, 2026 — the sheet gets a copy of each moved cell (xlsxkit move-range-cell-copy)

import type {
    ICellData,
    IMutation,
    IObjectMatrixPrimitiveType,
    IRange,
    Nullable,
    Workbook,
} from '@univerjs/core';
import { CommandType, IUniverInstanceService, ObjectMatrix, Tools, UniverInstanceType } from '@univerjs/core';

export interface IMoveRangeMutationParams {
    unitId: string;
    fromRange: IRange;
    toRange: IRange;
    from: {
        subUnitId: string;
        value: IObjectMatrixPrimitiveType<Nullable<ICellData>>;
    };
    to: {
        subUnitId: string;
        value: IObjectMatrixPrimitiveType<Nullable<ICellData>>;
    };
}

export const MoveRangeMutation: IMutation<IMoveRangeMutationParams, boolean> = {
    id: 'sheet.mutation.move-range',
    type: CommandType.MUTATION,
    handler: (accessor, params) => {
        const { from, to } = params;

        if (!from || !to) {
            return false;
        }

        const univerInstanceService = accessor.get(IUniverInstanceService);
        const workbook = univerInstanceService.getUnit<Workbook>(params.unitId, UniverInstanceType.UNIVER_SHEET);
        if (!workbook) {
            return false;
        }

        const fromWorksheet = workbook.getSheetBySheetId(params.from.subUnitId);
        const toWorksheet = workbook.getSheetBySheetId(params.to.subUnitId);

        if (!fromWorksheet || !toWorksheet) {
            return false;
        }

        const fromCellMatrix = fromWorksheet.getCellMatrix();
        const toCellMatrix = toWorksheet.getCellMatrix();

        // Carenode xlsxkit move-range-cell-copy: the sheet gets a copy of each cell, not the params' own object. A later
        // write merges into the sheet's cell object (set-range-values) and undo/redo run these params again, so a shared
        // object let every later edit of the cell rewrite the undo/redo record too.
        new ObjectMatrix<Nullable<ICellData>>(from.value).forValue((row, col, newVal) => {
            if (newVal === null || newVal === undefined) {
                fromCellMatrix.realDeleteValue(row, col);
            } else {
                fromCellMatrix.setValue(row, col, Tools.deepClone(newVal));
            }
        });

        new ObjectMatrix<Nullable<ICellData>>(to.value).forValue((row, col, newVal) => {
            if (newVal === null || newVal === undefined) {
                toCellMatrix.realDeleteValue(row, col);
            } else {
                toCellMatrix.setValue(row, col, Tools.deepClone(newVal)); // Carenode xlsxkit move-range-cell-copy
            }
        });

        return true;
    },
};
