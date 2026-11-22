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

import type { IDocumentBody, IUniverInstanceService } from '@univerjs/core';
import type { IEditorService } from '@univerjs/docs-ui';
import { DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY, DOCS_NORMAL_EDITOR_UNIT_ID_KEY } from '@univerjs/core';
import { DeviceInputEventType } from '@univerjs/engine-render';
import { describe, expect, it, vi } from 'vitest';
import type { IEditorBridgeService } from '../../../../services/editor-bridge.service';
import { fillOpenedMobileFormulaBar } from '../MobileFormulaBar';

function createServices(eventType: DeviceInputEventType, cellEditorBody: IDocumentBody | undefined) {
    const editorBridgeService = {
        isVisible: () => ({ visible: true, eventType, unitId: 'workbook-1' }),
        refreshEditCellState: vi.fn(),
    };
    const univerInstanceService = {
        getUnit: vi.fn((unitId: string) => unitId === DOCS_NORMAL_EDITOR_UNIT_ID_KEY && cellEditorBody
            ? { getBody: () => cellEditorBody }
            : null),
    };
    const formulaBarEditor = {
        getDocumentData: () => ({ id: DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY, body: { dataStream: 'stored\r\n' } }),
        setDocumentData: vi.fn(),
    };
    const editorService = {
        getEditor: vi.fn((editorId: string) => editorId === DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY ? formulaBarEditor : undefined),
    };

    return {
        editorBridgeService,
        formulaBarEditor,
        fill: () => fillOpenedMobileFormulaBar(
            editorBridgeService as unknown as IEditorBridgeService,
            univerInstanceService as unknown as IUniverInstanceService,
            editorService as unknown as IEditorService
        ),
    };
}

describe('fillOpenedMobileFormulaBar', () => {
    it('carries the draft that a hardware key typed into the cell editor over to the formula bar', () => {
        const draft: IDocumentBody = { dataStream: 'x\r\n', paragraphs: [{ startIndex: 1, paragraphId: 'p1' }] };
        const { editorBridgeService, fill, formulaBarEditor } = createServices(DeviceInputEventType.Keyboard, draft);

        fill();

        expect(editorBridgeService.refreshEditCellState).not.toHaveBeenCalled();
        expect(formulaBarEditor.setDocumentData).toHaveBeenCalledExactlyOnceWith({
            id: DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY,
            body: draft,
        }, null);
        expect(formulaBarEditor.setDocumentData.mock.calls[0][0].body).not.toBe(draft);
    });

    it('re-reads the cell for an edit opened by a tap', () => {
        const { editorBridgeService, fill, formulaBarEditor } = createServices(DeviceInputEventType.Dblclick, undefined);

        fill();

        expect(editorBridgeService.refreshEditCellState).toHaveBeenCalledOnce();
        expect(formulaBarEditor.setDocumentData).not.toHaveBeenCalled();
    });

    it('fails loudly when the cell editor document is missing during a keyboard edit', () => {
        const { fill } = createServices(DeviceInputEventType.Keyboard, undefined);

        expect(fill).toThrow('[MobileFormulaBar]');
    });
});
