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

// Modified by Carenode, 2026 — hands the worksheet shade a reader of the sheet's own protection state (xlsxkit worksheet-shadow-sheet-state)

import type { IRenderContext, IRenderModule, Spreadsheet } from '@univerjs/engine-render';
import type { MenuConfig } from '@univerjs/ui';
import { Disposable, IConfigService, Inject, IPermissionService, ThemeService } from '@univerjs/core';
import { IRenderManagerService } from '@univerjs/engine-render';
import { UnitAction } from '@univerjs/protocol';
import { RangeProtectionRuleModel, WorksheetEditPermission, WorksheetProtectionRuleModel, WorksheetViewPermission } from '@univerjs/sheets';
import { merge, skip, throttleTime } from 'rxjs';
import type { IUniverSheetsUIConfig } from '../../config/config';
import type { XlsxkitSheetProtectionReader } from '../../views/permission/extensions/worksheet-permission.render';
import { convertToShadowStrategy, SHEETS_UI_PLUGIN_CONFIG_KEY } from '../../config/config';
import { SheetSkeletonManagerService } from '../../services/sheet-skeleton-manager.service';
import {
    RANGE_PROTECTION_CAN_NOT_VIEW_RENDER_EXTENSION_KEY,
    RANGE_PROTECTION_CAN_VIEW_RENDER_EXTENSION_KEY,
    RangeProtectionCanNotViewRenderExtension,
    RangeProtectionCanViewRenderExtension,
} from '../../views/permission/extensions/range-protection.render';
import {
    worksheetProtectionKey,
    WorksheetProtectionRenderExtension,
} from '../../views/permission/extensions/worksheet-permission.render';

export interface IUniverSheetsPermissionMenuConfig {
    menu: MenuConfig;
}

export class SheetPermissionRenderController extends Disposable implements IRenderModule {
    private _rangeProtectionCanViewRenderExtension: RangeProtectionCanViewRenderExtension;
    private _rangeProtectionCanNotViewRenderExtension: RangeProtectionCanNotViewRenderExtension;

    constructor(
        private readonly _context: IRenderContext,
        @Inject(RangeProtectionRuleModel) private _rangeProtectionRuleModel: RangeProtectionRuleModel,
        @Inject(SheetSkeletonManagerService) private _sheetSkeletonManagerService: SheetSkeletonManagerService,
        @IPermissionService private _permissionService: IPermissionService,
        @IConfigService private _configService: IConfigService,
        @Inject(ThemeService) private readonly _themeService: ThemeService
    ) {
        super();

        const config = this._configService.getConfig<IUniverSheetsUIConfig>(SHEETS_UI_PLUGIN_CONFIG_KEY);

        // Get shadow strategy from config, default to 'always'
        const shadowStrategy = convertToShadowStrategy(config?.protectedRangeShadow);

        // Create render extensions with the shadow strategy
        this._rangeProtectionCanViewRenderExtension = new RangeProtectionCanViewRenderExtension(this._themeService, shadowStrategy);
        this._rangeProtectionCanNotViewRenderExtension = new RangeProtectionCanNotViewRenderExtension(this._themeService, shadowStrategy);

        this._initSkeleton();
        this._initRender();

        this.disposeWithMe(this._rangeProtectionRuleModel.ruleChange$.subscribe((info) => {
            if ((info.oldRule?.id && this._rangeProtectionCanViewRenderExtension.renderCache.has(info.oldRule.id)) || this._rangeProtectionCanViewRenderExtension.renderCache.has(info.rule.id)) {
                this._rangeProtectionCanViewRenderExtension.clearCache();
            }
            if ((info.oldRule?.id && this._rangeProtectionCanNotViewRenderExtension.renderCache.has(info.oldRule.id)) || this._rangeProtectionCanNotViewRenderExtension.renderCache.has(info.rule.id)) {
                this._rangeProtectionCanNotViewRenderExtension.clearCache();
            }
        }));
    }

    private _initRender(): void {
        const spreadsheetRender = this._context.mainComponent as Spreadsheet;
        if (spreadsheetRender) {
            if (!spreadsheetRender.getExtensionByKey(RANGE_PROTECTION_CAN_VIEW_RENDER_EXTENSION_KEY)) {
                spreadsheetRender.register(this._rangeProtectionCanViewRenderExtension);
            }
            if (!spreadsheetRender.getExtensionByKey(RANGE_PROTECTION_CAN_NOT_VIEW_RENDER_EXTENSION_KEY)) {
                spreadsheetRender.register(this._rangeProtectionCanNotViewRenderExtension);
            }
        }
    }

    private _initSkeleton(): void {
        const markDirtySkeleton = () => {
            this._sheetSkeletonManagerService.reCalculate();
            this._context.mainComponent?.makeDirty();
        };

        this.disposeWithMe(merge(
            this._permissionService.permissionPointUpdate$.pipe(throttleTime(300, undefined, { trailing: true })),
            this._rangeProtectionRuleModel.rangeRuleInitStateChange$,
            this._rangeProtectionRuleModel.ruleChange$,
            this._themeService.darkMode$.pipe(skip(1))
        ).pipe().subscribe(markDirtySkeleton));
    }
}

export class WorksheetProtectionRenderController extends Disposable implements IRenderModule {
    private _worksheetProtectionRenderExtension: WorksheetProtectionRenderExtension;

    constructor(
        private readonly _context: IRenderContext,
        @Inject(IRenderManagerService) private _renderManagerService: IRenderManagerService,
        @Inject(SheetSkeletonManagerService) private _sheetSkeletonManagerService: SheetSkeletonManagerService,
        @Inject(WorksheetProtectionRuleModel) private _worksheetProtectionRuleModel: WorksheetProtectionRuleModel,
        @Inject(IConfigService) private _configService: IConfigService,
        @Inject(ThemeService) private readonly _themeService: ThemeService,
        @IPermissionService private readonly _permissionService: IPermissionService
    ) {
        super();

        const config = this._configService.getConfig<IUniverSheetsUIConfig>(SHEETS_UI_PLUGIN_CONFIG_KEY);

        // Get shadow strategy from config, default to 'always'
        const shadowStrategy = convertToShadowStrategy(config?.protectedRangeShadow);

        // Create render extension with the shadow strategy
        this._worksheetProtectionRenderExtension = new WorksheetProtectionRenderExtension(this._themeService, shadowStrategy, this._readSheetProtection);

        this._initSkeleton();
        if (shadowStrategy === 'none') {
            return;
        }

        this._initRender();
    }

    // Carenode xlsxkit worksheet-shadow-sheet-state: the sheet's state the shade reads, the same rule and points the
    // sheets view model's sheet interceptor reads.
    private readonly _readSheetProtection: XlsxkitSheetProtectionReader = (unitId, subUnitId) => {
        if (!this._worksheetProtectionRuleModel.getRule(unitId, subUnitId)?.permissionId) {
            return null;
        }

        return {
            [UnitAction.View]: this._permissionService.getPermissionPoint(new WorksheetViewPermission(unitId, subUnitId).id)?.value ?? false,
            [UnitAction.Edit]: this._permissionService.getPermissionPoint(new WorksheetEditPermission(unitId, subUnitId).id)?.value ?? false,
        };
    };

    private _initRender() {
        const renderId = this._context.unitId;
        const render = renderId && this._renderManagerService.getRenderUnitById(renderId);
        const spreadsheetRender = render && render.mainComponent as Spreadsheet;
        if (spreadsheetRender) {
            if (!spreadsheetRender.getExtensionByKey(worksheetProtectionKey)) {
                spreadsheetRender.register(this._worksheetProtectionRenderExtension);
            }
        }
    }

    private _initSkeleton(): void {
        const markDirtySkeleton = () => {
            this._sheetSkeletonManagerService.reCalculate();
            this._context.mainComponent?.makeDirty();
        };

        this.disposeWithMe(merge(
            this._worksheetProtectionRuleModel.worksheetRuleInitStateChange$,
            this._themeService.darkMode$.pipe(skip(1))
        ).pipe().subscribe(markDirtySkeleton));
    }
}
