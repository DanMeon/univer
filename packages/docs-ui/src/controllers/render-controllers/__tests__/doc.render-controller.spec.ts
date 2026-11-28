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

// Modified by Carenode, 2026 — CNT-5176 ios-hangul-replace: replays the iOS Korean keyboard's input events; CNT-5176 ios-caret-move-reset: a caret moved by other means ends the iOS composition

// @vitest-environment jsdom

import type { DocumentDataModel, IDocumentData } from '@univerjs/core';
import type { IDocLayoutExecutor } from '@univerjs/docs';
import type { Documents, IPointerEvent, RenderUnit } from '@univerjs/engine-render';
import {
    BooleanNumber,
    CustomRangeType,
    DataStreamTreeTokenType,
    DeleteDirection,
    DocumentFlavor,
    DrawingTypeEnum,
    HorizontalAlign,
    ICommandService,
    IUniverInstanceService,
    NamedStyleType,
    ObjectRelativeFromH,
    ObjectRelativeFromV,
    PositionedObjectLayoutType,
    SpacingRule,
    Univer,
    UniverInstanceType,
} from '@univerjs/core';
import {
    DeleteTextCommand,
    DocLayoutExecutorService,
    DocSelectionManagerService,
    DocSkeletonManagerService,
    DocStateEmitService,
    InsertTextCommand,
    RichTextEditingMutation,
    SetHeadingCollapsedCommand,
    SetTextSelectionsOperation,
} from '@univerjs/docs';
import {
    CanvasColorService,
    FontCache,
    ICanvasColorService,
    IRenderManagerService,
    RenderManagerService,
} from '@univerjs/engine-render';
import { CanvasPopupService, ContextMenuService, ICanvasPopupService, IContextMenuService, ILayoutService, IPlatformService } from '@univerjs/ui';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VIEWPORT_KEY } from '../../../basics/docs-view-key';
import { AfterSpaceCommand } from '../../../commands/commands/auto-format.command';
import { BreakLineCommand } from '../../../commands/commands/break-line.command';
import { IMEInputCommand } from '../../../commands/commands/ime-input.command';
import { DocAutoFormatService } from '../../../services/doc-auto-format.service';
import { DocIMEInputManagerService } from '../../../services/doc-ime-input-manager.service';
import { DocLayoutInteractionService } from '../../../services/doc-layout-interaction.service';
import { DocMenuStyleService } from '../../../services/doc-menu-style.service';
import { DocMobileElementMenuService } from '../../../services/doc-mobile-element-menu.service';
import { DocPageLayoutService } from '../../../services/doc-page-layout.service';
import { DocCanvasPopManagerService } from '../../../services/doc-popup-manager.service';
import { DocViewScaleService } from '../../../services/doc-view-scale';
import { EditorService, IEditorService } from '../../../services/editor/editor-manager.service';
import { MobileDocSelectionRenderService } from '../../../services/mobile/doc-selection-render.service';
import { MobileDocViewScaleService } from '../../../services/mobile/doc-view-scale';
import { DocSelectionRenderService } from '../../../services/selection/doc-selection-render.service';
import { cursorConvertToTextRange } from '../../../services/selection/text-range';
import { DocBackScrollRenderController } from '../back-scroll.render-controller';
import { DocIMEInputController } from '../doc-ime-input.controller';
import { DocInputController } from '../doc-input.controller';
import { DocSelectionRenderController } from '../doc-selection-render.controller';
import { DocRenderController } from '../doc.render-controller';
import { MobileDocBackScrollRenderController } from '../mobile/back-scroll.render-controller';
import { MobileDocSelectionRenderController } from '../mobile/doc-selection-render.controller';
import { MobileDocRenderController } from '../mobile/doc.render-controller';

// The platform the next editor sees; the iOS tests turn isIOS on.
const testPlatform = { isMac: false, isWindows: false, isLinux: false, isIOS: false };

function createEditor(paragraphCount = 8, withDrawing = true, workerBeforeLayout = false, documentFlavor = DocumentFlavor.TRADITIONAL, withFootnote = false, mobile = false, renderingFontsReady?: Promise<void>, worker?: Partial<IDocLayoutExecutor>) {
    if (workerBeforeLayout) {
        // Model computation cost separately from fake timers so foreground work yields before Worker handoff.
        let elapsed = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => ++elapsed);
    }
    const univer = new Univer();
    const injector = univer.__getInjector();
    const root = document.createElement('div');
    document.body.appendChild(root);
    injector.add([ILayoutService, { useValue: {
        rootContainerElement: root,
        registerContainerElement: () => ({ dispose() {} }),
    } as unknown as ILayoutService }]);
    injector.add([IPlatformService, { useValue: { ...testPlatform } }]);
    injector.add([IRenderManagerService, { useClass: RenderManagerService }]);
    injector.add([ICanvasPopupService, { useClass: CanvasPopupService }]);
    injector.add([IContextMenuService, { useClass: ContextMenuService }]);
    injector.add([DocCanvasPopManagerService]);
    injector.add([DocMobileElementMenuService]);
    injector.add([ICanvasColorService, { useClass: CanvasColorService }]);
    injector.add([DocLayoutExecutorService]);
    // The transport boundary stays pending; the real controller and coordinator
    // must still hand off before Main paginates the entire document.
    const registerWorker = () => injector.get(DocLayoutExecutorService).register({
        type: 'worker',
        renderingFontsReady,
        initialize: () => new Promise<void>(() => {}),
        disposeSession: async () => {},
        ...worker,
    } as unknown as IDocLayoutExecutor);
    let registration = workerBeforeLayout ? registerWorker() : undefined;
    const startWorkerLayout = vi.spyOn(injector.get(DocLayoutExecutorService), 'startLayout');
    injector.add([DocSelectionManagerService]);
    injector.add([DocAutoFormatService]);
    injector.add([DocStateEmitService]);
    injector.add([DocMenuStyleService]);
    injector.add([IEditorService, { useClass: EditorService }]);
    const commands = injector.get(ICommandService);
    [InsertTextCommand, DeleteTextCommand, AfterSpaceCommand, BreakLineCommand, IMEInputCommand, RichTextEditingMutation, SetTextSelectionsOperation]
        .forEach((command) => commands.registerCommand(command));
    const firstParagraph = 'Hello world';
    const drawingToken = withDrawing ? DataStreamTreeTokenType.CUSTOM_BLOCK : '';
    const noteStream = `${'Footnote continuation with several words.\r'.repeat(40)}\n`;
    const separator = documentFlavor === DocumentFlavor.MODERN ? '\r\r' : '\r';
    const dataStream = `${firstParagraph}\r${drawingToken}${withFootnote ? '\uFFFC' : ''}${Array.from({ length: paragraphCount }, (_, i) => `Paragraph ${i} has enough words to wrap across several lines.${separator}`).join('')}\n`;
    const model = univer.createUnit<IDocumentData, DocumentDataModel>(UniverInstanceType.UNIVER_DOC, {
        id: 'bounded-caret-test',
        // A drawing on the edited page deliberately keeps the conservative
        // deferred path covered, independently of font-specific line wrapping.
        drawings: withDrawing
            ? {
                'inline-drawing': {
                    drawingId: 'inline-drawing',
                    unitId: 'bounded-caret-test',
                    subUnitId: 'bounded-caret-test',
                    drawingType: DrawingTypeEnum.DRAWING_BLOCK,
                    layoutType: PositionedObjectLayoutType.INLINE,
                    docTransform: {
                        angle: 0,
                        positionH: { relativeFrom: ObjectRelativeFromH.PAGE, posOffset: 0 },
                        positionV: { relativeFrom: ObjectRelativeFromV.PARAGRAPH, posOffset: 0 },
                        size: { width: 30, height: 20 },
                    },
                },
            }
            : {},
        notes: withFootnote
            ? { note: { type: 'footnote' as const, noteId: 'note', body: {
                dataStream: noteStream,
                // Explicit leading guarantees a continuation page independently of mocked glyph advances.
                paragraphs: [...noteStream.matchAll(/\r/g)].map((match, index) => ({
                    startIndex: match.index!,
                    paragraphId: `note-${index}`,
                    paragraphStyle: { spacingRule: SpacingRule.EXACT, lineSpacing: 24 },
                })),
            } } }
            : undefined,
        body: {
            dataStream,
            customRanges: withFootnote
                ? [{
                    rangeType: CustomRangeType.FOOTNOTE,
                    rangeId: 'note-ref',
                    wholeEntity: true,
                    startIndex: 12,
                    endIndex: 12,
                    properties: { noteId: 'note' },
                }]
                : [],
            customBlocks: withDrawing ? [{ blockId: 'inline-drawing', startIndex: firstParagraph.length + 1 }] : [],
            paragraphs: [...dataStream.matchAll(/\r/g)].map((match, index) => ({
                startIndex: match.index!,
                paragraphId: `paragraph_${index}`,
                paragraphStyle: { horizontalAlign: HorizontalAlign.CENTER },
            })),
            sectionBreaks: [{ startIndex: dataStream.length - 1, sectionId: 'section_test' }],
        },
        documentStyle: {
            ...(workerBeforeLayout ? { autoHyphenation: BooleanNumber.FALSE } : {}),
            documentFlavor,
            pageSize: { width: 300, height: 700 },
            textStyle: { ff: 'Arial', fs: 14 },
            marginLeft: 20,
            marginRight: 20,
            marginTop: 20,
            marginBottom: 20,
        },
    });
    const unitId = model.getUnitId();
    const instances = injector.get(IUniverInstanceService);
    instances.setCurrentUnitForType(unitId);
    instances.focusUnit(unitId);
    const render = injector.get(IRenderManagerService).createRender(unitId) as RenderUnit;
    render.engine.resizeBySize(800, 600);
    render.deactivate();
    render.addRenderDependencies([
        [DocSkeletonManagerService],
        [DocSelectionRenderService, { useClass: mobile ? MobileDocSelectionRenderService : DocSelectionRenderService }],
        [DocViewScaleService, { useClass: mobile ? MobileDocViewScaleService : DocViewScaleService }],
        [DocPageLayoutService],
        [DocLayoutInteractionService],
        [DocRenderController, { useClass: mobile ? MobileDocRenderController : DocRenderController }],
        [DocBackScrollRenderController, { useClass: mobile ? MobileDocBackScrollRenderController : DocBackScrollRenderController }],
        [DocSelectionRenderController, { useClass: mobile ? MobileDocSelectionRenderController : DocSelectionRenderController }],
        [DocInputController],
        [DocIMEInputManagerService],
        [DocIMEInputController],
    ]);
    const selection = render.with(DocSelectionRenderService);
    const selectionManager = injector.get(DocSelectionManagerService);
    const skeletonManager = render.with(DocSkeletonManagerService);
    const skeleton = skeletonManager.getSkeleton();
    if (!workerBeforeLayout) {
        const firstLine = skeleton.getSkeletonData()!.pages[0].sections[0].columns[0].lines[0];
        expect(firstLine.ed).toBe(firstParagraph.length);
        expect(firstLine.lineHeight).toBeGreaterThan(0);
        expect(skeleton.getSkeletonData()!.pages[0].skeDrawings.size).toBe(withDrawing ? 1 : 0);
    }
    // Worker transport is unavailable in jsdom. Keep it uninitialized so the
    // real Main coordinator must publish the bounded interaction window.
    registration ??= registerWorker();
    if (!workerBeforeLayout) {
        selection.replaceDocRanges([{ startOffset: 5, endOffset: 5 }], true, { shouldFocus: false });
    }
    const input = root.querySelector<HTMLDivElement>('[data-u-comp="editor"]')!;
    return {
        commands,
        input,
        model,
        render,
        selection,
        selectionManager,
        skeleton,
        skeletonManager,
        startWorkerLayout,
        unitId,
        dispose(): void {
            registration?.dispose();
            univer.dispose();
            root.remove();
        },
    };
}

describe('DocRenderController bounded input publication', () => {
    it('keeps mobile layout state out of the desktop render controller', () => {
        const desktopSource = readFileSync(resolve(process.cwd(), 'src/controllers/render-controllers/doc.render-controller.ts'), 'utf8');
        const mobilePluginSource = readFileSync(resolve(process.cwd(), 'src/mobile-plugin.ts'), 'utf8');

        expect(desktopSource).not.toContain('MOBILE_DOC_OUTER_MARGIN');
        expect(desktopSource).not.toContain('_mobileModernPageWidth');
        expect(desktopSource).not.toContain('_getMobileModernLayoutOptions');
        expect(desktopSource).not.toContain('_initMobileResponsiveLayout');
        expect(desktopSource).not.toContain('_initResponsiveLayout');
        expect(mobilePluginSource).toContain('[DocRenderController, { useClass: MobileDocRenderController }]');
    });

    it('uses the mobile render providers without Modern horizontal scrolling', () => {
        const editor = createEditor(8, true, false, DocumentFlavor.MODERN, false, true);
        try {
            expect(editor.render.scene.getViewport(VIEWPORT_KEY.VIEW_MAIN)?.getScrollBar()?.enableHorizontal).toBe(false);
        } finally {
            editor.dispose();
        }
    });

    beforeEach(() => {
        vi.useFakeTimers();
        const context = new Proxy({
            font: '',
            webkitBackingStorePixelRatio: 1,
            measureText(text: string) {
                const fontSize = /(\d+(?:\.\d+)?)(pt|px)/.exec(this.font);
                const points = fontSize ? Number(fontSize[1]) * (fontSize[2] === 'px' ? 0.75 : 1) : 14;
                const scale = points / 14;
                return {
                    width: text.length * 8 * scale,
                    actualBoundingBoxAscent: 8 * scale,
                    actualBoundingBoxDescent: 2 * scale,
                    fontBoundingBoxAscent: 8 * scale,
                    fontBoundingBoxDescent: 2 * scale,
                };
            },
        }, { get: (target, key) => key in target ? Reflect.get(target, key) : () => {} });
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
        const getBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            // Match the fixture's 14pt Canvas metrics; jsdom returns zero and cannot cache normal leading.
            if (this.style.visibility === 'hidden' && this.style.whiteSpace === 'pre' && this.style.lineHeight === 'normal') {
                const lineCount = (this.textContent ?? '').split('\n').length;
                const metrics = context.measureText.call({ font: this.style.font }, 'Hg');
                const lineHeight = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
                return new DOMRect(0, 0, 0, lineHeight * lineCount);
            }
            return getBoundingClientRect.call(this);
        });
        Reflect.set(FontCache, '_context', null);
        FontCache.invalidateMetrics(() => true);
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('keeps typing at the logical footnote caret after Enter moves it to a continuation page', async () => {
        const editor = createEditor(8, false, false, DocumentFlavor.TRADITIONAL, true);
        try {
            await vi.dynamicImportSettled();
            const pages = editor.skeleton.getSkeletonData()!.pages;
            const oldPage = pages.findIndex((page) => page.notes?.some((note) => note.noteId === 'note'));
            const boundary = pages[oldPage].notes![0].page.ed;
            expect(boundary).toBeLessThan(editor.model.getSnapshot().notes!.note.body.dataStream.length - 2);
            editor.selectionManager.replaceDocRanges([{
                startOffset: boundary,
                endOffset: boundary,
                segmentId: 'note',
                segmentPage: oldPage,
            }], { unitId: editor.unitId, subUnitId: editor.unitId }, true);
            expect(await editor.commands.executeCommand(BreakLineCommand.id)).toBe(true);
            expect(editor.selectionManager.getActiveTextRange()?.endOffset).toBe(boundary + 1);
            for (const text of ['A', ' ', '中', 'B']) {
                editor.input.textContent = text;
                editor.input.dispatchEvent(new InputEvent('input', { data: text, inputType: 'insertText' }));
                await Promise.resolve();
                await Promise.resolve();
            }
            await vi.advanceTimersByTimeAsync(1_000);
            const offset = boundary + 5;
            expect(editor.model.getSnapshot().notes!.note.body.dataStream.slice(boundary, offset)).toBe('\rA 中B');
            expect(editor.selectionManager.getActiveTextRange()?.endOffset).toBe(offset);
            const position = editor.skeleton.findNodePositionByCharIndex(offset, true, 'note');
            expect(position?.page).toBeGreaterThan(oldPage);
            expect(editor.selection.getActiveTextRange()?.endOffset).toBe(offset);
            expect(editor.selection.getSegmentPage()).toBe(position?.page);
            expect(editor.selection.hasPendingSelection).toBe(false);
            editor.selectionManager.replaceDocRanges([{
                startOffset: 5,
                endOffset: 5,
                segmentId: '',
                segmentPage: -1,
            }], { unitId: editor.unitId, subUnitId: editor.unitId }, true);
            expect(editor.selection.getSegment()).toBe('');
            editor.input.textContent = 'Z';
            editor.input.dispatchEvent(new InputEvent('input', { data: 'Z', inputType: 'insertText' }));
            await Promise.resolve();
            await Promise.resolve();
            expect(editor.model.getBody()!.dataStream.startsWith('HelloZ world')).toBe(true);
            expect(editor.model.getSnapshot().notes!.note.body.dataStream.slice(boundary, offset)).toBe('\rA 中B');
        } finally {
            editor.dispose();
        }
    });

    it('preserves a scrolled Modern viewport across heading reversals while Worker initialization is pending', async () => {
        let elapsed = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => ++elapsed);
        const editor = createEditor(100, true, false, DocumentFlavor.MODERN);
        try {
            await vi.dynamicImportSettled();
            editor.commands.registerCommand(SetHeadingCollapsedCommand);
            const paragraphs = editor.model.getBody()!.paragraphs!;
            const parent = paragraphs[41];
            parent.paragraphStyle = { namedStyleType: NamedStyleType.HEADING_1 };
            paragraphs[81].paragraphStyle = { namedStyleType: NamedStyleType.HEADING_1 };
            editor.skeleton.getViewModel().reset(editor.model);
            editor.skeleton.makeDirty(true);
            editor.skeleton.calculate();
            expect(editor.skeleton.getSkeletonData()!.pages[0].skeDrawings.size).toBe(1);
            const viewport = editor.render.scene.getViewport(VIEWPORT_KEY.VIEW_MAIN)!;
            const docsComponent = editor.render.mainComponent as Documents;
            const parentLine = editor.skeleton.getSkeletonData()!.pages[0].sections.flatMap((section) => section.columns.flatMap((column) => column.lines)).find((line) => line.paragraphIndex === parent.startIndex)!;
            viewport.scrollToViewportPos({ viewportScrollY: parentLine.top + docsComponent.getOffsetConfig().docsTop - 40 });
            const minimumHeight = viewport.calcViewportInfo().viewBound.bottom - docsComponent.getOffsetConfig().docsTop;
            expect(minimumHeight).toBeGreaterThan(0);
            const publishedHeights: number[] = [];
            const subscription = editor.skeleton.layoutProgress$.subscribe((progress) => {
                if (progress.didPublish && !progress.complete && progress.reason === 'edit') {
                    publishedHeights.push(editor.skeleton.getSkeletonData()!.pages[0].height);
                }
            });
            try {
                for (const collapsed of [true, false, true, false]) {
                    expect(editor.commands.syncExecuteCommand(SetHeadingCollapsedCommand.id, {
                        unitId: editor.unitId,
                        paragraphId: parent.paragraphId,
                        collapsed,
                    })).toBe(true);
                    expect(editor.skeleton.getSkeletonData()!.pages[0].height).toBeGreaterThanOrEqual(minimumHeight);
                    await vi.advanceTimersByTimeAsync(1_000);
                    expect(editor.model.getBody()!.customBlocks).toEqual([{ blockId: 'inline-drawing', startIndex: 12 }]);
                }
                expect(publishedHeights.length).toBeGreaterThan(0);
                expect(publishedHeights.every((height) => height >= minimumHeight)).toBe(true);
                expect(editor.skeleton.findNodePositionByCharIndex(parent.startIndex)).toBeDefined();
                expect(editor.skeleton.getSkeletonData()!.pages.flatMap((page) => [...page.skeDrawings.keys()])).toEqual(['inline-drawing']);
            } finally {
                subscription.unsubscribe();
            }
        } finally {
            editor.dispose();
        }
    });

    it('keeps short Modern edits and spaces complete while Worker initialization is pending', async () => {
        const editor = createEditor(3, false, false, DocumentFlavor.MODERN);
        try {
            await vi.dynamicImportSettled();
            const beginExternalLayout = vi.spyOn(editor.skeleton, 'beginExternalLayout');
            const applyLayoutPublication = vi.spyOn(editor.skeleton, 'applyLayoutPublication');
            for (const [index, text] of ['A', ' ', '中', 'B'].entries()) {
                editor.input.textContent = text;
                editor.input.dispatchEvent(new InputEvent('input', { data: text, inputType: 'insertText' }));
                await Promise.resolve();
                await Promise.resolve();
                expect(editor.selectionManager.getActiveTextRange()?.endOffset).toBe(6 + index);
                expect(editor.selection.getActiveTextRange()?.endOffset).toBe(6 + index);
                expect(editor.skeleton.getLayoutProgress()?.complete ?? true).toBe(true);
                expect(editor.skeleton.findNodeByCharIndex(editor.model.getBody()!.dataStream.length - 3)).toBeDefined();
            }
            expect(editor.model.getBody()?.dataStream.startsWith('HelloA 中B world')).toBe(true);
            expect(await editor.commands.executeCommand(BreakLineCommand.id)).toBe(true);
            expect(editor.selection.getActiveTextRange()?.endOffset).toBe(10);
            editor.input.textContent = 'C';
            editor.input.dispatchEvent(new InputEvent('input', { data: 'C', inputType: 'insertText' }));
            await Promise.resolve();
            await Promise.resolve();
            expect(editor.model.getBody()?.dataStream.startsWith('HelloA 中B\rC world')).toBe(true);
            expect(editor.skeleton.getLayoutProgress()?.complete ?? true).toBe(true);
            await vi.advanceTimersByTimeAsync(1_000);
            expect(editor.startWorkerLayout).toHaveBeenCalledTimes(1);
            expect(beginExternalLayout).not.toHaveBeenCalled();
            expect(applyLayoutPublication).not.toHaveBeenCalled();
            expect(editor.selection.getActiveTextRange()?.endOffset).toBe(11);
        } finally {
            editor.dispose();
        }
    });

    it.each([1, 500])('opens %i paragraphs without waiting for full Main pagination', async (paragraphCount) => {
        vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) =>
            window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 10 }), 0));
        vi.stubGlobal('cancelIdleCallback', (id: number) => window.clearTimeout(id));
        const editor = createEditor(paragraphCount, false, true);
        const layoutSteps = vi.spyOn(editor.skeleton, 'stepIncrementalLayout');
        try {
            await vi.advanceTimersByTimeAsync(1_000);
            expect(editor.startWorkerLayout).toHaveBeenCalledTimes(paragraphCount === 1 ? 0 : 1);
            expect(editor.skeleton.hasCompleteLayout()).toBe(paragraphCount === 1);
            if (paragraphCount > 1) {
                expect(layoutSteps.mock.results[0].value.processedBlockCount).toBeLessThan(paragraphCount);
            }
            const pages = editor.skeleton.getSkeletonData()!.pages;
            expect(pages.length).toBeGreaterThan(0);
            expect(pages.length).toBeLessThanOrEqual(5);
            expect(pages.every((page) => page.sections.length > 0)).toBe(true);
        } finally {
            editor.dispose();
        }
    });

    it('does not recover a disposed render after its Worker mount cleanup rejects', async () => {
        let rejectCleanup!: (error: Error) => void;
        const disposeLayoutMount = vi.fn(() => new Promise<void>((_resolve, reject) => {
            rejectCleanup = reject;
        }));
        const recover = vi.fn(async () => {});
        const editor = createEditor(500, false, true, DocumentFlavor.TRADITIONAL, false, false, undefined, {
            disposeLayoutMount,
            recover,
        });
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await vi.advanceTimersByTimeAsync(1_000);
            expect(editor.startWorkerLayout).toHaveBeenCalledOnce();
            editor.render.dispose();
            expect(disposeLayoutMount).toHaveBeenCalledOnce();
            rejectCleanup(new Error('Worker transport closed'));
            await vi.advanceTimersByTimeAsync(1_000);
            expect(recover).not.toHaveBeenCalled();
            expect(error).not.toHaveBeenCalled();
        } finally {
            editor.dispose();
        }
    });

    it('does not fall back to Main when a pending Worker recovery rejects after disposal', async () => {
        let rejectRecovery!: (error: Error) => void;
        const recover = vi.fn(() => new Promise<void>((_resolve, reject) => {
            rejectRecovery = reject;
        }));
        const editor = createEditor(500, false, true, DocumentFlavor.TRADITIONAL, false, false, undefined, {
            initialize: async () => {},
            createSession: async () => {},
            startLayout: async () => { throw new Error('Worker failed'); },
            disposeLayoutMount: async () => {},
            recover,
        });
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const startMain = vi.spyOn(editor.skeleton, 'startIncrementalLayout');
        try {
            await vi.advanceTimersByTimeAsync(1_000);
            expect(recover).toHaveBeenCalledOnce();
            editor.render.dispose();
            const errorsBeforeRejection = error.mock.calls.length;
            const layoutsBeforeRejection = startMain.mock.calls.length;
            rejectRecovery(new Error('Worker transport closed'));
            await vi.advanceTimersByTimeAsync(1_000);
            expect(error).toHaveBeenCalledTimes(errorsBeforeRejection);
            expect(startMain).toHaveBeenCalledTimes(layoutsBeforeRejection);
        } finally {
            editor.dispose();
        }
    });

    it('does not publish fallback-font pages while explicitly configured fonts are pending', async () => {
        let finishFonts!: () => void;
        const fontsReady = new Promise<void>((resolve) => {
            finishFonts = resolve;
        });
        const editor = createEditor(1, false, true, DocumentFlavor.TRADITIONAL, false, false, fontsReady);
        try {
            await vi.advanceTimersByTimeAsync(1_000);
            expect(editor.skeleton.getSkeletonData()?.pages.length ?? 0).toBe(0);
            expect(editor.startWorkerLayout).not.toHaveBeenCalled();
            finishFonts();
            await vi.advanceTimersByTimeAsync(1_000);
            expect(editor.skeleton.hasCompleteLayout()).toBe(true);
            expect(editor.skeleton.getSkeletonData()!.pages.length).toBe(1);
        } finally {
            editor.dispose();
        }
    });

    it('does not restart a disposed document when its configured fonts finish loading', async () => {
        let finishFonts!: () => void;
        const fontsReady = new Promise<void>((resolve) => {
            finishFonts = resolve;
        });
        const editor = createEditor(1, false, true, DocumentFlavor.TRADITIONAL, false, false, fontsReady);
        await vi.advanceTimersByTimeAsync(1_000);
        editor.dispose();
        finishFonts();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(editor.startWorkerLayout).not.toHaveBeenCalled();
        expect(editor.skeleton.getSkeletonData()?.pages.length ?? 0).toBe(0);
    });

    it('publishes the initial caret as soon as the first foreground page is ready', async () => {
        const editor = createEditor(500, false, true);
        try {
            expect(editor.selection.getActiveTextRange()).toBeUndefined();
            expect(document.activeElement).toBe(editor.input);

            await vi.advanceTimersByTimeAsync(1_000);

            expect(editor.skeleton.hasCompleteLayout()).toBe(false);
            expect(editor.skeleton.getSkeletonData()!.pages.length).toBeLessThanOrEqual(5);
            expect(editor.selection.getActiveTextRange()).toMatchObject({
                startOffset: 0,
                endOffset: 0,
            });
        } finally {
            editor.dispose();
        }
    });

    it.each(['A', '中'])('publishes the %s caret with its page without an intermediate wrong coordinate', async (text) => {
        const editor = createEditor();
        try {
            // Initial synchronous layout can initiate code-split dictionaries.
            // Resolve that fixture setup before measuring one input frame.
            await vi.dynamicImportSettled();
            const before = editor.selection.getActiveTextRange()!.getAnchor()!.left;
            const calculate = vi.spyOn(editor.skeleton, 'calculate');
            const steps = vi.spyOn(editor.skeleton, 'stepIncrementalLayout');
            await editor.commands.executeCommand(InsertTextCommand.id, {
                unitId: editor.unitId,
                range: { startOffset: 5, endOffset: 5, collapsed: true },
                body: { dataStream: text },
            });
            expect(editor.skeleton.getLayoutProgress()?.anchorReady).toBe(false);
            expect(calculate).not.toHaveBeenCalled();
            expect(steps.mock.calls.length).toBeLessThanOrEqual(4);
            expect(editor.selectionManager.getActiveTextRange()?.endOffset).toBe(6);
            expect(editor.selection.getActiveTextRange()!.getAnchor()!.left).toBe(before);
            await vi.advanceTimersByTimeAsync(20);
            const expected = cursorConvertToTextRange(
                editor.render.scene,
                { startOffset: 6, endOffset: 6 },
                editor.skeleton,
                editor.render.mainComponent as Documents
            )!;
            expect(editor.selection.getActiveTextRange()!.getAnchor()!.left).toBe(expected.getAnchor()!.left);
            expect(editor.selection.getActiveTextRange()?.endOffset).toBe(6);
            expected.dispose();
        } finally {
            editor.dispose();
        }
    });

    it('keeps consecutive native input ordered before the next layout frame', async () => {
        const editor = createEditor();
        try {
            for (const text of ['A', 'B', 'C']) {
                editor.input.textContent = text;
                editor.input.dispatchEvent(new InputEvent('input', { data: text, inputType: 'insertText' }));
                await Promise.resolve();
                await Promise.resolve();
                expect(editor.skeleton.getLayoutProgress()?.anchorReady).toBe(false);
            }
            expect(editor.model.getBody()?.dataStream.startsWith('HelloABC world')).toBe(true);
            expect(editor.selectionManager.getActiveTextRange()?.endOffset).toBe(8);
            await vi.advanceTimersByTimeAsync(20);
            expect(editor.selection.getActiveTextRange()?.endOffset).toBe(8);
        } finally {
            editor.dispose();
        }
    });

    it.each(['A', '中'])('publishes page-first %s text and caret before waiting for a frame', async (text) => {
        const editor = createEditor(30, false);
        try {
            const previousSkeleton = editor.skeleton.getSkeletonData();
            const steps = vi.spyOn(editor.skeleton, 'stepIncrementalLayout');
            await editor.commands.executeCommand(InsertTextCommand.id, {
                unitId: editor.unitId,
                range: { startOffset: 5, endOffset: 5, collapsed: true },
                body: { dataStream: text },
            });
            expect(editor.model.getBody()?.dataStream.startsWith(`Hello${text} world`)).toBe(true);
            expect(editor.skeleton.getSkeletonData()).not.toBe(previousSkeleton);
            expect(editor.skeleton.findNodeByCharIndex(5)?.content).toContain(text);
            expect(steps.mock.calls.length).toBeLessThanOrEqual(4);
            expect(editor.selection.getActiveTextRange()?.endOffset).toBe(6);
            expect(editor.selection.hasPendingSelection).toBe(false);
            const expected = cursorConvertToTextRange(
                editor.render.scene,
                { startOffset: 6, endOffset: 6 },
                editor.skeleton,
                editor.render.mainComponent as Documents
            )!;
            expect(editor.selection.getActiveTextRange()!.getAnchor()).toMatchObject({
                left: expected.getAnchor()!.left,
                top: expected.getAnchor()!.top,
                height: expected.getAnchor()!.height,
            });
            expected.dispose();
        } finally {
            editor.dispose();
        }
    });

    it('does not restore a queued edit caret over a newer selection', async () => {
        const editor = createEditor();
        try {
            editor.commands.syncExecuteCommand(InsertTextCommand.id, {
                unitId: editor.unitId,
                range: { startOffset: 5, endOffset: 5, collapsed: true },
                body: { dataStream: 'A' },
            });
            expect(editor.skeleton.getLayoutProgress()?.anchorReady).toBe(false);
            editor.selection.replaceDocRanges([{ startOffset: 2, endOffset: 2 }], true, { shouldFocus: false });
            await Promise.resolve();
            expect(editor.selectionManager.getActiveTextRange()?.endOffset).toBe(2);
            await vi.advanceTimersByTimeAsync(20);
            expect(editor.selectionManager.getActiveTextRange()?.endOffset).toBe(2);
        } finally {
            editor.dispose();
        }
    });

    it('uses a newer selection for native input while the edited page is pending', async () => {
        const editor = createEditor();
        try {
            await editor.commands.executeCommand(InsertTextCommand.id, {
                unitId: editor.unitId,
                range: { startOffset: 5, endOffset: 5, collapsed: true },
                body: { dataStream: 'A' },
            });
            expect(editor.skeleton.getLayoutProgress()?.anchorReady).toBe(false);
            editor.selection.replaceDocRanges([{ startOffset: 2, endOffset: 2 }], true, { shouldFocus: false });
            editor.input.textContent = 'Z';
            editor.input.dispatchEvent(new InputEvent('input', { data: 'Z', inputType: 'insertText' }));
            await Promise.resolve();
            expect(editor.model.getBody()?.dataStream.startsWith('HeZlloA world')).toBe(true);
            await vi.advanceTimersByTimeAsync(20);
            expect(editor.selectionManager.getActiveTextRange()?.endOffset).toBe(3);
        } finally {
            editor.dispose();
        }
    });

    it.each([
        { label: 'desktop', mobile: false },
        { label: 'mobile', mobile: true },
    ])('keeps $label IME focused across repeated space confirmations and layout refreshes', async ({ mobile }) => {
        const editor = createEditor(8, true, false, DocumentFlavor.TRADITIONAL, false, mobile);
        try {
            if (mobile) {
                (editor.selection as MobileDocSelectionRenderService).enterMobileEditMode();
            }
            editor.selection.focus();
            editor.input.textContent = 'A';
            editor.input.dispatchEvent(new InputEvent('input', { data: 'A', inputType: 'insertText' }));
            await Promise.resolve();
            await Promise.resolve();
            expect(editor.skeleton.getLayoutProgress()?.anchorReady).toBe(false);

            const compositions = [
                { updates: ['n', 'ni', '你'], result: '你' },
                { updates: ['h', 'ha', 'hao', '好'], result: '好' },
                { updates: ['s', 'sh', 'shi', '世'], result: '世' },
                { updates: ['j', 'jie', '界'], result: '界' },
                { updates: ['a', '啊'], result: '啊' },
            ];

            for (const [index, composition] of compositions.entries()) {
                editor.input.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
                for (const text of composition.updates) {
                    editor.input.textContent = text;
                    editor.input.dispatchEvent(new CompositionEvent('compositionupdate', { data: text }));
                    for (let microtask = 0; microtask < 8; microtask++) {
                        await Promise.resolve();
                    }
                }
                editor.input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
                editor.input.dispatchEvent(new CompositionEvent('compositionend', { data: composition.result }));
                for (let index = 0; index < 8; index++) {
                    await Promise.resolve();
                }

                const committed = compositions.slice(0, index + 1).map(({ result }) => result).join('');
                const expectedOffset = 6 + index + 1;
                expect(editor.model.getBody()?.dataStream.startsWith(`HelloA${committed} world`)).toBe(true);
                await vi.advanceTimersByTimeAsync(20);
                expect(editor.selectionManager.getActiveTextRange()?.endOffset).toBe(expectedOffset);
                expect(editor.selection.getActiveTextRange()?.endOffset).toBe(expectedOffset);
                expect(editor.selection.isEditing).toBe(true);
                expect(document.activeElement).toBe(editor.input);

                editor.skeletonManager.recalculate();

                expect(editor.selectionManager.getActiveTextRange()?.endOffset).toBe(expectedOffset);
                expect(editor.selection.isEditing).toBe(true);
                expect(document.activeElement).toBe(editor.input);
            }
        } finally {
            editor.dispose();
        }
    });

    it('does not restore an old input position after a pointer targets an unpublished page', async () => {
        const editor = createEditor();
        try {
            const target = cursorConvertToTextRange(
                editor.render.scene,
                { startOffset: 2, endOffset: 2 },
                editor.skeleton,
                editor.render.mainComponent as Documents
            )!;
            const anchor = target.getAnchor()!;
            const event = { offsetX: anchor.left, offsetY: anchor.top + 3, button: 0 } as IPointerEvent;
            target.dispose();
            await editor.commands.executeCommand(InsertTextCommand.id, {
                unitId: editor.unitId,
                range: { startOffset: 5, endOffset: 5, collapsed: true },
                body: { dataStream: 'A' },
            });
            editor.selection.__onPointDown(event);
            expect(editor.skeleton.getLayoutProgress()?.anchorReady).toBe(false);
            expect(editor.selection.isOnPointerEvent).toBe(false);
            expect(editor.selectionManager.getActiveTextRange()).toBeUndefined();
            editor.input.textContent = 'B';
            editor.input.dispatchEvent(new InputEvent('input', { data: 'B', inputType: 'insertText' }));
            await vi.advanceTimersByTimeAsync(20);
            expect(editor.selection.getActiveTextRange()?.endOffset).toBeUndefined();
            editor.render.scene.onPointerUp$.emitEvent(event);
            expect(editor.selectionManager.getActiveTextRange()).toBeUndefined();
            expect(editor.model.getBody()?.dataStream.startsWith('HelloA world')).toBe(true);
            expect(editor.model.getBody()?.dataStream.includes('B')).toBe(false);
        } finally {
            editor.dispose();
        }
    });

    it('keeps a manual scroll through delayed edit publication and resumes following new input', async () => {
        const editor = createEditor(100);
        try {
            const viewport = editor.render.scene.getViewport(VIEWPORT_KEY.VIEW_MAIN)!;
            expect(viewport.isActive).toBe(true);
            await editor.commands.executeCommand(InsertTextCommand.id, {
                unitId: editor.unitId,
                range: { startOffset: 5, endOffset: 5, collapsed: true },
                body: { dataStream: 'A' },
            });
            expect(editor.skeleton.getLayoutProgress()?.anchorReady).toBe(false);
            viewport.scrollToViewportPos({ viewportScrollY: 1200 });
            const manualScroll = viewport.viewportScrollY;
            expect(manualScroll).toBeGreaterThan(1000);
            await vi.advanceTimersByTimeAsync(100);
            expect(viewport.viewportScrollY).toBe(manualScroll);
            expect(editor.selectionManager.getActiveTextRange()?.endOffset).toBe(6);
            editor.input.textContent = 'B';
            editor.input.dispatchEvent(new InputEvent('input', { data: 'B', inputType: 'insertText' }));
            await vi.advanceTimersByTimeAsync(100);
            expect(editor.model.getBody()?.dataStream.startsWith('HelloAB world')).toBe(true);
            expect(editor.selectionManager.getActiveTextRange()?.endOffset).toBe(7);
            expect(viewport.viewportScrollY).toBeLessThan(manualScroll);
        } finally {
            editor.dispose();
        }
    });

    describe('iOS Korean keyboard', () => {
        // Replays iOS Safari's Korean keyboard as measured on iOS 27 (CNT-5176): every key fires keydown with keyCode 0
        // and no composition event. A key that joins the syllable before the caret then removes that syllable from the
        // editable (deleteContentBackward) and inserts the joined text (insertText) in the same task — "ㅎ", "ㅏ" gives
        // "ㅎ" then remove "ㅎ" + insert "하"; "닭", "ㅏ" gives remove "닭" + insert "달가". When the editable does not
        // hold the syllable (it was emptied), no removal event fires and only the insertion comes.
        type Key = [key: string, remove: number, insert: string];

        function press(input: HTMLElement, [key, remove, insert]: Key, keyCode = 0): void {
            input.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true }));
            const held = input.textContent ?? '';
            if (remove > 0 && held.length >= remove) {
                input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true }));
                input.textContent = held.slice(0, held.length - remove);
                input.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true }));
            }
            input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: insert, bubbles: true, cancelable: true }));
            input.textContent = (input.textContent ?? '') + insert;
            input.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: insert, bubbles: true }));
        }

        async function settle(): Promise<void> {
            for (let index = 0; index < 8; index++) {
                await Promise.resolve();
            }
        }

        async function type(editor: ReturnType<typeof createEditor>, keys: Key[], after?: (text: string) => void): Promise<void> {
            for (const key of keys) {
                press(editor.input, key);
                await settle();
                after?.(key[2]);
            }
        }

        const HANGEUL: Key[] = [['ㅎ', 0, 'ㅎ'], ['ㅏ', 1, '하'], ['ㄴ', 1, '한'], ['ㄱ', 0, 'ㄱ'], ['ㅡ', 1, '그'], ['ㄹ', 1, '글']];
        const DALGA: Key[] = [['ㄷ', 0, 'ㄷ'], ['ㅏ', 1, '다'], ['ㄹ', 1, '달'], ['ㄱ', 1, '닭'], ['ㅏ', 1, '달가']];

        function text(editor: ReturnType<typeof createEditor>): string {
            return editor.model.getBody()!.dataStream.split('\r')[0];
        }

        it.each([
            { label: 'desktop', mobile: false },
            { label: 'mobile', mobile: true },
        ])('puts the joined syllables, not every step, into the $label document', async ({ mobile }) => {
            const editor = createEditor(8, false, false, DocumentFlavor.TRADITIONAL, false, mobile);
            try {
                if (mobile) {
                    (editor.selection as MobileDocSelectionRenderService).enterMobileEditMode();
                }
                editor.selection.focus();
                const steps: string[] = [];
                await type(editor, HANGEUL, () => steps.push(text(editor)));
                expect(steps).toEqual(['Helloㅎ world', 'Hello하 world', 'Hello한 world', 'Hello한ㄱ world', 'Hello한그 world', 'Hello한글 world']);

                // A space, then a final consonant that moves to the next syllable (달 → 닭 → 달가), then a digit and a letter.
                press(editor.input, [' ', 0, ' '], 32);
                await settle();
                await type(editor, DALGA);
                expect(text(editor)).toBe('Hello한글 달가 world');
                press(editor.input, ['7', 0, '7'], 55);
                await settle();
                press(editor.input, ['a', 0, 'a'], 65);
                await settle();
                expect(text(editor)).toBe('Hello한글 달가7a world');
                expect(editor.selectionManager.getActiveTextRange()).toMatchObject({ startOffset: 12, endOffset: 12 });
            } finally {
                editor.dispose();
            }
        });

        it('replaces a selection with the first jamo and keeps joining after it', async () => {
            const editor = createEditor(8, false);
            try {
                editor.selection.replaceDocRanges([{ startOffset: 0, endOffset: 5 }], true, { shouldFocus: true });
                await type(editor, HANGEUL.slice(0, 3));
                expect(text(editor)).toBe('한 world');
            } finally {
                editor.dispose();
            }
        });

        it('starts over from an emptied input after a key the document handled', async () => {
            const editor = createEditor(8, false);
            // A shortcut (Backspace, Enter) runs on window in the capture phase and prevents the key. iOS then leaves
            // the editable alone and starts a new syllable (measured: "ㅏ" after a prevented Backspace inserts "ㅏ").
            const shortcut = (event: KeyboardEvent): void => {
                const range = editor.selectionManager.getActiveTextRange();
                if (range == null) {
                    return;
                }
                if (event.key === 'Backspace') {
                    event.preventDefault();
                    void editor.commands.executeCommand(DeleteTextCommand.id, {
                        unitId: editor.unitId,
                        range,
                        direction: DeleteDirection.LEFT,
                        len: 1,
                    });
                } else if (event.key === 'Enter') {
                    event.preventDefault();
                    void editor.commands.executeCommand(BreakLineCommand.id);
                }
            };
            window.addEventListener('keydown', shortcut, true);
            try {
                editor.selection.focus();
                await type(editor, HANGEUL.slice(0, 3));
                expect(text(editor)).toBe('Hello한 world');

                editor.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', keyCode: 8, bubbles: true, cancelable: true }));
                await settle();
                expect(text(editor)).toBe('Hello world');
                expect(editor.input.textContent).toBe('');

                await type(editor, [['ㅏ', 0, 'ㅏ'], ['ㄱ', 0, 'ㄱ'], ['ㅏ', 1, '가']]);
                expect(text(editor)).toBe('Helloㅏ가 world');

                editor.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
                await settle();
                expect(editor.input.textContent).toBe('');
                await type(editor, [['ㄴ', 0, 'ㄴ'], ['ㅏ', 1, '나']]);
                expect(editor.model.getBody()!.dataStream.startsWith('Helloㅏ가\r나 world')).toBe(true);
            } finally {
                window.removeEventListener('keydown', shortcut, true);
                editor.dispose();
            }
        });

        it('does not replace text the document no longer holds before the caret', async () => {
            const editor = createEditor(8, false);
            try {
                editor.selection.focus();
                await type(editor, HANGEUL.slice(0, 3));
                expect(text(editor)).toBe('Hello한 world');

                // The caret moves (a tap) while the keyboard still joins: "한" + "ㅏ" removes "한" and inserts "하나".
                editor.selection.replaceDocRanges([{ startOffset: 1, endOffset: 1 }], true, { shouldFocus: true });
                await type(editor, [['ㅏ', 1, '하나']]);
                expect(text(editor)).toBe('H하나ello한 world');
            } finally {
                editor.dispose();
            }
        });

        it('applies a removal no insertion follows at the end of the task', async () => {
            const editor = createEditor(8, false);
            try {
                editor.selection.focus();
                await type(editor, HANGEUL.slice(0, 4));
                expect(text(editor)).toBe('Hello한ㄱ world');

                editor.input.textContent = '한';
                editor.input.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true }));
                await settle();
                expect(text(editor)).toBe('Hello한ㄱ world');
                await vi.advanceTimersByTimeAsync(0);
                expect(text(editor)).toBe('Hello한 world');
                expect(editor.selectionManager.getActiveTextRange()).toMatchObject({ startOffset: 6, endOffset: 6 });
            } finally {
                editor.dispose();
            }
        });

        it('replaces the word iOS autocorrect replaces', async () => {
            const editor = createEditor(8, false);
            try {
                editor.selection.focus();
                for (const [key, keyCode] of [['T', 84], ['e', 69], ['h', 72]] as const) {
                    press(editor.input, [key, 0, key], keyCode);
                    await settle();
                }
                // Measured for "Teh" + space: insertReplacementText over "Teh" (no data), then insertText " ".
                editor.input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', keyCode: 32, bubbles: true, cancelable: true }));
                editor.input.textContent = 'The';
                editor.input.dispatchEvent(new InputEvent('input', { inputType: 'insertReplacementText', bubbles: true }));
                editor.input.textContent = 'The ';
                editor.input.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: ' ', bubbles: true }));
                await settle();
                expect(text(editor)).toBe('HelloThe  world');
            } finally {
                editor.dispose();
            }
        });

        it('empties the input on a key an input method takes, as before', async () => {
            const editor = createEditor(8, false);
            try {
                editor.selection.focus();
                press(editor.input, ['a', 0, 'a'], 65);
                await settle();
                expect(editor.input.textContent).toBe('a');
                editor.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', keyCode: 229, bubbles: true, cancelable: true }));
                expect(editor.input.textContent).toBe('');
            } finally {
                editor.dispose();
            }
        });

        // The typed text the input keeps between keys ("12" here) must never reach the document again. The platform can
        // edit the input elsewhere than at its end — its caret moved inside by a key no shortcut takes (iOS spacebar
        // drag, macOS Ctrl+B/A, Option+arrow) — and only the text that edit newly inserted belongs at the document caret,
        // as when the input was emptied after every key.
        async function typeTwelve(editor: ReturnType<typeof createEditor>): Promise<void> {
            editor.selection.focus();
            for (const [key, keyCode] of [['1', 49], ['2', 50]] as const) {
                press(editor.input, [key, 0, key], keyCode);
                await settle();
            }
            expect(text(editor)).toBe('Hello12 world');
            expect(editor.input.textContent).toBe('12');
        }

        function edit(input: HTMLElement, inputType: string, after: string, data: string | null = null, key?: string): void {
            if (key != null) {
                input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
            }
            input.dispatchEvent(new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true }));
            input.textContent = after;
            input.dispatchEvent(new InputEvent('input', { inputType, data, bubbles: true }));
        }

        it('puts only the new text into the document when the caret moved inside the input', async () => {
            const editor = createEditor(8, false);
            try {
                await typeTwelve(editor);
                // The input's caret went to its start; "3" lands before the kept "12".
                edit(editor.input, 'insertText', '312', '3', '3');
                await settle();
                expect(text(editor)).toBe('Hello123 world');
                expect(editor.input.textContent).toBe('');
            } finally {
                editor.dispose();
            }
        });

        it.each([
            { label: 'insertText inside the kept text', inputType: 'insertText', after: '1x2', data: 'x', key: 'x', expected: 'Hello12x' },
            { label: 'insertText over a part of it selected', inputType: 'insertText', after: 'x2', data: 'x', key: 'x', expected: 'Hello12x' },
            { label: 'deleteWordBackward', inputType: 'deleteWordBackward', after: '', expected: 'Hello12' },
            { label: 'deleteContentForward', inputType: 'deleteContentForward', after: '2', expected: 'Hello12' },
            { label: 'deleteContentBackward inside it', inputType: 'deleteContentBackward', after: '2', expected: 'Hello12' },
            { label: 'insertFromPaste', inputType: 'insertFromPaste', after: '12pasted', expected: 'Hello12' },
            { label: 'insertFromDrop', inputType: 'insertFromDrop', after: '1dropped2', expected: 'Hello12' },
            { label: 'insertTranspose', inputType: 'insertTranspose', after: '21', expected: 'Hello12' },
            { label: 'historyUndo', inputType: 'historyUndo', after: '1', expected: 'Hello12' },
        ])('applies $label as with an emptied input and empties it', async ({ inputType, after, data, key, expected }) => {
            const editor = createEditor(8, false);
            try {
                await typeTwelve(editor);
                edit(editor.input, inputType, after, data ?? null, key);
                await settle();
                await vi.advanceTimersByTimeAsync(0);
                expect(text(editor)).toBe(`${expected} world`);
                expect(editor.input.textContent).toBe('');

                press(editor.input, ['z', 0, 'z'], 90);
                await settle();
                expect(text(editor)).toBe(`${expected}z world`);
            } finally {
                editor.dispose();
            }
        });

        it('puts only the composed text into the document when a composition starts without keyCode 229', async () => {
            const editor = createEditor(8, false);
            try {
                await typeTwelve(editor);
                editor.input.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
                for (const composed of ['ㅎ', '하']) {
                    editor.input.textContent = `12${composed}`;
                    editor.input.dispatchEvent(new CompositionEvent('compositionupdate', { data: composed }));
                    await settle();
                }
                editor.input.dispatchEvent(new CompositionEvent('compositionend', { data: '하' }));
                await settle();
                expect(text(editor)).toBe('Hello12하 world');
                expect(editor.input.textContent).toBe('');
            } finally {
                editor.dispose();
            }
        });

        it('refuses the line breaks the platform would put into the input', () => {
            const editor = createEditor(8, false);
            try {
                editor.selection.focus();
                const before = (inputType: string): boolean => !editor.input.dispatchEvent(
                    new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true })
                );
                expect(before('insertParagraph')).toBe(true);
                expect(before('insertLineBreak')).toBe(true);
                expect(before('insertText')).toBe(false);
            } finally {
                editor.dispose();
            }
        });

        it('empties the input on a key that may move its caret', async () => {
            const editor = createEditor(8, false);
            try {
                editor.selection.focus();
                const keys: KeyboardEventInit[] = [
                    { key: 'ArrowLeft', keyCode: 37 },
                    { key: 'b', keyCode: 66, ctrlKey: true },
                    { key: 'ArrowLeft', keyCode: 37, altKey: true },
                    { key: 'a', keyCode: 65, metaKey: true },
                    { key: 'Enter', keyCode: 13 },
                ];
                for (const init of keys) {
                    press(editor.input, ['a', 0, 'a'], 65);
                    await settle();
                    expect(editor.input.textContent).toBe('a');
                    editor.input.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }));
                    expect(editor.input.textContent, init.key).toBe('');
                }
            } finally {
                editor.dispose();
            }
        });

        it('puts in the suggestion tapped for the word before the caret', async () => {
            const editor = createEditor(8, false);
            try {
                editor.selection.focus();
                await type(editor, HANGEUL);
                expect(text(editor)).toBe('Hello한글 world');
                // Measured for the suggestion "한글날": insertReplacementText over "한글" (no data), the input then holds "한글날".
                edit(editor.input, 'insertReplacementText', '한글날');
                await settle();
                expect(text(editor)).toBe('Hello한글날 world');
                expect(editor.selectionManager.getActiveTextRange()).toMatchObject({ startOffset: 8, endOffset: 8 });
            } finally {
                editor.dispose();
            }
        });

        it('keeps joining across the Shift key of a doubled consonant', async () => {
            const editor = createEditor(8, false);
            try {
                editor.selection.focus();
                await type(editor, [['ㅎ', 0, 'ㅎ'], ['ㅐ', 1, '해']]);
                // Measured: Shift sends its own keydown ("Shift", keyCode 16) before "ㅆ" replaces 해 with 했.
                editor.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', keyCode: 16, shiftKey: true, bubbles: true, cancelable: true }));
                expect(editor.input.textContent).toBe('해');
                await type(editor, [['ㅆ', 1, '했'], ['ㄷ', 0, 'ㄷ'], ['ㅏ', 1, '다']]);
                expect(text(editor)).toBe('Hello했다 world');
            } finally {
                editor.dispose();
            }
        });

        describe('caret moved by other means', () => {
            // Measured in iOS Safari (CNT-5176): the keyboard keeps composing the syllable before the caret of the hidden
            // input when the caret moves on the canvas, and only a focus moved to another text field ends that.
            let breakerFocuses = 0;
            const leaked: string[] = [];
            const countBreaker = (event: FocusEvent): void => {
                if (event.target instanceof HTMLInputElement && event.target.readOnly) {
                    breakerFocuses += 1;
                }
            };
            const watchLeak = (event: FocusEvent): void => {
                leaked.push(`${event.type}:${(event.target as HTMLElement).tagName}`);
            };

            beforeEach(() => {
                breakerFocuses = 0;
                leaked.length = 0;
                document.addEventListener('focusin', countBreaker, true);
                window.addEventListener('focusin', watchLeak);
                window.addEventListener('focusout', watchLeak);
            });

            afterEach(() => {
                testPlatform.isIOS = false;
                document.removeEventListener('focusin', countBreaker, true);
                window.removeEventListener('focusin', watchLeak);
                window.removeEventListener('focusout', watchLeak);
            });

            it('ends the composition once and puts the next key alone at the new caret on iOS', async () => {
                testPlatform.isIOS = true;
                const editor = createEditor(8, false);
                const focusAndBlur: string[] = [];
                editor.selection.onFocus$.subscribe(() => focusAndBlur.push('focus'));
                editor.selection.onBlur$.subscribe(() => focusAndBlur.push('blur'));
                try {
                    editor.selection.focus();
                    leaked.length = 0;
                    await type(editor, HANGEUL.slice(0, 3));
                    expect(text(editor)).toBe('Hello한 world');

                    // A tap before "e", in a later task: the selection comes from the canvas, not from the platform's input.
                    await vi.advanceTimersByTimeAsync(0);
                    editor.selection.replaceDocRanges([{ startOffset: 1, endOffset: 1 }], true, { shouldFocus: true });
                    expect(breakerFocuses).toBe(1);
                    expect(editor.input.textContent).toBe('');
                    expect(document.activeElement).toBe(editor.input);
                    expect(focusAndBlur).toEqual([]);
                    expect(leaked).toEqual([]);

                    // The keyboard starts a new syllable: "ㄱ" alone, then "ㅏ" joins it.
                    await type(editor, [['ㄱ', 0, 'ㄱ'], ['ㅏ', 1, '가']]);
                    expect(text(editor)).toBe('H가ello한 world');
                    expect(breakerFocuses).toBe(1);
                } finally {
                    editor.dispose();
                }
            });

            it('leaves the composition alone for the caret its own input moves on iOS', async () => {
                testPlatform.isIOS = true;
                const editor = createEditor(8, false);
                try {
                    editor.selection.focus();
                    // Every key in its own task, as on the device: the caret each edit publishes is the expected one.
                    const keys: Array<[Key, number]> = [...HANGEUL.map((key): [Key, number] => [key, 0]), [[' ', 0, ' '], 32], ...DALGA.map((key): [Key, number] => [key, 0])];
                    for (const [key, keyCode] of keys) {
                        press(editor.input, key, keyCode);
                        await settle();
                        await vi.advanceTimersByTimeAsync(0);
                    }
                    expect(text(editor)).toBe('Hello한글 달가 world');
                    expect(breakerFocuses).toBe(0);
                    expect(editor.input.textContent).toBe('한글 달가');

                    // A later publication of the same caret (layout catching up, a refresh) is not a move.
                    const caret = editor.selectionManager.getActiveTextRange()!.startOffset;
                    editor.selection.replaceDocRanges([{ startOffset: caret, endOffset: caret }], true, { shouldFocus: true });
                    expect(breakerFocuses).toBe(0);
                    expect(editor.input.textContent).toBe('한글 달가');
                } finally {
                    editor.dispose();
                }
            });

            it('does nothing outside iOS', async () => {
                const editor = createEditor(8, false);
                try {
                    editor.selection.focus();
                    await type(editor, HANGEUL.slice(0, 3));
                    editor.selection.replaceDocRanges([{ startOffset: 1, endOffset: 1 }], true, { shouldFocus: true });
                    expect(breakerFocuses).toBe(0);
                    expect(editor.input.textContent).toBe('한');
                } finally {
                    editor.dispose();
                }
            });
        });

        it('turns Safari autocorrect off on the input', () => {
            const editor = createEditor(8, false);
            try {
                expect(editor.input.getAttribute('autocorrect')).toBe('off');
            } finally {
                editor.dispose();
            }
        });
    });
});
