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

// Modified by Carenode, 2026 — CNT-5176: cases for the edit cell snapshot after a number format is set or removed, and after rows or columns are inserted, removed, moved or reordered on its own or another sheet or workbook

import type { ICommandInfo, IDocumentBody, IDocumentData, IDrawings, IRange, Nullable } from '@univerjs/core';
import type { IRemoveNumfmtMutationParams, ISetNumfmtMutationParams } from '@univerjs/sheets';
import {
    BooleanNumber,
    CellValueType,
    CommandType,
    DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY,
    DOCS_NORMAL_EDITOR_UNIT_ID_KEY,
    DocumentDataModel,
    FOCUSING_FX_BAR_EDITOR,
    ICommandService,
    IContextService,
    Injector,
    IUniverInstanceService,
    ThemeService,
    UniverInstanceType,
} from '@univerjs/core';
import { DocStateChangeManagerService } from '@univerjs/docs';
import { IFunctionService, LexerTreeBuilder } from '@univerjs/engine-formula';
import { DeviceInputEventType, IRenderManagerService } from '@univerjs/engine-render';
import {
    BEFORE_CELL_EDIT,
    InsertColMutation,
    InsertRowMutation,
    INumfmtService,
    MoveColsMutation,
    MoveRangeMutation,
    MoveRowsMutation,
    NumfmtService,
    RangeProtectionRuleModel,
    RemoveColMutation,
    RemoveNumfmtMutation,
    RemoveRowMutation,
    ReorderRangeMutation,
    SetNumfmtMutation,
    SetRangeValuesMutation,
    SheetInterceptorService,
    WorksheetProtectionRuleModel,
} from '@univerjs/sheets';
import { BehaviorSubject, EMPTY } from 'rxjs';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { ICellEditorState } from '../../../services/editor-bridge.service';
import { ScrollToRangeOperation } from '../../../commands/operations/scroll-to-range.operation';
import { IEditorBridgeService } from '../../../services/editor-bridge.service';
import { CellEditorManagerService, ICellEditorManagerService } from '../../../services/editor/cell-editor-manager.service';
import { SheetCellEditorResizeService } from '../../../services/editor/cell-editor-resize.service';
import { IFormulaEditorManagerService } from '../../../services/editor/formula-editor-manager.service';
import { createChartRenderTestBed } from '../../render-controllers/__tests__/chart-render-test-bed';
import { EditorDataSyncController } from '../data-sync.controller';
import { EditingRenderController } from '../editing.render-controller';
import { FormulaEditorController } from '../formula-editor.controller';

interface ITestableEditorDataSyncController {
    _checkAndSetRenderStyleConfig: (documentDataModel: Pick<DocumentDataModel, 'getSnapshot'>) => void;
    _syncContentAndRender: (
        unitId: string,
        body: IDocumentBody,
        drawings: Nullable<IDrawings>,
        drawingsOrder: Nullable<string[]>
    ) => void;
}

class TestCommandService {
    private readonly _listeners = new Set<(command: ICommandInfo) => void>();

    onCommandExecuted(listener: (command: ICommandInfo) => void) {
        this._listeners.add(listener);

        return {
            dispose: () => this._listeners.delete(listener),
        };
    }

    emit(command: ICommandInfo) {
        this._listeners.forEach((listener) => listener(command));
    }
}

function setNumfmtCommand(unitId: string, subUnitId: string, values: ISetNumfmtMutationParams['values']): ICommandInfo<ISetNumfmtMutationParams> {
    const refMap: ISetNumfmtMutationParams['refMap'] = {};
    Object.keys(values).forEach((id) => {
        refMap[id] = { pattern: id === 'date' ? 'yyyy-mm-dd' : '@' };
    });

    return { id: SetNumfmtMutation.id, params: { unitId, subUnitId, values, refMap } };
}

function removeNumfmtCommand(unitId: string, subUnitId: string, ranges: IRange[]): ICommandInfo<IRemoveNumfmtMutationParams> {
    return { id: RemoveNumfmtMutation.id, params: { unitId, subUnitId, ranges } };
}

/** The edit cell of `createController` is row 1, column 2 of `sheet1` in `test-unit`. */
const EDITED_CELL_RANGE: IRange = { startRow: 1, endRow: 1, startColumn: 2, endColumn: 2 };

const NUMFMT_ELSEWHERE_CASES = [
    { target: 'another cell', unitId: 'test-unit', subUnitId: 'sheet1', range: { startRow: 1, endRow: 3, startColumn: 3, endColumn: 4 } },
    { target: 'the same cell of another sheet', unitId: 'test-unit', subUnitId: 'sheet2', range: EDITED_CELL_RANGE },
    { target: 'the same cell of another workbook', unitId: 'other-unit', subUnitId: 'sheet1', range: EDITED_CELL_RANGE },
];

interface ISheetTarget {
    unitId: string;
    subUnitId: string;
}

const EDITED_SHEET: ISheetTarget = { unitId: 'test-unit', subUnitId: 'sheet1' };

function rows(startRow: number, endRow = startRow): IRange {
    return { startRow, endRow, startColumn: 0, endColumn: 19 };
}

function columns(startColumn: number, endColumn = startColumn): IRange {
    return { startRow: 0, endRow: 49, startColumn, endColumn };
}

type StructureCommand = (target: ISheetTarget) => ICommandInfo;

const insertRows = (range: IRange): StructureCommand => (target) => ({ id: InsertRowMutation.id, params: { ...target, range } });
const insertColumns = (range: IRange): StructureCommand => (target) => ({ id: InsertColMutation.id, params: { ...target, range } });
const removeRows = (range: IRange): StructureCommand => (target) => ({ id: RemoveRowMutation.id, params: { ...target, range } });
const removeColumns = (range: IRange): StructureCommand => (target) => ({ id: RemoveColMutation.id, params: { ...target, range } });
const moveRows = (sourceRange: IRange, targetRange: IRange): StructureCommand => (target) => ({ id: MoveRowsMutation.id, params: { ...target, sourceRange, targetRange } });
const moveColumns = (sourceRange: IRange, targetRange: IRange): StructureCommand => (target) => ({ id: MoveColsMutation.id, params: { ...target, sourceRange, targetRange } });
const reorder = (range: IRange, order: Record<number, number>): StructureCommand => (target) => ({ id: ReorderRangeMutation.id, params: { ...target, range, order } });

/** Row and column changes after which another cell sits at row 1, column 2 (the edit cell of `createController`). */
const SHIFTS_EDITED_CELL_CASES: Array<{ change: string; command: StructureCommand }> = [
    { change: 'a row is inserted above it', command: insertRows(rows(0)) },
    { change: 'a row is inserted at its row', command: insertRows(rows(1)) },
    { change: 'a column is inserted at its column', command: insertColumns(columns(2)) },
    { change: 'its row is removed', command: removeRows(rows(1)) },
    { change: 'a row above it is removed', command: removeRows(rows(0)) },
    { change: 'its column is removed', command: removeColumns(columns(2)) },
    { change: 'a column before it is removed', command: removeColumns(columns(0, 1)) },
    { change: 'its row is moved down', command: moveRows(rows(1), rows(4)) },
    { change: 'a row below it is moved above it', command: moveRows(rows(3), rows(0)) },
    { change: 'its column is moved right', command: moveColumns(columns(2), columns(5)) },
    { change: 'a column after it is moved before it', command: moveColumns(columns(4), columns(1)) },
    { change: 'its row takes another row in a reorder', command: reorder({ startRow: 0, endRow: 3, startColumn: 0, endColumn: 4 }, { 1: 3, 3: 1 }) },
];

/** Row and column changes that keep the cell at row 1, column 2 where it is. */
const KEEPS_EDITED_CELL_CASES: Array<{ change: string; command: StructureCommand }> = [
    { change: 'a row is inserted below it', command: insertRows(rows(2)) },
    { change: 'a column is inserted after it', command: insertColumns(columns(3)) },
    { change: 'rows below it are removed', command: removeRows(rows(2, 4)) },
    { change: 'a column after it is removed', command: removeColumns(columns(3)) },
    { change: 'rows below it are moved', command: moveRows(rows(3), rows(6)) },
    { change: 'columns after it are moved', command: moveColumns(columns(4), columns(8)) },
    { change: 'a reorder leaves its row out', command: reorder({ startRow: 0, endRow: 3, startColumn: 0, endColumn: 4 }, { 0: 3, 3: 0 }) },
    { change: 'a reorder keeps its row in place', command: reorder({ startRow: 0, endRow: 3, startColumn: 0, endColumn: 4 }, { 1: 1 }) },
    { change: 'a reorder covers other columns', command: reorder({ startRow: 0, endRow: 3, startColumn: 3, endColumn: 4 }, { 1: 3, 3: 1 }) },
];

describe('EditorDataSyncController', () => {
    const controllers: EditorDataSyncController[] = [];

    afterEach(() => {
        controllers.splice(0).forEach((controller) => controller.dispose());
    });

    function createController(options: {
        isFocusFxBar?: boolean;
        themeTextColor?: string;
        isInArrayFormulaRange?: boolean;
        isEditorVisible?: boolean;
        eventType?: DeviceInputEventType;
        formulaBarPosition?: { width: number; height: number } | null;
        documentDataModel?: DocumentDataModel;
        editUnitId?: string;
        editSheetId?: string;
    } = {}) {
        const commandService = new TestCommandService();
        const editorBridgeService = {
            currentEditCellState$: new BehaviorSubject<Nullable<ICellEditorState>>(null),
            getEditLocation: vi.fn(() => ({
                unitId: options.editUnitId ?? 'test-unit',
                sheetId: options.editSheetId ?? 'sheet1',
                row: 1,
                column: 2,
                isInArrayFormulaRange: options.isInArrayFormulaRange ?? false,
            })),
            isVisible: vi.fn(() => ({
                visible: options.isEditorVisible ?? false,
                eventType: options.eventType ?? DeviceInputEventType.Dblclick,
            })),
            refreshEditCellState: vi.fn(),
            changeEditorDirty: vi.fn(),
            isForceKeepVisible: vi.fn(() => false),
        };
        const contextService = {
            getContextValue: vi.fn((key: string) => {
                if (key === FOCUSING_FX_BAR_EDITOR) return options.isFocusFxBar ?? false;
                return false;
            }),
            subscribeContextValue$: vi.fn(() => EMPTY),
        };
        const currentTheme$ = new BehaviorSubject({});
        const skeleton = { calculate: vi.fn() };
        const documentViewModel = { reset: vi.fn() };
        const currentRender = {
            mainComponent: { makeDirty: vi.fn() },
            with: vi.fn(() => ({
                getSkeleton: () => skeleton,
                getViewModel: () => documentViewModel,
            })),
        };

        const injector = new Injector();
        injector.add([IUniverInstanceService, {
            useValue: { getUnit: () => options.documentDataModel } as never,
        }]);
        injector.add([IRenderManagerService, {
            useValue: { getRenderUnitById: () => options.documentDataModel ? currentRender : undefined } as never,
        }]);
        injector.add([IEditorBridgeService, { useValue: editorBridgeService as never }]);
        injector.add([ICommandService, { useValue: commandService as never }]);
        injector.add([RangeProtectionRuleModel, { useValue: { getRangeRuleInitState: () => true } as never }]);
        injector.add([WorksheetProtectionRuleModel, { useValue: { getSheetRuleInitState: () => true } as never }]);
        injector.add([FormulaEditorController, { useValue: { autoScroll: vi.fn() } as never }]);
        injector.add([IFormulaEditorManagerService, {
            useValue: { getPosition: () => options.formulaBarPosition ?? null } as never,
        }]);
        injector.add([IContextService, { useValue: contextService as never }]);
        injector.add([ThemeService, {
            useValue: {
                currentTheme$,
                getColorFromTheme: vi.fn((token: string) => token === 'gray.900'
                    ? options.themeTextColor ?? '#1b1c1f'
                    : '#d1d5db'),
            } as never,
        }]);
        injector.add([EditorDataSyncController]);

        const controller = injector.get(EditorDataSyncController);

        controllers.push(controller);

        return {
            commandService,
            controller,
            editorBridgeService,
        };
    }

    function checkAndSetRenderStyleConfig(controller: EditorDataSyncController, snapshot: IDocumentData) {
        (controller as unknown as ITestableEditorDataSyncController)._checkAndSetRenderStyleConfig({
            getSnapshot: vi.fn(() => snapshot),
        });
    }

    function syncContentAndRender(
        controller: EditorDataSyncController,
        body: IDocumentBody
    ) {
        const testableController = controller as unknown as ITestableEditorDataSyncController;
        testableController._syncContentAndRender(DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY, body, null, null);
    }

    it('ignores a zero-width formula bar position', () => {
        const { controller } = createController({ formulaBarPosition: { width: 0, height: 28 } });
        const formulaBarSnapshot: IDocumentData = {
            id: DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY,
            documentStyle: {},
            body: {
                dataStream: 'text\r\n',
            },
        };

        checkAndSetRenderStyleConfig(controller, formulaBarSnapshot);

        expect(formulaBarSnapshot.documentStyle?.pageSize?.width).toBe(Number.POSITIVE_INFINITY);
    });

    it('applies a measured formula bar width', () => {
        const { controller } = createController({ formulaBarPosition: { width: 320, height: 28 } });
        const formulaBarSnapshot: IDocumentData = {
            id: DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY,
            documentStyle: {},
            body: {
                dataStream: 'text\r\n',
            },
        };

        checkAndSetRenderStyleConfig(controller, formulaBarSnapshot);

        expect(formulaBarSnapshot.documentStyle?.pageSize?.width).toBe(320);
    });

    it('keeps the previous formula bar width when the latest position has zero width', () => {
        const formulaBarPosition = { width: 320, height: 28 };
        const { controller } = createController({ formulaBarPosition });
        const formulaBarSnapshot: IDocumentData = {
            id: DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY,
            documentStyle: {},
            body: {
                dataStream: 'text\r\n',
            },
        };

        checkAndSetRenderStyleConfig(controller, formulaBarSnapshot);
        formulaBarPosition.width = 0;
        checkAndSetRenderStyleConfig(controller, formulaBarSnapshot);

        expect(formulaBarSnapshot.documentStyle.pageSize?.width).toBe(320);
    });

    it('notifies formula bar content observers when the selected cell changes', () => {
        const documentDataModel = new DocumentDataModel({
            id: DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY,
            documentStyle: {},
            body: {
                dataStream: '=SUM(A1)\r\n',
            },
        });
        const { controller } = createController({ documentDataModel });
        let observedDataStream = '';
        const subscription = documentDataModel.change$.subscribe(() => {
            observedDataStream = documentDataModel.getBody()?.dataStream ?? '';
        });

        syncContentAndRender(controller, { dataStream: '\r\n' });

        expect(documentDataModel.getBody()?.dataStream).toBe('\r\n');
        expect(observedDataStream).toBe('\r\n');

        subscription.unsubscribe();
        documentDataModel.dispose();
    });

    it.each([
        { isEditorVisible: false, eventType: DeviceInputEventType.Dblclick },
        { isEditorVisible: true, eventType: DeviceInputEventType.Dblclick },
        { isEditorVisible: false, eventType: DeviceInputEventType.PointerDown },
        { isEditorVisible: true, eventType: DeviceInputEventType.PointerDown },
        { isEditorVisible: true, eventType: DeviceInputEventType.Keyboard },
    ])('clears inherited formulas only while editing (visible=$isEditorVisible, event=$eventType)', ({ isEditorVisible, eventType }) => {
        const documentDataModel = new DocumentDataModel({
            id: DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY,
            documentStyle: {},
            body: { dataStream: '\r\n' },
        });
        const sourceDocument = new DocumentDataModel({
            id: DOCS_NORMAL_EDITOR_UNIT_ID_KEY,
            documentStyle: {},
            body: { dataStream: '=A1:B10\r\n' },
        });
        const { editorBridgeService } = createController({
            documentDataModel,
            isEditorVisible,
            eventType,
            isInArrayFormulaRange: true,
        });

        editorBridgeService.currentEditCellState$.next({
            isInArrayFormulaRange: true,
            documentLayoutObject: { documentModel: sourceDocument },
        } as ICellEditorState);

        expect(documentDataModel.getBody()?.dataStream).toBe(isEditorVisible ? '\r\n' : '=A1:B10\r\n');
        expect(sourceDocument.getBody()?.dataStream).toBe('=A1:B10\r\n');
        documentDataModel.dispose();
        sourceDocument.dispose();
    });

    it('refreshes the current edit cell when set-values updates the edited cell', () => {
        const { commandService, editorBridgeService } = createController();

        commandService.emit({
            id: SetRangeValuesMutation.id,
            params: {
                unitId: 'test-unit',
                subUnitId: 'sheet1',
                cellValue: {
                    1: {
                        2: { v: 'updated' },
                    },
                },
            },
        } as ICommandInfo);

        expect(editorBridgeService.refreshEditCellState).toHaveBeenCalledTimes(1);
    });

    it('refreshes the current edit cell when set-values clears the edited cell', () => {
        const { commandService, editorBridgeService } = createController();

        commandService.emit({
            id: SetRangeValuesMutation.id,
            params: {
                unitId: 'test-unit',
                subUnitId: 'sheet1',
                cellValue: {
                    1: {
                        2: null,
                    },
                },
            },
        } as ICommandInfo);

        expect(editorBridgeService.refreshEditCellState).toHaveBeenCalledTimes(1);
    });

    it('refreshes the current edit cell when move-range changes the edited cell', () => {
        const { commandService, editorBridgeService } = createController();

        commandService.emit({
            id: MoveRangeMutation.id,
            params: {
                unitId: 'test-unit',
                from: {
                    subUnitId: 'sheet1',
                    value: {
                        1: {
                            2: null,
                        },
                    },
                },
                to: {
                    subUnitId: 'sheet1',
                    value: {},
                },
            },
        } as ICommandInfo);

        expect(editorBridgeService.refreshEditCellState).toHaveBeenCalledTimes(1);
    });

    it('refreshes the current edit cell when move-range writes into it', () => {
        const { commandService, editorBridgeService } = createController();

        commandService.emit({
            id: MoveRangeMutation.id,
            params: {
                unitId: 'test-unit',
                from: {
                    subUnitId: 'sheet2',
                    value: {
                        1: {
                            2: null,
                        },
                    },
                },
                to: {
                    subUnitId: 'sheet1',
                    value: {
                        1: {
                            2: { v: 'moved' },
                        },
                    },
                },
            },
        } as ICommandInfo);

        expect(editorBridgeService.refreshEditCellState).toHaveBeenCalledTimes(1);
    });

    it('ignores set-values on the same coordinates of another sheet', () => {
        const { commandService, editorBridgeService } = createController();

        commandService.emit({
            id: SetRangeValuesMutation.id,
            params: {
                unitId: 'test-unit',
                subUnitId: 'sheet2',
                cellValue: {
                    1: {
                        2: { v: 'recalculated' },
                    },
                },
            },
        } as ICommandInfo);

        expect(editorBridgeService.refreshEditCellState).not.toHaveBeenCalled();
    });

    it('ignores set-values on the same coordinates of another workbook', () => {
        const { commandService, editorBridgeService } = createController();

        commandService.emit({
            id: SetRangeValuesMutation.id,
            params: {
                unitId: 'other-unit',
                subUnitId: 'sheet1',
                cellValue: {
                    1: {
                        2: { v: 'updated' },
                    },
                },
            },
        } as ICommandInfo);

        expect(editorBridgeService.refreshEditCellState).not.toHaveBeenCalled();
    });

    it('ignores move-range on the same coordinates of another sheet', () => {
        const { commandService, editorBridgeService } = createController();

        commandService.emit({
            id: MoveRangeMutation.id,
            params: {
                unitId: 'test-unit',
                from: {
                    subUnitId: 'sheet2',
                    value: {
                        1: {
                            2: { v: 'moved' },
                        },
                    },
                },
                to: {
                    subUnitId: 'sheet3',
                    value: {},
                },
            },
        } as ICommandInfo);

        expect(editorBridgeService.refreshEditCellState).not.toHaveBeenCalled();
    });

    it('marks the open editor dirty when an external update replaces the edited cell content', () => {
        const { commandService, editorBridgeService } = createController({ isEditorVisible: true });

        commandService.emit({
            id: SetRangeValuesMutation.id,
            params: {
                unitId: 'test-unit',
                subUnitId: 'sheet1',
                cellValue: {
                    1: {
                        2: { f: '=SUM(A1:A2)' },
                    },
                },
            },
        } as ICommandInfo);

        expect(editorBridgeService.changeEditorDirty).toHaveBeenCalledWith(true);
        expect(editorBridgeService.refreshEditCellState).not.toHaveBeenCalled();
    });

    it('marks the open editor dirty when the edited cell is cleared externally', () => {
        const { commandService, editorBridgeService } = createController({ isEditorVisible: true });

        commandService.emit({
            id: SetRangeValuesMutation.id,
            params: {
                unitId: 'test-unit',
                subUnitId: 'sheet1',
                cellValue: {
                    1: {
                        2: null,
                    },
                },
            },
        } as ICommandInfo);

        expect(editorBridgeService.changeEditorDirty).toHaveBeenCalledWith(true);
    });

    it('leaves the open editor untouched when an external update only changes cell style', () => {
        const { commandService, editorBridgeService } = createController({ isEditorVisible: true });

        commandService.emit({
            id: SetRangeValuesMutation.id,
            params: {
                unitId: 'test-unit',
                subUnitId: 'sheet1',
                cellValue: {
                    1: {
                        2: { s: { bg: { rgb: '#ff0000' }, bl: 1 } },
                    },
                },
            },
        } as ICommandInfo);

        expect(editorBridgeService.changeEditorDirty).not.toHaveBeenCalled();
        expect(editorBridgeService.refreshEditCellState).not.toHaveBeenCalled();
    });

    it('marks the open editor dirty when move-range writes the edited cell', () => {
        const { commandService, editorBridgeService } = createController({ isEditorVisible: true });

        commandService.emit({
            id: MoveRangeMutation.id,
            params: {
                unitId: 'test-unit',
                from: {
                    subUnitId: 'sheet1',
                    value: {
                        1: {
                            2: null,
                        },
                    },
                },
                to: {
                    subUnitId: 'sheet1',
                    value: {},
                },
            },
        } as ICommandInfo);

        expect(editorBridgeService.changeEditorDirty).toHaveBeenCalledWith(true);
        expect(editorBridgeService.refreshEditCellState).not.toHaveBeenCalled();
    });

    it('marks the open editor dirty when move-range moves cells into the edited cell', () => {
        const { commandService, editorBridgeService } = createController({ isEditorVisible: true });

        commandService.emit({
            id: MoveRangeMutation.id,
            params: {
                unitId: 'test-unit',
                from: {
                    subUnitId: 'sheet2',
                    value: {},
                },
                to: {
                    subUnitId: 'sheet1',
                    value: {
                        1: {
                            2: { v: 'moved' },
                        },
                    },
                },
            },
        } as ICommandInfo);

        expect(editorBridgeService.changeEditorDirty).toHaveBeenCalledWith(true);
    });

    it('leaves the open editor untouched when move-range does not involve the edited cell', () => {
        const { commandService, editorBridgeService } = createController({ isEditorVisible: true });

        commandService.emit({
            id: MoveRangeMutation.id,
            params: {
                unitId: 'test-unit',
                from: {
                    subUnitId: 'sheet1',
                    value: {
                        5: {
                            7: null,
                        },
                    },
                },
                to: {
                    subUnitId: 'sheet1',
                    value: {
                        6: {
                            8: { v: 'moved' },
                        },
                    },
                },
            },
        } as ICommandInfo);

        expect(editorBridgeService.changeEditorDirty).not.toHaveBeenCalled();
        expect(editorBridgeService.refreshEditCellState).not.toHaveBeenCalled();
    });

    it('leaves the open editor untouched when move-range writes the edited coordinates on another sheet', () => {
        const { commandService, editorBridgeService } = createController({ isEditorVisible: true });

        commandService.emit({
            id: MoveRangeMutation.id,
            params: {
                unitId: 'test-unit',
                from: {
                    subUnitId: 'sheet2',
                    value: {
                        1: {
                            2: null,
                        },
                    },
                },
                to: {
                    subUnitId: 'sheet2',
                    value: {
                        1: {
                            2: { v: 'moved' },
                        },
                    },
                },
            },
        } as ICommandInfo);

        expect(editorBridgeService.changeEditorDirty).not.toHaveBeenCalled();
        expect(editorBridgeService.refreshEditCellState).not.toHaveBeenCalled();
    });

    it('refreshes the current edit cell when a number format is set on a range that holds it', () => {
        const { commandService, editorBridgeService } = createController();

        commandService.emit(setNumfmtCommand('test-unit', 'sheet1', {
            text: { ranges: [{ startRow: 5, endRow: 5, startColumn: 0, endColumn: 0 }] },
            date: { ranges: [{ startRow: 0, endRow: 3, startColumn: 1, endColumn: 2 }] },
        }));

        expect(editorBridgeService.refreshEditCellState).toHaveBeenCalledTimes(1);
    });

    it.each(NUMFMT_ELSEWHERE_CASES)('ignores a number format set on $target', ({ unitId, subUnitId, range }) => {
        const { commandService, editorBridgeService } = createController();

        commandService.emit(setNumfmtCommand(unitId, subUnitId, { date: { ranges: [range] } }));

        expect(editorBridgeService.refreshEditCellState).not.toHaveBeenCalled();
    });

    it('refreshes the current edit cell when the number format of a range that holds it is removed', () => {
        const { commandService, editorBridgeService } = createController();

        commandService.emit(removeNumfmtCommand('test-unit', 'sheet1', [
            { startRow: 5, endRow: 5, startColumn: 0, endColumn: 0 },
            { startRow: 1, endRow: 2, startColumn: 0, endColumn: 2 },
        ]));

        expect(editorBridgeService.refreshEditCellState).toHaveBeenCalledTimes(1);
    });

    it.each(NUMFMT_ELSEWHERE_CASES)('ignores a number format removed from $target', ({ unitId, subUnitId, range }) => {
        const { commandService, editorBridgeService } = createController();

        commandService.emit(removeNumfmtCommand(unitId, subUnitId, [range]));

        expect(editorBridgeService.refreshEditCellState).not.toHaveBeenCalled();
    });

    it.each([
        { change: 'set on', command: setNumfmtCommand('test-unit', 'sheet1', { date: { ranges: [EDITED_CELL_RANGE] } }) },
        { change: 'removed from', command: removeNumfmtCommand('test-unit', 'sheet1', [EDITED_CELL_RANGE]) },
    ])('leaves the open editor untouched when a number format is $change the edited cell', ({ command }) => {
        const { commandService, editorBridgeService } = createController({ isEditorVisible: true });

        commandService.emit(command);

        // A number format is cell style, so the typed draft still describes the cell and is not marked as replaced.
        expect(editorBridgeService.changeEditorDirty).not.toHaveBeenCalled();
        expect(editorBridgeService.refreshEditCellState).not.toHaveBeenCalled();
    });

    it.each(SHIFTS_EDITED_CELL_CASES)('refreshes the current edit cell when $change', ({ command }) => {
        const { commandService, editorBridgeService } = createController();

        commandService.emit(command(EDITED_SHEET));

        expect(editorBridgeService.refreshEditCellState).toHaveBeenCalledTimes(1);
    });

    it.each(KEEPS_EDITED_CELL_CASES)('ignores a row or column change when $change', ({ command }) => {
        const { commandService, editorBridgeService } = createController();

        commandService.emit(command(EDITED_SHEET));

        expect(editorBridgeService.refreshEditCellState).not.toHaveBeenCalled();
    });

    it.each(SHIFTS_EDITED_CELL_CASES)('ignores the same change on another sheet or workbook when $change', ({ command }) => {
        const { commandService, editorBridgeService } = createController();

        commandService.emit(command({ unitId: 'test-unit', subUnitId: 'sheet2' }));
        commandService.emit(command({ unitId: 'other-unit', subUnitId: 'sheet1' }));

        expect(editorBridgeService.refreshEditCellState).not.toHaveBeenCalled();
    });

    it.each(SHIFTS_EDITED_CELL_CASES)('leaves the open editor untouched when $change', ({ command }) => {
        const { commandService, editorBridgeService } = createController({ isEditorVisible: true });

        commandService.emit(command(EDITED_SHEET));

        expect(editorBridgeService.changeEditorDirty).not.toHaveBeenCalled();
        expect(editorBridgeService.refreshEditCellState).not.toHaveBeenCalled();
    });

    it('renders formula reference styles in the cell editor when the cell editor is focused', () => {
        const { controller } = createController();
        const cellEditorSnapshot: IDocumentData = {
            id: DOCS_NORMAL_EDITOR_UNIT_ID_KEY,
            body: {
                dataStream: '=G10+G12+G13\r\n',
                textRuns: [
                    { st: 1, ed: 4, ts: { cl: { rgb: '#8f7cf6' }, fs: 11 } },
                ],
            },
            documentStyle: {},
        };
        const formulaBarSnapshot: IDocumentData = {
            id: DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY,
            body: {
                dataStream: '=G10+G12+G13\r\n',
                textRuns: [
                    { st: 1, ed: 4, ts: { cl: { rgb: '#8f7cf6' }, fs: 11 } },
                ],
            },
            documentStyle: {},
        };

        checkAndSetRenderStyleConfig(controller, cellEditorSnapshot);
        checkAndSetRenderStyleConfig(controller, formulaBarSnapshot);

        expect(cellEditorSnapshot.documentStyle.renderConfig?.isRenderStyle).toBe(BooleanNumber.TRUE);
        expect(formulaBarSnapshot.documentStyle.renderConfig?.isRenderStyle).toBe(BooleanNumber.FALSE);
    });

    it('uses the resolved theme color for the formula bar default text', () => {
        const { controller } = createController({ themeTextColor: '#f7f9fc' });
        const formulaBarSnapshot: IDocumentData = {
            id: DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY,
            body: {
                dataStream: 'A Schedule of Items\r\n',
            },
            documentStyle: {},
        };

        checkAndSetRenderStyleConfig(controller, formulaBarSnapshot);

        expect(formulaBarSnapshot.documentStyle.textStyle?.cl?.rgb).toBe('#f7f9fc');
    });

    it.each([false, true])('shows inherited spill formulas in gray until editing starts (visible=%s)', (isEditorVisible) => {
        const { controller } = createController({ isInArrayFormulaRange: true, isEditorVisible });
        const formulaBarSnapshot: IDocumentData = {
            id: DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY,
            body: {
                dataStream: '=A1:B10\r\n',
                textRuns: [{ st: 0, ed: 7, ts: { cl: { rgb: '#d1d5db' } } }],
            },
            documentStyle: {},
        };

        checkAndSetRenderStyleConfig(controller, formulaBarSnapshot);

        expect(formulaBarSnapshot.documentStyle.renderConfig?.isRenderStyle).toBe(BooleanNumber.FALSE);
        expect(formulaBarSnapshot.documentStyle.textStyle?.cl?.rgb).toBe(isEditorVisible ? '#1b1c1f' : '#d1d5db');
    });

    it('renders formula reference styles in the formula bar when the formula bar is focused', () => {
        const { controller } = createController({ isFocusFxBar: true });
        const cellEditorSnapshot: IDocumentData = {
            id: DOCS_NORMAL_EDITOR_UNIT_ID_KEY,
            body: {
                dataStream: '=G10+G12+G13\r\n',
                textRuns: [
                    { st: 1, ed: 4, ts: { cl: { rgb: '#8f7cf6' }, fs: 11 } },
                ],
            },
            documentStyle: {},
        };
        const formulaBarSnapshot: IDocumentData = {
            id: DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY,
            body: {
                dataStream: '=G10+G12+G13\r\n',
                textRuns: [
                    { st: 1, ed: 4, ts: { cl: { rgb: '#8f7cf6' }, fs: 11 } },
                ],
            },
            documentStyle: {},
        };

        checkAndSetRenderStyleConfig(controller, cellEditorSnapshot);
        checkAndSetRenderStyleConfig(controller, formulaBarSnapshot);

        expect(cellEditorSnapshot.documentStyle.renderConfig?.isRenderStyle).toBe(BooleanNumber.FALSE);
        expect(formulaBarSnapshot.documentStyle.renderConfig?.isRenderStyle).toBe(BooleanNumber.TRUE);
    });
});

describe('EditorDataSyncController cell refresh with real sheet providers', () => {
    function createRealController() {
        const { injector, workbook, render, manager, commands } = createChartRenderTestBed();
        const worksheet = workbook.getSheetBySheetId('grid')!;

        // The formula bar has its own unit and render stack; keep it out of this bed so the assertions
        // observe the cell editor snapshot only.
        injector.add([FormulaEditorController, { useValue: { autoScroll: vi.fn() } as never }]);
        injector.add([IFormulaEditorManagerService, { useValue: { getPosition: () => null } as never }]);
        injector.add([RangeProtectionRuleModel, { useValue: { getRangeRuleInitState: () => true } as never }]);
        injector.add([WorksheetProtectionRuleModel, { useValue: { getSheetRuleInitState: () => true } as never }]);
        injector.add([EditorDataSyncController]);

        commands.registerCommand(SetRangeValuesMutation);
        manager.setCurrent({ sheetId: 'grid' });
        worksheet.getCellMatrix().setValue(0, 0, { v: 'old' });

        const controller = injector.get(EditorDataSyncController);
        onTestFinished(() => controller.dispose());

        const bridge = injector.get(IEditorBridgeService);
        bridge.setEditCell({
            unitId: workbook.getUnitId(),
            sheetId: 'grid',
            scene: render.scene,
            engine: render.engine,
            primary: worksheet.getCellInfoInMergeData(0, 0),
        });
        // A closed editor is what #6715 (and the formula bar) relies on: the snapshot follows the model.
        bridge.changeVisible({
            visible: false,
            eventType: DeviceInputEventType.Keyboard,
            unitId: workbook.getUnitId(),
        });

        return {
            bridge,
            commands,
            worksheet,
            unitId: workbook.getUnitId(),
            editedDocumentModel: () => bridge.getEditCellState()?.documentLayoutObject.documentModel,
            editedBody: () => bridge.getEditCellState()?.documentLayoutObject.documentModel?.getBody()?.dataStream,
            writeCell: (value: string) => commands.syncExecuteCommand(SetRangeValuesMutation.id, {
                unitId: workbook.getUnitId(),
                subUnitId: 'grid',
                cellValue: { 0: { 0: { v: value } } },
            }),
        };
    }

    it('keeps a closed cell editor snapshot aligned with an external write to the edited cell (#6715)', () => {
        const { bridge, worksheet, writeCell, editedBody } = createRealController();
        expect(bridge.isVisible().visible).toBe(false);
        expect(editedBody()).toBe('old\r\n');

        writeCell('Hello World');

        expect(worksheet.getCellRaw(0, 0)?.v).toBe('Hello World');
        // #6715: opening the editor afterwards must show the written value, not the pre-write snapshot.
        expect(editedBody()).toBe('Hello World\r\n');
    });

    it('keeps the open draft and marks it for submission when an external write hits the edited cell', () => {
        const { bridge, worksheet, unitId, writeCell, editedBody, editedDocumentModel } = createRealController();
        const draftDocumentModel = editedDocumentModel();

        bridge.changeVisible({ visible: true, eventType: DeviceInputEventType.Keyboard, unitId });
        expect(bridge.getEditorDirty()).toBe(false);
        writeCell('remote value');

        expect(worksheet.getCellRaw(0, 0)?.v).toBe('remote value');
        // The draft is left alone, so the editor keeps showing it and submits it when editing ends.
        expect(editedDocumentModel()).toBe(draftDocumentModel);
        expect(editedBody()).toBe('old\r\n');
        expect(bridge.getEditorDirty()).toBe(true);
    });

    it('keeps the open draft clean when an external write only changes cell style', () => {
        const { bridge, unitId, commands } = createRealController();
        bridge.changeVisible({ visible: true, eventType: DeviceInputEventType.Keyboard, unitId });

        commands.syncExecuteCommand(SetRangeValuesMutation.id, {
            unitId,
            subUnitId: 'grid',
            cellValue: { 0: { 0: { s: { bg: { rgb: '#ff0000' } } } } },
        });

        expect(bridge.getEditorDirty()).toBe(false);
    });
});

describe('EditorDataSyncController number format refresh with real sheet providers', () => {
    const DATE_PATTERN = 'yyyy-mm-dd';
    const SERIAL = 46350;
    const SERIAL_AS_DATE = '2026-11-24';
    const A1: IRange = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 };

    function createNumfmtController() {
        const { injector, workbook, render, manager, commands } = createChartRenderTestBed();
        const worksheet = workbook.getSheetBySheetId('grid')!;
        const unitId = workbook.getUnitId();

        injector.add([FormulaEditorController, { useValue: { autoScroll: vi.fn() } as never }]);
        injector.add([IFormulaEditorManagerService, { useValue: { getPosition: () => null } as never }]);
        injector.add([RangeProtectionRuleModel, { useValue: { getRangeRuleInitState: () => true } as never }]);
        injector.add([WorksheetProtectionRuleModel, { useValue: { getSheetRuleInitState: () => true } as never }]);
        injector.add([INumfmtService, { useClass: NumfmtService }]);
        injector.add([EditorDataSyncController]);

        commands.registerCommand(SetNumfmtMutation);
        commands.registerCommand(RemoveNumfmtMutation);
        manager.setCurrent({ sheetId: 'grid' });
        worksheet.getCellMatrix().setValue(0, 0, { v: SERIAL, t: CellValueType.NUMBER });

        const numfmtService = injector.get(INumfmtService);
        // Stands in for NumfmtEditorController (sheets-numfmt-ui, which sheets-ui does not depend on):
        // the editor text of a date serial is the date while the cell has a date format.
        injector.get(SheetInterceptorService).writeCellInterceptor.intercept(BEFORE_CELL_EDIT, {
            handler: (cell, context, next) => {
                const numfmt = numfmtService.getValue(context.unitId, context.subUnitId, context.row, context.col);
                const rawCell = context.worksheet.getCellRaw(context.row, context.col);
                if (numfmt?.pattern === DATE_PATTERN && rawCell?.v === SERIAL) {
                    return next({ ...rawCell, v: SERIAL_AS_DATE });
                }

                return next(cell);
            },
        });

        const controller = injector.get(EditorDataSyncController);
        onTestFinished(() => controller.dispose());

        const bridge = injector.get(IEditorBridgeService);
        bridge.setEditCell({
            unitId,
            sheetId: 'grid',
            scene: render.scene,
            engine: render.engine,
            primary: worksheet.getCellInfoInMergeData(0, 0),
        });
        bridge.changeVisible({ visible: false, eventType: DeviceInputEventType.Keyboard, unitId });

        return {
            bridge,
            numfmtService,
            unitId,
            editedDocumentModel: () => bridge.getEditCellState()?.documentLayoutObject.documentModel,
            editedBody: () => bridge.getEditCellState()?.documentLayoutObject.documentModel?.getBody()?.dataStream,
            setDateFormat: () => commands.syncExecuteCommand(SetNumfmtMutation.id, {
                unitId,
                subUnitId: 'grid',
                values: { date: { ranges: [A1] } },
                refMap: { date: { pattern: DATE_PATTERN } },
            }),
            removeNumberFormat: () => commands.syncExecuteCommand(RemoveNumfmtMutation.id, {
                unitId,
                subUnitId: 'grid',
                ranges: [A1],
            }),
        };
    }

    it('shows the date in a closed cell editor once a date format is set on the selected cell', () => {
        const { numfmtService, unitId, editedBody, setDateFormat } = createNumfmtController();
        expect(editedBody()).toBe(`${SERIAL}\r\n`);

        setDateFormat();

        expect(numfmtService.getValue(unitId, 'grid', 0, 0)?.pattern).toBe(DATE_PATTERN);
        // Opening the editor on the same cell reuses this snapshot, so it must already hold the date text.
        expect(editedBody()).toBe(`${SERIAL_AS_DATE}\r\n`);
    });

    it('shows the serial again in a closed cell editor once the number format of the selected cell is removed', () => {
        const { numfmtService, unitId, editedBody, setDateFormat, removeNumberFormat } = createNumfmtController();
        setDateFormat();
        expect(editedBody()).toBe(`${SERIAL_AS_DATE}\r\n`);

        removeNumberFormat();

        expect(numfmtService.getValue(unitId, 'grid', 0, 0)).toBeNull();
        expect(editedBody()).toBe(`${SERIAL}\r\n`);
    });

    it('keeps the open draft clean when a date format is set on the edited cell', () => {
        const { bridge, unitId, editedBody, editedDocumentModel, setDateFormat } = createNumfmtController();
        bridge.changeVisible({ visible: true, eventType: DeviceInputEventType.Keyboard, unitId });
        const draftDocumentModel = editedDocumentModel();

        setDateFormat();

        expect(editedDocumentModel()).toBe(draftDocumentModel);
        expect(editedBody()).toBe(`${SERIAL}\r\n`);
        expect(bridge.getEditorDirty()).toBe(false);
    });
});

describe('EditorDataSyncController row and column change refresh with real sheet providers', () => {
    /** B13:D17 of the grid sheet; C14 (row 13, column 2) is the selected cell. */
    const BLOCK = [
        ['b13', 'c13', 'd13'],
        ['b14', 'c14', 'd14'],
        ['b15', 'c15', 'd15'],
        ['b16', 'c16', 'd16'],
        ['b17', 'c17', 'd17'],
    ];
    const SELECTED = { row: 13, column: 2 };
    const C14_TO_C16 = { startRow: 13, endRow: 15, startColumn: 2, endColumn: 2 };
    /** Another workbook of the bed. Its sheet has the id of the edited sheet, so only the workbook differs. */
    const OTHER_WORKBOOK = 'other-book';

    /** Mutations that move C14 when they change its own sheet, and where C14 goes. */
    const MOVES_SELECTED_CELL_CASES = [
        { change: 'inserts a row above row 14', command: insertRows(rows(13)), followed: { row: 14, column: 2 } },
        { change: 'removes row 13', command: removeRows(rows(12)), followed: { row: 12, column: 2 } },
        { change: 'moves row 15 above row 14', command: moveRows(rows(14), rows(13)), followed: { row: 14, column: 2 } },
        { change: 'inserts a column before column C', command: insertColumns(columns(2)), followed: { row: 13, column: 3 } },
        { change: 'removes column B', command: removeColumns(columns(1)), followed: { row: 13, column: 1 } },
        { change: 'moves column D before column C', command: moveColumns(columns(3), columns(2)), followed: { row: 13, column: 3 } },
    ];

    function createStructureController() {
        const { injector, workbook, render, manager, commands } = createChartRenderTestBed();
        const worksheet = workbook.getSheetBySheetId('grid')!;
        const unitId = workbook.getUnitId();

        injector.add([FormulaEditorController, { useValue: { autoScroll: vi.fn() } as never }]);
        injector.add([IFormulaEditorManagerService, { useValue: { getPosition: () => null } as never }]);
        injector.add([RangeProtectionRuleModel, { useValue: { getRangeRuleInitState: () => true } as never }]);
        injector.add([WorksheetProtectionRuleModel, { useValue: { getSheetRuleInitState: () => true } as never }]);
        injector.add([EditorDataSyncController]);
        // EditingRenderController also listens to row and column changes (an open editor follows its cell). The
        // sheets-ui plugins create it after EditorDataSyncController, so its listener runs second here as well.
        injector.add([ICellEditorManagerService, { useClass: CellEditorManagerService }]);
        injector.add([LexerTreeBuilder]);
        injector.add([IFunctionService, { useValue: { getDescriptions: () => ({}) } as never }]);
        injector.add([SheetCellEditorResizeService, { useValue: { resizeCellEditor: vi.fn(), fitTextSize: vi.fn() } as never }]);
        injector.add([DocStateChangeManagerService, { useValue: { clearHistory: vi.fn() } as never }]);
        injector.add([EditingRenderController]);

        [
            InsertRowMutation,
            InsertColMutation,
            RemoveRowMutation,
            RemoveColMutation,
            MoveRowsMutation,
            MoveColsMutation,
            ReorderRangeMutation,
        ].forEach((mutation) => commands.registerCommand(mutation));
        // Opening the editor scrolls to the edit cell; the scroll render controller is not part of this bed.
        commands.registerCommand({ id: ScrollToRangeOperation.id, type: CommandType.OPERATION, handler: () => true });
        workbook.addWorksheet('other', 2, { id: 'other', name: 'other', rowCount: 50, columnCount: 20 });
        injector.get(IUniverInstanceService).createUnit(UniverInstanceType.UNIVER_SHEET, {
            id: OTHER_WORKBOOK,
            sheetOrder: ['grid'],
            sheets: { grid: { id: 'grid', rowCount: 50, columnCount: 20 } },
        }, { makeCurrent: false, skipAutoRender: true });
        manager.setCurrent({ sheetId: 'grid' });
        BLOCK.forEach((values, rowOffset) => values.forEach((value, columnOffset) => {
            worksheet.getCellMatrix().setValue(12 + rowOffset, 1 + columnOffset, { v: value });
        }));

        const controller = injector.get(EditorDataSyncController);
        const editingController = injector.get(EditingRenderController);
        onTestFinished(() => {
            editingController.dispose();
            controller.dispose();
        });

        const bridge = injector.get(IEditorBridgeService);
        bridge.setEditCell({
            unitId,
            sheetId: 'grid',
            scene: render.scene,
            engine: render.engine,
            primary: worksheet.getCellInfoInMergeData(SELECTED.row, SELECTED.column),
        });
        bridge.changeVisible({ visible: false, eventType: DeviceInputEventType.Keyboard, unitId });

        return {
            bridge,
            unitId,
            worksheet,
            editedDocumentModel: () => bridge.getEditCellState()?.documentLayoutObject.documentModel,
            editedBody: () => bridge.getEditCellState()?.documentLayoutObject.documentModel?.getBody()?.dataStream,
            editLocation: () => {
                const location = bridge.getEditLocation();
                return location && { row: location.row, column: location.column };
            },
            run: (command: StructureCommand, subUnitId = 'grid', targetUnitId = unitId) => {
                const { id, params } = command({ unitId: targetUnitId, subUnitId });
                expect(commands.syncExecuteCommand(id, params)).toBe(true);
            },
        };
    }

    it.each([
        { change: 'the selected row is removed', command: removeRows(rows(13)), text: 'c15' },
        { change: 'the row above the selected cell is removed', command: removeRows(rows(12)), text: 'c15' },
        { change: 'the selected column is removed', command: removeColumns(columns(2)), text: 'd14' },
        { change: 'the column before the selected cell is removed', command: removeColumns(columns(1)), text: 'd14' },
        { change: 'the selected row is moved two rows down', command: moveRows(rows(13), rows(16)), text: 'c15' },
        { change: 'the next row is moved above the selected row', command: moveRows(rows(14), rows(13)), text: 'c15' },
        { change: 'the selected column is moved one column right', command: moveColumns(columns(2), columns(4)), text: 'd14' },
        { change: 'the next column is moved before the selected column', command: moveColumns(columns(3), columns(2)), text: 'd14' },
        { change: 'a reorder puts the next row into the selected row', command: reorder(C14_TO_C16, { 13: 14, 14: 15, 15: 13 }), text: 'c15' },
        { change: 'a row is inserted above the selected row', command: insertRows(rows(13)), text: '' },
        { change: 'a column is inserted before the selected column', command: insertColumns(columns(2)), text: '' },
    ])('shows what the selected cell holds in a closed cell editor once $change', ({ command, text }) => {
        const { worksheet, editedBody, editLocation, run } = createStructureController();
        expect(editedBody()).toBe('c14\r\n');

        run(command);

        expect(worksheet.getCellRaw(SELECTED.row, SELECTED.column)?.v ?? '').toBe(text);
        // Opening the editor on the selected cell reuses this snapshot and submits to this location.
        expect(editedBody()).toBe(`${text}\r\n`);
        expect(editLocation()).toEqual(SELECTED);
    });

    it.each([
        { change: 'a row below the selected cell is removed', command: removeRows(rows(20)), subUnitId: 'grid' },
        { change: 'rows below the selected cell are moved', command: moveRows(rows(20), rows(25)), subUnitId: 'grid' },
        { change: 'the row above the same cell of another sheet is removed', command: removeRows(rows(12)), subUnitId: 'other' },
        { change: 'a column is inserted before the same cell of another sheet', command: insertColumns(columns(2)), subUnitId: 'other' },
    ])('keeps the closed cell editor snapshot when $change', ({ command, subUnitId }) => {
        const { editedDocumentModel, editedBody, editLocation, run } = createStructureController();
        const snapshot = editedDocumentModel();

        run(command, subUnitId);

        expect(editedDocumentModel()).toBe(snapshot);
        expect(editedBody()).toBe('c14\r\n');
        expect(editLocation()).toEqual(SELECTED);
    });

    it('keeps the open draft clean and follows the edited cell when the row above it is removed', () => {
        const { bridge, unitId, editedDocumentModel, editedBody, editLocation, run } = createStructureController();
        bridge.changeVisible({ visible: true, eventType: DeviceInputEventType.Keyboard, unitId });
        const draftDocumentModel = editedDocumentModel();

        run(removeRows(rows(12)));

        expect(editedDocumentModel()).toBe(draftDocumentModel);
        expect(editedBody()).toBe('c14\r\n');
        expect(bridge.getEditorDirty()).toBe(false);
        // The edited cell moved up one row, and the open editor still submits to it.
        expect(editLocation()).toEqual({ row: 12, column: 2 });
    });

    it('keeps the open draft clean on its coordinates when a reorder puts another row there', () => {
        const { bridge, unitId, editedDocumentModel, editedBody, editLocation, run } = createStructureController();
        bridge.changeVisible({ visible: true, eventType: DeviceInputEventType.Keyboard, unitId });
        const draftDocumentModel = editedDocumentModel();

        run(reorder(C14_TO_C16, { 13: 14, 14: 15, 15: 13 }));

        expect(editedDocumentModel()).toBe(draftDocumentModel);
        expect(editedBody()).toBe('c14\r\n');
        expect(bridge.getEditorDirty()).toBe(false);
        expect(editLocation()).toEqual(SELECTED);
    });

    it.each(MOVES_SELECTED_CELL_CASES)('keeps an open editor on C14 when a mutation $change of another sheet', ({ command }) => {
        const { bridge, unitId, editedDocumentModel, editedBody, editLocation, run } = createStructureController();
        bridge.changeVisible({ visible: true, eventType: DeviceInputEventType.Keyboard, unitId });
        const draftDocumentModel = editedDocumentModel();

        run(command, 'other');

        // The open editor submits its draft to this location when editing ends.
        expect(editLocation()).toEqual(SELECTED);
        expect(editedDocumentModel()).toBe(draftDocumentModel);
        expect(editedBody()).toBe('c14\r\n');
        expect(bridge.getEditorDirty()).toBe(false);
    });

    it.each(MOVES_SELECTED_CELL_CASES)('keeps an open editor on C14 when a mutation $change of the same sheet in another workbook', ({ command }) => {
        const { bridge, unitId, editedDocumentModel, editedBody, editLocation, run } = createStructureController();
        bridge.changeVisible({ visible: true, eventType: DeviceInputEventType.Keyboard, unitId });
        const draftDocumentModel = editedDocumentModel();

        run(command, 'grid', OTHER_WORKBOOK);

        expect(editLocation()).toEqual(SELECTED);
        expect(editedDocumentModel()).toBe(draftDocumentModel);
        expect(editedBody()).toBe('c14\r\n');
        expect(bridge.getEditorDirty()).toBe(false);
    });

    it.each(MOVES_SELECTED_CELL_CASES)('moves an open editor along with C14 when a mutation $change of its own sheet', ({ command, followed }) => {
        const { bridge, unitId, editedDocumentModel, editedBody, editLocation, run } = createStructureController();
        bridge.changeVisible({ visible: true, eventType: DeviceInputEventType.Keyboard, unitId });
        const draftDocumentModel = editedDocumentModel();

        run(command);

        expect(editLocation()).toEqual(followed);
        expect(editedDocumentModel()).toBe(draftDocumentModel);
        expect(editedBody()).toBe('c14\r\n');
        expect(bridge.getEditorDirty()).toBe(false);
    });
});
