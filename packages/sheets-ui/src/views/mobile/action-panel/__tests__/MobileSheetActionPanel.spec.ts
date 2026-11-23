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

// Modified by Carenode, 2026 — CNT-5176 mobile-edit-cell-visible: the reveal area, the scroll offset, the settle scheduler and the reveal of the edited cell in sheet units
// Modified by Carenode, 2026 — CNT-5176 mobile-edit-cell-host-scroll: the host page scroll offset, and the page scrolled once to make room before the sheet scrolls

import type { IWorkbookData, Workbook } from '@univerjs/core';
import type { IMenuSchema } from '@univerjs/ui';
import type { Root } from 'react-dom/client';
import {
    CommandType,
    FOCUSING_COMMON_DRAWINGS,
    getSheetsEmptySnapshot,
    ICommandService,
    IContextService,
    IPermissionService,
    IUniverInstanceService,
    LocaleService,
    LocaleType,
    Univer,
    UniverInstanceType,
} from '@univerjs/core';
import { IEditorService } from '@univerjs/docs-ui';
import { IRenderManagerService, RenderManagerService } from '@univerjs/engine-render';
import {
    getPrimaryForRange,
    RangeProtectionRuleModel,
    SheetsSelectionsService,
    WorkbookEditablePermission,
    WorksheetEditPermission,
    WorksheetSetCellValuePermission,
} from '@univerjs/sheets';
import {
    ComponentManager,
    IconManager,
    ILayoutService,
    IMenuManagerService,
    IRibbonService,
    MenuItemType,
    RediContext,
    RibbonInsertGroup,
    RibbonPosition,
    RibbonStartGroup,
} from '@univerjs/ui';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { BehaviorSubject, EMPTY } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { MobileNumberFormatItem } from '../MobileStylePanel';
import { SetScrollRelativeCommand } from '../../../../commands/commands/set-scroll.command';
import { SetCellEditVisibleOperation } from '../../../../commands/operations/cell-edit.operation';
import { MOBILE_KEYBOARD_VISIBLE } from '../../../../consts/mobile-context';
import enUS from '../../../../locale/en-US';
import { IEditorBridgeService } from '../../../../services/editor-bridge.service';
import {
    createMobileRevealScheduler,
    getMobileCellCenterOffset,
    getMobileCellRevealOffset,
    getMobileCellScrollOffset,
    getMobileHostScrollOffset,
    getMobileMenuCommand,
    MobileSheetActionPanel,
    normalizeMobileSelectionPrimary,
    resolveMobileCellRevealArea,
} from '../MobileSheetActionPanel';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true, writable: true });

const TEST_INSERT_MENU_ID = 'test.menu.insert-image';
const TEST_INSERT_COMMAND_ID = 'test.command.insert-image';
const TEST_NUMFMT_MENU_ID = 'test.menu.number-format';
const TEST_NUMFMT_COMMAND_ID = 'test.command.set-number-format';
const TEST_CUSTOM_NUMFMT_COMPONENT = 'test.component.custom-number-format';

function createNumberFormatRibbon(): IMenuSchema[] {
    const numberFormatItem: MobileNumberFormatItem = {
        id: TEST_NUMFMT_MENU_ID,
        type: MenuItemType.SELECTOR,
        title: 'Number format',
        selections: [],
        value$: new BehaviorSubject('General'),
        mobileNumberFormat: {
            kind: 'number-format',
            title: 'Number format',
            commandId: TEST_NUMFMT_COMMAND_ID,
            detailTitle: 'More formats',
            customTitle: 'Custom format',
            customComponent: TEST_CUSTOM_NUMFMT_COMPONENT,
            quickOptions: [],
            decimalOptions: [],
            detailOptions: [
                { label: 'General', value: null },
                { label: 'Custom format', custom: true },
            ],
            customPatterns: ['0.00'],
        },
    };

    return [{
        key: RibbonPosition.START,
        order: 0,
        children: [{
            key: RibbonStartGroup.NUMBER,
            order: 0,
            children: [{
                key: TEST_NUMFMT_MENU_ID,
                order: 0,
                item: numberFormatItem,
            }],
        }],
    }];
}

interface IPanelServiceOverrides {
    editorBridge?: IEditorBridgeService;
    renderManager?: IRenderManagerService;
}

async function renderMobileSheetActionPanel(ribbon: IMenuSchema[] = [], overrides: IPanelServiceOverrides = {}) {
    const univer = new Univer();
    const injector = univer.__getInjector();
    const contextService = injector.get(IContextService);

    injector.get(LocaleService).load({ [LocaleType.EN_US]: enUS });
    injector.get(LocaleService).setLocale(LocaleType.EN_US);
    injector.get(LocaleService).setDirection('ltr');
    const workbook = univer.createUnit<IWorkbookData, Workbook>(
        UniverInstanceType.UNIVER_SHEET,
        getSheetsEmptySnapshot('mobile-sheet')
    );
    injector.get(IUniverInstanceService).focusUnit('mobile-sheet');
    injector.add([IEditorBridgeService, {
        useValue: overrides.editorBridge ?? {
            visible$: new BehaviorSubject({ visible: false }),
            getEditCellState: () => null,
            refreshEditCellPosition: vi.fn(),
        } as unknown as IEditorBridgeService,
    }]);
    injector.add([IEditorService, { useValue: { focus: vi.fn() } as unknown as IEditorService }]);
    injector.add([ILayoutService, { useValue: { focus: vi.fn() } as unknown as ILayoutService }]);
    if (overrides.renderManager) {
        injector.add([IRenderManagerService, { useValue: overrides.renderManager }]);
    } else {
        injector.add([IRenderManagerService, { useClass: RenderManagerService }]);
    }
    injector.add([ComponentManager]);
    injector.add([IconManager]);
    injector.add([IMenuManagerService, {
        useValue: {
            menuChanged$: EMPTY,
            getMenuByPositionKey: () => [],
        } as unknown as IMenuManagerService,
    }]);
    injector.add([IRibbonService, {
        useValue: { ribbon$: new BehaviorSubject(ribbon) } as unknown as IRibbonService,
    }]);
    injector.add([SheetsSelectionsService]);
    injector.add([RangeProtectionRuleModel]);
    const worksheet = workbook.getActiveSheet();
    const range = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };
    injector.get(SheetsSelectionsService).setSelections([{
        range,
        primary: getPrimaryForRange(range, worksheet),
        style: null,
    }]);
    const permissions = injector.get(IPermissionService);
    const subUnitId = worksheet.getSheetId();
    [
        new WorkbookEditablePermission(workbook.getUnitId()),
        new WorksheetEditPermission(workbook.getUnitId(), subUnitId),
        new WorksheetSetCellValuePermission(workbook.getUnitId(), subUnitId),
    ].forEach((permission) => permissions.addPermissionPoint(permission));

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(createElement(
            RediContext.Provider,
            { value: { injector } },
            createElement(MobileSheetActionPanel)
        ));
    });

    return { commandService: injector.get(ICommandService), container, contextService, permissions, root, subUnitId, univer, workbook };
}

function clickButton(container: HTMLElement, name: string) {
    const button = Array.from(container.querySelectorAll('button')).find((item) =>
        item.getAttribute('aria-label') === name || item.textContent?.includes(name));
    if (!button) {
        throw new Error(`Button "${name}" was not rendered.`);
    }

    act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function clickCommand(container: HTMLElement, commandId: string) {
    const button = container.querySelector(`[data-u-command="${commandId}"]`);
    if (!button) {
        throw new Error(`Command "${commandId}" was not rendered.`);
    }

    act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function disposeRenderedPanel(root: Root, container: HTMLElement, univer: Univer) {
    act(() => root.unmount());
    container.remove();
    univer.dispose();
}

describe('mobile sheet action panel visibility', () => {
    it('disables both keyboard entrances when cell editing is forbidden', async () => {
        const { commandService, container, permissions, root, subUnitId, univer } = await renderMobileSheetActionPanel();
        const startEditing = vi.fn(() => true);
        commandService.registerCommand({ ...SetCellEditVisibleOperation, handler: startEditing });
        const keyboard = () => container.querySelector<HTMLButtonElement>(
            'button[aria-label="Start Editing (Selection into the Editor)"]'
        )!;
        try {
            expect(keyboard().disabled).toBe(false);
            act(() => permissions.updatePermissionPoint(new WorkbookEditablePermission('mobile-sheet').id, false));
            expect(keyboard().disabled).toBe(true);
            act(() => keyboard().click());
            expect(startEditing).not.toHaveBeenCalled();
            clickButton(container, 'Open sheet tools');
            expect(keyboard().disabled).toBe(true);
            act(() => permissions.updatePermissionPoint(new WorkbookEditablePermission('mobile-sheet').id, true));
            expect(keyboard().disabled).toBe(false);
            act(() => permissions.updatePermissionPoint(new WorksheetSetCellValuePermission('mobile-sheet', subUnitId).id, false));
            expect(keyboard().disabled).toBe(true);
        } finally {
            disposeRenderedPanel(root, container, univer);
        }
    });

    it('keeps an exit available while a drawing owns touch gestures', async () => {
        const { container, contextService, root, univer } = await renderMobileSheetActionPanel();

        try {
            act(() => contextService.setContextValue(FOCUSING_COMMON_DRAWINGS, true));
            expect(container.querySelector('[aria-label="Open sheet tools"]')).toBeNull();
            clickButton(container, 'Back');
            expect(contextService.getContextValue(FOCUSING_COMMON_DRAWINGS)).toBe(false);
            expect(container.querySelector('[aria-label="Open sheet tools"]')).not.toBeNull();
        } finally {
            disposeRenderedPanel(root, container, univer);
        }
    });

    it('does not reopen the previous sheet drawer after drawing focus ends', async () => {
        const { container, contextService, root, univer } = await renderMobileSheetActionPanel();

        try {
            clickButton(container, 'Open sheet tools');
            expect(container.querySelector('[data-u-comp="mobile-sheet-action-panel"]')).not.toBeNull();

            act(() => contextService.setContextValue(FOCUSING_COMMON_DRAWINGS, true));
            expect(container.querySelector('[data-u-comp="mobile-sheet-action-panel"]')).toBeNull();

            act(() => contextService.setContextValue(FOCUSING_COMMON_DRAWINGS, false));
            expect(container.querySelector('[data-u-comp="mobile-sheet-action-panel"]')).toBeNull();
        } finally {
            disposeRenderedPanel(root, container, univer);
        }
    });

    it('closes the sheet drawer after executing a nested insert menu command', async () => {
        const execute = vi.fn(() => true);
        const ribbon: IMenuSchema[] = [{
            key: RibbonPosition.INSERT,
            order: 0,
            children: [{
                key: RibbonInsertGroup.MEDIA,
                order: 0,
                children: [{
                    key: TEST_INSERT_MENU_ID,
                    order: 0,
                    item: {
                        id: TEST_INSERT_MENU_ID,
                        type: MenuItemType.SUBITEMS,
                        title: 'Insert image',
                    },
                    children: [{
                        key: TEST_INSERT_COMMAND_ID,
                        order: 0,
                        item: {
                            id: TEST_INSERT_COMMAND_ID,
                            type: MenuItemType.BUTTON,
                            title: 'Floating image',
                        },
                    }],
                }],
            }],
        }];
        const { commandService, container, root, univer } = await renderMobileSheetActionPanel(ribbon);
        commandService.registerCommand({
            id: TEST_INSERT_COMMAND_ID,
            type: CommandType.COMMAND,
            handler: execute,
        });

        try {
            clickButton(container, 'Open sheet tools');
            clickCommand(container, TEST_INSERT_MENU_ID);
            expect(container.querySelector('[data-u-comp="mobile-sheet-action-panel"]')).not.toBeNull();

            clickCommand(container, TEST_INSERT_COMMAND_ID);

            expect(execute).toHaveBeenCalledOnce();
            expect(container.querySelector('[data-u-comp="mobile-sheet-action-panel"]')).toBeNull();
        } finally {
            disposeRenderedPanel(root, container, univer);
        }
    });

    it('closes the sheet drawer after selecting a detailed number format', async () => {
        const execute = vi.fn(() => true);
        const { commandService, container, root, univer } = await renderMobileSheetActionPanel(createNumberFormatRibbon());
        commandService.registerCommand({
            id: TEST_NUMFMT_COMMAND_ID,
            type: CommandType.COMMAND,
            handler: execute,
        });

        try {
            clickButton(container, 'Open sheet tools');
            clickButton(container, 'Style');
            clickButton(container, 'More formats');
            clickButton(container, 'General');

            expect(execute).toHaveBeenCalledOnce();
            expect(container.querySelector('[data-u-comp="mobile-sheet-action-panel"]')).toBeNull();
        } finally {
            disposeRenderedPanel(root, container, univer);
        }
    });

    it('closes the sheet drawer after confirming a custom number format', async () => {
        const execute = vi.fn(() => true);
        const { commandService, container, root, univer } = await renderMobileSheetActionPanel(createNumberFormatRibbon());
        commandService.registerCommand({
            id: TEST_NUMFMT_COMMAND_ID,
            type: CommandType.COMMAND,
            handler: execute,
        });
        univer.__getInjector().get(ComponentManager).register(
            TEST_CUSTOM_NUMFMT_COMPONENT,
            (props: { onConfirm: (pattern: string) => void }) => createElement('button', {
                type: 'button',
                'aria-label': 'Confirm custom format',
                onClick: () => props.onConfirm('0.00'),
            })
        );

        try {
            clickButton(container, 'Open sheet tools');
            clickButton(container, 'Style');
            clickButton(container, 'More formats');
            clickButton(container, 'Custom format');
            clickButton(container, 'Confirm custom format');

            expect(execute).toHaveBeenCalledOnce();
            expect(container.querySelector('[data-u-comp="mobile-sheet-action-panel"]')).toBeNull();
        } finally {
            disposeRenderedPanel(root, container, univer);
        }
    });
});

describe('mobile active-cell reveal offset', () => {
    it('moves only the distance outside the padded visible area', () => {
        expect(getMobileCellRevealOffset(100, 130, 80, 500)).toBe(0);
        expect(getMobileCellRevealOffset(60, 90, 80, 500)).toBe(-20);
        expect(getMobileCellRevealOffset(490, 530, 80, 500)).toBe(30);
    });

    it('centers the active cell in the area above the software keyboard', () => {
        expect(getMobileCellCenterOffset(100, 140, 80, 500)).toBe(-170);
        expect(getMobileCellCenterOffset(280, 320, 80, 520)).toBe(0);
        expect(getMobileCellCenterOffset(460, 500, 80, 520)).toBe(180);
    });
});

describe('mobile edited-cell reveal area', () => {
    it('starts below the column header and the frozen rows, not at the canvas top', () => {
        const visibleWindow = { top: 0, bottom: 504 };
        expect(resolveMobileCellRevealArea({
            canvas: { top: 190, bottom: 433 },
            mainViewportTop: 115,
            clips: [visibleWindow],
            coverTops: [386],
        })).toEqual({ top: 305, bottom: 386 });
        expect(resolveMobileCellRevealArea({
            canvas: { top: 190, bottom: 433 },
            mainViewportTop: 25,
            clips: [visibleWindow],
            coverTops: [386],
        })).toEqual({ top: 215, bottom: 386 });
    });

    it('ends at the host box when the box ends above the visible window', () => {
        expect(resolveMobileCellRevealArea({
            canvas: { top: 190, bottom: 773 },
            mainViewportTop: 25,
            clips: [{ top: 101, bottom: 434 }, { top: 0, bottom: 504 }],
            coverTops: [],
        })).toEqual({ top: 215, bottom: 434 });
        expect(resolveMobileCellRevealArea({
            canvas: { top: 190, bottom: 773 },
            mainViewportTop: 25,
            clips: [{ top: 101, bottom: 434 }, { top: 0, bottom: 504 }],
            coverTops: [386],
        })).toEqual({ top: 215, bottom: 386 });
    });

    it('starts below the top of the visible window when the window is scrolled past the canvas top', () => {
        expect(resolveMobileCellRevealArea({
            canvas: { top: 190, bottom: 773 },
            mainViewportTop: 25,
            clips: [{ top: 250, bottom: 600 }],
            coverTops: [550],
        })).toEqual({ top: 250, bottom: 550 });
    });

    it('does not bound the area by a cover that starts above it (an input bar opened full screen)', () => {
        expect(resolveMobileCellRevealArea({
            canvas: { top: 190, bottom: 773 },
            mainViewportTop: 25,
            clips: [{ top: 0, bottom: 844 }],
            coverTops: [0],
        })).toEqual({ top: 215, bottom: 773 });
    });
});

describe('mobile edited-cell scroll offset', () => {
    const area = { top: 305, bottom: 386 };

    it('does not scroll a cell that is already all inside, with or without the keyboard', () => {
        expect(getMobileCellScrollOffset({ top: 320, bottom: 350 }, area, true)).toBe(0);
        expect(getMobileCellScrollOffset({ top: 320, bottom: 350 }, area, false)).toBe(0);
        expect(getMobileCellScrollOffset({ top: 305, bottom: 335 }, area, true)).toBe(0);
        expect(getMobileCellScrollOffset({ top: 356, bottom: 386.4 }, area, true)).toBe(0);
    });

    it('centers a hidden cell between the band and the cover while the keyboard is up', () => {
        expect(getMobileCellScrollOffset({ top: 575, bottom: 605 }, area, true)).toBe(244.5);
        expect(getMobileCellScrollOffset({ top: 241, bottom: 271 }, area, true)).toBe(-89.5);
    });

    it('moves a hidden cell just inside, kept off the edge by the safe padding when the area has room', () => {
        const tall = { top: 215, bottom: 686 };
        expect(getMobileCellScrollOffset({ top: 700, bottom: 730 }, tall, false)).toBe(92);
        expect(getMobileCellScrollOffset({ top: 180, bottom: 210 }, tall, false)).toBe(-83);
        // ^ 81px of area: 25.5px each side, not 48
        expect(getMobileCellScrollOffset({ top: 400, bottom: 430 }, area, false)).toBe(69.5);
    });

    it('puts the top of the cell at the area top when the area is lower than the cell', () => {
        const low = { top: 305, bottom: 325 };
        expect(getMobileCellScrollOffset({ top: 400, bottom: 430 }, low, true)).toBe(95);
        expect(getMobileCellScrollOffset({ top: 250, bottom: 280 }, low, false)).toBe(-55);
        expect(getMobileCellScrollOffset({ top: 305.2, bottom: 335.2 }, low, true)).toBe(0);
    });

    it('leaves an area with no height alone', () => {
        expect(getMobileCellScrollOffset({ top: 575, bottom: 605 }, { top: 386, bottom: 386 }, true)).toBe(0);
        expect(getMobileCellScrollOffset({ top: 575, bottom: 605 }, { top: 386, bottom: 300 }, false)).toBe(0);
    });
});

describe('mobile host page scroll offset', () => {
    // ^ a tablet with the on-screen keyboard up, the editor's box low in a page below a 49px host header: the band is at
    //   900 and the input bar is held at 792
    const moving = { top: 900, bottom: 1638 };
    const fixed = { top: 49, bottom: 792 };

    it('makes room for the cell and the safe padding when the band reaches below the input bar', () => {
        expect(getMobileHostScrollOffset({ cellHeight: 30, moving, fixed })).toBe(234);
        // ^ the customer measurement: the band at 804 over the input bar at 792, a 22px cell
        expect(getMobileHostScrollOffset({ cellHeight: 22, moving: { top: 804, bottom: 1650 }, fixed })).toBe(130);
    });

    it('does not move the page when the area already holds the cell', () => {
        expect(getMobileHostScrollOffset({ cellHeight: 30, moving: { top: 622, bottom: 1360 }, fixed })).toBe(0);
        expect(getMobileHostScrollOffset({ cellHeight: 30, moving: { top: 762, bottom: 1638 }, fixed })).toBe(0);
    });

    it('keeps less padding when the room is short, and does not take the band above the fixed top', () => {
        // ^ 92px between a host bar and the input bar: 31px each side of a 30px cell
        expect(getMobileHostScrollOffset({ cellHeight: 30, moving, fixed: { top: 700, bottom: 792 } })).toBe(200);
        // ^ less room than the cell: all there is
        expect(getMobileHostScrollOffset({ cellHeight: 30, moving, fixed: { top: 780, bottom: 792 } })).toBe(120);
    });

    it('does not move the page when no scroll can make room', () => {
        // ^ 20px of rows in a box that ends above the input bar: a scroll moves its bottom up with the band
        expect(getMobileHostScrollOffset({ cellHeight: 30, moving: { top: 700, bottom: 720 }, fixed })).toBe(0);
        // ^ the band is already above the top of the page
        expect(getMobileHostScrollOffset({ cellHeight: 30, moving: { top: 40, bottom: 1638 }, fixed: { top: 49, bottom: 60 } })).toBe(0);
    });
});

function createFrames() {
    const queue = new Map<number, () => void>();
    let next = 1;
    return {
        requestFrame: (callback: () => void) => {
            const handle = next++;
            queue.set(handle, callback);
            return handle;
        },
        cancelFrame: (handle: number) => {
            queue.delete(handle);
        },
        run() {
            const callbacks = [...queue.values()];
            queue.clear();
            callbacks.forEach((callback) => callback());
        },
        get pending() {
            return queue.size;
        },
    };
}

describe('mobile reveal scheduler', () => {
    it('reveals once, on the first frame whose layout is the one of the frame before', () => {
        const frames = createFrames();
        const layouts = ['window shorter', 'box shorter', 'box shorter'];
        const reveal = vi.fn();
        const scheduler = createMobileRevealScheduler({ ...frames, readLayout: () => layouts.shift() ?? 'box shorter', reveal });

        scheduler.schedule();
        frames.run();
        frames.run();
        expect(reveal).not.toHaveBeenCalled();
        frames.run();
        expect(reveal).toHaveBeenCalledTimes(1);
        expect(frames.pending).toBe(0);
    });

    it('waits again when a change arrives while it waits, and still reveals once', () => {
        const frames = createFrames();
        const reveal = vi.fn();
        const scheduler = createMobileRevealScheduler({ ...frames, readLayout: () => 'same', reveal });

        scheduler.schedule();
        scheduler.schedule();
        expect(frames.pending).toBe(1);
        frames.run();
        scheduler.schedule();
        frames.run();
        expect(reveal).not.toHaveBeenCalled();
        frames.run();
        expect(reveal).toHaveBeenCalledTimes(1);
        expect(frames.pending).toBe(0);
    });

    it('reveals after a capped wait when the layout keeps moving', () => {
        const frames = createFrames();
        let frame = 0;
        const reveal = vi.fn();
        const scheduler = createMobileRevealScheduler({ ...frames, readLayout: () => String(frame++), reveal });

        scheduler.schedule();
        for (let i = 0; i < 29; i++) frames.run();
        expect(reveal).not.toHaveBeenCalled();
        frames.run();
        expect(reveal).toHaveBeenCalledTimes(1);
        expect(frames.pending).toBe(0);
    });

    it('drops a pending reveal when disposed', () => {
        const frames = createFrames();
        const reveal = vi.fn();
        const scheduler = createMobileRevealScheduler({ ...frames, readLayout: () => 'same', reveal });

        scheduler.schedule();
        frames.run();
        scheduler.dispose();
        expect(frames.pending).toBe(0);
        expect(reveal).not.toHaveBeenCalled();
    });
});

interface IRevealScreen {
    canvas: { top: number; bottom: number };
    inputBarTop: number;
}

async function renderEditingPanel(options: { row: number; startY: number; endY: number; screen: IRevealScreen }) {
    const frames = createFrames();
    vi.stubGlobal('requestAnimationFrame', frames.requestFrame);
    vi.stubGlobal('cancelAnimationFrame', frames.cancelFrame);

    const screen = options.screen;
    const appLayout = document.createElement('div');
    appLayout.setAttribute('data-u-comp', 'app-layout');
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ top: screen.canvas.top, bottom: screen.canvas.bottom } as DOMRect);
    const inputBar = document.createElement('div');
    inputBar.setAttribute('data-u-comp', 'mobile-formula-bar');
    inputBar.getBoundingClientRect = () => ({ top: screen.inputBarTop, bottom: screen.inputBarTop + 48 } as DOMRect);
    appLayout.append(canvas, inputBar);
    document.body.appendChild(appLayout);

    // ^ the main viewport starts below a 25px column header and three 30px frozen rows (screen pixels)
    const viewMain = { top: 115, viewportScrollY: 0 };
    const renderUnit = {
        engine: { getCanvasElement: () => canvas },
        scene: { getViewport: () => viewMain },
    };
    const state = {
        unitId: 'mobile-sheet',
        sheetId: '',
        row: options.row,
        column: 0,
        position: { startX: 46, endX: 146, startY: options.startY, endY: options.endY },
        canvasOffset: { left: 0, top: screen.canvas.top },
        scaleX: 1.25,
        scaleY: 1.25,
    };
    const rendered = await renderMobileSheetActionPanel([], {
        editorBridge: {
            visible$: new BehaviorSubject({ visible: true }),
            getEditCellState: () => state,
            refreshEditCellPosition: vi.fn(),
        } as unknown as IEditorBridgeService,
        renderManager: { getRenderUnitById: () => renderUnit } as unknown as IRenderManagerService,
    });
    state.sheetId = rendered.subUnitId;
    const scroll = vi.fn((_accessor: unknown, _params?: { offsetY?: number }) => true);
    rendered.commandService.registerCommand({ id: SetScrollRelativeCommand.id, type: CommandType.COMMAND, handler: scroll });

    async function settle() {
        for (let i = 0; i < 40 && frames.pending > 0; i++) {
            await act(async () => frames.run());
        }
        // ^ the scroll command runs after the command service's own awaits
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }

    function dispose() {
        disposeRenderedPanel(rendered.root, rendered.container, rendered.univer);
        appLayout.remove();
        vi.unstubAllGlobals();
    }

    return { ...rendered, frames, screen, scroll, settle, dispose };
}

describe('mobile edited-cell reveal on the screen', () => {
    it('scrolls a hidden edited cell in between the frozen band and the input bar, in sheet units', async () => {
        // ^ the window got shorter: the canvas spans 190..433 and the input bar starts at 386, the cell is at 575..605
        const panel = await renderEditingPanel({
            row: 13,
            startY: 385,
            endY: 415,
            screen: { canvas: { top: 190, bottom: 433 }, inputBarTop: 386 },
        });
        try {
            act(() => panel.contextService.setContextValue(MOBILE_KEYBOARD_VISIBLE, true));
            await panel.settle();
            expect(panel.scroll).toHaveBeenCalledTimes(1);
            // ^ 244.5 screen pixels at zoom 1.25: the cell's middle lands in the middle of 305..386
            expect(panel.scroll.mock.calls[0][1]).toEqual({ offsetY: 195.6 });
        } finally {
            panel.dispose();
        }
    });

    it('does not scroll when the edited cell is already all inside', async () => {
        const panel = await renderEditingPanel({
            row: 6,
            startY: 130,
            endY: 160,
            screen: { canvas: { top: 190, bottom: 433 }, inputBarTop: 386 },
        });
        try {
            act(() => panel.contextService.setContextValue(MOBILE_KEYBOARD_VISIBLE, true));
            await panel.settle();
            expect(panel.scroll).not.toHaveBeenCalled();
        } finally {
            panel.dispose();
        }
    });

    it('leaves a cell in the frozen rows alone', async () => {
        // ^ the first frozen row, just below the 25px column header: above the main viewport, and no scroll moves it
        const panel = await renderEditingPanel({
            row: 0,
            startY: 25,
            endY: 55,
            screen: { canvas: { top: 190, bottom: 433 }, inputBarTop: 386 },
        });
        try {
            panel.workbook.getActiveSheet().getConfig().freeze = { xSplit: 0, ySplit: 4, startRow: 4, startColumn: -1 };
            await panel.settle();
            expect(panel.scroll).not.toHaveBeenCalled();
        } finally {
            panel.dispose();
        }
    });

    it('measures once the layout has stopped moving, and scrolls once', async () => {
        // ^ the first frame still shows the tall canvas, where the cell is inside; the host shrinks the box after it
        const panel = await renderEditingPanel({
            row: 13,
            startY: 385,
            endY: 415,
            screen: { canvas: { top: 190, bottom: 773 }, inputBarTop: 726 },
        });
        try {
            act(() => panel.contextService.setContextValue(MOBILE_KEYBOARD_VISIBLE, true));
            await act(async () => panel.frames.run());
            panel.screen.canvas.bottom = 433;
            panel.screen.inputBarTop = 386;
            await panel.settle();
            expect(panel.scroll).toHaveBeenCalledTimes(1);
            expect(panel.scroll.mock.calls[0][1]).toEqual({ offsetY: 195.6 });
        } finally {
            panel.dispose();
        }
    });
});

interface IHostPage {
    windowHeight: number;
    /** The editor's box with nothing scrolled; the canvas fills it from `canvasTop`. */
    box: { top: number; bottom: number };
    canvasTop: number;
    /** How far the page — below a 49px host header, down to the window bottom — can scroll. */
    pageMax: number;
    /** A scroll box between the page and the editor's box (2000px tall), and how far it can scroll. */
    innerMax?: number;
    /** `held`: the input bar is drawn at the bottom of the window; `left-behind`: where a page scroll left it. */
    inputBar: 'held' | 'left-behind';
    /** The host puts its page back on the frame after it is scrolled. */
    snapBack?: boolean;
}

/** An element that scrolls up to `max`, recording what it is asked to scroll to. */
function createScrollBox(max: number, clientHeight: number, onSet?: (value: number) => void): HTMLElement {
    const element = document.createElement('div');
    element.style.overflowY = 'auto';
    let scrollTop = 0;
    Object.defineProperties(element, {
        clientHeight: { configurable: true, value: clientHeight },
        scrollHeight: { configurable: true, value: clientHeight + max },
        scrollTop: {
            configurable: true,
            get: () => scrollTop,
            set: (value: number) => {
                scrollTop = Math.min(max, Math.max(0, value));
                onSet?.(value);
            },
        },
    });
    return element;
}

async function renderHostPageEditingPanel(options: { startY: number; endY: number; host: IHostPage }) {
    const frames = createFrames();
    vi.stubGlobal('requestAnimationFrame', frames.requestFrame);
    vi.stubGlobal('cancelAnimationFrame', frames.cancelFrame);
    const host = options.host;
    const viewport = Object.assign(new EventTarget(), { offsetTop: 0, height: host.windowHeight });
    vi.stubGlobal('visualViewport', viewport);
    vi.stubGlobal('innerHeight', host.windowHeight);

    const pageScrolls: number[] = [];
    const page: HTMLElement = createScrollBox(host.pageMax, host.windowHeight - 49, (value) => {
        pageScrolls.push(value);
        if (host.snapBack && value !== 0) {
            frames.requestFrame(() => {
                page.scrollTop = 0;
            });
        }
    });
    page.getBoundingClientRect = () => ({ top: 49, bottom: viewport.height } as DOMRect);
    const inner = host.innerMax == null ? null : createScrollBox(host.innerMax, 2000);
    if (inner) inner.getBoundingClientRect = () => ({ top: 49 - page.scrollTop, bottom: 2049 - page.scrollTop } as DOMRect);
    const scrolled = () => page.scrollTop + (inner?.scrollTop ?? 0);
    const box = document.createElement('div');
    box.style.overflowY = 'hidden';
    box.getBoundingClientRect = () => ({ top: host.box.top - scrolled(), bottom: host.box.bottom - scrolled() } as DOMRect);
    const appLayout = document.createElement('div');
    appLayout.setAttribute('data-u-comp', 'app-layout');
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ top: host.canvasTop - scrolled(), bottom: host.box.bottom - scrolled() } as DOMRect);
    const inputBar = document.createElement('div');
    inputBar.setAttribute('data-u-comp', 'mobile-formula-bar');
    Object.defineProperty(inputBar, 'offsetParent', { configurable: true, get: () => box });
    inputBar.getBoundingClientRect = () => {
        const bottom = host.inputBar === 'held'
            ? Math.min(host.box.bottom - scrolled(), viewport.height)
            : Math.min(host.box.bottom, host.windowHeight) - scrolled();
        return { top: bottom - 48, bottom, height: 48 } as DOMRect;
    };
    appLayout.append(canvas, inputBar);
    box.appendChild(appLayout);
    if (inner) {
        inner.appendChild(box);
        page.appendChild(inner);
    } else {
        page.appendChild(box);
    }
    document.body.appendChild(page);

    // ^ the main viewport starts below a 25px column header, with no frozen rows
    const viewMain = { top: 25, viewportScrollY: 0 };
    const renderUnit = {
        engine: { getCanvasElement: () => canvas },
        scene: { getViewport: () => viewMain },
    };
    const state = {
        unitId: 'mobile-sheet',
        sheetId: '',
        row: 13,
        column: 0,
        position: { startX: 46, endX: 146, startY: options.startY, endY: options.endY },
        canvasOffset: { left: 0, top: host.canvasTop },
        scaleX: 1.25,
        scaleY: 1.25,
    };
    const rendered = await renderMobileSheetActionPanel([], {
        editorBridge: {
            visible$: new BehaviorSubject({ visible: true }),
            getEditCellState: () => state,
            refreshEditCellPosition: vi.fn(),
        } as unknown as IEditorBridgeService,
        renderManager: { getRenderUnitById: () => renderUnit } as unknown as IRenderManagerService,
    });
    state.sheetId = rendered.subUnitId;
    act(() => rendered.contextService.setContextValue(MOBILE_KEYBOARD_VISIBLE, true));
    const scroll = vi.fn((_accessor: unknown, _params?: { offsetY?: number }) => true);
    rendered.commandService.registerCommand({ id: SetScrollRelativeCommand.id, type: CommandType.COMMAND, handler: scroll });

    async function settle() {
        for (let i = 0; i < 40 && frames.pending > 0; i++) {
            await act(async () => frames.run());
        }
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }

    function resizeWindow(height: number) {
        viewport.height = height;
        vi.stubGlobal('innerHeight', height);
        act(() => {
            viewport.dispatchEvent(new Event('resize'));
        });
    }

    function dispose() {
        disposeRenderedPanel(rendered.root, rendered.container, rendered.univer);
        page.remove();
        vi.unstubAllGlobals();
    }

    return { ...rendered, frames, inner, page, pageScrolls, resizeWindow, scroll, settle, dispose };
}

describe('mobile edited-cell reveal in a host page that scrolls', () => {
    // ^ a tablet with the on-screen keyboard up (the window is 840 tall): the editor's 900px box starts at 786, its
    //   canvas at 875 and the band at 900, below the input bar held at 792; the cell is at 1003..1033
    const low = { windowHeight: 840, box: { top: 786, bottom: 1686 }, canvasTop: 875, pageMax: 1276 };

    it('scrolls the page up just far enough for the cell and the padding, then scrolls the sheet once', async () => {
        const panel = await renderHostPageEditingPanel({ startY: 128, endY: 158, host: { ...low, inputBar: 'held' } });
        try {
            await panel.settle();
            // ^ the band goes to 666, 126px above the input bar: 30px of cell and 48px each side
            expect(panel.page.scrollTop).toBe(234);
            expect(panel.scroll).toHaveBeenCalledTimes(1);
            // ^ then the cell, at 769..799, is centred in 666..792: 55 screen pixels at zoom 1.25
            expect(panel.scroll.mock.calls[0][1]).toEqual({ offsetY: 44 });

            // the window comes back: the page is not scrolled back and the sheet does not scroll
            panel.resizeWindow(1180);
            await panel.settle();
            expect(panel.page.scrollTop).toBe(234);
            expect(panel.pageScrolls).toEqual([234]);
            expect(panel.scroll).toHaveBeenCalledTimes(1);
        } finally {
            panel.dispose();
        }
    });

    it('leaves the page alone when the area has room, and scrolls only the sheet', async () => {
        // ^ the box at 508: the band at 622, 170px above the input bar
        const panel = await renderHostPageEditingPanel({
            startY: 304,
            endY: 334,
            host: { windowHeight: 840, box: { top: 508, bottom: 1408 }, canvasTop: 597, pageMax: 1276, inputBar: 'held' },
        });
        try {
            await panel.settle();
            expect(panel.pageScrolls).toEqual([]);
            expect(panel.scroll).toHaveBeenCalledTimes(1);
            expect(panel.scroll.mock.calls[0][1]).toEqual({ offsetY: 167.2 });
        } finally {
            panel.dispose();
        }
    });

    it('scrolls the next scroll box out with what the nearest one could not give', async () => {
        const panel = await renderHostPageEditingPanel({ startY: 128, endY: 158, host: { ...low, innerMax: 100, inputBar: 'held' } });
        try {
            await panel.settle();
            expect(panel.inner!.scrollTop).toBe(100);
            expect(panel.page.scrollTop).toBe(134);
            expect(panel.scroll).toHaveBeenCalledTimes(1);
            expect(panel.scroll.mock.calls[0][1]).toEqual({ offsetY: 44 });
        } finally {
            panel.dispose();
        }
    });

    it('asks the page once for each change: a page that puts itself back is not asked again', async () => {
        const panel = await renderHostPageEditingPanel({ startY: 128, endY: 158, host: { ...low, inputBar: 'left-behind', snapBack: true } });
        try {
            await panel.settle();
            expect(panel.pageScrolls).toEqual([234, 0]);
            expect(panel.frames.pending).toBe(0);
            // ^ back where it was there is still no room, and the sheet has nothing to scroll into
            expect(panel.scroll).not.toHaveBeenCalled();
        } finally {
            panel.dispose();
        }
    });
});

describe('mobile style selection normalization', () => {
    it('restores the last selection primary before running shared style commands', () => {
        const selections = [
            {
                range: { startRow: 3, endRow: 4, startColumn: 2, endColumn: 5 },
                primary: null,
                style: null,
            },
        ];
        const worksheet = { getMergedCell: () => null };

        const normalized = normalizeMobileSelectionPrimary(selections, worksheet);

        expect(normalized?.[0].primary).toMatchObject({
            actualRow: 3,
            actualColumn: 2,
            startRow: 3,
            startColumn: 2,
        });
        expect(selections[0].primary).toBeNull();
    });

    it('keeps an existing primary unchanged', () => {
        const selections = [{
            range: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 },
            primary: {
                actualRow: 1,
                actualColumn: 1,
                startRow: 1,
                endRow: 1,
                startColumn: 1,
                endColumn: 1,
                isMerged: false,
                isMergedMainCell: false,
            },
            style: null,
        }];

        expect(normalizeMobileSelectionPrimary(selections, { getMergedCell: () => null })).toBeNull();
    });
});

describe('mobile menu command mapping', () => {
    it.each([
        {
            name: 'plain button command',
            input: { id: 'copy', params: { from: 'mobile' } },
            expected: { commandId: 'copy', commandParams: { from: 'mobile' } },
        },
        {
            name: 'explicit command alias',
            input: { id: 'menu.copy', commandId: 'sheet.copy', params: { from: 'mobile' } },
            expected: { commandId: 'sheet.copy', commandParams: { from: 'mobile' } },
        },
        {
            name: 'selector value',
            input: { id: 'align', commandId: 'set-align', value: 'center' },
            expected: { commandId: 'set-align', commandParams: { value: 'center' } },
        },
        {
            name: 'boolean style value',
            input: { id: 'set-bold', value: false },
            expected: { commandId: 'set-bold', commandParams: { value: false } },
        },
        {
            name: 'selector params factory',
            input: { id: 'set-format', value: undefined, params: (value?: string | number) => ({ pattern: value ?? 'general' }) },
            expected: { commandId: 'set-format', commandParams: { pattern: 'general' } },
        },
    ])('maps $name', ({ input, expected }) => {
        expect(getMobileMenuCommand(input)).toEqual(expected);
    });

    it('ignores a menu entry without an executable command id', () => {
        expect(getMobileMenuCommand({ id: undefined })).toBeNull();
    });
});
