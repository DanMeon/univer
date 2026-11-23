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

import type { DocumentDataModel, ICommand, ITextStyle, Nullable } from '@univerjs/core';
import { CommandType, Disposable, Inject, IUniverInstanceService, SHEET_EDITOR_UNITS, ThemeService, UniverInstanceType } from '@univerjs/core';
import { DocSelectionManagerService, DocSkeletonManagerService } from '@univerjs/docs';
import { DocumentEditArea, IRenderManagerService } from '@univerjs/engine-render';

const BODY_DEFAULT_FONTSIZE = 11;
const HEADER_FOOTER_DEFAULT_FONTSIZE = 9;
const DEFAULT_TEXT_STYLE = {
    /**
     * fontFamily
     */
    ff: 'Arial',
    /**
     * fontSize
     */
    fs: BODY_DEFAULT_FONTSIZE,
};

// It is used to cache the styles in the doc menu, which is used for the next input,
// and is cleared when the doc range is changed.
export class DocMenuStyleService extends Disposable {
    private _cacheStyle: Nullable<ITextStyle> = null;

    constructor(
        @Inject(DocSelectionManagerService) private readonly _textSelectionManagerService: DocSelectionManagerService,
        @IUniverInstanceService private readonly _univerInstanceService: IUniverInstanceService,
        @IRenderManagerService private readonly _renderManagerService: IRenderManagerService,
        @Inject(ThemeService) private readonly _themeService: ThemeService
    ) {
        super();

        this._init();
    }

    private _init() {
        this._listenDocRangeChange();
        this.disposeWithMe(
            this._univerInstanceService.getCurrentTypeOfUnit$(UniverInstanceType.UNIVER_DOC).subscribe(() => {
                this._clearStyleCache();
            })
        );
    }

    private _listenDocRangeChange() {
        this.disposeWithMe(
            this._textSelectionManagerService.textSelection$.subscribe(({ options }) => {
                if (!options?.preserveInputStyle) {
                    this._clearStyleCache();
                }
            })
        );
    }

    getStyleCache(): Nullable<ITextStyle> {
        return this._cacheStyle;
    }

    getDefaultStyle(): ITextStyle {
        const defaultTextStyle: ITextStyle = {
            ...DEFAULT_TEXT_STYLE,
            cl: { rgb: this._themeService.getColorFromTheme('gray.900') },
        };
        const docDataModel = this._univerInstanceService
            .getCurrentUnitOfType<DocumentDataModel>(UniverInstanceType.UNIVER_DOC);

        if (docDataModel == null) {
            return {
                ...defaultTextStyle,
            };
        }

        const documentDefaultTextStyle: ITextStyle = {
            ...defaultTextStyle,
            ...docDataModel.getDocumentStyle().textStyle,
        };

        // A sheet cell editor and the formula bar write no colour of their own into typed text, as in 0.24: the
        // colour comes from the cell's format (the editor renders with its document style and the cell keeps its
        // style), from the run the text continues, or from a colour picked while editing (the style cache). A
        // concrete colour here — the theme's, or the formula bar's document colour, which is the theme's too —
        // goes into every new run (typing, IME, line break), so one appended character turned a plain cell into
        // rich text and a cell typed over got the colour in its style.
        if (SHEET_EDITOR_UNITS.includes(docDataModel.getUnitId())) {
            delete documentDefaultTextStyle.cl;
        }

        const unitId = docDataModel?.getUnitId();
        const docSkeletonManagerService = this._renderManagerService.getRenderUnitById(unitId)?.with(DocSkeletonManagerService);
        const docViewModel = docSkeletonManagerService?.getViewModel();

        if (docViewModel == null) {
            return {
                ...documentDefaultTextStyle,
            };
        }

        const editArea = docViewModel.getEditArea();

        if (editArea === DocumentEditArea.BODY) {
            return {
                ...documentDefaultTextStyle,
            };
        } else {
            return {
                ...documentDefaultTextStyle,
                fs: HEADER_FOOTER_DEFAULT_FONTSIZE,
            };
        }
    }

    setStyleCache(style: ITextStyle) {
        this._cacheStyle = {
            ...this._cacheStyle,
            ...style,
        };
    }

    private _clearStyleCache() {
        this._cacheStyle = null;
    }
}

export interface ISetDocInputStyleCommandParams {
    style: ITextStyle;
}

export const SetDocInputStyleCommand: ICommand<ISetDocInputStyleCommandParams> = {
    id: 'doc.command.set-input-style',
    type: CommandType.COMMAND,
    handler: (accessor, params) => {
        if (!params) {
            return false;
        }
        accessor.get(DocMenuStyleService).setStyleCache(params.style);
        return true;
    },
};
