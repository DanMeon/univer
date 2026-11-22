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

import type { IShortcutItem } from '@univerjs/ui';
import {
    Direction,
    DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY,
    ICommandService,
    IConfigService,
    IContextService,
    Injector,
    IUniverInstanceService,
} from '@univerjs/core';
import { IRenderManagerService } from '@univerjs/engine-render';
import { ILayoutService, IMenuManagerService, IShortcutService, IUIPartsService, KeyCode, MetaKeys } from '@univerjs/ui';
import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { IMobileFormulaBarSubmitCommandParams } from '../ui-mobile.controller';
import { MoveSelectionEnterAndTabCommand } from '../../../commands/commands/set-selection.command';
import { IEditorBridgeService } from '../../../services/editor-bridge.service';
import { EditingRenderController } from '../../editor/editing.render-controller';
import { MobileFormulaBarSubmitCommand, SheetUIMobileController } from '../ui-mobile.controller';

function createFormulaBarShortcuts(): IShortcutItem[] {
    const shortcuts: IShortcutItem[] = [];
    const injector = new Injector([
        [ILayoutService, { useValue: { registerFocusHandler: vi.fn(() => ({ dispose: vi.fn() })) } }],
        [ICommandService, { useValue: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })) } }],
        [IMenuManagerService, { useValue: { mergeMenu: vi.fn() } }],
        [IUIPartsService, { useValue: { registerComponent: vi.fn(() => ({ dispose: vi.fn() })) } }],
        [IShortcutService, { useValue: { registerShortcut: vi.fn((item: IShortcutItem) => {
            shortcuts.push(item);
            return { dispose: vi.fn() };
        }) } }],
        [IConfigService, { useValue: {} }],
        [IEditorBridgeService, { useValue: { visible$: new Subject(), isVisible: () => ({ visible: false }) } }],
        [IContextService, { useValue: { getContextValue: vi.fn(() => false), setContextValue: vi.fn() } }],
        [IRenderManagerService, { useValue: {} }],
        [IUniverInstanceService, { useValue: {} }],
    ]);
    injector.createInstance(SheetUIMobileController).dispose();
    injector.dispose();
    return shortcuts;
}

function keydownOn(id: string): KeyboardEvent {
    const element = document.createElement('div');
    element.id = id;
    const event = new KeyboardEvent('keydown', { key: 'Tab' });
    Object.defineProperty(event, 'target', { value: element });
    return event;
}

describe('mobile formula bar Tab', () => {
    it.each([
        { binding: KeyCode.TAB, direction: Direction.RIGHT },
        { binding: KeyCode.TAB | MetaKeys.SHIFT, direction: Direction.LEFT },
    ])('submits the formula bar sideways ($direction) ahead of the editor key handler', ({ binding, direction }) => {
        const tab = createFormulaBarShortcuts().find((item) => item.binding === binding);

        expect(tab).toMatchObject({
            id: MobileFormulaBarSubmitCommand.id,
            staticParameters: { direction, keycode: KeyCode.TAB },
        });
        // The rich text editor registers its own Tab handler at 901, which closes the editor instead.
        expect(tab!.priority).toBeGreaterThan(901);
        expect(tab!.eventPreconditions!(keydownOn(`__editor_${DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY}`))).toBe(true);
        expect(tab!.eventPreconditions!(keydownOn('some-host-input'))).toBe(false);
    });
});

describe('MobileFormulaBarSubmitCommand', () => {
    function runSubmit(params?: IMobileFormulaBarSubmitCommandParams) {
        const executeCommand = vi.fn(async () => false);
        const injector = new Injector([
            [IUniverInstanceService, { useValue: {
                getCurrentUnitOfType: () => ({ getUnitId: () => 'workbook-1' }),
                getUnit: () => ({}),
            } }],
            [IRenderManagerService, { useValue: { getRenderUnitById: () => ({}) } }],
            [EditingRenderController, { useValue: {} }],
            [IEditorBridgeService, { useValue: {
                getEditorDirty: () => false,
                enableForceKeepVisible: vi.fn(),
                disableForceKeepVisible: vi.fn(),
            } }],
            [ICommandService, { useValue: { executeCommand } }],
        ]);

        return { executeCommand, result: injector.invoke((accessor) => MobileFormulaBarSubmitCommand.handler(accessor, params)) };
    }

    it('moves down like Enter when no direction is given', async () => {
        const { executeCommand, result } = runSubmit();
        await result;
        expect(executeCommand).toHaveBeenCalledExactlyOnceWith(MoveSelectionEnterAndTabCommand.id, {
            keycode: KeyCode.ENTER,
            direction: Direction.DOWN,
            fromCurrentSelection: true,
        });
    });

    it('moves in the given direction with the Tab key semantics', async () => {
        const { executeCommand, result } = runSubmit({ direction: Direction.LEFT, keycode: KeyCode.TAB });
        await result;
        expect(executeCommand).toHaveBeenCalledExactlyOnceWith(MoveSelectionEnterAndTabCommand.id, {
            keycode: KeyCode.TAB,
            direction: Direction.LEFT,
            fromCurrentSelection: true,
        });
    });
});
