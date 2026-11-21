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

// Modified by Carenode, 2026 — CNT-4497 excel-line-height: added file, the seam Carenode's Excel row-height rule plugs into.

// Carenode CNT-4497 excel-line-height. Excel fits an auto-height row to N x L, where L is a fixed line height per
// font and size, with nothing added. The rule (table and lookups) lives in Carenode's editor and is registered in
// IConfigService under XLSXKIT_AUTO_ROW_HEIGHT_RESOLVER_CONFIG_KEY; with none registered every path keeps the
// upstream value. This module is internal: it is not re-exported from the package index.

import { VerticalAlign } from '@univerjs/core';
import type { IDocumentSkeletonFontStyle, IDocumentSkeletonPage } from './i-document-skeleton-cached';

/** Must equal AUTO_ROW_HEIGHT_RESOLVER_CONFIG_KEY in Carenode's apps/xlsxkit/packages/editor/src/excel-row-height.ts. */
export const XLSXKIT_AUTO_ROW_HEIGHT_RESOLVER_CONFIG_KEY = 'xlsxkit.autoRowHeight.resolver';

/** The key of the Documents instance a spreadsheet uses to draw its document (rich text) cells. */
export const SHEET_FONT_DOCUMENTS_OBJECT_KEY = '__SHEET_EXTENSION_FONT_DOCUMENT_INSTANCE__';

interface IXlsxkitCellProbeBase {
    unitId: string;
    row: number;
    col: number;
    /** The cell is part of a merge (Excel does not fit a row to merged cells). */
    merged: boolean;
}

/** What the skeleton measured: one-line or wrapped plain text, a styled empty cell, or a document (rich text) cell. */
export type IXlsxkitCellProbeKind =
    | { kind: 'text'; font: IDocumentSkeletonFontStyle; lineCount: number }
    | { kind: 'empty'; font: IDocumentSkeletonFontStyle }
    | { kind: 'document'; rotated: boolean; pages: IDocumentSkeletonPage[] };

export type IXlsxkitAutoRowHeightCellProbe = IXlsxkitCellProbeBase & IXlsxkitCellProbeKind;

export interface IXlsxkitAutoRowHeightResolver {
    /** The cell's auto height in px, or undefined to keep the upstream measure. */
    cellHeight(probe: IXlsxkitAutoRowHeightCellProbe): number | undefined;
    /** The height an auto-height row never drops below, or undefined to keep the sheet default row height. */
    rowFloor(probe: { unitId: string; defaultRowHeight: number }): number | undefined;
}

/**
 * An Excel auto-fit row is exactly as tall as its lines, without the bottom padding Univer keeps inside a cell.
 * A top- or middle-aligned block taller than the padded inner box but not taller than the cell is placed where
 * bottom alignment places it, so the overflow goes into the empty space above the first line's glyphs instead of
 * under the cell's bottom clip. Any other block keeps its upstream position.
 */
export function xlsxkitCellBlockTop(
    blockTop: number,
    blockHeight: number,
    innerTop: number,
    innerHeight: number,
    paddingBottom: number,
    verticalAlign: VerticalAlign | undefined
): number {
    if (verticalAlign !== VerticalAlign.TOP && verticalAlign !== VerticalAlign.MIDDLE) return blockTop;
    if (blockHeight <= innerHeight || blockHeight > innerTop + innerHeight + paddingBottom) return blockTop;
    return innerTop + innerHeight - blockHeight;
}
