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

import type { Injector, IWorkbookData } from '@univerjs/core';
import { CellValueType, LocaleType } from '@univerjs/core';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LexerNode } from '../../../../engine/analysis/lexer-node';
import type { BaseAstNode } from '../../../../engine/ast-node/base-ast-node';
import { createFunctionTestBed } from '../../../__tests__/create-function-test-bed';
import { ErrorType } from '../../../../basics/error-type';
import { Lexer } from '../../../../engine/analysis/lexer';
import { AstTreeBuilder } from '../../../../engine/analysis/parser';
import { Interpreter } from '../../../../engine/interpreter/interpreter';
import { generateExecuteAstNodeData } from '../../../../engine/utils/ast-node-tool';
import { IFormulaCurrentConfigService } from '../../../../services/current-data.service';
import { IFunctionService } from '../../../../services/function.service';
import { IFormulaRuntimeService } from '../../../../services/runtime.service';
import { FUNCTION_NAMES_LOGICAL } from '../../../logical/function-names';
import { If } from '../../../logical/if';
import { FUNCTION_NAMES_MATH } from '../../../math/function-names';
import { Sum } from '../../../math/sum';
import { Sumifs } from '../../../math/sumifs';
import { Sumproduct } from '../../../math/sumproduct';
import { Compare } from '../../../meta/compare';
import { FUNCTION_NAMES_META } from '../../../meta/function-names';
import { Minus } from '../../../meta/minus';
import { Multiply } from '../../../meta/multiply';
import { Concatenate } from '../../../text/concatenate';
import { FUNCTION_NAMES_TEXT } from '../../../text/function-names';
import { getObjectValue } from '../../../util';
import { Countif } from '../../countif';
import { FUNCTION_NAMES_STATISTICAL } from '../../function-names';
import { Countifs } from '../index';

// A1:A6 = a b a c b a, B1:B6 = 1..6, D1:D3 = a b c
const getDerivedCriteriaWorkbookData = (): IWorkbookData => ({
    id: 'test',
    appVersion: '3.0.0-alpha',
    sheets: {
        sheet1: {
            id: 'sheet1',
            cellData: {
                0: { 0: { v: 'a', t: CellValueType.STRING }, 1: { v: 1, t: CellValueType.NUMBER }, 3: { v: 'a', t: CellValueType.STRING } },
                1: { 0: { v: 'b', t: CellValueType.STRING }, 1: { v: 2, t: CellValueType.NUMBER }, 3: { v: 'b', t: CellValueType.STRING } },
                2: { 0: { v: 'a', t: CellValueType.STRING }, 1: { v: 3, t: CellValueType.NUMBER }, 3: { v: 'c', t: CellValueType.STRING } },
                3: { 0: { v: 'c', t: CellValueType.STRING }, 1: { v: 4, t: CellValueType.NUMBER } },
                4: { 0: { v: 'b', t: CellValueType.STRING }, 1: { v: 5, t: CellValueType.NUMBER } },
                5: { 0: { v: 'a', t: CellValueType.STRING }, 1: { v: 6, t: CellValueType.NUMBER } },
            },
        },
    },
    locale: LocaleType.ZH_CN,
    name: '',
    sheetOrder: [],
    styles: {},
});

const getTestWorkbookData = (): IWorkbookData => {
    return {
        id: 'test',
        appVersion: '3.0.0-alpha',
        sheets: {
            sheet1: {
                id: 'sheet1',
                cellData: {
                    0: {
                        0: {
                            v: 1,
                            t: CellValueType.NUMBER,
                        },
                        1: {
                            v: 2,
                            t: CellValueType.NUMBER,
                        },
                        2: {
                            v: 3,
                            t: CellValueType.NUMBER,
                        },
                        3: {
                            v: 4,
                            t: CellValueType.NUMBER,
                        },
                        4: {
                            v: 'User001',
                            t: CellValueType.STRING,
                        },
                        5: {
                            v: 'Active',
                            t: CellValueType.STRING,
                        },
                        6: {
                            v: 'AP_Clerk',
                            t: CellValueType.STRING,
                        },
                        7: {
                            v: 'AP_Clerk',
                            t: CellValueType.STRING,
                        },
                        8: {
                            v: 'Vendor_Master',
                            t: CellValueType.STRING,
                        },
                        9: {
                            v: 'High',
                            t: CellValueType.STRING,
                        },
                    },
                    1: {
                        0: {
                            v: 2,
                            t: CellValueType.NUMBER,
                        },
                        1: {
                            v: 3,
                            t: CellValueType.NUMBER,
                        },
                        2: {
                            v: 4,
                            t: CellValueType.NUMBER,
                        },
                        3: {
                            v: 5,
                            t: CellValueType.NUMBER,
                        },
                        4: {
                            v: 'User001',
                            t: CellValueType.STRING,
                        },
                        5: {
                            v: 'Active',
                            t: CellValueType.STRING,
                        },
                        6: {
                            v: 'Vendor_Master',
                            t: CellValueType.STRING,
                        },
                        7: {
                            v: 'AR_Clerk',
                            t: CellValueType.STRING,
                        },
                        8: {
                            v: 'AR_Manager',
                            t: CellValueType.STRING,
                        },
                        9: {
                            v: 'Low',
                            t: CellValueType.STRING,
                        },
                    },
                    2: {
                        0: {
                            v: 3,
                            t: CellValueType.NUMBER,
                        },
                        1: {
                            v: 4,
                            t: CellValueType.NUMBER,
                        },
                        2: {
                            v: 5,
                            t: CellValueType.NUMBER,
                        },
                        3: {
                            v: 6,
                            t: CellValueType.NUMBER,
                        },
                        4: {
                            v: 'User001',
                            t: CellValueType.STRING,
                        },
                        5: {
                            v: 'Active',
                            t: CellValueType.STRING,
                        },
                        6: {
                            v: 'AR_Clerk',
                            t: CellValueType.STRING,
                        },
                        7: {
                            v: 'Payroll_Admin',
                            t: CellValueType.STRING,
                        },
                        8: {
                            v: 'GL_Accountant',
                            t: CellValueType.STRING,
                        },
                        9: {
                            v: 'Low',
                            t: CellValueType.STRING,
                        },
                    },
                    3: {
                        0: {
                            v: 4,
                            t: CellValueType.NUMBER,
                        },
                        1: {
                            v: 5,
                            t: CellValueType.NUMBER,
                        },
                        2: {
                            v: 6,
                            t: CellValueType.NUMBER,
                        },
                        3: {
                            v: 7,
                            t: CellValueType.NUMBER,
                        },
                    },
                    4: {
                        0: {
                            v: 'Compa',
                            t: CellValueType.STRING,
                        },
                        1: {
                            v: '<0.90',
                            t: CellValueType.STRING,
                        },
                        2: {
                            v: 0,
                            t: CellValueType.NUMBER,
                        },
                        3: {
                            v: 0.86,
                            t: CellValueType.NUMBER,
                        },
                    },
                    5: {
                        0: {
                            v: 'Compa',
                            t: CellValueType.STRING,
                        },
                        1: {
                            v: '0.90-1.00',
                            t: CellValueType.STRING,
                        },
                        2: {
                            v: 5,
                            t: CellValueType.NUMBER,
                        },
                    },
                    6: {
                        0: {
                            v: 'Compa',
                            t: CellValueType.STRING,
                        },
                        1: {
                            v: '1.00-1.10',
                            t: CellValueType.STRING,
                        },
                        2: {
                            v: 15,
                            t: CellValueType.NUMBER,
                        },
                    },
                },
            },
        },
        locale: LocaleType.ZH_CN,
        name: '',
        sheetOrder: [],
        styles: {},
    };
};

describe('Test countifs function', () => {
    let get: Injector['get'];
    let lexer: Lexer;
    let astTreeBuilder: AstTreeBuilder;
    let interpreter: Interpreter;
    let calculate: (formula: string) => (string | number | boolean | null)[][] | string | number | boolean;

    beforeEach(() => {
        const testBed = createFunctionTestBed(getTestWorkbookData());

        get = testBed.get;

        lexer = get(Lexer);
        astTreeBuilder = get(AstTreeBuilder);
        interpreter = get(Interpreter);

        const functionService = get(IFunctionService);

        const formulaCurrentConfigService = get(IFormulaCurrentConfigService);

        const formulaRuntimeService = get(IFormulaRuntimeService);

        formulaCurrentConfigService.load({
            formulaData: {},
            arrayFormulaCellData: {},
            arrayFormulaRange: {},
            forceCalculate: false,
            dirtyRanges: [],
            dirtyNameMap: {},
            dirtyDefinedNameMap: {},
            dirtyUnitFeatureMap: {},
            dirtyUnitOtherFormulaMap: {},
            excludedCell: {},
            allUnitData: {
                [testBed.unitId]: testBed.sheetData,
            },
        });

        const sheetItem = testBed.sheetData[testBed.sheetId];

        formulaRuntimeService.setCurrent(
            0,
            0,
            sheetItem.rowCount,
            sheetItem.columnCount,
            testBed.sheetId,
            testBed.unitId
        );

        functionService.registerExecutors(
            new Countifs(FUNCTION_NAMES_STATISTICAL.COUNTIFS),
            new Sumproduct(FUNCTION_NAMES_MATH.SUMPRODUCT),
            new If(FUNCTION_NAMES_LOGICAL.IF),
            new Compare(FUNCTION_NAMES_META.COMPARE),
            new Multiply(FUNCTION_NAMES_META.MULTIPLY),
            new Minus(FUNCTION_NAMES_META.MINUS)
        );

        calculate = (formula: string) => {
            const lexerNode = lexer.treeBuilder(formula);

            const astNode = astTreeBuilder.parse(lexerNode as LexerNode);

            const result = interpreter.execute(generateExecuteAstNodeData(astNode as BaseAstNode));

            return getObjectValue(result);
        };
    });

    describe('Countifs', () => {
        it('Value is normal', async () => {
            const result = await calculate('=COUNTIFS(A1:A4,">3")');
            expect(result).toBe(1);
        });

        it('Value is array', async () => {
            const result = await calculate('=COUNTIFS({1;2;3;4},">3")');
            expect(result).toBe(ErrorType.VALUE);
        });

        it('Range and criteria is not paired', async () => {
            const result = await calculate('=COUNTIFS(A1:A4,">3",C1:C4)');
            expect(result).toBe(ErrorType.VALUE);
        });

        it('Range is different size', async () => {
            const result = await calculate('=COUNTIFS(A1:A4,">3",C1:C3,{"=5","=6"})');
            expect(result).toStrictEqual([
                [ErrorType.VALUE, ErrorType.VALUE],
            ]);
        });

        it('Range and array criteria', async () => {
            const result = await calculate('=COUNTIFS(A1:A4,{">1";">2"})');
            expect(result).toStrictEqual([
                [3],
                [2],
            ]);
        });

        it('Two ranges and criteria', async () => {
            const result = await calculate('=COUNTIFS(A1:A4,">2",C1:C4,"=5")');
            expect(result).toBe(1);
        });

        it('Two ranges and criteria, criteria is array', async () => {
            const result = await calculate('=COUNTIFS(A1:A4,">2",C1:C4,{">4";">5"})');
            expect(result).toStrictEqual([
                [2],
                [1],
            ]);
        });

        it('Multiple array criteria are paired by position', async () => {
            const result = await calculate('=COUNTIFS(A1:A4,">0",C1:C4,{3;5},D1:D4,{4;7})');
            expect(result).toStrictEqual([
                [1],
                [0],
            ]);
        });

        it('Array criteria remain paired inside SUMPRODUCT masks', async () => {
            const result = await calculate('=SUMPRODUCT({0;1;1},COUNTIFS(E1:E3,"User001",F1:F3,"Active",G1:G3,{"AP_Clerk";"AR_Clerk";"Payroll_Admin"}),COUNTIFS(E1:E3,"User001",F1:F3,"Active",G1:G3,{"Vendor_Master";"AR_Manager";"GL_Accountant"}))');
            expect(result).toBe(0);
        });

        it('COUNTIFS array results compare element-wise inside SUMPRODUCT masks', async () => {
            const result = await calculate('=SUMPRODUCT(--({"High";"Low";"Low"}="Low"),--(COUNTIFS(E1:E3,"User001",F1:F3,"Active",G1:G3,{"AP_Clerk";"AR_Clerk";"Payroll_Admin"})>0),--(COUNTIFS(E1:E3,"User001",F1:F3,"Active",G1:G3,{"Vendor_Master";"AR_Manager";"GL_Accountant"})>0))');
            expect(result).toBe(0);
        });

        it('COUNTIFS criteria ranges compare element-wise inside SUMPRODUCT masks', async () => {
            const result = await calculate('=SUMPRODUCT(--(J1:J3="Low"),--(COUNTIFS(E1:E3,"User001",F1:F3,"Active",G1:G3,H1:H3)>0),--(COUNTIFS(E1:E3,"User001",F1:F3,"Active",G1:G3,I1:I3)>0))');
            expect(result).toBe(0);
        });

        it('SUMPRODUCT uses scalar IF criteria without shifting range masks', async () => {
            const result = await calculate('=SUMPRODUCT((A5:A7="Compa")*(B5:B7=IF(D5<0.9,"<0.90",IF(D5<1,"0.90-1.00",IF(D5<1.1,"1.00-1.10",">1.10"))))*C5:C7)');
            expect(result).toBe(0);
        });

        it('Excludes blank cells in less-than text criteria', async () => {
            const result = await calculate('=COUNTIFS(B5:B8,"<1 hour")');
            expect(result).toBe(2);
        });
    });
});

describe('Test countifs function with a derived criteria array', () => {
    let calculateAt: (formula: string, row: number, column: number) => ReturnType<typeof getObjectValue>;

    beforeEach(() => {
        const testBed = createFunctionTestBed(getDerivedCriteriaWorkbookData());
        const get = testBed.get;

        const lexer = get(Lexer);
        const astTreeBuilder = get(AstTreeBuilder);
        const interpreter = get(Interpreter);
        const formulaCurrentConfigService = get(IFormulaCurrentConfigService);
        const formulaRuntimeService = get(IFormulaRuntimeService);

        formulaCurrentConfigService.load({
            formulaData: {},
            arrayFormulaCellData: {},
            arrayFormulaRange: {},
            forceCalculate: false,
            dirtyRanges: [],
            dirtyNameMap: {},
            dirtyDefinedNameMap: {},
            dirtyUnitFeatureMap: {},
            dirtyUnitOtherFormulaMap: {},
            excludedCell: {},
            allUnitData: {
                [testBed.unitId]: testBed.sheetData,
            },
        });

        get(IFunctionService).registerExecutors(
            new Countifs(FUNCTION_NAMES_STATISTICAL.COUNTIFS),
            new Countif(FUNCTION_NAMES_STATISTICAL.COUNTIF),
            new Sumifs(FUNCTION_NAMES_MATH.SUMIFS),
            new Sum(FUNCTION_NAMES_MATH.SUM),
            new Sumproduct(FUNCTION_NAMES_MATH.SUMPRODUCT),
            new Concatenate(FUNCTION_NAMES_TEXT.CONCATENATE)
        );

        const sheetItem = testBed.sheetData[testBed.sheetId];

        calculateAt = (formula: string, row: number, column: number) => {
            formulaRuntimeService.setCurrent(row, column, sheetItem.rowCount, sheetItem.columnCount, testBed.sheetId, testBed.unitId);

            const lexerNode = lexer.treeBuilder(formula);
            const astNode = astTreeBuilder.parse(lexerNode as LexerNode);
            const result = interpreter.execute(generateExecuteAstNodeData(astNode as BaseAstNode));

            return getObjectValue(result);
        };
    });

    describe.each([
        ['a row the criteria range crosses', 1],
        ['a row the criteria range does not cross', 8],
    ])('formula on %s', (_rowLabel, row) => {
        it('counts every criterion of a criteria array built with &', () => {
            expect(calculateAt('=COUNTIFS(A1:A6,D1:D3&"")', row, 10)).toStrictEqual([[3], [2], [1]]);
            expect(calculateAt('=SUM(COUNTIFS(A1:A6,D1:D3&""))', row, 10)).toBe(6);
            expect(calculateAt('=SUMPRODUCT(COUNTIFS(A1:A6,D1:D3&""))', row, 10)).toBe(6);
        });

        it('counts every criterion of a criteria range', () => {
            expect(calculateAt('=COUNTIFS(A1:A6,D1:D3)', row, 10)).toStrictEqual([[3], [2], [1]]);
        });

        it('matches COUNTIF and SUMIFS over the same criteria array', () => {
            expect(calculateAt('=SUMPRODUCT(COUNTIF(A1:A6,D1:D3&""))', row, 10)).toBe(6);
            expect(calculateAt('=SUMPRODUCT(SUMIFS(B1:B6,A1:A6,D1:D3&""))', row, 10)).toBe(21);
        });
    });
});
