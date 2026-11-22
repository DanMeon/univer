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

import type { IWorkbookData } from '@univerjs/core';
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
import { ArrayValueObject, transformToValueObject } from '../../../../engine/value-object/array-value-object';
import { BooleanValueObject, NullValueObject, NumberValueObject, StringValueObject } from '../../../../engine/value-object/primitive-object';
import { IFormulaCurrentConfigService } from '../../../../services/current-data.service';
import { IFunctionService } from '../../../../services/function.service';
import { IFormulaRuntimeService } from '../../../../services/runtime.service';
import { Choose } from '../../../lookup/choose';
import { FUNCTION_NAMES_LOOKUP } from '../../../lookup/function-names';
import { Index } from '../../../lookup/index/index';
import { Vlookup } from '../../../lookup/vlookup';
import { Xlookup } from '../../../lookup/xlookup';
import { FUNCTION_NAMES_MATH } from '../../../math/function-names';
import { Sum } from '../../../math/sum';
import { Sumproduct } from '../../../math/sumproduct';
import { Compare } from '../../../meta/compare';
import { FUNCTION_NAMES_META } from '../../../meta/function-names';
import { Multiply } from '../../../meta/multiply';
import { Plus } from '../../../meta/plus';
import { Average } from '../../../statistical/average';
import { Counta } from '../../../statistical/counta';
import { FUNCTION_NAMES_STATISTICAL } from '../../../statistical/function-names';
import { Max } from '../../../statistical/max';
import { Concatenate } from '../../../text/concatenate';
import { FUNCTION_NAMES_TEXT } from '../../../text/function-names';
import { Textjoin } from '../../../text/textjoin';
import { getObjectValue } from '../../../util';
import { FUNCTION_NAMES_LOGICAL } from '../../function-names';
import { Iferror } from '../../iferror';
import { Ifs } from '../../ifs';
import { If } from '../index';

// Sheet1: A1:A6 = a b a c b a, B1:B6 = 1..6, D1:D3 = a b c, H1:H3 = 1 2 3, I1:I3 = 4 5 6.
// Small is a sheet of one cell, so a formula on it is evaluated with a formula range of one cell.
const getFormulaWorkbookData = (): IWorkbookData => ({
    id: 'test',
    appVersion: '3.0.0-alpha',
    sheets: {
        sheet1: {
            id: 'sheet1',
            name: 'Sheet1',
            cellData: {
                0: {
                    0: { v: 'a', t: CellValueType.STRING },
                    1: { v: 1, t: CellValueType.NUMBER },
                    3: { v: 'a', t: CellValueType.STRING },
                    7: { v: 1, t: CellValueType.NUMBER },
                    8: { v: 4, t: CellValueType.NUMBER },
                },
                1: {
                    0: { v: 'b', t: CellValueType.STRING },
                    1: { v: 2, t: CellValueType.NUMBER },
                    3: { v: 'b', t: CellValueType.STRING },
                    7: { v: 2, t: CellValueType.NUMBER },
                    8: { v: 5, t: CellValueType.NUMBER },
                },
                2: {
                    0: { v: 'a', t: CellValueType.STRING },
                    1: { v: 3, t: CellValueType.NUMBER },
                    3: { v: 'c', t: CellValueType.STRING },
                    7: { v: 3, t: CellValueType.NUMBER },
                    8: { v: 6, t: CellValueType.NUMBER },
                },
                3: { 0: { v: 'c', t: CellValueType.STRING }, 1: { v: 4, t: CellValueType.NUMBER } },
                4: { 0: { v: 'b', t: CellValueType.STRING }, 1: { v: 5, t: CellValueType.NUMBER } },
                5: { 0: { v: 'a', t: CellValueType.STRING }, 1: { v: 6, t: CellValueType.NUMBER } },
            },
        },
        small: {
            id: 'small',
            name: 'Small',
            rowCount: 1,
            columnCount: 1,
            cellData: {},
        },
    },
    locale: LocaleType.ZH_CN,
    name: '',
    sheetOrder: ['sheet1', 'small'],
    styles: {},
});

describe('Test if function', () => {
    const testFunction = new If(FUNCTION_NAMES_LOGICAL.IF);

    describe('If', () => {
        it('LogicalTest and valueIfTrue', () => {
            const logicTest = BooleanValueObject.create(true);
            const valueIfTrue = NumberValueObject.create(1);
            const result = testFunction.calculate(logicTest, valueIfTrue);
            expect(getObjectValue(result)).toBe(1);
        });

        it('LogicalTest and valueIfTrue and valueIfFalse', () => {
            const logicTest = BooleanValueObject.create(false);
            const valueIfTrue = NumberValueObject.create(1);
            const valueIfFalse = NumberValueObject.create(2);
            const result = testFunction.calculate(logicTest, valueIfTrue, valueIfFalse);
            expect(getObjectValue(result)).toBe(2);
        });

        it('LogicalTest coerces Excel-compatible scalar values', () => {
            const valueIfTrue = StringValueObject.create('yes');
            const valueIfFalse = StringValueObject.create('no');

            expect(getObjectValue(testFunction.calculate(NumberValueObject.create(0), valueIfTrue, valueIfFalse))).toBe('no');
            expect(getObjectValue(testFunction.calculate(NumberValueObject.create(2), valueIfTrue, valueIfFalse))).toBe('yes');
            expect(getObjectValue(testFunction.calculate(StringValueObject.create('FALSE'), valueIfTrue, valueIfFalse))).toBe('no');
            expect(getObjectValue(testFunction.calculate(StringValueObject.create('TRUE'), valueIfTrue, valueIfFalse))).toBe('yes');
            expect(getObjectValue(testFunction.calculate(StringValueObject.create(''), valueIfTrue, valueIfFalse))).toBe(ErrorType.VALUE);
            expect(getObjectValue(testFunction.calculate(StringValueObject.create('0'), valueIfTrue, valueIfFalse))).toBe(ErrorType.VALUE);
        });

        it('LogicalTest is array', () => {
            const logicTest = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    [false],
                    [true],
                    [true],
                ]),
                rowCount: 3,
                columnCount: 1,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });
            const valueIfTrue = NumberValueObject.create(1);
            const result = testFunction.calculate(logicTest, valueIfTrue);
            expect(getObjectValue(result)).toStrictEqual([
                [false],
                [1],
                [1],
            ]);
        });

        it('ValueIfTrue is array', () => {
            const logicTest = BooleanValueObject.create(true);
            const valueIfTrue = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    [1],
                    [2],
                    [3],
                ]),
                rowCount: 3,
                columnCount: 1,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });
            const result = testFunction.calculate(logicTest, valueIfTrue);
            expect(getObjectValue(result)).toStrictEqual([
                [1],
                [2],
                [3],
            ]);
        });
        it('ValueIfTrue is array, set false', () => {
            const logicTest = BooleanValueObject.create(false);
            const valueIfTrue = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    [1],
                    [2],
                    [3],
                ]),
                rowCount: 3,
                columnCount: 1,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });
            const result = testFunction.calculate(logicTest, valueIfTrue);
            expect(getObjectValue(result)).toBe(false);
        });

        it('Direct IF preserves selected reference-derived array for scalar condition', () => {
            testFunction.setRefInfo('unit', 'summary', 11, 0);

            const logicTest = BooleanValueObject.create(false);
            const valueIfTrue = NumberValueObject.create(1);
            const valueIfFalse = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    [false],
                    [true],
                    [false],
                ]),
                rowCount: 3,
                columnCount: 1,
                unitId: 'unit',
                sheetId: 'data',
                row: 10,
                column: 3,
            });
            const result = testFunction.calculate(logicTest, valueIfTrue, valueIfFalse);
            expect(getObjectValue(result)).toStrictEqual([[false], [true], [false]]);
        });

        it('Direct IF evaluates a reference-derived logical test array as a whole on a row it crosses', () => {
            testFunction.setRefInfo('unit', 'summary', 11, 0);

            const logicTest = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    [true],
                    [false],
                    [true],
                ]),
                rowCount: 3,
                columnCount: 1,
                unitId: 'unit',
                sheetId: 'data',
                row: 10,
                column: 0,
            });
            const valueIfTrue = StringValueObject.create('blank');
            const valueIfFalse = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    ['first'],
                    ['second'],
                    ['third'],
                ]),
                rowCount: 3,
                columnCount: 1,
                unitId: 'unit',
                sheetId: 'data',
                row: 10,
                column: 0,
            });
            const result = testFunction.calculate(logicTest, valueIfTrue, valueIfFalse);
            expect(getObjectValue(result)).toStrictEqual([['blank'], ['second'], ['blank']]);
        });

        it('Direct IF evaluates a reference-derived logical test array as a whole on a row it does not cross', () => {
            testFunction.setRefInfo('unit', 'summary', 23, 0);

            const logicTest = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    [false],
                    [false],
                    [true],
                ]),
                rowCount: 3,
                columnCount: 1,
                unitId: 'unit',
                sheetId: 'data',
                row: 12,
                column: 0,
            });
            const valueIfTrue = StringValueObject.create('blank');
            const valueIfFalse = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    ['first'],
                    ['second'],
                    ['third'],
                ]),
                rowCount: 3,
                columnCount: 1,
                unitId: 'unit',
                sheetId: 'data',
                row: 12,
                column: 0,
            });
            const result = testFunction.calculate(logicTest, valueIfTrue, valueIfFalse);
            expect(getObjectValue(result)).toStrictEqual([['first'], ['second'], ['blank']]);
        });

        it('Direct IF evaluates reference-derived logical test and value arrays as a whole', () => {
            testFunction.setRefInfo('unit', 'summary', 4, 11);

            const logicTest = ArrayValueObject.create({
                calculateValueList: transformToValueObject([[true], [false], [true]]),
                rowCount: 3,
                columnCount: 1,
                unitId: 'unit',
                sheetId: 'data',
                row: 4,
                column: 0,
            });
            const valueIfTrue = ArrayValueObject.create({
                calculateValueList: transformToValueObject([[5], [6], [7]]),
                rowCount: 3,
                columnCount: 1,
                unitId: 'unit',
                sheetId: 'data',
                row: 4,
                column: 2,
            });

            expect(getObjectValue(testFunction.calculate(logicTest, valueIfTrue))).toStrictEqual([[5], [false], [7]]);
        });

        it('ValueIfFalse is array', () => {
            const logicTest = BooleanValueObject.create(false);
            const valueIfTrue = NumberValueObject.create(1);
            const valueIfFalse = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    [1],
                    [2],
                    [3],
                ]),
                rowCount: 3,
                columnCount: 1,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });
            const result = testFunction.calculate(logicTest, valueIfTrue, valueIfFalse);
            expect(getObjectValue(result)).toStrictEqual([
                [1],
                [2],
                [3],
            ]);
        });

        it('LogicalTest is array and valueIfTrue is array', () => {
            const logicTest = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    [true],
                    [false],
                    [1],
                    [0],
                ]),
                rowCount: 4,
                columnCount: 1,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });
            const valueIfTrue = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    [1],
                    [2],
                    [3],
                    [4],
                    [5],
                ]),
                rowCount: 5,
                columnCount: 1,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });
            const result = testFunction.calculate(logicTest, valueIfTrue);
            expect(getObjectValue(result)).toStrictEqual([
                [1],
                [false],
                [3],
                [false],
                ['#N/A'],
            ]);
        });

        it('LogicalTest is array and valueIfFalse is array', () => {
            const logicTest = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    [true],
                    [false],
                    [1],
                    [0],
                ]),
                rowCount: 4,
                columnCount: 1,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });

            const valueIfTrue = StringValueObject.create('yes');

            const valueIfFalse = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    [1],
                    [2],
                    [3],
                ]),
                rowCount: 3,
                columnCount: 1,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });
            const result = testFunction.calculate(logicTest, valueIfTrue, valueIfFalse);
            expect(getObjectValue(result)).toStrictEqual([
                ['yes'],
                [2],
                ['yes'],
                ['#N/A'],
            ]);
        });

        it('ValueIfTrue is array and valueIfFalse is array', () => {
            const logicTest = BooleanValueObject.create(true);

            const valueIfTrue = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    [1],
                    [2],
                    [3],
                    [4],
                    [5],
                ]),
                rowCount: 5,
                columnCount: 1,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });

            const valueIfFalse = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    [6],
                    [7],
                    [8],
                    [9],
                ]),
                rowCount: 4,
                columnCount: 1,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });
            const result = testFunction.calculate(logicTest, valueIfTrue, valueIfFalse);
            expect(getObjectValue(result)).toStrictEqual([
                [1],
                [2],
                [3],
                [4],
                [5],
            ]);
        });

        it('LogicalTest is array and valueIfTrue is array and valueIfFalse is array', () => {
            const logicTest = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    [true],
                    [false],
                    [1],
                    [0],
                ]),
                rowCount: 4,
                columnCount: 1,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });

            const valueIfTrue = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    [1],
                    [2],
                    [3],
                    [4],
                    [5],
                ]),
                rowCount: 5,
                columnCount: 1,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });

            const valueIfFalse = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    [6],
                    [7],
                    [8],
                    [9],
                    [10],
                ]),
                rowCount: 5,
                columnCount: 1,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });
            const result = testFunction.calculate(logicTest, valueIfTrue, valueIfFalse);
            expect(getObjectValue(result)).toStrictEqual([
                [1],
                [7],
                [3],
                [9],
                ['#N/A'],
            ]);
        });

        it('LogicalTest is 3*2 array and 1*4 valueIfTrue is array and 1*3 valueIfFalse is array', () => {
            const logicTest = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    [false, true],
                    [true, true],
                    [false, true],
                ]),
                rowCount: 3,
                columnCount: 2,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });

            const valueIfTrue = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    ['yes1', 'yes2', 'yes3', 'yes4'],
                ]),
                rowCount: 1,
                columnCount: 4,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });

            const valueIfFalse = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    ['no1', 'no2', 'no3'],
                ]),
                rowCount: 1,
                columnCount: 3,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });
            const result = testFunction.calculate(logicTest, valueIfTrue, valueIfFalse);
            expect(getObjectValue(result)).toStrictEqual([
                ['no1', 'yes2', '#N/A', '#N/A'],
                ['yes1', 'yes2', '#N/A', '#N/A'],
                ['no1', 'yes2', '#N/A', '#N/A'],
            ]);
        });

        it('LogicalTest is 2*1 array and 3*4 valueIfTrue is array and 4*3 valueIfFalse is array', () => {
            const logicTest = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    [false],
                    [true],
                ]),
                rowCount: 2,
                columnCount: 1,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });

            const valueIfTrue = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    ['yes1', 'yes2', 'yes3', 'yes4'],
                    ['yes2', 'yes3', 'yes4', 'yes5'],
                    ['yes3', 'yes4', 'yes5', 'yes6'],
                ]),
                rowCount: 3,
                columnCount: 4,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });

            const valueIfFalse = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    ['no1', 'no2', 'no3'],
                    ['no2', 'no3', 'no4'],
                    ['no3', 'no4', 'no5'],
                    ['no4', 'no5', 'no6'],
                ]),
                rowCount: 4,
                columnCount: 3,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });
            const result = testFunction.calculate(logicTest, valueIfTrue, valueIfFalse);
            expect(getObjectValue(result)).toStrictEqual([
                ['no1', 'no2', 'no3', '#N/A'],
                ['yes2', 'yes3', 'yes4', 'yes5'],
                ['#N/A', '#N/A', '#N/A', '#N/A'],
                ['#N/A', '#N/A', '#N/A', '#N/A'],
            ]);
        });

        it('LogicalTest is 1*2 array and 3*4 valueIfTrue is array and 4*3 valueIfFalse is array', () => {
            const logicTest = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    [false, true],
                ]),
                rowCount: 1,
                columnCount: 2,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });

            const valueIfTrue = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    ['yes1', 'yes2', 'yes3', 'yes4'],
                    ['yes2', 'yes3', 'yes4', 'yes5'],
                    ['yes3', 'yes4', 'yes5', 'yes6'],
                ]),
                rowCount: 3,
                columnCount: 4,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });

            const valueIfFalse = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    ['no1', 'no2', 'no3'],
                    ['no2', 'no3', 'no4'],
                    ['no3', 'no4', 'no5'],
                    ['no4', 'no5', 'no6'],
                ]),
                rowCount: 4,
                columnCount: 3,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });
            const result = testFunction.calculate(logicTest, valueIfTrue, valueIfFalse);
            expect(getObjectValue(result)).toStrictEqual([
                ['no1', 'yes2', '#N/A', '#N/A'],
                ['no2', 'yes3', '#N/A', '#N/A'],
                ['no3', 'yes4', '#N/A', '#N/A'],
                ['no4', '#N/A', '#N/A', '#N/A'],
            ]);
        });

        it('LogicalTest is 3*1 array and 1*4 valueIfTrue is array and 1*3 valueIfFalse is array', () => {
            const logicTest = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    [false],
                    [true],
                    [false],
                ]),
                rowCount: 3,
                columnCount: 1,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });

            const valueIfTrue = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    ['yes1', 'yes2', 'yes3', 'yes4'],
                ]),
                rowCount: 1,
                columnCount: 4,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });

            const valueIfFalse = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    ['no1', 'no2', 'no3'],
                ]),
                rowCount: 1,
                columnCount: 3,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });
            const result = testFunction.calculate(logicTest, valueIfTrue, valueIfFalse);
            expect(getObjectValue(result)).toStrictEqual([
                ['no1', 'no2', 'no3', '#N/A'],
                ['yes1', 'yes2', 'yes3', 'yes4'],
                ['no1', 'no2', 'no3', '#N/A'],
            ]);
        });

        it('More test', () => {
            const logicTest = NullValueObject.create();
            const valueIfTrue = NumberValueObject.create(1);
            const valueIfFalse = NumberValueObject.create(2);
            const result = testFunction.calculate(logicTest, valueIfTrue, valueIfFalse);
            expect(getObjectValue(result)).toBe(2);

            const logicTest2 = BooleanValueObject.create(true);
            const valueIfTrue2 = NullValueObject.create();
            const valueIfFalse2 = NumberValueObject.create(2);
            const result2 = testFunction.calculate(logicTest2, valueIfTrue2, valueIfFalse2);
            expect(getObjectValue(result2)).toBe(0);

            const logicTest3 = BooleanValueObject.create(false);
            const valueIfTrue3 = NumberValueObject.create(1);
            const valueIfFalse3 = NullValueObject.create();
            const result3 = testFunction.calculate(logicTest3, valueIfTrue3, valueIfFalse3);
            expect(getObjectValue(result3)).toBe(0);
        });
    });

    describe('If in a formula', () => {
        let calculateAt: (formula: string, row: number, column: number, sheetId?: string) => ReturnType<typeof getObjectValue>;

        beforeEach(() => {
            const testBed = createFunctionTestBed(getFormulaWorkbookData());
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
                new If(FUNCTION_NAMES_LOGICAL.IF),
                new Iferror(FUNCTION_NAMES_LOGICAL.IFERROR),
                new Ifs(FUNCTION_NAMES_LOGICAL.IFS),
                new Sum(FUNCTION_NAMES_MATH.SUM),
                new Sumproduct(FUNCTION_NAMES_MATH.SUMPRODUCT),
                new Average(FUNCTION_NAMES_STATISTICAL.AVERAGE),
                new Max(FUNCTION_NAMES_STATISTICAL.MAX),
                new Counta(FUNCTION_NAMES_STATISTICAL.COUNTA),
                new Vlookup(FUNCTION_NAMES_LOOKUP.VLOOKUP),
                new Index(FUNCTION_NAMES_LOOKUP.INDEX),
                new Choose(FUNCTION_NAMES_LOOKUP.CHOOSE),
                new Xlookup(FUNCTION_NAMES_LOOKUP.XLOOKUP),
                new Concatenate(FUNCTION_NAMES_TEXT.CONCATENATE),
                new Textjoin(FUNCTION_NAMES_TEXT.TEXTJOIN),
                new Compare(FUNCTION_NAMES_META.COMPARE),
                new Plus(FUNCTION_NAMES_META.PLUS),
                new Multiply(FUNCTION_NAMES_META.MULTIPLY)
            );

            calculateAt = (formula: string, row: number, column: number, sheetId: string = 'sheet1') => {
                const sheetItem = testBed.sheetData[sheetId];
                formulaRuntimeService.setCurrent(row, column, sheetItem.rowCount, sheetItem.columnCount, sheetId, testBed.unitId);

                const lexerNode = lexer.treeBuilder(formula);
                const astNode = astTreeBuilder.parse(lexerNode as LexerNode);
                const result = interpreter.execute(generateExecuteAstNodeData(astNode as BaseAstNode));

                return getObjectValue(result);
            };
        });

        describe.each([
            ['a row the ranges cross', 1],
            ['a row the ranges do not cross', 8],
        ])('formula on %s', (_rowLabel, row) => {
            it('hands the whole selected range of a scalar test to the enclosing function', () => {
                expect(calculateAt('=SUM(IF(H1>0,H1:H3,I1:I3))', row, 10)).toBe(6);
                expect(calculateAt('=SUM(IF(H1>5,H1:H3,I1:I3))', row, 10)).toBe(15);
                expect(calculateAt('=AVERAGE(IF(H1>0,H1:H3,I1:I3))', row, 10)).toBe(2);
                expect(calculateAt('=MAX(IF(H1>0,H1:H3,I1:I3))', row, 10)).toBe(3);
                expect(calculateAt('=COUNTA(IF(TRUE,A1:A6,D1:D3))', row, 10)).toBe(6);
                expect(calculateAt('=VLOOKUP("b",IF(TRUE,A1:B6,A1:B6),2,0)', row, 10)).toStrictEqual([[2]]);
                expect(calculateAt('=VLOOKUP("b",IF(TRUE,A1:B6,A1:B6),2,0)', row, 10)).toStrictEqual(calculateAt('=VLOOKUP("b",A1:B6,2,0)', row, 10));
                expect(calculateAt('=INDEX(IF(H1>0,H1:H3,I1:I3),3)', row, 10)).toStrictEqual([[3]]);
                expect(calculateAt('=INDEX(IF(H1>0,H1:H3,I1:I3),3)', row, 10)).toStrictEqual(calculateAt('=INDEX(H1:H3,3)', row, 10));
                expect(calculateAt('=SUM(IFERROR(IF(H1>0,H1:H3,I1:I3),0))', row, 10)).toBe(6);
            });

            it('hands the whole selected range of a scalar test to an operator', () => {
                expect(calculateAt('=SUM(IF(H1>0,H1:H3,I1:I3)*2)', row, 10)).toBe(12);
            });

            it('hands the whole selected array of a scalar test on', () => {
                expect(calculateAt('=SUM(IF(H1>0,H1:H3*1,I1:I3))', row, 10)).toBe(6);
                expect(calculateAt('=IF(TRUE,H1:H3&"",0)', row, 10)).toStrictEqual([['1'], ['2'], ['3']]);
            });

            it('returns the whole selected range of a scalar test at the top level', () => {
                expect(calculateAt('=IF(H1>0,H1:H3,I1:I3)', row, 10)).toStrictEqual([[1], [2], [3]]);
            });

            it('keeps a selected single cell a single value', () => {
                expect(calculateAt('=IF(TRUE,H2,0)', row, 10)).toBe(2);
            });

            it('keeps the results that never depended on the formula row', () => {
                expect(calculateAt('=SUMPRODUCT(IF(H1>0,H1:H3,I1:I3),I1:I3)', row, 10)).toBe(32);
                expect(calculateAt('=SUM(IF(H1:H3>1,H1:H3,0))', row, 10)).toBe(5);
                expect(calculateAt('=MAX(IF(H1:H3>1,I1:I3,0))', row, 10)).toBe(6);
                expect(calculateAt('=SUM(IF(H1:H3+I1:I3>6,1,0))', row, 10)).toBe(2);
                expect(calculateAt('=SUM(IFS(H1>0,H1:H3))', row, 10)).toBe(6);
                expect(calculateAt('=SUM(CHOOSE(1,H1:H3,I1:I3))', row, 10)).toBe(6);
                expect(calculateAt('=SUM(XLOOKUP(H1:H3,H1:H3,I1:I3))', row, 10)).toBe(15);
                expect(calculateAt('=TEXTJOIN(",",TRUE,CONCATENATE(H1:H3,"x"))', row, 10)).toBe('1x,2x,3x');
                expect(calculateAt('=IF(H1:H3>1,I1:I3,0)', row, 10)).toStrictEqual([[0], [5], [6]]);
                expect(calculateAt('=XLOOKUP(D1:D3,A1:A6,B1:B6)', row, 10)).toStrictEqual([[1], [2], [4]]);
                expect(calculateAt('=H1:H3*2', row, 10)).toStrictEqual([[2], [4], [6]]);
            });
        });

        it('evaluates an array test as a whole on a sheet of one cell', () => {
            expect(calculateAt('=SUM(IF(Sheet1!H1:H3>1,1,0))', 0, 0, 'small')).toBe(2);
            expect(calculateAt('=SUM(IF(Sheet1!H2:H3>1,1,0))', 0, 0, 'small')).toBe(2);
            expect(calculateAt('=SUM(IF(Sheet1!H1:H3>0,Sheet1!I1:I3,0))', 0, 0, 'small')).toBe(15);
        });
    });
});
