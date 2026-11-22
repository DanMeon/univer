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

import type { Nullable, Workbook } from '@univerjs/core';
import type { IConfirmPartMethodOptions, IShortcutItem } from '@univerjs/ui';
import {
    Disposable,
    ICommandService,
    IConfirmService,
    IUniverInstanceService,
    RedoCommand,
    toDisposable,
    UniverInstanceType,
} from '@univerjs/core';
import { DeviceInputEventType, IRenderManagerService } from '@univerjs/engine-render';
import { ClearSelectionContentCommand } from '@univerjs/sheets';
import {
    CopyShortcutItem,
    CutShortcutItem,
    IContextMenuService,
    IDialogService,
    ILayoutService,
    IPlatformService,
    KeyCode,
    MetaKeys,
    PasteCommand,
    RedoShortcutItem,
    UndoShortcutItem,
} from '@univerjs/ui';
import type { IEditorBridgeServiceVisibleParam } from '../../services/editor-bridge.service';
import { SetCellEditVisibleOperation } from '../../commands/operations/cell-edit.operation';
import { IEditorBridgeService } from '../../services/editor-bridge.service';
import { StartEditWithF2Shortcut } from '../shortcuts/editor.shortcut';
import {
    ExpandSelectionDownShortcutItem,
    ExpandSelectionLeftShortcutItem,
    ExpandSelectionRightShortcutItem,
    ExpandSelectionUpShortcutItem,
    MoveSelectionDownShortcutItem,
    MoveSelectionEnterShortcutItem,
    MoveSelectionEnterUpShortcutItem,
    MoveSelectionLeftShortcutItem,
    MoveSelectionRightShortcutItem,
    MoveSelectionTabLeftShortcutItem,
    MoveSelectionTabShortcutItem,
    MoveSelectionUpShortcutItem,
    SelectAllShortcutItem,
} from '../shortcuts/selection.shortcut';

/**
 * Keys a hardware keyboard sends to an idle mobile sheet. The desktop shortcut items supply the command and its
 * parameters; their preconditions need the hidden cell editor to hold DOM focus, which the mobile screen never
 * gives it, so `MobileSheetKeyboardController` replaces them with its own keyboard-target check.
 */
const MOBILE_IDLE_SHORTCUTS: IShortcutItem[] = [
    MoveSelectionDownShortcutItem,
    MoveSelectionUpShortcutItem,
    MoveSelectionLeftShortcutItem,
    MoveSelectionRightShortcutItem,
    ExpandSelectionDownShortcutItem,
    ExpandSelectionUpShortcutItem,
    ExpandSelectionLeftShortcutItem,
    ExpandSelectionRightShortcutItem,
    MoveSelectionTabShortcutItem,
    MoveSelectionTabLeftShortcutItem,
    MoveSelectionEnterShortcutItem,
    MoveSelectionEnterUpShortcutItem,
    SelectAllShortcutItem,
    StartEditWithF2Shortcut,
    UndoShortcutItem,
    RedoShortcutItem,
    { id: RedoCommand.id, binding: KeyCode.Z | MetaKeys.CTRL_COMMAND | MetaKeys.SHIFT },
    CopyShortcutItem,
    CutShortcutItem,
    // Desktop pastes through the native paste event of the focused hidden editor. Mobile keeps that editor
    // unfocused, so the key runs the clipboard-API paste the mobile context menu runs.
    { id: PasteCommand.id, binding: KeyCode.V | MetaKeys.CTRL_COMMAND },
    { id: ClearSelectionContentCommand.id, binding: KeyCode.DELETE },
    { id: ClearSelectionContentCommand.id, binding: KeyCode.BACKSPACE },
];

const IME_PROCESS_KEY_CODE = 229;
const EDITABLE_SELECTOR = 'input, textarea, select';
const DIALOG_SELECTOR = 'dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]';

/**
 * Lets a hardware keyboard drive the mobile sheet while no editor is open: arrows, Tab and Enter move the selection,
 * Delete clears it, and typing starts editing. The mobile screen keeps DOM focus on `body` so a tap does not open the
 * on-screen keyboard, which leaves the shortcut service (it only reads events inside Univer containers) deaf to these
 * keys; this controller reads them from the document instead and acts only when the sheet is their target.
 */
export class MobileSheetKeyboardController extends Disposable {
    private readonly _idleShortcuts = new Map<number, IShortcutItem>();
    private _lastPressTarget: Nullable<EventTarget> = null;
    private _dialogOpen = false;
    private _confirmOpen = false;

    constructor(
        @ICommandService private readonly _commandService: ICommandService,
        @IUniverInstanceService private readonly _univerInstanceService: IUniverInstanceService,
        @IRenderManagerService private readonly _renderManagerService: IRenderManagerService,
        @IEditorBridgeService private readonly _editorBridgeService: IEditorBridgeService,
        @ILayoutService private readonly _layoutService: ILayoutService,
        @IPlatformService private readonly _platformService: IPlatformService,
        @IContextMenuService private readonly _contextMenuService: IContextMenuService,
        @IDialogService dialogService: IDialogService,
        @IConfirmService confirmService: IConfirmService<IConfirmPartMethodOptions>
    ) {
        super();

        for (const item of MOBILE_IDLE_SHORTCUTS) {
            if (item.binding == null || this._idleShortcuts.has(item.binding)) {
                throw new Error(`[MobileSheetKeyboardController]: shortcut ${item.id} has a missing or duplicate binding.`);
            }
            this._idleShortcuts.set(item.binding, item);
        }

        // Overlays that open without a new press: a press on the sheet canvas starts them (long press, a command that
        // asks for confirmation), so the press rule below cannot tell they now cover the sheet.
        this.disposeWithMe(dialogService.getDialogs$().subscribe((dialogs) => {
            this._dialogOpen = dialogs.some((dialog) => dialog.open !== false);
        }));
        this.disposeWithMe(confirmService.confirmOptions$.subscribe((confirms) => {
            this._confirmOpen = confirms.some((confirm) => confirm.visible === true);
        }));

        this._initPointerTracking();
        this._initKeyboardListener();
    }

    private _initPointerTracking(): void {
        // With `body` focused, the last pointer press is the only sign of what the person is working on. A press on
        // anything but the sheet canvas (a panel, a toolbar, the host page, another Univer instance) hands the keys
        // over to it, and a modal overlay's backdrop keeps the canvas from being pressed while it is open.
        const onPointerDown = (event: PointerEvent) => {
            this._lastPressTarget = event.target;
        };

        document.addEventListener('pointerdown', onPointerDown, true);
        this.disposeWithMe(toDisposable(() => document.removeEventListener('pointerdown', onPointerDown, true)));
    }

    private _initKeyboardListener(): void {
        // Bubble phase on the document: element handlers and the shortcut service (window capture) run first, and
        // whatever they handle arrives here with `defaultPrevented` set.
        const onKeydown = (event: KeyboardEvent) => this._handleKeydown(event);

        document.addEventListener('keydown', onKeydown);
        this.disposeWithMe(toDisposable(() => document.removeEventListener('keydown', onKeydown)));
    }

    private _handleKeydown(event: KeyboardEvent): void {
        const workbook = this._getKeyboardTargetWorkbook(event);
        if (!workbook) {
            return;
        }

        const shortcut = this._idleShortcuts.get(this._getBinding(event));
        if (shortcut) {
            event.preventDefault();
            this._commandService.executeCommand(shortcut.id, shortcut.staticParameters);
            return;
        }

        if (isImeProcessKey(event)) {
            // The composition goes to the editor input that opening the editor focuses, so the event keeps its
            // default action.
            this._startEditing(workbook, event, '');
            return;
        }

        if (isPrintableKey(event)) {
            // Opening the editor focuses its input synchronously, and the browser delivers this key's character to
            // the element that holds focus once keydown returns, so the default action types it into the editor.
            this._startEditing(workbook, event, event.key);
        }
    }

    private _startEditing(workbook: Workbook, event: KeyboardEvent, initialValue: string): void {
        this._commandService.syncExecuteCommand(SetCellEditVisibleOperation.id, {
            visible: true,
            eventType: DeviceInputEventType.Keyboard,
            keycode: event.keyCode,
            initialValue,
            unitId: workbook.getUnitId(),
        } as IEditorBridgeServiceVisibleParam);
    }

    private _getKeyboardTargetWorkbook(event: KeyboardEvent): Workbook | null {
        if (event.defaultPrevented || event.isComposing) {
            return null;
        }

        const root = this._layoutService.rootContainerElement;
        if (!root || !this._isFocusFreeForSheet(root, event)) {
            return null;
        }

        const workbook = this._univerInstanceService.getCurrentUnitOfType<Workbook>(UniverInstanceType.UNIVER_SHEET);
        if (!workbook || this._univerInstanceService.getFocusedUnit()?.getUnitId() !== workbook.getUnitId()) {
            return null;
        }

        const sheetCanvas = this._renderManagerService.getRenderUnitById(workbook.getUnitId())?.engine.getCanvasElement();
        if (sheetCanvas == null || this._lastPressTarget !== sheetCanvas) {
            return null;
        }

        if (
            this._editorBridgeService.isVisible().visible ||
            this._dialogOpen ||
            this._confirmOpen ||
            this._contextMenuService.visible
        ) {
            return null;
        }

        return workbook;
    }

    private _isFocusFreeForSheet(root: HTMLElement, event: KeyboardEvent): boolean {
        const ownerDocument = root.ownerDocument;
        const activeElement = ownerDocument.activeElement;
        if (activeElement == null || activeElement === ownerDocument.body || activeElement === ownerDocument.documentElement) {
            return true;
        }

        if (!root.contains(activeElement) || activeElement.closest(DIALOG_SELECTOR) != null) {
            return false;
        }

        if (activeElement.matches(EDITABLE_SELECTOR) || (activeElement as HTMLElement).isContentEditable) {
            return false;
        }

        // A focused button owns activation and focus traversal, as in the shortcut service.
        const ownsActivation = activeElement.matches('button, [role="button"]') &&
            !event.ctrlKey && !event.metaKey && !event.altKey &&
            (event.key === 'Enter' || event.key === ' ' || event.key === 'Tab');
        return !ownsActivation;
    }

    /** The same binding the shortcut service derives, so the desktop items above match the same key presses. */
    private _getBinding(event: KeyboardEvent): number {
        const isMac = this._platformService.isMac;
        let binding = event.keyCode;
        if (event.shiftKey) {
            binding |= MetaKeys.SHIFT;
        }
        if (event.altKey) {
            binding |= MetaKeys.ALT;
        }
        if (isMac ? event.metaKey : event.ctrlKey) {
            binding |= MetaKeys.CTRL_COMMAND;
        }
        if (isMac && event.ctrlKey) {
            binding |= MetaKeys.MAC_CTRL;
        }
        return binding;
    }
}

function isImeProcessKey(event: KeyboardEvent): boolean {
    return event.key === 'Process' || event.keyCode === IME_PROCESS_KEY_CODE;
}

function isPrintableKey(event: KeyboardEvent): boolean {
    return !event.ctrlKey && !event.metaKey && !event.altKey && [...event.key].length === 1;
}
