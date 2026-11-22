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

import type { IConfirmPartMethodOptions, IDialogPartMethodOptions } from '@univerjs/ui';
import {
    Direction,
    ICommandService,
    IConfirmService,
    Injector,
    IUniverInstanceService,
    LocaleType,
    RedoCommand,
    UndoCommand,
    Univer,
} from '@univerjs/core';
import { DeviceInputEventType, IRenderManagerService, RenderManagerService } from '@univerjs/engine-render';
import { ClearSelectionContentCommand, SheetsSelectionsService } from '@univerjs/sheets';
import {
    ComponentManager,
    CopyCommand,
    CutCommand,
    IconManager,
    IContextMenuService,
    IDialogService,
    ILayoutService,
    IPlatformService,
    KeyCode,
    PasteCommand,
} from '@univerjs/ui';
import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    ExpandSelectionCommand,
    MoveSelectionCommand,
    MoveSelectionEnterAndTabCommand,
    SelectAllCommand,
} from '../../../commands/commands/set-selection.command';
import { SetCellEditVisibleOperation, SetCellEditVisibleWithF2Operation } from '../../../commands/operations/cell-edit.operation';
import { UniverSheetsMobileUIPlugin } from '../../../mobile-plugin';
import { UniverSheetsUIPlugin } from '../../../plugin';
import { IEditorBridgeService } from '../../../services/editor-bridge.service';
import { MobileSheetKeyboardController } from '../mobile-keyboard.controller';

interface IHarnessOptions {
    isMac?: boolean;
    unitId?: string;
}

function createHarness(options: IHarnessOptions = {}) {
    const unitId = options.unitId ?? 'workbook-1';
    const root = document.createElement('div');
    // The workbook's render canvas, as the engine of its render unit hands it out.
    const cell = document.createElement('canvas');
    cell.tabIndex = -1;
    root.appendChild(cell);
    document.body.appendChild(root);

    const workbook = { getUnitId: () => unitId };
    const state = {
        focusedUnit: workbook as { getUnitId(): string } | null,
        editorVisible: false,
        contextMenuVisible: false,
    };
    const dialogs$ = new BehaviorSubject<IDialogPartMethodOptions[]>([]);
    const confirms$ = new BehaviorSubject<IConfirmPartMethodOptions[]>([]);
    const commandService = {
        executeCommand: vi.fn(async () => true),
        syncExecuteCommand: vi.fn(() => true),
    };
    const injector = new Injector([
        [ICommandService, { useValue: commandService }],
        [IUniverInstanceService, { useValue: {
            getCurrentUnitOfType: () => workbook,
            getFocusedUnit: () => state.focusedUnit,
        } }],
        [IRenderManagerService, { useValue: {
            getRenderUnitById: (id: string) => id === unitId ? { engine: { getCanvasElement: () => cell } } : null,
        } }],
        [IEditorBridgeService, { useValue: { isVisible: () => ({ visible: state.editorVisible }) } }],
        [ILayoutService, { useValue: { rootContainerElement: root } }],
        [IPlatformService, { useValue: { isMac: options.isMac ?? false, isWindows: !options.isMac, isLinux: false } }],
        [IContextMenuService, { useValue: { get visible() { return state.contextMenuVisible; } } }],
        [IDialogService, { useValue: { getDialogs$: () => dialogs$ } }],
        [IConfirmService, { useValue: { confirmOptions$: confirms$ } }],
    ]);
    const controller = injector.createInstance(MobileSheetKeyboardController);

    return {
        cell,
        commandService,
        confirms$,
        dialogs$,
        root,
        state,
        unitId,
        dispose() {
            controller.dispose();
            injector.dispose();
            root.remove();
        },
    };
}

function press(element: Element): void {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
}

function keydown(init: KeyboardEventInit & { keyCode: number }, target: EventTarget = document.body): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, 'keyCode', { configurable: true, value: init.keyCode });
    target.dispatchEvent(event);
    return event;
}

describe('MobileSheetKeyboardController', () => {
    const disposers: Array<() => void> = [];

    afterEach(() => {
        disposers.splice(0).forEach((dispose) => dispose());
        (document.activeElement as HTMLElement | null)?.blur?.();
    });

    function setup(options?: IHarnessOptions) {
        const harness = createHarness(options);
        disposers.push(() => harness.dispose());
        press(harness.cell);
        return harness;
    }

    it('moves the selection with arrows and expands it with Shift+arrows', () => {
        const { commandService } = setup();

        const cases = [
            { key: 'ArrowDown', keyCode: KeyCode.ARROW_DOWN, direction: Direction.DOWN },
            { key: 'ArrowUp', keyCode: KeyCode.ARROW_UP, direction: Direction.UP },
            { key: 'ArrowLeft', keyCode: KeyCode.ARROW_LEFT, direction: Direction.LEFT },
            { key: 'ArrowRight', keyCode: KeyCode.ARROW_RIGHT, direction: Direction.RIGHT },
        ];
        for (const { key, keyCode, direction } of cases) {
            const move = keydown({ key, keyCode });
            expect(move.defaultPrevented).toBe(true);
            expect(commandService.executeCommand).toHaveBeenLastCalledWith(MoveSelectionCommand.id, { direction });

            const expand = keydown({ key, keyCode, shiftKey: true });
            expect(expand.defaultPrevented).toBe(true);
            expect(commandService.executeCommand).toHaveBeenLastCalledWith(ExpandSelectionCommand.id, { direction });
        }
    });

    it('moves with Tab and Enter the way the desktop shortcuts do', () => {
        const { commandService } = setup();

        keydown({ key: 'Tab', keyCode: KeyCode.TAB });
        expect(commandService.executeCommand).toHaveBeenLastCalledWith(MoveSelectionEnterAndTabCommand.id, {
            direction: Direction.RIGHT,
            keycode: KeyCode.TAB,
        });
        keydown({ key: 'Tab', keyCode: KeyCode.TAB, shiftKey: true });
        expect(commandService.executeCommand).toHaveBeenLastCalledWith(MoveSelectionEnterAndTabCommand.id, {
            direction: Direction.LEFT,
            keycode: KeyCode.TAB,
        });
        keydown({ key: 'Enter', keyCode: KeyCode.ENTER });
        expect(commandService.executeCommand).toHaveBeenLastCalledWith(MoveSelectionEnterAndTabCommand.id, {
            direction: Direction.DOWN,
            keycode: KeyCode.ENTER,
        });
        keydown({ key: 'Enter', keyCode: KeyCode.ENTER, shiftKey: true });
        expect(commandService.executeCommand).toHaveBeenLastCalledWith(MoveSelectionEnterAndTabCommand.id, {
            direction: Direction.UP,
            keycode: KeyCode.ENTER,
        });
    });

    it('clears the selection with Delete and Backspace and keeps the content with F2', () => {
        const { commandService } = setup();

        expect(keydown({ key: 'Delete', keyCode: KeyCode.DELETE }).defaultPrevented).toBe(true);
        expect(commandService.executeCommand).toHaveBeenLastCalledWith(ClearSelectionContentCommand.id, undefined);
        expect(keydown({ key: 'Backspace', keyCode: KeyCode.BACKSPACE }).defaultPrevented).toBe(true);
        expect(commandService.executeCommand).toHaveBeenLastCalledWith(ClearSelectionContentCommand.id, undefined);

        keydown({ key: 'F2', keyCode: KeyCode.F2 });
        expect(commandService.executeCommand).toHaveBeenLastCalledWith(SetCellEditVisibleWithF2Operation.id, {
            visible: true,
            eventType: DeviceInputEventType.Keyboard,
            keycode: KeyCode.F2,
        });
        expect(commandService.syncExecuteCommand).not.toHaveBeenCalled();
    });

    it('starts editing with a typed character and leaves the character to the editor it focuses', () => {
        const { commandService, unitId } = setup();

        const typed = keydown({ key: 'a', keyCode: KeyCode.A });
        expect(typed.defaultPrevented).toBe(false);
        expect(commandService.syncExecuteCommand).toHaveBeenCalledExactlyOnceWith(SetCellEditVisibleOperation.id, {
            visible: true,
            eventType: DeviceInputEventType.Keyboard,
            keycode: KeyCode.A,
            initialValue: 'a',
            unitId,
        });

        const shifted = keydown({ key: 'A', keyCode: KeyCode.A, shiftKey: true });
        expect(shifted.defaultPrevented).toBe(false);
        expect(commandService.syncExecuteCommand).toHaveBeenLastCalledWith(SetCellEditVisibleOperation.id, expect.objectContaining({
            initialValue: 'A',
        }));

        commandService.syncExecuteCommand.mockClear();
        keydown({ key: 'a', keyCode: KeyCode.A, altKey: true });
        keydown({ key: 'Shift', keyCode: 16, shiftKey: true });
        expect(commandService.syncExecuteCommand).not.toHaveBeenCalled();
    });

    it('starts an empty edit for an IME key and lets the composition reach the editor', () => {
        const { commandService, unitId } = setup();

        const ime = keydown({ key: 'Process', keyCode: 229 });
        expect(ime.defaultPrevented).toBe(false);
        expect(commandService.syncExecuteCommand).toHaveBeenCalledExactlyOnceWith(SetCellEditVisibleOperation.id, {
            visible: true,
            eventType: DeviceInputEventType.Keyboard,
            keycode: 229,
            initialValue: '',
            unitId,
        });

        commandService.syncExecuteCommand.mockClear();
        keydown({ key: 'Process', keyCode: 229, isComposing: true });
        expect(commandService.syncExecuteCommand).not.toHaveBeenCalled();
    });

    it.each([
        { platform: 'Windows and Android', isMac: false, modifier: { ctrlKey: true } },
        { platform: 'macOS and iPadOS', isMac: true, modifier: { metaKey: true } },
    ])('runs undo, redo, clipboard and select-all with the $platform command key', ({ isMac, modifier }) => {
        const { commandService } = setup({ isMac });
        const cases = [
            { key: 'z', keyCode: KeyCode.Z, shiftKey: false, id: UndoCommand.id },
            { key: 'z', keyCode: KeyCode.Z, shiftKey: true, id: RedoCommand.id },
            { key: 'y', keyCode: KeyCode.Y, shiftKey: false, id: RedoCommand.id },
            { key: 'c', keyCode: KeyCode.C, shiftKey: false, id: CopyCommand.id },
            { key: 'x', keyCode: KeyCode.X, shiftKey: false, id: CutCommand.id },
            { key: 'v', keyCode: KeyCode.V, shiftKey: false, id: PasteCommand.id },
        ];

        for (const { key, keyCode, shiftKey, id } of cases) {
            const event = keydown({ key, keyCode, shiftKey, ...modifier });
            expect(event.defaultPrevented).toBe(true);
            expect(commandService.executeCommand).toHaveBeenLastCalledWith(id, undefined);
        }

        keydown({ key: 'a', keyCode: KeyCode.A, ...modifier });
        expect(commandService.executeCommand).toHaveBeenLastCalledWith(SelectAllCommand.id, {
            expandToGapFirst: true,
            loop: true,
        });
        expect(commandService.syncExecuteCommand).not.toHaveBeenCalled();
    });

    it('acts while a non-editable element of the Univer container holds focus', () => {
        const { cell, commandService } = setup();
        cell.focus();
        expect(document.activeElement).toBe(cell);

        keydown({ key: 'ArrowDown', keyCode: KeyCode.ARROW_DOWN }, cell);
        expect(commandService.executeCommand).toHaveBeenCalledExactlyOnceWith(MoveSelectionCommand.id, {
            direction: Direction.DOWN,
        });
    });

    it.each([
        { name: 'an input of the host page', create: () => document.createElement('input'), inside: false },
        { name: 'a textarea inside Univer', create: () => document.createElement('textarea'), inside: true },
        { name: 'a select inside Univer', create: () => document.createElement('select'), inside: true },
        {
            name: 'a contenteditable inside Univer',
            create: () => {
                const element = document.createElement('div');
                element.contentEditable = 'true';
                return element;
            },
            inside: true,
        },
        {
            name: 'a button inside a Univer dialog',
            create: () => {
                const dialog = document.createElement('div');
                dialog.setAttribute('role', 'dialog');
                dialog.appendChild(document.createElement('button'));
                return dialog;
            },
            focus: (element: HTMLElement) => element.querySelector('button')!,
            inside: true,
        },
        { name: 'a button of the host page', create: () => document.createElement('button'), inside: false },
    ])('refuses keys while focus is in $name', ({ create, focus, inside }) => {
        const { commandService, root } = setup();
        const element = create();
        (inside ? root : document.body).appendChild(element);
        disposers.push(() => element.remove());
        const focusTarget = (focus?.(element) ?? element) as HTMLElement;
        focusTarget.focus();
        expect(document.activeElement).toBe(focusTarget);

        keydown({ key: 'ArrowDown', keyCode: KeyCode.ARROW_DOWN }, focusTarget);
        keydown({ key: 'a', keyCode: KeyCode.A }, focusTarget);
        expect(commandService.executeCommand).not.toHaveBeenCalled();
        expect(commandService.syncExecuteCommand).not.toHaveBeenCalled();
    });

    it('leaves Enter, Space and Tab to a focused button inside Univer but moves with arrows', () => {
        const { commandService, root } = setup();
        const button = document.createElement('button');
        root.appendChild(button);
        button.focus();

        keydown({ key: 'Enter', keyCode: KeyCode.ENTER }, button);
        keydown({ key: ' ', keyCode: KeyCode.SPACE }, button);
        keydown({ key: 'Tab', keyCode: KeyCode.TAB }, button);
        expect(commandService.executeCommand).not.toHaveBeenCalled();
        expect(commandService.syncExecuteCommand).not.toHaveBeenCalled();

        keydown({ key: 'ArrowDown', keyCode: KeyCode.ARROW_DOWN }, button);
        expect(commandService.executeCommand).toHaveBeenCalledExactlyOnceWith(MoveSelectionCommand.id, {
            direction: Direction.DOWN,
        });
    });

    it.each([
        { name: 'the long-press context menu', open: (h: ReturnType<typeof createHarness>) => { h.state.contextMenuVisible = true; } },
        {
            name: 'a dialog',
            open: (h: ReturnType<typeof createHarness>) => h.dialogs$.next([{ id: 'dialog-1' } as IDialogPartMethodOptions]),
        },
        {
            name: 'a confirm',
            open: (h: ReturnType<typeof createHarness>) => h.confirms$.next([{ id: 'confirm-1', visible: true } as IConfirmPartMethodOptions]),
        },
    ])('refuses keys while $name opened after the canvas press', ({ open }) => {
        const harness = setup();
        open(harness);

        keydown({ key: 'ArrowDown', keyCode: KeyCode.ARROW_DOWN });
        keydown({ key: 'Delete', keyCode: KeyCode.DELETE });
        keydown({ key: 'a', keyCode: KeyCode.A });
        expect(harness.commandService.executeCommand).not.toHaveBeenCalled();
        expect(harness.commandService.syncExecuteCommand).not.toHaveBeenCalled();
    });

    it('acts again once the dialogs and confirms left are closed', () => {
        const { commandService, confirms$, dialogs$ } = setup();
        dialogs$.next([{ id: 'dialog-1', open: false } as IDialogPartMethodOptions]);
        confirms$.next([{ id: 'confirm-1', visible: false } as IConfirmPartMethodOptions]);

        keydown({ key: 'ArrowDown', keyCode: KeyCode.ARROW_DOWN });
        expect(commandService.executeCommand).toHaveBeenCalledOnce();
    });

    it('refuses keys before the sheet canvas was ever pressed', () => {
        const harness = createHarness();
        disposers.push(() => harness.dispose());

        keydown({ key: 'ArrowDown', keyCode: KeyCode.ARROW_DOWN });
        keydown({ key: 'a', keyCode: KeyCode.A });
        expect(harness.commandService.executeCommand).not.toHaveBeenCalled();
        expect(harness.commandService.syncExecuteCommand).not.toHaveBeenCalled();
    });

    it.each([
        {
            name: 'a toolbar button inside Univer',
            create: () => {
                const toolbar = document.createElement('div');
                toolbar.setAttribute('role', 'toolbar');
                toolbar.appendChild(document.createElement('button'));
                return toolbar;
            },
            pressTarget: (element: HTMLElement) => element.querySelector('button')!,
            inside: true,
        },
        { name: 'a drawer inside Univer', create: () => document.createElement('section'), inside: true },
        { name: 'another canvas inside Univer', create: () => document.createElement('canvas'), inside: true },
        { name: 'the host page', create: () => document.createElement('div'), inside: false },
    ])('refuses keys after the last press landed on $name, until the sheet canvas is pressed again', ({ create, pressTarget, inside }) => {
        const { cell, commandService, root } = setup();
        const element = create();
        (inside ? root : document.body).appendChild(element);
        disposers.push(() => element.remove());

        press(pressTarget?.(element) ?? element);
        keydown({ key: 'ArrowDown', keyCode: KeyCode.ARROW_DOWN });
        keydown({ key: 'a', keyCode: KeyCode.A });
        expect(commandService.executeCommand).not.toHaveBeenCalled();
        expect(commandService.syncExecuteCommand).not.toHaveBeenCalled();

        // The other element stays on screen, like a non-modal panel the person keeps open while working on cells.
        press(cell);
        keydown({ key: 'ArrowDown', keyCode: KeyCode.ARROW_DOWN });
        expect(commandService.executeCommand).toHaveBeenCalledOnce();
    });

    it('refuses keys while the cell editor is open, the sheet is not focused, or someone else handled the key', () => {
        const { commandService, state } = setup();

        state.editorVisible = true;
        keydown({ key: 'ArrowDown', keyCode: KeyCode.ARROW_DOWN });
        keydown({ key: 'a', keyCode: KeyCode.A });
        state.editorVisible = false;

        state.focusedUnit = { getUnitId: () => 'doc-1' };
        keydown({ key: 'ArrowDown', keyCode: KeyCode.ARROW_DOWN });
        state.focusedUnit = { getUnitId: () => 'workbook-1' };

        const handled = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
        Object.defineProperty(handled, 'keyCode', { value: KeyCode.ARROW_DOWN });
        handled.preventDefault();
        document.body.dispatchEvent(handled);

        expect(commandService.executeCommand).not.toHaveBeenCalled();
        expect(commandService.syncExecuteCommand).not.toHaveBeenCalled();
    });

    it('lets only the Univer instance whose canvas the person last pressed react', () => {
        const first = setup({ unitId: 'workbook-1' });
        const second = setup({ unitId: 'workbook-2' });

        press(second.cell);
        keydown({ key: 'ArrowDown', keyCode: KeyCode.ARROW_DOWN });
        expect(first.commandService.executeCommand).not.toHaveBeenCalled();
        expect(second.commandService.executeCommand).toHaveBeenCalledOnce();

        press(first.cell);
        keydown({ key: 'ArrowDown', keyCode: KeyCode.ARROW_DOWN });
        expect(first.commandService.executeCommand).toHaveBeenCalledOnce();
        expect(second.commandService.executeCommand).toHaveBeenCalledOnce();
    });

    it('stops listening once disposed', () => {
        const harness = createHarness();
        press(harness.cell);
        harness.dispose();

        keydown({ key: 'ArrowDown', keyCode: KeyCode.ARROW_DOWN });
        expect(harness.commandService.executeCommand).not.toHaveBeenCalled();
    });
});

describe('MobileSheetKeyboardController registration', () => {
    function isRegisteredBy(plugin: typeof UniverSheetsMobileUIPlugin | typeof UniverSheetsUIPlugin): boolean {
        const univer = new Univer({ locale: LocaleType.EN_US });
        try {
            const injector = univer.__getInjector();
            injector.add([SheetsSelectionsService]);
            injector.add([ComponentManager]);
            injector.add([IconManager]);
            injector.add([IRenderManagerService, { useClass: RenderManagerService }]);
            injector.createInstance(plugin as typeof UniverSheetsUIPlugin, {}).onStarting();
            return injector.has(MobileSheetKeyboardController);
        } finally {
            univer.dispose();
        }
    }

    it('is registered by the mobile sheets UI plugin and not by the desktop one', () => {
        expect(isRegisteredBy(UniverSheetsMobileUIPlugin)).toBe(true);
        expect(isRegisteredBy(UniverSheetsUIPlugin)).toBe(false);
    });
});
