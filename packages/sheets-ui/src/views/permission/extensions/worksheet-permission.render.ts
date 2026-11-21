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

// Modified by Carenode, 2026 — whole-sheet protection shade reads the sheet's own state (xlsxkit worksheet-shadow-sheet-state)

import type { IScale, ThemeService } from '@univerjs/core';
import type { SpreadsheetSkeleton, UniverRenderingContext } from '@univerjs/engine-render';
import { SheetExtension } from '@univerjs/engine-render';
import { UnitAction } from '@univerjs/protocol';
import { base64 } from './protect-background-img';

export const worksheetProtectionKey = 'worksheet-protection';
const EXTENSION_CAN_VIEW_Z_INDEX = 25;
const EXTENSION_CAN_NOT_VIEW_Z_INDEX = 80;

/**
 * Carenode xlsxkit worksheet-shadow-sheet-state: a sheet's view and edit points, the values the sheets view model's
 * sheet interceptor writes into every cell of a sheet with a rule.
 */
export interface IXlsxkitSheetProtectionState {
    [UnitAction.View]: boolean;
    [UnitAction.Edit]: boolean;
}

/** Reads a sheet's protection state; `null` when the sheet has no rule. */
export type XlsxkitSheetProtectionReader = (unitId: string, subUnitId: string) => IXlsxkitSheetProtectionState | null;

export class WorksheetProtectionRenderExtension extends SheetExtension {
    override readonly viewportCacheReusable = this.constructor === WorksheetProtectionRenderExtension;

    override uKey = worksheetProtectionKey;

    override Z_INDEX = EXTENSION_CAN_VIEW_Z_INDEX;
    private _pattern: CanvasPattern | null;

    private _img = new Image();
    protected _shadowStrategy: 'always' | 'non-editable' | 'non-viewable' | 'none' = 'always';

    constructor(
        private readonly _themeService: ThemeService,
        shadowStrategy: 'always' | 'non-editable' | 'non-viewable' | 'none' | undefined,
        private readonly _readSheetProtection: XlsxkitSheetProtectionReader
    ) {
        super();
        this._img.onload = () => {
            this._img.onload = null;
            this.parent?.makeDirty(true);
        };
        this._img.src = base64;
        if (shadowStrategy) {
            this._shadowStrategy = shadowStrategy;
        }
    }

    override draw(
        ctx: UniverRenderingContext,
        _parentScale: IScale,
        spreadsheetSkeleton: SpreadsheetSkeleton
    ) {
        const { worksheet } = spreadsheetSkeleton;

        if (!worksheet) {
            return false;
        }

        ctx.save();
        ctx.globalAlpha *= this._themeService.darkMode ? 0.16 : 1;
        if (!this._pattern) {
            this._pattern = ctx.createPattern(this._img, 'repeat');
        }
        const { startRow, startColumn, endRow, endColumn } = spreadsheetSkeleton.rowColumnSegment;
        const start = spreadsheetSkeleton.getCellWithCoordByIndex(startRow, startColumn, false);
        const end = spreadsheetSkeleton.getCellWithCoordByIndex(endRow, endColumn, false);

        // Carenode xlsxkit worksheet-shadow-sheet-state: whether the whole sheet is shaded, and on which layer, is the
        // sheet's own state — its rule and its view and edit points. Upstream read both off the top-left visible cell
        // (`hasWorksheetRule`, `selectionProtection[0]`), which stands for the sheet only while a sheet rule overwrites
        // every cell's protection: once a cell keeps its range rule (the sheets fork commit `xlsxkit protection-merge`)
        // a locked top-left cell shaded an editable sheet and the shade came and went with the scroll, and a cell a range
        // rule hides holds no sheet state at all (the range interceptor stops there) — the sheet's shade on that cell's
        // layer covered the text of a sheet people may view.
        const sheetProtection = this._readSheetProtection(worksheet.getUnitId(), worksheet.getSheetId());
        if (!this._pattern) {
            ctx.restore();
            return;
        }

        if (sheetProtection !== null) {
            this.setZIndex(sheetProtection[UnitAction.View] ? EXTENSION_CAN_VIEW_Z_INDEX : EXTENSION_CAN_NOT_VIEW_Z_INDEX);
        }

        ctx.fillStyle = this._pattern;

        // Apply shadow strategy for worksheet protection
        let shouldRenderShadow = sheetProtection !== null;

        // If strategy is 'none', never show shadow
        if (this._shadowStrategy === 'none') {
            shouldRenderShadow = false;
        } else if (sheetProtection !== null) {
            if (this._shadowStrategy === 'non-editable') {
                // Only show shadow if edit permission is false
                shouldRenderShadow = sheetProtection[UnitAction.Edit] === false;
            } else if (this._shadowStrategy === 'non-viewable') {
                // Only show shadow if view permission is false
                shouldRenderShadow = sheetProtection[UnitAction.View] === false;
            }
            // For 'always' strategy, shouldRenderShadow remains true (the sheet has a rule)
        }

        if (shouldRenderShadow) {
            ctx.fillRect(start.startX, start.startY, end.endX - start.startX, end.endY - start.startY);
        }

        ctx.restore();
    }

    override dispose(): void {
        this._img.onload = null;
        this._pattern = null;
        super.dispose();
    }

    /**
     * Set the shadow strategy for this extension
     * @param strategy The shadow strategy
     */
    setShadowStrategy(strategy: 'always' | 'non-editable' | 'non-viewable' | 'none'): void {
        this._shadowStrategy = strategy;
    }

    /**
     * Get the current shadow strategy
     */
    getShadowStrategy(): 'always' | 'non-editable' | 'non-viewable' | 'none' {
        return this._shadowStrategy;
    }

    setZIndex(zIndex: number) {
        this.Z_INDEX = zIndex;
    }
}
