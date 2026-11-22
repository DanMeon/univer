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
import { CellValueType, DateSystem, LocaleType } from '@univerjs/core';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LexerNode } from '../../../../engine/analysis/lexer-node';
import type { BaseAstNode } from '../../../../engine/ast-node/base-ast-node';
import { createFunctionTestBed } from '../../../__tests__/create-function-test-bed';
import { ErrorType } from '../../../../basics/error-type';
import { Lexer } from '../../../../engine/analysis/lexer';
import { AstTreeBuilder } from '../../../../engine/analysis/parser';
import { Interpreter } from '../../../../engine/interpreter/interpreter';
import { generateExecuteAstNodeData } from '../../../../engine/utils/ast-node-tool';
import { stripErrorMargin } from '../../../../engine/utils/math-kit';
import { ArrayValueObject, transformToValueObject } from '../../../../engine/value-object/array-value-object';
import { ErrorValueObject } from '../../../../engine/value-object/base-value-object';
import { BooleanValueObject, NullValueObject, NumberValueObject, StringValueObject } from '../../../../engine/value-object/primitive-object';
import { IFormulaCurrentConfigService } from '../../../../services/current-data.service';
import { IFunctionService } from '../../../../services/function.service';
import { IFormulaRuntimeService } from '../../../../services/runtime.service';
import { FUNCTION_NAMES_META } from '../../../meta/function-names';
import { Minus } from '../../../meta/minus';
import { Multiply } from '../../../meta/multiply';
import { Plus } from '../../../meta/plus';
import { getObjectValue } from '../../../util';
import { FUNCTION_NAMES_MATH } from '../../function-names';
import { Sum } from '../index';

// H1:H3 = {1;2;3}, I1:I3 = {4;5;6}, H5:J5 = {1,2,3}, H6:J6 = {4,5,6}
const getOperatorDerivedArrayWorkbookData = (): IWorkbookData => ({
    id: 'test',
    appVersion: '3.0.0-alpha',
    sheets: {
        sheet1: {
            id: 'sheet1',
            cellData: {
                0: {
                    7: { v: 1, t: CellValueType.NUMBER },
                    8: { v: 4, t: CellValueType.NUMBER },
                },
                1: {
                    7: { v: 2, t: CellValueType.NUMBER },
                    8: { v: 5, t: CellValueType.NUMBER },
                },
                2: {
                    7: { v: 3, t: CellValueType.NUMBER },
                    8: { v: 6, t: CellValueType.NUMBER },
                },
                4: {
                    7: { v: 1, t: CellValueType.NUMBER },
                    8: { v: 2, t: CellValueType.NUMBER },
                    9: { v: 3, t: CellValueType.NUMBER },
                },
                5: {
                    7: { v: 4, t: CellValueType.NUMBER },
                    8: { v: 5, t: CellValueType.NUMBER },
                    9: { v: 6, t: CellValueType.NUMBER },
                },
            },
        },
    },
    locale: LocaleType.ZH_CN,
    name: '',
    sheetOrder: [],
    styles: {},
});

describe('Test sum function', () => {
    const testFunction = new Sum(FUNCTION_NAMES_MATH.SUM);

    describe('Sum', () => {
        it('Var1 is number, var2 is number', () => {
            const var1 = NumberValueObject.create(1);
            const var2 = NumberValueObject.create(2);
            const result = testFunction.calculate(var1, var2);
            expect(result.getValue()).toBe(3);
        });
        it('Var1 is number, var2 is string', () => {
            const var1 = NumberValueObject.create(1);
            const var2 = StringValueObject.create('test');
            const result = testFunction.calculate(var1, var2);
            expect(result.getValue()).toBe(ErrorType.VALUE);
        });
        it('Var1 is number, var2 is string number', () => {
            const var1 = NumberValueObject.create(1);
            const var2 = StringValueObject.create('2');
            const result = testFunction.calculate(var1, var2);
            expect(result.getValue()).toBe(3);
        });

        it('uses the date system bound to a date string', () => {
            const date1900 = StringValueObject.create('1904-1-1').withDateSystem(DateSystem.Date1900);
            const date1904 = StringValueObject.create('1904-1-1').withDateSystem(DateSystem.Date1904);

            expect(testFunction.calculate(date1900).getValue()).toBe(1462);
            expect(testFunction.calculate(date1904).getValue()).toBe(0);
        });
        it('Var1 is number, var2 is boolean', () => {
            const var1 = NumberValueObject.create(2);

            let var2 = BooleanValueObject.create(true);
            let result = testFunction.calculate(var1, var2);
            expect(result.getValue()).toBe(3);

            var2 = BooleanValueObject.create(false);
            result = testFunction.calculate(var1, var2);
            expect(result.getValue()).toBe(2);
        });
        it('Var1 is number, var2 is null', () => {
            const var1 = NumberValueObject.create(1);
            const var2 = NullValueObject.create();
            const result = testFunction.calculate(var1, var2);
            expect(result.getValue()).toBe(1);
        });
        it('Var1 is number, var2 is error', () => {
            const var1 = NumberValueObject.create(1);
            const var2 = ErrorValueObject.create(ErrorType.NA);
            const result = testFunction.calculate(var1, var2);
            expect(result.getValue()).toBe(ErrorType.NA);
        });

        it('Var1 is number, var2 is array includes error', () => {
            const var1 = NumberValueObject.create(1);
            const var2 = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    [1, null],
                    [0, ErrorType.VALUE],
                ]),
                rowCount: 2,
                columnCount: 2,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });
            const result = testFunction.calculate(var1, var2);
            expect(result.getValue()).toBe(ErrorType.VALUE);
        });

        it('Var1 is number, var2 is array not includes error', () => {
            const var1 = NumberValueObject.create(2);
            const var2 = ArrayValueObject.create({
                calculateValueList: transformToValueObject([
                    [1, ' ', 1.23, true, false, null],
                    [0, '100', '2.34', 'test', -3, null],
                ]),
                rowCount: 2,
                columnCount: 6,
                unitId: '',
                sheetId: '',
                row: 0,
                column: 0,
            });
            const result = testFunction.calculate(var1, var2);
            expect(stripErrorMargin(Number(result.getValue()))).toBe(103.57);
        });
    });

    describe('Sum of an operator-derived array', () => {
        let calculateAt: (formula: string, row: number, column: number) => ReturnType<typeof getObjectValue>;

        beforeEach(() => {
            const testBed = createFunctionTestBed(getOperatorDerivedArrayWorkbookData());
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
                new Sum(FUNCTION_NAMES_MATH.SUM),
                new Plus(FUNCTION_NAMES_META.PLUS),
                new Minus(FUNCTION_NAMES_META.MINUS),
                new Multiply(FUNCTION_NAMES_META.MULTIPLY)
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

        it('sums the whole range + range array on every row the ranges cross', () => {
            expect(calculateAt('=SUM(H1:H3+I1:I3)', 0, 10)).toBe(21);
            expect(calculateAt('=SUM(H1:H3+I1:I3)', 1, 10)).toBe(21);
            expect(calculateAt('=SUM(H1:H3+I1:I3)', 2, 10)).toBe(21);
        });

        it('sums the whole range + range array on a row the ranges do not cross', () => {
            expect(calculateAt('=SUM(H1:H3+I1:I3)', 7, 10)).toBe(21);
        });

        it('sums the whole horizontal range + range array on a column the ranges cross', () => {
            expect(calculateAt('=SUM(H5:J5+H6:J6)', 9, 8)).toBe(21);
        });

        it('sums the whole range - range and range * range arrays on a row the ranges cross', () => {
            expect(calculateAt('=SUM(H1:H3-I1:I3)', 0, 10)).toBe(-9);
            expect(calculateAt('=SUM(H1:H3*I1:I3)', 0, 10)).toBe(32);
        });
    });
});
