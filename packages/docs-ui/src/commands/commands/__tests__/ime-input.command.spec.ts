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

// Modified by Carenode, 2026 — a sheet cell editor and the formula bar give typed text no default colour (xlsxkit cell-editor-no-default-colour)

import type { IDocumentStyle } from '@univerjs/core';
import { CustomRangeType, DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY, DOCS_NORMAL_EDITOR_UNIT_ID_KEY, ICommandService, Tools } from '@univerjs/core';
import { RichTextEditingMutation } from '@univerjs/docs';
import { describe, expect, it } from 'vitest';
import { DocIMEInputManagerService } from '../../../services/doc-ime-input-manager.service';
import { DocMenuStyleService } from '../../../services/doc-menu-style.service';
import { IMEInputCommand } from '../ime-input.command';
import { createCommandTestBed } from './create-command-test-bed';

describe('IME composition range preservation', () => {
    it.each([CustomRangeType.SDT, CustomRangeType.HYPERLINK].flatMap((rangeType) =>
        ['中', '中文'].flatMap((previous) => ['你', '中文测试'].flatMap((next) =>
            [false, true].map((nested) => ({ rangeType, previous, next, nested }))))
    ))('retains range $rangeType when replacing $previous with $next (nested $nested)', async ({ rangeType, previous, next, nested }) => {
        const properties = rangeType === CustomRangeType.SDT
            ? { kind: 'text', showingPlaceholder: false }
            : { url: 'https://example.com' };
        const bed = createCommandTestBed({
            id: 'ime-range',
            body: {
                dataStream: `A${previous}B\r\n`,
                paragraphs: [{ startIndex: previous.length + 2, paragraphId: 'paragraph' }],
                customRanges: [...(nested
                    ? [{
                        rangeId: 'outer-control',
                        rangeType: CustomRangeType.SDT,
                        startIndex: 0,
                        endIndex: previous.length + 1,
                        wholeEntity: false,
                        properties: { kind: 'richText', showingPlaceholder: false },
                    }]
                    : []), {
                    rangeId: 'preceding-link',
                    rangeType: CustomRangeType.HYPERLINK,
                    startIndex: 0,
                    endIndex: 0,
                    properties: { url: 'https://example.org' },
                }, {
                    rangeId: 'composition',
                    rangeType,
                    startIndex: 1,
                    endIndex: previous.length,
                    wholeEntity: false,
                    properties,
                }],
            },
            documentStyle: {},
        });
        try {
            const commands = bed.get(ICommandService);
            commands.registerCommand(IMEInputCommand);
            commands.registerCommand(RichTextEditingMutation);
            const ime = bed.get(DocIMEInputManagerService);
            ime.setActiveRange({ startOffset: 1, endOffset: 1, collapsed: true, segmentId: '' });
            const before = Tools.deepClone(bed.doc.getBody());

            expect(await commands.executeCommand(IMEInputCommand.id, {
                unitId: bed.doc.getUnitId(),
                newText: next,
                oldTextLen: previous.length,
                isCompositionStart: false,
                isCompositionEnd: true,
            })).toBe(true);
            expect(bed.doc.getBody()?.dataStream).toBe(`A${next}B\r\n`);
            expect(bed.doc.getBody()?.customRanges).toEqual(before!.customRanges!.map((range) => ({
                ...range,
                endIndex: range.rangeId === 'preceding-link' ? range.endIndex : range.endIndex + next.length - previous.length,
            })));

            const undo = ime.getUndoRedoMutationParamsCache().undoCache[0];
            commands.syncExecuteCommand(RichTextEditingMutation.id, { ...undo, noHistory: true });
            expect(bed.doc.getBody()?.dataStream).toBe(before!.dataStream);
            expect(bed.doc.getBody()?.customRanges).toEqual(before!.customRanges);
        } finally {
            bed.univer.dispose();
        }
    });
});

describe('IME selection typing style', () => {
    it('uses the first selected style throughout a mixed-style composition', async () => {
        const bed = createCommandTestBed({
            id: 'ime-style',
            documentStyle: {},
            body: {
                dataStream: '123456789\r\n',
                paragraphs: [{ paragraphId: 'paragraph-9', startIndex: 9 }],
                textRuns: [
                    { st: 0, ed: 3, ts: { cl: { rgb: '#ff0000' }, bl: 1 } },
                    { st: 3, ed: 6, ts: { cl: { rgb: '#0000ff' }, fs: 20, it: 1 } },
                    { st: 6, ed: 9, ts: { cl: { rgb: '#008000' }, st: { s: 1 } } },
                ],
            },
        });
        try {
            const commands = bed.get(ICommandService);
            commands.registerCommand(IMEInputCommand);
            commands.registerCommand(RichTextEditingMutation);
            const ime = bed.get(DocIMEInputManagerService);
            ime.setActiveRange({ startOffset: 3, endOffset: 7, collapsed: false, segmentId: '' });
            for (const [index, newText] of ['中', '中文'].entries()) {
                expect(await commands.executeCommand(IMEInputCommand.id, {
                    unitId: bed.doc.getUnitId(),
                    newText,
                    oldTextLen: index,
                    isCompositionStart: index === 0,
                    isCompositionEnd: index === 1,
                })).toBe(true);
                const body = bed.doc.getBody()!;
                expect(body.dataStream).toBe(`123${newText}89\r\n`);
                expect(body.textRuns?.find((run) => run.st <= 3 && run.ed > 3)?.ts)
                    .toEqual({ cl: { rgb: '#0000ff' }, fs: 20, it: 1 });
            }
        } finally {
            bed.univer.dispose();
        }
    });
});

describe('IME input colour in a sheet cell editor', () => {
    const THEME_TEXT_COLOUR = { rgb: '#1B1C1F' };
    const RED = { rgb: '#ff0000' };
    const BLUE = { rgb: '#0000ff' };

    function createEditorBed(unitId: string, text: string, textRuns: { st: number; ed: number; ts: { cl: { rgb: string } } }[] = [], documentStyle: IDocumentStyle = {}) {
        const bed = createCommandTestBed({
            id: unitId,
            documentStyle,
            body: {
                dataStream: `${text}\r\n`,
                paragraphs: [{ paragraphId: 'paragraph', startIndex: text.length }],
                textRuns,
            },
        });
        const commands = bed.get(ICommandService);
        commands.registerCommand(IMEInputCommand);
        commands.registerCommand(RichTextEditingMutation);
        return { bed, commands, ime: bed.get(DocIMEInputManagerService) };
    }

    /** One composition at `offset`: each step replaces the text the step before it composed. */
    async function compose(editor: ReturnType<typeof createEditorBed>, offset: number, steps: string[]) {
        editor.ime.setActiveRange({ startOffset: offset, endOffset: offset, collapsed: true, segmentId: '' });
        for (const [index, newText] of steps.entries()) {
            expect(await editor.commands.executeCommand(IMEInputCommand.id, {
                unitId: editor.bed.doc.getUnitId(),
                newText,
                oldTextLen: index === 0 ? 0 : steps[index - 1].length,
                isCompositionStart: index === 0,
                isCompositionEnd: index === steps.length - 1,
            })).toBe(true);
        }
    }

    function colourAt(editor: ReturnType<typeof createEditorBed>, offset: number) {
        return editor.bed.doc.getBody()?.textRuns?.find((run) => run.st <= offset && run.ed > offset)?.ts?.cl;
    }

    // ^ the formula bar's document carries the theme colour as its text style (sheets-ui data-sync sets it)
    it.each([
        { unitId: DOCS_NORMAL_EDITOR_UNIT_ID_KEY, documentStyle: {}, expected: undefined },
        { unitId: DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY, documentStyle: { textStyle: { cl: THEME_TEXT_COLOUR } }, expected: undefined },
        { unitId: 'ime-document', documentStyle: {}, expected: THEME_TEXT_COLOUR },
    ])('composes Hangul after the text of $unitId with colour $expected.rgb', async ({ unitId, documentStyle, expected }) => {
        const editor = createEditorBed(unitId, '고정 열 12', [], documentStyle);
        try {
            await compose(editor, 7, ['ㄱ', '가', '간']);
            expect(editor.bed.doc.getBody()?.dataStream).toBe('고정 열 12간\r\n');
            expect(colourAt(editor, 7)).toEqual(expected);
        } finally {
            editor.bed.univer.dispose();
        }
    });

    it('keeps the colour of the text it continues and a colour picked while editing, and adds none of its own', async () => {
        const editor = createEditorBed(DOCS_NORMAL_EDITOR_UNIT_ID_KEY, 'ab', [{ st: 0, ed: 1, ts: { cl: RED } }]);
        try {
            await compose(editor, 1, ['가']);
            expect(editor.bed.doc.getBody()?.dataStream).toBe('a가b\r\n');
            expect(colourAt(editor, 1)).toEqual(RED);

            await compose(editor, 3, ['나']);
            expect(editor.bed.doc.getBody()?.dataStream).toBe('a가b나\r\n');
            expect(colourAt(editor, 3)).toBeUndefined();

            editor.bed.get(DocMenuStyleService).setStyleCache({ cl: BLUE });
            await compose(editor, 4, ['다']);
            expect(editor.bed.doc.getBody()?.dataStream).toBe('a가b나다\r\n');
            expect(colourAt(editor, 4)).toEqual(BLUE);
        } finally {
            editor.bed.univer.dispose();
        }
    });
});
