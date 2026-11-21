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

// Modified by Carenode, 2026 — a fill re-measures the filled rows with the row calculation every edit uses (CNT-4497 autofill-row-height)

import type {
    IAccessor,
    IDisposable,
    IMutationInfo,
    IRange,
    Nullable,
    Workbook,
    Worksheet,
} from '@univerjs/core';
import type { Observable } from 'rxjs';
import {
    createIdentifier,
    Direction,
    Disposable,
    ICommandService,
    Inject,
    Injector,
    IUndoRedoService,
    IUniverInstanceService,
    ObjectMatrix,
    RANGE_TYPE,
    Rectangle,
    sequenceExecute,
    toDisposable,
    UniverInstanceType,
} from '@univerjs/core';
import { BehaviorSubject } from 'rxjs';
import type { ISetRangeValuesMutationParams } from '../../commands/mutations/set-range-values.mutation';
import type { IAutoFillLocation, IAutoFillRule, ISheetAutoFillHook } from './type';
import { discreteRangeToRange, rangeToDiscreteRange } from '../../basics/utils';
import { AutoClearContentCommand } from '../../commands/commands/auto-fill.command';
import { getRangesHeight, getSuitableRangesInView } from '../../commands/commands/util';
import { getPrimaryForRange } from '../../commands/commands/utils/selection-utils';
import { SetRangeValuesMutation } from '../../commands/mutations/set-range-values.mutation';
import { SetSelectionsOperation } from '../../commands/operations/selection.operation';
import { SheetSkeletonService } from '../../skeleton/skeleton.service';
import { SheetInterceptorService } from '../sheet-interceptor/sheet-interceptor.service';
import AutoFillRules from './rules';
import { AUTO_FILL_APPLY_TYPE, AUTO_FILL_HOOK_TYPE } from './type';

const {
    chnNumberRule,
    chnWeek2Rule,
    chnWeek3Rule,
    dateRule,
    extendNumberRule,
    loopSeriesRule,
    numberRule,
    otherRule,
} = AutoFillRules;

export interface IAutoFillService {
    applyType$: Observable<AUTO_FILL_APPLY_TYPE>;
    applyType: AUTO_FILL_APPLY_TYPE;

    direction: Direction;

    menu$: Observable<IApplyMenuItem[]>;
    menu: IApplyMenuItem[];

    showMenu$: Observable<boolean>;
    setShowMenu: (show: boolean) => void;

    setDisableApplyType: (type: AUTO_FILL_APPLY_TYPE, disable: boolean) => void;

    getRules(): IAutoFillRule[];
    isFillingStyle(): boolean;

    autoFillLocation$: Observable<Nullable<IAutoFillLocation>>;
    autoFillLocation: Nullable<IAutoFillLocation>;

    setFillingStyle(isFillingStyle: boolean): void;
    registerRule(rule: IAutoFillRule): void;

    getAllHooks(): ISheetAutoFillHook[];
    getActiveHooks(applyType?: AUTO_FILL_APPLY_TYPE): ISheetAutoFillHook[];
    addHook(hook: ISheetAutoFillHook): IDisposable;
    fillData(applyType: AUTO_FILL_APPLY_TYPE): boolean;

    triggerAutoFill(unitId: string, subUnitId: string, source: IRange, target: IRange, manualApplyType?: AUTO_FILL_APPLY_TYPE): Promise<boolean>;
}

export interface IApplyMenuItem {
    label: string;
    value: AUTO_FILL_APPLY_TYPE;
    disable: boolean;
}

// Carenode CNT-4497 autofill-row-height: the filled rows split for the row calculation, with the pre-fill heights.
interface IXlsxkitFilledRows {
    suitableRanges: IRange[];
    remainingRanges: IRange[];
    cellHeights: ObjectMatrix<number>;
}

export class AutoFillService extends Disposable implements IAutoFillService {
    private _rules: IAutoFillRule[] = [];
    private _hooks: ISheetAutoFillHook[] = [];
    private readonly _applyType$: BehaviorSubject<AUTO_FILL_APPLY_TYPE> = new BehaviorSubject<AUTO_FILL_APPLY_TYPE>(AUTO_FILL_APPLY_TYPE.SERIES);
    private _isFillingStyle: boolean = true;

    private _prevUndos: IMutationInfo[] = [];

    private readonly _autoFillLocation$: BehaviorSubject<Nullable<IAutoFillLocation>> = new BehaviorSubject<
        Nullable<IAutoFillLocation>
    >(null);

    readonly autoFillLocation$ = this._autoFillLocation$.asObservable();

    private readonly _showMenu$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
    readonly showMenu$ = this._showMenu$.asObservable();

    private _direction: Direction = Direction.DOWN;
    readonly applyType$ = this._applyType$.asObservable();

    private readonly _menu$: BehaviorSubject<IApplyMenuItem[]> = new BehaviorSubject<IApplyMenuItem[]>([
        {
            label: 'sheets.autoFill.copy',
            value: AUTO_FILL_APPLY_TYPE.COPY,
            disable: false,
        },
        {
            label: 'sheets.autoFill.series',
            value: AUTO_FILL_APPLY_TYPE.SERIES,
            disable: false,
        },
        {
            label: 'sheets.autoFill.formatOnly',
            value: AUTO_FILL_APPLY_TYPE.ONLY_FORMAT,
            disable: false,
        },
        {
            label: 'sheets.autoFill.noFormat',
            value: AUTO_FILL_APPLY_TYPE.NO_FORMAT,
            disable: false,
        },
    ]);

    readonly menu$ = this._menu$.asObservable();
    constructor(
        @ICommandService private _commandService: ICommandService,
        @IUndoRedoService private _undoRedoService: IUndoRedoService,
        @Inject(IUniverInstanceService) private _univerInstanceService: IUniverInstanceService,
        @Inject(Injector) private readonly _injector: Injector
    ) {
        super();
        this._init();
    }

    private _init() {
        this._rules = [
            dateRule,
            numberRule,
            extendNumberRule,
            chnNumberRule,
            chnWeek2Rule,
            chnWeek3Rule,
            loopSeriesRule,
            otherRule,
        ].sort((a, b) => b.priority - a.priority);
        this._isFillingStyle = true;
    }

    private _getOneByPriority(items: ISheetAutoFillHook[]) {
        if (items.length <= 0) {
            return [];
        }
        const maxPriority = items.reduce((maxItem, currentItem) => {
            return (currentItem.priority || 0) > (maxItem.priority || 0) ? currentItem : maxItem;
        }, items[0]);
        return [maxPriority];
    }

    // a cache to undo commands of last apply-type
    private _initPrevUndo() {
        this._prevUndos = [];
    }

    // eslint-disable-next-line max-lines-per-function, complexity
    async triggerAutoFill(unitId: string, subUnitId: string, source: IRange, selection: IRange, manualApplyType?: AUTO_FILL_APPLY_TYPE) {
        // if source range === dest range, do nothing;
        if (
            source.startColumn === selection.startColumn &&
            source.startRow === selection.startRow &&
            source.endColumn === selection.endColumn &&
            source.endRow === selection.endRow
        ) {
            return false;
        }
        // situation 1: drag to smaller range, horizontally.
        if (selection.endColumn < source.endColumn && selection.endColumn > source.startColumn) {
            return this._commandService.executeCommand(AutoClearContentCommand.id, {
                unitId,
                subUnitId,
                clearRange: {
                    startRow: selection.startRow,
                    endRow: selection.endRow,
                    startColumn: selection.endColumn + 1,
                    endColumn: source.endColumn,
                },
                selectionRange: selection,
            });
        }
        // situation 2: drag to smaller range, vertically.
        if (selection.endRow < source.endRow && selection.endRow > source.startRow) {
            return this._commandService.executeCommand(AutoClearContentCommand.id, {
                unitId,
                subUnitId,
                clearRange: {
                    startRow: selection.endRow + 1,
                    endRow: source.endRow,
                    startColumn: selection.startColumn,
                    endColumn: selection.endColumn,
                },
                selectionRange: selection,
            });
        }
        // situation 3: drag to larger range, expand to fill

        // save ranges
        const target = {
            startRow: selection.startRow,
            endRow: selection.endRow,
            startColumn: selection.startColumn,
            endColumn: selection.endColumn,
        };
        let direction: Nullable<Direction> = null;
        if (selection.startRow < source.startRow) {
            direction = Direction.UP;
            target.endRow = source.startRow - 1;
        } else if (selection.endRow > source.endRow) {
            direction = Direction.DOWN;
            target.startRow = source.endRow + 1;
        } else if (selection.startColumn < source.startColumn) {
            direction = Direction.LEFT;
            target.endColumn = source.startColumn - 1;
        } else if (selection.endColumn > source.endColumn) {
            direction = Direction.RIGHT;
            target.startColumn = source.endColumn + 1;
        } else {
            return false;
        }

        // A new drag replaces the cached fill session; its old menu must not survive a rejected preparation.
        this.setShowMenu(false);
        this.direction = direction;

        const autoFillSource = this._injector.invoke((accessor: IAccessor) => rangeToDiscreteRange(source, accessor, unitId, subUnitId));
        const autoFillTarget = this._injector.invoke((accessor: IAccessor) => rangeToDiscreteRange(target, accessor, unitId, subUnitId));

        if (!autoFillSource || !autoFillTarget) {
            return false;
        }

        this.autoFillLocation = {
            source: autoFillSource,
            target: autoFillTarget,
            unitId,
            subUnitId,
        };

        const preferTypes: AUTO_FILL_APPLY_TYPE[] = [];
        const activeHooks = this.getActiveHooks();
        activeHooks.forEach((hook) => {
            const type = hook?.onBeforeFillData?.({ source: autoFillSource, target: autoFillTarget, unitId, subUnitId }, direction!);
            if (type) {
                preferTypes.unshift(type);
            }
        });

        this._initPrevUndo();

        // If manual apply type is given, use it
        if (manualApplyType) {
            return this.fillData(manualApplyType);
        }

        // set apply type will trigger fillData
        for (let i = 0; i < preferTypes.length; i++) {
            const menuItem = this.menu.find((m) => m.value === preferTypes[i]);
            if (menuItem && !menuItem.disable) {
                return this.fillData(preferTypes[i]);
            }
        }

        // if no hook return apply type, use first available apply type
        const first = this.menu.find((m) => m.disable === false)?.value;
        if (first) {
            return this.fillData(first);
        }

        return false;
    }

    addHook(hook: ISheetAutoFillHook) {
        if (this._hooks.find((h) => h.id === hook.id)) {
            throw new Error(`Add hook failed, hook id '${hook.id}' already exist!`);
        }
        if (hook.priority === undefined) {
            hook.priority = 0;
        }

        if (hook.type === undefined) {
            hook.type = AUTO_FILL_HOOK_TYPE.APPEND;
        }
        this._hooks.push(hook);
        return toDisposable(() => {
            const index = this._hooks.findIndex((item) => item === hook);
            if (index > -1) {
                this._hooks.splice(index, 1);
            }
        });
    }

    registerRule(rule: IAutoFillRule) {
        // if rule.type is used, console error
        if (this._rules.find((r) => r.type === rule.type)) {
            throw new Error(`Registry rule failed, type '${rule.type}' already exist!`);
        }
        // insert rules according to the rule.priority, the higher priority will be inserted at the beginning of the array
        const index = this._rules.findIndex((r) => r.priority < rule.priority);
        this._rules.splice(index === -1 ? this._rules.length : index, 0, rule);
    }

    getRules() {
        return this._rules;
    }

    getAllHooks() {
        return this._hooks;
    }

    getActiveHooks(applyType = this.applyType) {
        const { source, target, unitId, subUnitId } = this.autoFillLocation || {};
        if (!source || !target || !unitId || !subUnitId) {
            return [];
        }
        const enabledHooks = this._hooks.filter(
            (h) => !h.disable?.({ source, target, unitId, subUnitId }, this._direction, applyType) === true
        );
        const onlyHooks = enabledHooks.filter((h) => h.type === AUTO_FILL_HOOK_TYPE.ONLY);
        if (onlyHooks.length > 0) {
            return this._getOneByPriority(onlyHooks);
        }

        const defaultHooks = this._getOneByPriority(enabledHooks.filter((h) => h.type === AUTO_FILL_HOOK_TYPE.DEFAULT));

        const appendHooks = enabledHooks.filter((h) => h.type === AUTO_FILL_HOOK_TYPE.APPEND) || [];

        return [...defaultHooks, ...appendHooks];
    }

    get applyType() {
        return this._applyType$.getValue();
    }

    set applyType(type: AUTO_FILL_APPLY_TYPE) {
        this._applyType$.next(type);
    }

    get menu() {
        return this._menu$.getValue();
    }

    get direction() {
        return this._direction;
    }

    set direction(direction: Direction) {
        this._direction = direction;
    }

    isFillingStyle(): boolean {
        return this._isFillingStyle;
    }

    setFillingStyle(isFillingStyle: boolean) {
        this._isFillingStyle = isFillingStyle;
    }

    get autoFillLocation() {
        return this._autoFillLocation$.getValue();
    }

    set autoFillLocation(location: Nullable<IAutoFillLocation>) {
        this._autoFillLocation$.next(location);
    }

    setDisableApplyType(type: AUTO_FILL_APPLY_TYPE, disable: boolean) {
        this._menu$.next(
            this._menu$.getValue().map((item) => {
                if (item.value === type) {
                    return {
                        ...item,
                        disable,
                    };
                }
                return item;
            })
        );
    }

    setShowMenu(show: boolean) {
        this._showMenu$.next(show);
    }

    // eslint-disable-next-line max-lines-per-function
    fillData(applyType: AUTO_FILL_APPLY_TYPE) {
        const activeWorkbook = this._univerInstanceService.getCurrentUnitOfType<Workbook>(UniverInstanceType.UNIVER_SHEET);
        const activeUnitId = activeWorkbook?.getUnitId();
        const activeSubUnitId = activeWorkbook?.getActiveSheet()?.getSheetId();
        const { source, target, unitId = activeUnitId, subUnitId = activeSubUnitId } = this.autoFillLocation || {};

        if (!source || !target || !unitId || !subUnitId) {
            return false;
        }

        const workbook = this._univerInstanceService.getUnit<Workbook>(unitId, UniverInstanceType.UNIVER_SHEET);
        if (!workbook) {
            return false;
        }
        const worksheet = workbook.getSheetBySheetId(subUnitId);
        if (!worksheet) {
            return false;
        }

        const direction = this.direction;
        const activeHooks = this.getActiveHooks(applyType);
        // Prepare and validate before updating the apply type, undoing a previous fill or changing the selection.
        const fillCallbacks = activeHooks.map((hook) => hook.onPrepareFillData?.(
            { source, target, unitId, subUnitId },
            direction,
            applyType
        ) ?? (() => hook.onFillData?.({ source, target, unitId, subUnitId }, direction, applyType)));
        this.applyType = applyType;

        if (this._prevUndos.length > 0) {
            this._prevUndos.forEach((undo) => {
                this._commandService.syncExecuteCommand(undo.id, undo.params);
            });
        }
        this._prevUndos = [];

        const selection = Rectangle.union(discreteRangeToRange(source), discreteRangeToRange(target));

        // If filling the active sheet, update the selection immediately
        if (unitId === activeUnitId && subUnitId === activeSubUnitId) {
            this._commandService.syncExecuteCommand(SetSelectionsOperation.id, {
                selections: [
                    {
                        primary: getPrimaryForRange({
                            startRow: source.rows[0],
                            endRow: source.rows[source.rows.length - 1],
                            startColumn: source.cols[0],
                            endColumn: source.cols[source.cols.length - 1],
                        }, worksheet),
                        range: {
                            ...selection,
                            rangeType: RANGE_TYPE.NORMAL,
                        },
                    },
                ],
                unitId,
                subUnitId,
            });
        }

        const undos: IMutationInfo[] = [];
        const redos: IMutationInfo[] = [];
        fillCallbacks.forEach((fill) => {
            const { undos: hookUndos, redos: hookRedos } = fill() || {};
            if (hookUndos) {
                undos.push(...hookUndos);
            }
            if (hookRedos) {
                redos.push(...hookRedos);
            }
        });
        // Carenode CNT-4497 autofill-row-height: the filled cells' heights are read before the fill runs, as
        // SetRangeValuesCommand does.
        const xlsxkitFilled = this._xlsxkitFilledRows(redos, workbook, worksheet);
        const result = redos.every((m) => this._commandService.syncExecuteCommand(m.id, m.params));

        // deal with auto-height
        const { redos: autoHeightRedos, undos: autoHeightUndos } = this._getAutoHeightUndoRedos(xlsxkitFilled, workbook, worksheet);
        redos.push(...autoHeightRedos);
        undos.push(...autoHeightUndos);

        if (result) {
            this._prevUndos = undos;
            // add to undo redo services
            this._undoRedoService.pushUndoRedo({
                unitID: unitId,
                undoMutations: undos,
                redoMutations: redos,
            });
        }
        activeHooks.forEach((hook) => {
            hook.onAfterFillData?.({ source, target, unitId, subUnitId }, direction, applyType);
        });
        this.setShowMenu(true);
        return true;
    }

    // Carenode CNT-4497 autofill-row-height: upstream wrote each filled cell's own height as its row's height, so a
    // taller cell elsewhere in the row was cut, the row floor was skipped, and a fill without formats never re-measured.
    // The filled rows go to the row calculation every other edit uses (SheetInterceptorService
    // .generateMutationsOfAutoHeight), whatever the apply type, split and hinted the way SetStyleCommand does it.
    private _getAutoHeightUndoRedos(filled: IXlsxkitFilledRows, workbook: Workbook, worksheet: Worksheet) {
        if (filled.suitableRanges.length === 0 && filled.remainingRanges.length === 0) {
            return { undos: [], redos: [] };
        }

        const { undos, redos } = this._injector.get(SheetInterceptorService).generateMutationsOfAutoHeight({
            unitId: workbook.getUnitId(),
            subUnitId: worksheet.getSheetId(),
            ranges: filled.suitableRanges,
            autoHeightRanges: filled.suitableRanges,
            lazyAutoHeightRanges: filled.remainingRanges,
            cellHeights: filled.cellHeights,
        });

        if (!sequenceExecute(redos, this._commandService).result) {
            return { undos: [], redos: [] };
        }

        return { undos, redos };
    }

    // Carenode CNT-4497 autofill-row-height: one range per filled row over its filled columns; the rows near the
    // viewport (getSuitableRangesInView) are measured now with each cell's pre-fill height as the hint, the rest go to
    // the lazy pass.
    private _xlsxkitFilledRows(redos: IMutationInfo[], workbook: Workbook, worksheet: Worksheet): IXlsxkitFilledRows {
        const columns = new Map<number, [number, number]>();
        redos.forEach((m) => {
            if (m.id !== SetRangeValuesMutation.id) {
                return;
            }
            new ObjectMatrix((m.params as ISetRangeValuesMutationParams).cellValue).forValue((row, col) => {
                const span = columns.get(row);
                columns.set(row, span ? [Math.min(span[0], col), Math.max(span[1], col)] : [col, col]);
            });
        });

        const ranges: IRange[] = [...columns].map(([row, [startColumn, endColumn]]) => ({
            startRow: row,
            endRow: row,
            startColumn,
            endColumn,
        }));
        const skeleton = this._injector.get(SheetSkeletonService).getSkeleton(workbook.getUnitId(), worksheet.getSheetId());
        const { suitableRanges, remainingRanges } = getSuitableRangesInView(ranges, skeleton);

        return {
            suitableRanges,
            remainingRanges,
            cellHeights: getRangesHeight(suitableRanges, worksheet),
        };
    }
}

export const IAutoFillService = createIdentifier<IAutoFillService>('univer.auto-fill-service');
