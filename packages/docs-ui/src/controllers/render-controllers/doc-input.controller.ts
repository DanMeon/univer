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

// Modified by Carenode, 2026 — CNT-5176 ios-hangul-replace: an input that replaces the text before the caret replaces it in the document

import type { DocumentDataModel, IDocumentBody, Nullable } from '@univerjs/core';
import type { IDeleteTextCommandParams, IInsertTextCommandParams } from '@univerjs/docs';
import type { IRenderContext, IRenderModule, ITextRangeWithStyle } from '@univerjs/engine-render';
import type { Subscription } from 'rxjs';
import { DeleteDirection, Disposable, ICommandService, Inject, Optional, SHEET_EDITOR_UNITS } from '@univerjs/core';
import { DeleteTextCommand, DocSkeletonManagerService, InsertTextCommand } from '@univerjs/docs';
import type { IEditorInputConfig } from '../../services/selection/doc-selection-render.service';
import {
    getCustomDecorationAtPosition,
    getCustomRangeAtPosition,
    getTextRunForSelection,
} from '../../basics/paragraph';
import { AfterSpaceCommand } from '../../commands/commands/auto-format.command';
import { ReplaceSelectionCommand } from '../../commands/commands/replace-content.command';
import {
    IDocEmbedInteractionBoundaryService,
    IDocEmbedRuntimeFocusCoordinator,
} from '../../services/doc-embed-integration.service';
import { DocMenuStyleService } from '../../services/doc-menu-style.service';
import { getEditorRuntimeConfig } from '../../services/editor/editor-runtime-config';
import { DocSelectionRenderService } from '../../services/selection/doc-selection-render.service';

export class DocInputController extends Disposable implements IRenderModule {
    private _onInputSubscription: Nullable<Subscription>;

    constructor(
        private readonly _context: IRenderContext<DocumentDataModel>,
        @Inject(DocSelectionRenderService) private readonly _docSelectionRenderService: DocSelectionRenderService,
        @Inject(DocSkeletonManagerService) private readonly _docSkeletonManagerService: DocSkeletonManagerService,
        @ICommandService private readonly _commandService: ICommandService,
        @Inject(DocMenuStyleService) private readonly _docMenuStyleService: DocMenuStyleService,
        @Optional(IDocEmbedInteractionBoundaryService) _embedInteractionBoundaryService?: IDocEmbedInteractionBoundaryService,
        @Optional(IDocEmbedRuntimeFocusCoordinator) private readonly _embedRuntimeFocusCoordinator?: IDocEmbedRuntimeFocusCoordinator
    ) {
        super();

        this._init();
    }

    override dispose(): void {
        super.dispose();

        this._onInputSubscription?.unsubscribe();
    }

    private _init() {
        this._initialNormalInput();
    }

    private _initialNormalInput() {
        this._onInputSubscription = this._docSelectionRenderService.onInput$.subscribe(async (config) => {
            if (config == null) {
                return;
            }

            const { unitId } = this._context;

            const { event, content = '', activeRange, rangeList = [] } = config;
            // Present when the hidden input resolved this input into an edit of the text it typed (see
            // IEditorInputConfig.replacedText); such an input puts in `content` even without `data`.
            const isPlatformTextEdit = config.replacedText !== undefined;
            const replacedText = config.replacedText ?? '';

            const e = event as InputEvent;
            if (e.defaultPrevented) {
                return;
            }

            if (!SHEET_EDITOR_UNITS.includes(unitId) && this._isEmbedChildInputActive(unitId, e)) {
                return;
            }

            const skeleton = this._docSkeletonManagerService.getSkeleton();

            if ((e.data == null && !isPlatformTextEdit) || skeleton == null || activeRange == null) {
                return;
            }

            const { segmentId } = activeRange;

            const docDataModel = this._context.unit;
            const originBody = docDataModel.getSelfOrHeaderFooterModel(segmentId)?.getBody();
            if (!originBody) {
                return;
            }

            // The platform removed text it had typed and inserted nothing after it.
            if (content === '' && replacedText !== '') {
                await this._removeReplacedText(config, originBody, replacedText);
                return;
            }

            // Insert content's style should follow the text style of the current position.
            const defaultTextStyle = this._docMenuStyleService.getDefaultStyle();
            const cacheStyle = this._docMenuStyleService.getStyleCache();
            const curCustomRange = getCustomRangeAtPosition(originBody?.customRanges ?? [], activeRange.endOffset, SHEET_EDITOR_UNITS.includes(unitId));
            const curTextRun = getTextRunForSelection(originBody, activeRange, defaultTextStyle, cacheStyle, SHEET_EDITOR_UNITS.includes(unitId), getEditorRuntimeConfig(docDataModel)?.inheritParagraphStartStyle === true);
            const curCustomDecorations = getCustomDecorationAtPosition(originBody?.customDecorations ?? [], activeRange.endOffset);

            const insertBody = {
                dataStream: content,
                textRuns: curTextRun
                    ? [{ ...curTextRun, st: 0, ed: content.length }]
                    : [],
                customRanges: curCustomRange
                    ? [{
                        ...curCustomRange,
                        startIndex: 0,
                        endIndex: content.length - 1,
                    }]
                    : [],
                customDecorations: curCustomDecorations.map((customDecoration) => ({
                    ...customDecoration,
                    startIndex: 0,
                    endIndex: content.length - 1,
                })),
            };
            const hasSelectedStructure = !activeRange.collapsed && (
                Boolean(originBody.blockRanges?.length) ||
                Boolean(originBody.columnGroups?.length) ||
                Boolean(originBody.customBlocks?.length) ||
                Boolean(originBody.tables?.length)
            );
            const hasComplexSelection = hasSelectedStructure || rangeList.length > 1 || this._docSelectionRenderService.getAllRectRanges().length > 0;

            if (hasComplexSelection) {
                await this._commandService.executeCommand(ReplaceSelectionCommand.id, {
                    unitId,
                    body: insertBody,
                    segmentId,
                });
            } else {
                await this._commandService.executeCommand<IInsertTextCommandParams>(InsertTextCommand.id, {
                    unitId,
                    body: insertBody,
                    // One edit replaces the platform's earlier text, so undo goes back to that text.
                    range: this._getReplaceRange(config, originBody, replacedText) ?? activeRange,
                    segmentId,
                });
            }

            // Space
            if (content === ' ') {
                await this._commandService.executeCommand(AfterSpaceCommand.id);
            }
        });
    }

    private async _removeReplacedText(config: IEditorInputConfig, body: IDocumentBody, replacedText: string): Promise<void> {
        const { activeRange } = config;
        if (activeRange == null || this._getReplaceRange(config, body, replacedText) == null) {
            return;
        }

        await this._commandService.executeCommand<IDeleteTextCommandParams>(DeleteTextCommand.id, {
            unitId: this._context.unitId,
            range: activeRange,
            segmentId: activeRange.segmentId,
            direction: DeleteDirection.LEFT,
            len: replacedText.length,
        });
    }

    /**
     * The range the input replaces when it carries `replacedText`: that text, right before a single collapsed caret.
     * The hidden input stays as the platform typed it while the document caret can move (a tap, a shortcut such as
     * Backspace, a change from elsewhere), so the replacement applies only while the document still holds that text
     * there; otherwise the input only inserts, as an input that replaces nothing.
     */
    private _getReplaceRange(config: IEditorInputConfig, body: IDocumentBody, replacedText: string): Nullable<ITextRangeWithStyle> {
        const { activeRange, rangeList = [] } = config;
        if (replacedText === '' || activeRange == null || !activeRange.collapsed) {
            return null;
        }

        if (rangeList.length > 1 || this._docSelectionRenderService.getAllRectRanges().length > 0) {
            return null;
        }

        const { startOffset } = activeRange;
        const replaceStart = startOffset - replacedText.length;
        if (replaceStart < 0 || body.dataStream.slice(replaceStart, startOffset) !== replacedText) {
            return null;
        }

        return {
            ...activeRange,
            startOffset: replaceStart,
            endOffset: startOffset,
            collapsed: false,
        };
    }

    private _isEmbedChildInputActive(unitId: string, event: Event): boolean {
        if (this._embedRuntimeFocusCoordinator?.isChildUnitRuntimeEvent(unitId, event.target, event)) {
            return false;
        }

        if (this._embedRuntimeFocusCoordinator?.isChildUnitInActiveSession(unitId)) {
            return false;
        }

        if (this._embedRuntimeFocusCoordinator?.shouldSuppressHostInteraction(unitId, event.target, event)) {
            return true;
        }

        return false;
    }
}
