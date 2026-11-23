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

// Modified by Carenode, 2026 — CNT-5176 mobile-edit-cell-visible: the edited cell is scrolled in between the frozen band and what covers the canvas from below, measured in place, in sheet units, once the layout has settled
// Modified by Carenode, 2026 — CNT-5176 mobile-edit-cell-host-scroll: when there is no room for the edited cell at all, the host page is scrolled just far enough to make it, once, before the sheet scrolls

import type { Worksheet } from '@univerjs/core';
import type { ISelectionWithStyle } from '@univerjs/sheets';
import type { IValueOption, MobileDrawerSnap } from '@univerjs/ui';
import {
    DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY,
    EDITOR_ACTIVATED,
    FOCUSING_COMMON_DRAWINGS,
    FOCUSING_FX_BAR_EDITOR,
    ICommandService,
    IContextService,
    Injector,
    IPermissionService,
    IUniverInstanceService,
    LocaleService,
    UniverInstanceType,
} from '@univerjs/core';
import { Button, clsx, resetButtonClassName, useMobileKeyboardViewportLayout } from '@univerjs/design';
import { IEditorService } from '@univerjs/docs-ui';
import { DeviceInputEventType, IRenderManagerService, SHEET_VIEWPORT_KEY } from '@univerjs/engine-render';
import { KeyboardIcon, MenuIcon, MoreLeftIcon } from '@univerjs/icons';
import {
    checkRangesEditablePermission,
    getPrimaryForRange,
    RangeProtectionRuleModel,
    SheetsSelectionsService,
    WorksheetSetCellValuePermission,
} from '@univerjs/sheets';
import {
    ContextMenuGroup,
    ContextMenuPosition,
    ILayoutService,
    IMenuManagerService,
    IRibbonService,
    MobileDrawer,
    MobileMenu,
    RibbonPosition,
    RibbonStartGroup,
    useConfigValue,
    useDependency,
    useObservable,
} from '@univerjs/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { map, merge, of, startWith } from 'rxjs';
import type { IUniverSheetsUIConfig } from '../../../config/config';
import type { LocaleKey } from '../../../locale/types';
import type { IMobileStyleCommand, MobileStyleView } from './MobileStylePanel';
import { ScrollCommand, SetScrollRelativeCommand } from '../../../commands/commands/set-scroll.command';
import { SetCellEditVisibleOperation } from '../../../commands/operations/cell-edit.operation';
import { SHEETS_UI_PLUGIN_CONFIG_KEY } from '../../../config/config';
import {
    MOBILE_FORMULA_OPERATOR_BAR_HEIGHT,
    MOBILE_FORMULA_OPERATORS_VISIBLE,
    MOBILE_KEYBOARD_VISIBLE,
} from '../../../consts/mobile-context';
import { IEditorBridgeService } from '../../../services/editor-bridge.service';
import { ISheetEmbedRuntimeFocusCoordinator } from '../../../services/sheet-embed-integration.service';
import { useActiveWorkbook } from '../../hook';
import { MobileStylePanel } from './MobileStylePanel';

type MobileSheetPanelTab = 'insert' | 'operation' | 'style';
type MobileMenuSource = 'insert' | 'data' | 'operation';

interface IMobileMenuNavigation {
    source: MobileMenuSource;
    title?: string;
    onBack: () => void;
}

interface IMobileSheetPanelTab {
    key: MobileSheetPanelTab;
    title: LocaleKey;
}

const MOBILE_SHEET_PANEL_TABS: IMobileSheetPanelTab[] = [
    { key: 'insert', title: 'sheets-ui.mobile.insert' },
    { key: 'operation', title: 'sheets-ui.mobile.operation' },
    { key: 'style', title: 'sheets-ui.mobile.style' },
];

const MOBILE_CELL_SAFE_PADDING = 48;

export function getMobileCellRevealOffset(cellTop: number, cellBottom: number, safeTop: number, safeBottom: number): number {
    if (cellTop < safeTop) return cellTop - safeTop;
    if (cellBottom > safeBottom) return cellBottom - safeBottom;
    return 0;
}

export function getMobileCellCenterOffset(cellTop: number, cellBottom: number, safeTop: number, safeBottom: number): number {
    return (cellTop + cellBottom - safeTop - safeBottom) / 2;
}

/** A vertical span in client (layout viewport) coordinates. */
export interface IMobileVerticalSpan {
    top: number;
    bottom: number;
}

export interface IMobileCellRevealAreaInput {
    /** The sheet canvas. */
    canvas: IMobileVerticalSpan;
    /** Where the main viewport starts below the column header and the frozen rows, in canvas pixels. */
    mainViewportTop: number;
    /** What cuts the canvas off: its clipping ancestors (the host's box among them) and the visible part of the window. */
    clips: IMobileVerticalSpan[];
    /** The top edges of what lies over the canvas from below: the input bar, an open tools panel. */
    coverTops: number[];
}

/**
 * Where the rows of the main viewport can be seen: below the column header and the frozen rows, above the highest of
 * the canvas bottom, the clipping box bottom, the visible window bottom and what covers the canvas from below. A cover
 * that starts at or above that top (an input bar opened full screen) hides the whole area and does not bound it.
 */
export function resolveMobileCellRevealArea(input: IMobileCellRevealAreaInput): IMobileVerticalSpan {
    let top = input.canvas.top + input.mainViewportTop;
    let bottom = input.canvas.bottom;
    for (const clip of input.clips) {
        top = Math.max(top, clip.top);
        bottom = Math.min(bottom, clip.bottom);
    }
    for (const coverTop of input.coverTops) {
        if (coverTop > top) {
            bottom = Math.min(bottom, coverTop);
        }
    }
    return { top, bottom };
}

// ^ below half a pixel the cell is where it should be: rounding of the canvas position, not a scroll to make
const MOBILE_CELL_REVEAL_TOLERANCE = 0.5;

/**
 * How far, in screen pixels, the sheet must scroll down (negative: up) to bring the whole cell into the area. Nothing
 * when it is already all inside — the screen does not jump. An area lower than the cell gets the cell's top; an area
 * with no height shows nothing, and no scroll can change that. Otherwise the cell is centred (`center`, while the
 * on-screen keyboard is up) or moved just inside, kept off the edge by the safe padding when the area has room for it.
 */
export function getMobileCellScrollOffset(cell: IMobileVerticalSpan, area: IMobileVerticalSpan, center: boolean): number {
    const cellHeight = cell.bottom - cell.top;
    const areaHeight = area.bottom - area.top;
    if (areaHeight <= 0) return 0;
    if (areaHeight < cellHeight) {
        const offset = cell.top - area.top;
        return Math.abs(offset) < MOBILE_CELL_REVEAL_TOLERANCE ? 0 : offset;
    }
    if (cell.top >= area.top - MOBILE_CELL_REVEAL_TOLERANCE && cell.bottom <= area.bottom + MOBILE_CELL_REVEAL_TOLERANCE) {
        return 0;
    }
    if (center) {
        return getMobileCellCenterOffset(cell.top, cell.bottom, area.top, area.bottom);
    }
    const inset = Math.min(MOBILE_CELL_SAFE_PADDING, (areaHeight - cellHeight) / 2);
    return getMobileCellRevealOffset(cell.top, cell.bottom, area.top + inset, area.bottom - inset);
}

export interface IMobileHostScrollInput {
    /** The edited cell's height on the screen. */
    cellHeight: number;
    /**
     * What a scroll of the host page moves with the canvas: the band at the top; the canvas, the boxes inside the
     * scrolled element and the input bar's place at the bottom of its box at the bottom.
     */
    moving: IMobileVerticalSpan;
    /** What stays where it is: the visible window, the scrolled element and the boxes around it, an input bar held at the window bottom. */
    fixed: IMobileVerticalSpan;
}

/**
 * How far, in screen pixels, a scroll of the host page must move the canvas up for the area — the part of `moving`
 * inside `fixed` — to hold the edited cell with the safe padding on both sides: less padding when the room is short, as
 * much as there is when the cell itself does not fit. Nothing when the area already holds the cell: the sheet's own
 * scroll can show it, and the page stays where it is. The area grows while the band rises toward the fixed top and the
 * moving bottom is still below the fixed bottom; a scroll past that gains nothing.
 */
export function getMobileHostScrollOffset({ cellHeight, moving, fixed }: IMobileHostScrollInput): number {
    const heightAt = (offset: number) =>
        Math.min(moving.bottom - offset, fixed.bottom) - Math.max(moving.top - offset, fixed.top);
    const height = heightAt(0);
    if (height >= cellHeight - MOBILE_CELL_REVEAL_TOLERANCE) return 0;

    const reach = Math.max(0, Math.min(moving.top - fixed.top, moving.bottom - fixed.bottom));
    const most = heightAt(reach);
    const wanted = most >= cellHeight
        ? cellHeight + 2 * Math.min(MOBILE_CELL_SAFE_PADDING, (most - cellHeight) / 2)
        : most;
    return Math.min(reach, Math.max(0, wanted - height));
}

// ^ a cap on the wait for a layout that keeps moving (an animation): about half a second at 60 frames a second
const MOBILE_REVEAL_MAX_SETTLE_FRAMES = 30;

export interface IMobileRevealScheduler {
    /** A change that may hide the cell: reveal it once the layout has settled. A change while waiting waits again. */
    schedule(): void;
    dispose(): void;
}

export interface IMobileRevealSchedulerOptions {
    requestFrame: (callback: () => void) => number;
    cancelFrame: (handle: number) => void;
    /** Everything the reveal reads, as one comparable value. */
    readLayout: () => string;
    reveal: () => void;
}

/**
 * Runs `reveal` once, on the first animation frame whose layout is the same as on the frame before. A host can resize
 * the editor's box a frame after the window, the workbench follows its box after layout and the canvas follows the
 * workbench, so a reveal on the first frame after a resize measured a layout that was about to change.
 */
export function createMobileRevealScheduler(options: IMobileRevealSchedulerOptions): IMobileRevealScheduler {
    let frame: number | null = null;
    let previousLayout: string | null = null;
    let frames = 0;

    const onFrame = () => {
        frame = null;
        frames += 1;
        const layout = options.readLayout();
        if (layout === previousLayout || frames >= MOBILE_REVEAL_MAX_SETTLE_FRAMES) {
            previousLayout = null;
            options.reveal();
            return;
        }
        previousLayout = layout;
        frame = options.requestFrame(onFrame);
    };

    return {
        schedule() {
            previousLayout = null;
            if (frame != null) {
                return;
            }
            frames = 0;
            frame = options.requestFrame(onFrame);
        },
        dispose() {
            if (frame != null) {
                options.cancelFrame(frame);
                frame = null;
            }
        },
    };
}

interface IMobileRevealMeasure {
    canvasTop: number;
    /** The main viewport's scroll, in sheet units: a scroll moves the cell with no change of the area. */
    scrollY: number;
    area: IMobileVerticalSpan;
}

function getMobileRevealLayoutKey(measured: IMobileRevealMeasure | null): string {
    return measured
        ? `${measured.canvasTop},${measured.scrollY},${measured.area.top},${measured.area.bottom}`
        : '';
}

const MOBILE_CLIPPING_OVERFLOW = new Set(['hidden', 'clip', 'auto', 'scroll']);

/** The canvas's clipping ancestors below the body and the visible part of the window, in client coordinates. */
function getMobileCanvasClips(canvas: HTMLElement): IMobileVerticalSpan[] {
    const clips: IMobileVerticalSpan[] = [];
    for (let element = canvas.parentElement; element && element !== document.body; element = element.parentElement) {
        if (MOBILE_CLIPPING_OVERFLOW.has(getComputedStyle(element).overflowY)) {
            const rect = element.getBoundingClientRect();
            clips.push({ top: rect.top, bottom: rect.bottom });
        }
    }
    clips.push(getMobileVisibleWindow());
    return clips;
}

/** The visible part of the window, in client coordinates. */
function getMobileVisibleWindow(): IMobileVerticalSpan {
    const visualViewport = window.visualViewport;
    return visualViewport
        ? { top: visualViewport.offsetTop, bottom: visualViewport.offsetTop + visualViewport.height }
        : { top: 0, bottom: window.innerHeight };
}

interface IMobileInputBar {
    element: HTMLElement;
    /** How far above the bar's box the formula operators reach (they sit on top of it, outside its box). */
    operatorBar: number;
}

function getMobileInputBar(canvas: HTMLElement, formulaOperatorsVisible: boolean): IMobileInputBar | null {
    const element = canvas.closest('[data-u-comp="app-layout"]')?.querySelector<HTMLElement>('[data-u-comp="mobile-formula-bar"]');
    return element
        ? { element, operatorBar: formulaOperatorsVisible ? MOBILE_FORMULA_OPERATOR_BAR_HEIGHT : 0 }
        : null;
}

/**
 * The elements a host page can move the canvas with, nearest first: its scrollable ancestors, then the document's
 * scrolling element. None past a fixed box, which no scroll around it moves.
 */
function getMobileHostScrollers(canvas: HTMLElement): HTMLElement[] {
    const scrollers: HTMLElement[] = [];
    for (let element = canvas.parentElement; element && element !== document.documentElement; element = element.parentElement) {
        const { overflowY, position } = getComputedStyle(element);
        if ((overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight) {
            scrollers.push(element);
        }
        if (position === 'fixed') return scrollers;
    }
    const page = document.scrollingElement;
    if (page instanceof HTMLElement && !scrollers.includes(page) && page.scrollHeight > page.clientHeight) {
        scrollers.push(page);
    }
    return scrollers;
}

/**
 * What a scroll of `scroller` moves with the canvas and what stays, for `getMobileHostScrollOffset`. The input bar's place
 * comes from its containing block and the visible window, not from where it is drawn: it is held at the bottom of the
 * visible window while it is lifted above the bottom of its block (the on-screen keyboard is up, or the block reaches
 * below the window while a cell is edited) and sits at that bottom otherwise, and a scroll of the page leaves it behind
 * until the mobile workbench measures again.
 */
function measureMobileHostScroll(
    canvas: HTMLElement,
    mainViewportTop: number,
    scroller: HTMLElement,
    inputBar: IMobileInputBar | null,
    cellHeight: number
): IMobileHostScrollInput {
    const canvasRect = canvas.getBoundingClientRect();
    const moving = { top: canvasRect.top + mainViewportTop, bottom: canvasRect.bottom };
    const visibleWindow = getMobileVisibleWindow();
    const fixed = { ...visibleWindow };
    for (let element = canvas.parentElement; element && element !== document.body; element = element.parentElement) {
        if (MOBILE_CLIPPING_OVERFLOW.has(getComputedStyle(element).overflowY)) {
            const rect = element.getBoundingClientRect();
            const span = element !== scroller && scroller.contains(element) ? moving : fixed;
            span.top = Math.max(span.top, rect.top);
            span.bottom = Math.min(span.bottom, rect.bottom);
        }
    }
    const block = inputBar?.element.offsetParent;
    if (inputBar && block) {
        const barRect = inputBar.element.getBoundingClientRect();
        const barHeight = barRect.height + inputBar.operatorBar;
        const blockBottom = block.getBoundingClientRect().bottom;
        moving.bottom = Math.min(moving.bottom, blockBottom - barHeight);
        if (barRect.bottom < blockBottom - MOBILE_CELL_REVEAL_TOLERANCE) {
            fixed.bottom = Math.min(fixed.bottom, visibleWindow.bottom - barHeight);
        }
    }
    return { cellHeight, moving, fixed };
}

export function getMobileEditingMenuBottomOffset(formulaOperatorsVisible: boolean): number {
    return 72 + (formulaOperatorsVisible ? MOBILE_FORMULA_OPERATOR_BAR_HEIGHT : 0);
}

export function normalizeMobileSelectionPrimary(
    selections: Readonly<ISelectionWithStyle[]>,
    worksheet: Pick<Worksheet, 'getMergedCell'>
): ISelectionWithStyle[] | null {
    const lastIndex = selections.length - 1;
    if (lastIndex < 0 || selections[lastIndex].primary) return null;

    return selections.map((selection, index) => ({
        range: { ...selection.range },
        primary: index === lastIndex
            ? getPrimaryForRange(selection.range, worksheet)
            : selection.primary ? { ...selection.primary } : null,
        style: selection.style ? { ...selection.style } : selection.style,
    }));
}

export function getMobileMenuCommand(params: IValueOption | IMobileStyleCommand): {
    commandId: string;
    commandParams?: Record<string, unknown>;
} | null {
    const commandId = ('commandId' in params ? params.commandId : undefined) ?? params.id;
    if (typeof commandId !== 'string') {
        return null;
    }

    if (!('params' in params)) {
        return {
            commandId,
            commandParams: typeof params.value === 'undefined' ? undefined : { value: params.value },
        };
    }

    const fallbackParams = typeof params.params === 'function'
        ? params.params(typeof params.value === 'string' || typeof params.value === 'number' ? params.value : undefined)
        : params.params;
    const commandParams = typeof params.value === 'undefined' ? fallbackParams : { value: params.value };

    return {
        commandId,
        commandParams,
    };
}

export function MobileSheetActionPanel() {
    const instances = useDependency(IUniverInstanceService);
    const injector = useDependency(Injector);
    const localeService = useDependency(LocaleService);
    const focusCoordinator = injector.has(ISheetEmbedRuntimeFocusCoordinator)
        ? injector.get(ISheetEmbedRuntimeFocusCoordinator)
        : undefined;
    const resolveChildOwnsTools = () => {
        const scope = focusCoordinator?.resolveActiveChildSessionRuntimeScope();
        return scope != null && scope.hostUnitId === instances.getCurrentUnitOfType(UniverInstanceType.UNIVER_SHEET)?.getUnitId() && scope.childType !== UniverInstanceType.UNIVER_SHEET;
    };
    const childOwnsTools = useObservable(
        () => focusCoordinator?.runtimeSessionChanged$.pipe(startWith(undefined), map(resolveChildOwnsTools)) ?? of(false),
        resolveChildOwnsTools(),
        false,
        [focusCoordinator, instances]
    );
    const contextService = useDependency(IContextService);
    const focusingDrawing = useObservable(
        () => contextService.subscribeContextValue$(FOCUSING_COMMON_DRAWINGS).pipe(map(Boolean)),
        Boolean(contextService.getContextValue(FOCUSING_COMMON_DRAWINGS)),
        false,
        [contextService]
    );

    function exitDrawingSelection() {
        const workbook = instances.getCurrentUnitOfType(UniverInstanceType.UNIVER_SHEET);
        const transformer = workbook
            ? injector.get(IRenderManagerService).getRenderUnitById(workbook.getUnitId())?.scene.getTransformer()
            : undefined;
        transformer?.finishTransform();
        transformer?.clearSelectedObjects();
        contextService.setContextValue(FOCUSING_COMMON_DRAWINGS, false);
    }

    if (childOwnsTools) {
        return null;
    }

    if (focusingDrawing) {
        return (
            <Button
                type="button"
                variant="primary"
                size="large"
                className="
                  univer-pointer-events-auto univer-absolute univer-bottom-14 univer-right-4 univer-z-50 univer-h-12
                  univer-rounded-full univer-px-4 univer-shadow-lg
                "
                style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
                onClick={exitDrawingSelection}
            >
                <MoreLeftIcon />
                {localeService.t<LocaleKey>('sheets-ui.mobile.back')}
            </Button>
        );
    }

    return <MobileSheetActionPanelContent />;
}

function MobileSheetActionPanelContent() {
    const workbook = useActiveWorkbook();
    const commandService = useDependency(ICommandService);
    const contextService = useDependency(IContextService);
    const editorBridgeService = useDependency(IEditorBridgeService);
    const editorService = useDependency(IEditorService);
    const layoutService = useDependency(ILayoutService);
    const localeService = useDependency(LocaleService);
    const menuManagerService = useDependency(IMenuManagerService);
    const ribbonService = useDependency(IRibbonService);
    const selectionManagerService = useDependency(SheetsSelectionsService);
    const injector = useDependency(Injector);
    const permissionService = useDependency(IPermissionService);
    const rangeProtectionRuleModel = useDependency(RangeProtectionRuleModel);
    const renderManagerService = useDependency(IRenderManagerService);
    const config = useConfigValue<IUniverSheetsUIConfig>(SHEETS_UI_PLUGIN_CONFIG_KEY);
    const editingDisabled = useObservable(
        () => merge(
            workbook?.activeSheet$ ?? [],
            selectionManagerService.selectionMoveEnd$,
            selectionManagerService.selectionSet$,
            permissionService.permissionPointUpdate$,
            rangeProtectionRuleModel.ruleChange$
        ).pipe(startWith(null), map(() => !canEditCell())),
        true,
        false,
        [workbook, selectionManagerService, permissionService, rangeProtectionRuleModel, injector, config?.disableEdit]
    );
    const ribbon = useObservable(ribbonService.ribbon$, []);
    const operationSchemas = useObservable(
        () => menuManagerService.menuChanged$.pipe(
            startWith(undefined),
            map(() => menuManagerService.getMenuByPositionKey(ContextMenuPosition.MAIN_AREA).filter((schema) =>
                schema.key === ContextMenuGroup.QUICK ||
                schema.key === ContextMenuGroup.LAYOUT
            ))
        ),
        [],
        false,
        [menuManagerService]
    );
    const editing = useObservable(
        () => editorBridgeService.visible$.pipe(map((state) => state.visible)),
        false,
        false,
        [editorBridgeService]
    );
    const formulaOperatorsVisible = useObservable(
        () => contextService.subscribeContextValue$(MOBILE_FORMULA_OPERATORS_VISIBLE).pipe(map(Boolean)),
        Boolean(contextService.getContextValue(MOBILE_FORMULA_OPERATORS_VISIBLE)),
        false,
        [contextService]
    );
    const [activeTab, setActiveTab] = useState<MobileSheetPanelTab>('insert');
    const [toolsOpen, setToolsOpen] = useState(false);
    const [drawerSnap, setDrawerSnap] = useState<MobileDrawerSnap>('compact');
    const [styleViewStack, setStyleViewStack] = useState<MobileStyleView[]>([]);
    const [menuNavigation, setMenuNavigation] = useState<IMobileMenuNavigation | null>(null);
    const [recentColors, setRecentColors] = useState<string[]>([]);
    const editingMenuRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const keyboardLayout = useMobileKeyboardViewportLayout(editingMenuRef);
    const currentStyleView = styleViewStack[styleViewStack.length - 1] ?? null;
    const nestedTitle = currentStyleView?.title ?? menuNavigation?.title;

    const insertSchemas = useMemo(
        () => ribbon.find((group) => group.key === RibbonPosition.INSERT)?.children?.flatMap((group) => group.children ?? []) ?? [],
        [ribbon]
    );
    const dataSchemas = useMemo(
        () => ribbon.find((group) => group.key === RibbonPosition.DATA)?.children?.flatMap((group) => group.children ?? []) ?? [],
        [ribbon]
    );
    const styleGroups = useMemo(() => {
        const startGroups = ribbon.find((group) => group.key === RibbonPosition.START)?.children ?? [];
        return startGroups.filter((group) =>
            group.key === RibbonStartGroup.FORMAT ||
            group.key === RibbonStartGroup.LAYOUT ||
            group.key === RibbonStartGroup.NUMBER
        );
    }, [ribbon]);
    const createNavigationHandler = useCallback((source: MobileMenuSource) => (
        navigation: { title?: string; onBack: () => void } | null
    ) => {
        setMenuNavigation((current) => navigation
            ? { ...navigation, source }
            : current?.source === source ? null : current);
    }, []);
    const handleInsertNavigation = useMemo(() => createNavigationHandler('insert'), [createNavigationHandler]);
    const handleDataNavigation = useMemo(() => createNavigationHandler('data'), [createNavigationHandler]);
    const handleOperationNavigation = useMemo(() => createNavigationHandler('operation'), [createNavigationHandler]);

    /**
     * The canvas top, the main viewport's scroll and where its rows can be seen now, all measured in place; nothing
     * when the sheet is not rendered. `cover` is an open tools panel.
     */
    const getSheetCanvas = useCallback(() => {
        const unitId = workbook?.getUnitId();
        const renderUnit = unitId ? renderManagerService.getRenderUnitById(unitId) : null;
        const canvas = renderUnit?.engine.getCanvasElement();
        const viewMain = renderUnit?.scene.getViewport(SHEET_VIEWPORT_KEY.VIEW_MAIN);
        return canvas && viewMain ? { canvas, mainViewportTop: viewMain.top, scrollY: viewMain.viewportScrollY } : null;
    }, [renderManagerService, workbook]);

    const measureRevealArea = useCallback((cover: HTMLElement | null): IMobileRevealMeasure | null => {
        const sheetCanvas = getSheetCanvas();
        if (!sheetCanvas) return null;
        const { canvas, mainViewportTop, scrollY } = sheetCanvas;

        const coverTops: number[] = [];
        const inputBar = getMobileInputBar(canvas, Boolean(contextService.getContextValue(MOBILE_FORMULA_OPERATORS_VISIBLE)));
        if (inputBar) {
            coverTops.push(inputBar.element.getBoundingClientRect().top - inputBar.operatorBar);
        }
        if (cover) {
            coverTops.push(cover.getBoundingClientRect().top);
        }
        const canvasRect = canvas.getBoundingClientRect();
        return {
            canvasTop: canvasRect.top,
            scrollY,
            area: resolveMobileCellRevealArea({
                canvas: { top: canvasRect.top, bottom: canvasRect.bottom },
                mainViewportTop,
                clips: getMobileCanvasClips(canvas),
                coverTops,
            }),
        };
    }, [contextService, getSheetCanvas]);

    /**
     * When the area has no room for the whole edited cell, scroll the host page — the nearest scrollable ancestor
     * first, the next one with what is still missing, the document last — just far enough to make room for it. Whether
     * the page moved. Not for a cell in the frozen rows: the area is where the rows below them can be seen.
     */
    const scrollHostForEditedCell = useCallback((): boolean => {
        editorBridgeService.refreshEditCellPosition(false);
        const state = editorBridgeService.getEditCellState();
        if (!state) return false;
        const freeze = workbook?.getSheetBySheetId(state.sheetId)?.getFreeze();
        if (freeze && freeze.ySplit > 0 && state.row < freeze.startRow) return false;
        const sheetCanvas = getSheetCanvas();
        if (!sheetCanvas) return false;
        const { canvas, mainViewportTop } = sheetCanvas;
        const inputBar = getMobileInputBar(canvas, Boolean(contextService.getContextValue(MOBILE_FORMULA_OPERATORS_VISIBLE)));
        // ^ an input bar opened to the whole screen leaves no room to make
        if (inputBar?.element.getAttribute('data-expanded') === 'true') return false;

        const cellHeight = state.position.endY - state.position.startY;
        let scrolled = false;
        for (const scroller of getMobileHostScrollers(canvas)) {
            const offset = getMobileHostScrollOffset(measureMobileHostScroll(canvas, mainViewportTop, scroller, inputBar, cellHeight));
            if (offset <= MOBILE_CELL_REVEAL_TOLERANCE) break;
            const before = scroller.scrollTop;
            scroller.scrollTop = before + offset;
            scrolled = scrolled || scroller.scrollTop !== before;
        }
        return scrolled;
    }, [contextService, editorBridgeService, getSheetCanvas, workbook]);

    const ensureActiveCellVisible = useCallback(async (cover: HTMLElement | null) => {
        editorBridgeService.refreshEditCellPosition(false);
        const state = editorBridgeService.getEditCellState();
        const selectionRange = selectionManagerService.getCurrentLastSelection()?.range;
        if (!state && !selectionRange) return;

        if (state) {
            const freeze = workbook?.getSheetBySheetId(state.sheetId)?.getFreeze();
            // ^ a cell in the frozen rows stays where it is when the sheet scrolls
            if (freeze && freeze.ySplit > 0 && state.row < freeze.startRow) return;
            const measured = measureRevealArea(cover);
            if (!measured) return;
            const offsetY = getMobileCellScrollOffset(
                { top: measured.canvasTop + state.position.startY, bottom: measured.canvasTop + state.position.endY },
                measured.area,
                Boolean(contextService.getContextValue(MOBILE_KEYBOARD_VISIBLE))
            );
            if (offsetY === 0) return;

            // ^ the offset is in screen pixels and the scroll is in sheet units, which the zoom scales
            await commandService.executeCommand(SetScrollRelativeCommand.id, { offsetY: offsetY / state.scaleY });
            editorBridgeService.refreshEditCellPosition(false);
            return;
        }

        const workbookModel = workbook;
        const sheet = workbookModel?.getActiveSheet();
        if (!workbookModel || !sheet || !selectionRange) return;
        const { ySplit } = sheet.getFreeze();
        await commandService.executeCommand(ScrollCommand.id, {
            unitId: workbookModel.getUnitId(),
            sheetId: sheet.getSheetId(),
            sheetViewStartRow: Math.max(0, selectionRange.startRow - ySplit),
            offsetY: 0,
        });
        editorBridgeService.refreshEditCellPosition(false);
    }, [commandService, contextService, editorBridgeService, measureRevealArea, selectionManagerService, workbook]);

    useEffect(() => {
        if (!editing) return undefined;

        // ^ one scheduler for every change of what can be seen, so changes that arrive together end in one scroll. After a
        //   scroll of the host page the layout is measured again and the sheet then scrolls as usual: the page is asked
        //   once for each reveal, and a page that did not give the room is not asked again.
        let afterHostScroll = false;
        const scheduler = createMobileRevealScheduler({
            requestFrame: (callback) => requestAnimationFrame(callback),
            cancelFrame: (handle) => cancelAnimationFrame(handle),
            readLayout: () => getMobileRevealLayoutKey(measureRevealArea(null)),
            reveal: () => {
                if (!afterHostScroll && scrollHostForEditedCell()) {
                    afterHostScroll = true;
                    scheduler.schedule();
                    return;
                }
                afterHostScroll = false;
                ensureActiveCellVisible(null).catch(() => undefined);
            },
        });
        const schedule = () => scheduler.schedule();
        schedule();
        // ^ the canvas follows the host's box, which can change with no window resize (a host panel above the editor)
        const canvas = getSheetCanvas()?.canvas;
        const canvasObserver = canvas && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
        if (canvas) canvasObserver?.observe(canvas);
        const visualViewport = window.visualViewport;
        visualViewport?.addEventListener('resize', schedule);
        const selectionSubscription = selectionManagerService.selectionMoveEnd$.subscribe(schedule);

        return () => {
            scheduler.dispose();
            canvasObserver?.disconnect();
            visualViewport?.removeEventListener('resize', schedule);
            selectionSubscription.unsubscribe();
        };
    }, [editing, ensureActiveCellVisible, getSheetCanvas, measureRevealArea, scrollHostForEditedCell, selectionManagerService]);

    useEffect(() => {
        if (!toolsOpen || drawerSnap === 'expanded') return undefined;

        const scheduler = createMobileRevealScheduler({
            requestFrame: (callback) => requestAnimationFrame(callback),
            cancelFrame: (handle) => cancelAnimationFrame(handle),
            readLayout: () => getMobileRevealLayoutKey(measureRevealArea(panelRef.current)),
            reveal: () => {
                ensureActiveCellVisible(panelRef.current).catch(() => undefined);
            },
        });
        scheduler.schedule();
        return () => scheduler.dispose();
    }, [drawerSnap, ensureActiveCellVisible, measureRevealArea, toolsOpen]);

    useEffect(() => {
        if (contentRef.current) contentRef.current.scrollTop = 0;
    }, [activeTab, menuNavigation?.title, styleViewStack.length]);

    if (!workbook) {
        return null;
    }

    function closeTools() {
        setToolsOpen(false);
        setDrawerSnap('compact');
        setStyleViewStack([]);
        setMenuNavigation(null);
    }

    async function openTools() {
        if (editing) {
            await commandService.executeCommand(SetCellEditVisibleOperation.id, {
                visible: false,
                eventType: DeviceInputEventType.PointerDown,
                unitId: workbook!.getUnitId(),
            });
        }
        contextService.setContextValue(EDITOR_ACTIVATED, false);
        contextService.setContextValue(FOCUSING_FX_BAR_EDITOR, false);
        ensureSelectionPrimary();
        setDrawerSnap('compact');
        setToolsOpen(true);
    }

    function ensureSelectionPrimary() {
        const selections = selectionManagerService.getCurrentSelections();
        const normalized = normalizeMobileSelectionPrimary(selections, workbook!.getActiveSheet());
        if (normalized) selectionManagerService.setSelections(normalized);
    }

    function openKeyboard() {
        if (!canEditCell()) {
            return;
        }

        closeTools();
        layoutService.focus();

        if (editing) {
            contextService.setContextValue(FOCUSING_FX_BAR_EDITOR, true);
            editorService.focus(DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY);
            return;
        }

        commandService.executeCommand(SetCellEditVisibleOperation.id, {
            visible: true,
            eventType: DeviceInputEventType.Dblclick,
            unitId: workbook!.getUnitId(),
        }).catch(() => undefined);
    }

    function canEditCell() {
        const worksheet = workbook?.getActiveSheet();
        const primary = selectionManagerService.getCurrentLastSelection()?.primary;
        if (config?.disableEdit || !workbook || !worksheet || !primary) {
            return false;
        }

        const unitId = workbook.getUnitId();
        const subUnitId = worksheet.getSheetId();
        return permissionService.getPermissionPoint(new WorksheetSetCellValuePermission(unitId, subUnitId).id)?.value === true
            && checkRangesEditablePermission(injector, unitId, subUnitId, [{
                startRow: primary.actualRow,
                endRow: primary.actualRow,
                startColumn: primary.actualColumn,
                endColumn: primary.actualColumn,
            }]);
    }

    function executeMenuItem(params: IValueOption | IMobileStyleCommand): boolean {
        const command = getMobileMenuCommand(params);
        if (!command) {
            return false;
        }

        ensureSelectionPrimary();
        commandService.executeCommand(command.commandId, command.commandParams).catch(() => undefined);
        return true;
    }

    function executeMenuItemAndClose(params: IValueOption | IMobileStyleCommand) {
        if (executeMenuItem(params)) {
            closeTools();
        }
    }

    if (editing) {
        return (
            <button
                ref={editingMenuRef}
                type="button"
                aria-label={localeService.t<LocaleKey>('sheets-ui.mobile.openTools')}
                className={clsx(resetButtonClassName, `
                  univer-pointer-events-auto univer-absolute univer-right-4 univer-z-30 univer-flex univer-size-12
                  univer-items-center univer-justify-center univer-rounded-full univer-bg-primary-600 univer-text-xl
                  univer-text-gray-0 univer-shadow-lg univer-transition-[bottom] univer-duration-150
                  active:univer-bg-primary-700
                `)}
                style={{
                    bottom: (keyboardLayout?.bottom ?? 0) + getMobileEditingMenuBottomOffset(formulaOperatorsVisible),
                }}
                onClick={() => openTools().catch(() => undefined)}
            >
                <MenuIcon />
            </button>
        );
    }

    if (!toolsOpen) {
        return (
            <div
                className="
                  univer-pointer-events-none univer-absolute univer-bottom-14 univer-right-4 univer-z-20 univer-flex
                  univer-gap-2
                "
                style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
            >
                <button
                    type="button"
                    aria-label={localeService.t<LocaleKey>('sheets-ui.shortcut.sheet.start-editing')}
                    disabled={editingDisabled}
                    className={clsx(resetButtonClassName, `
                      univer-pointer-events-auto univer-flex univer-size-12 univer-items-center univer-justify-center
                      univer-rounded-full univer-bg-gray-0 univer-text-xl univer-text-primary-600 univer-shadow-lg
                      active:univer-bg-gray-100
                      disabled:univer-cursor-not-allowed disabled:univer-opacity-40
                      dark:!univer-bg-gray-800 dark:!univer-text-primary-400
                      dark:active:!univer-bg-gray-700
                    `)}
                    onClick={openKeyboard}
                >
                    <KeyboardIcon />
                </button>
                <button
                    type="button"
                    aria-label={localeService.t<LocaleKey>('sheets-ui.mobile.openTools')}
                    className={clsx(resetButtonClassName, `
                      univer-pointer-events-auto univer-flex univer-size-12 univer-items-center univer-justify-center
                      univer-rounded-full univer-bg-primary-600 univer-text-xl univer-text-gray-0 univer-shadow-lg
                      active:univer-bg-primary-700
                    `)}
                    onClick={() => openTools().catch(() => undefined)}
                >
                    <MenuIcon />
                </button>
            </div>
        );
    }

    return (
        <MobileDrawer
            panelRef={panelRef}
            contentRef={contentRef}
            componentName="mobile-sheet-action-panel"
            snap={drawerSnap}
            expandLabel={localeService.t<LocaleKey>('sheets-ui.mobile.openTools')}
            collapseLabel={localeService.t<LocaleKey>('sheets-ui.mobile.closeTools')}
            onSnapChange={setDrawerSnap}
            onClose={closeTools}
            floatingActions={(
                <button
                    type="button"
                    aria-label={localeService.t<LocaleKey>('sheets-ui.shortcut.sheet.start-editing')}
                    disabled={editingDisabled}
                    className={clsx(resetButtonClassName, `
                      univer-pointer-events-auto univer-flex univer-size-12 univer-items-center univer-justify-center
                      univer-rounded-full univer-bg-gray-0 univer-text-xl univer-text-primary-600 univer-shadow-lg
                      active:univer-bg-gray-100
                      disabled:univer-cursor-not-allowed disabled:univer-opacity-40
                      dark:!univer-bg-gray-800 dark:!univer-text-primary-400
                      dark:active:!univer-bg-gray-700
                    `)}
                    onClick={openKeyboard}
                >
                    <KeyboardIcon />
                </button>
            )}
            header={nestedTitle
                ? (
                    <div
                        className="
                          univer-grid univer-h-12 univer-flex-1 univer-grid-cols-[56px_minmax(0,1fr)_56px]
                          univer-items-center univer-px-2
                        "
                    >
                        <button
                            type="button"
                            aria-label={localeService.t<LocaleKey>('sheets-ui.mobile.back')}
                            className={clsx(resetButtonClassName, `
                              univer-flex univer-size-12 univer-items-center univer-justify-center univer-rounded-full
                              univer-text-gray-700
                              active:univer-bg-gray-100
                              dark:!univer-text-gray-300
                              dark:active:!univer-bg-gray-700
                              [&>svg]:univer-size-6
                            `)}
                            onClick={() => currentStyleView
                                ? setStyleViewStack((stack) => stack.slice(0, -1))
                                : menuNavigation?.onBack()}
                        >
                            <MoreLeftIcon />
                        </button>
                        <div
                            className="
                              univer-truncate univer-text-center univer-text-sm univer-font-semibold
                              univer-text-gray-900
                              dark:!univer-text-gray-100
                            "
                        >
                            {nestedTitle}
                        </div>
                    </div>
                )
                : (
                    <div className="univer-grid univer-h-10 univer-flex-1 univer-grid-cols-3">
                        {MOBILE_SHEET_PANEL_TABS.map((tab) => (
                            <button
                                key={tab.key}
                                type="button"
                                role="tab"
                                aria-selected={activeTab === tab.key}
                                className={clsx(resetButtonClassName, `
                                  univer-relative univer-flex univer-min-h-10 univer-items-center univer-justify-center
                                  univer-text-base univer-font-semibold univer-text-gray-900
                                  dark:!univer-text-gray-100
                                `, {
                                    'univer-text-primary-600 dark:!univer-text-primary-400': activeTab === tab.key,
                                })}
                                onClick={() => {
                                    setActiveTab(tab.key);
                                    setStyleViewStack([]);
                                    setMenuNavigation(null);
                                }}
                            >
                                {localeService.t<LocaleKey>(tab.title)}
                                {activeTab === tab.key && (
                                    <span
                                        className="
                                          univer-absolute univer-bottom-0 univer-h-0.5 univer-w-8 univer-rounded-full
                                          univer-bg-primary-600
                                        "
                                    />
                                )}
                            </button>
                        ))}
                    </div>
                )}
        >
            {activeTab === 'insert' && (
                <MobileMenu
                    schemas={insertSchemas}
                    menuManagerService={menuManagerService}
                    showHeader={false}
                    onNavigationChange={handleInsertNavigation}
                    onOptionSelect={executeMenuItemAndClose}
                />
            )}
            {activeTab === 'style' && (
                <MobileStylePanel
                    groups={styleGroups}
                    currentView={currentStyleView}
                    recentColors={recentColors}
                    onOpenView={(view) => {
                        setMenuNavigation(null);
                        setStyleViewStack((stack) => [...stack, view]);
                    }}
                    onBack={() => setStyleViewStack((stack) => stack.slice(0, -1))}
                    onExecute={currentStyleView?.kind === 'number-format' ||
                        currentStyleView?.kind === 'custom-number-format'
                        ? executeMenuItemAndClose
                        : executeMenuItem}
                    onUseColor={(color) => setRecentColors((colors) => [
                        color,
                        ...colors.filter((item) => item.toUpperCase() !== color.toUpperCase()),
                    ].slice(0, 8))}
                />
            )}
            {activeTab === 'operation' && (
                <div className="univer-grid univer-gap-3">
                    {dataSchemas.length > 0 && (!menuNavigation || menuNavigation.source === 'data') && (
                        <MobileMenu
                            schemas={dataSchemas}
                            menuManagerService={menuManagerService}
                            showHeader={false}
                            onNavigationChange={handleDataNavigation}
                            onOptionSelect={executeMenuItemAndClose}
                        />
                    )}
                    {(!menuNavigation || menuNavigation.source === 'operation') && (
                        <MobileMenu
                            schemas={operationSchemas}
                            menuManagerService={menuManagerService}
                            showHeader={false}
                            onNavigationChange={handleOperationNavigation}
                            onOptionSelect={executeMenuItemAndClose}
                        />
                    )}
                </div>
            )}
        </MobileDrawer>
    );
}
