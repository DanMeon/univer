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

// Modified by Carenode, 2026 — CNT-3483 (b'): added file, the paste-range resolver seam Carenode's form grid plugs into.

// Carenode CNT-3483 (b'). A paste whose range partly covers a merge is refused upstream
// (sheets-ui.clipboard.paste.overlappingMergedCells). Carenode's work-log forms are grids of horizontal merges,
// so its editor registers a resolver in IConfigService under XLSXKIT_PASTE_RANGE_RESOLVER_CONFIG_KEY that maps the
// pasted matrix onto the merge grid. With none registered, the paste range is the upstream one. This module is
// internal: it is not re-exported from the package index.

import type { ICellDataWithSpanAndDisplay, IRange, Nullable, ObjectMatrix } from '@univerjs/core';
import type { IDiscreteRange } from '@univerjs/sheets';

/** Must equal PASTE_RANGE_RESOLVER_CONFIG_KEY in Carenode's apps/xlsxkit/packages/editor/src/paste-merge-grid.ts. */
export const XLSXKIT_PASTE_RANGE_RESOLVER_CONFIG_KEY = 'xlsxkit.clipboard.pasteRangeResolver';

export interface IXlsxkitPasteRangeResolverInput {
    unitId: string;
    subUnitId: string;
    /** The upstream paste range. Matrix index (i, j) lands on (rows[i], cols[j]). */
    pastedRange: IDiscreteRange;
    cellMatrix: ObjectMatrix<ICellDataWithSpanAndDisplay>;
    mergeData: IRange[];
}

/** Returns the rows and columns to paste into, or nothing to keep the upstream range. */
export type XlsxkitPasteRangeResolver = (input: IXlsxkitPasteRangeResolverInput) => Nullable<Pick<IDiscreteRange, 'rows' | 'cols'>>;
