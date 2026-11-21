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

// Modified by Carenode, 2026 — CNT-5176: added file, the command with and without the calculation-settings lock.

import type { Injector, IWorkbookCalculationSettings, Univer, Workbook } from '@univerjs/core';
import {
    ICommandService,
    IConfigService,
    IUndoRedoService,
    IUniverInstanceService,
    UndoCommand,
    UniverInstanceType,
} from '@univerjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XlsxkitCalculationSettingsLockResolver } from '../../../basics/xlsxkit-calculation-settings-lock';
import { XLSXKIT_CALCULATION_SETTINGS_LOCK_RESOLVER_CONFIG_KEY } from '../../../basics/xlsxkit-calculation-settings-lock';
import { SetWorkbookCalculationSettingsMutation } from '../../mutations/set-workbook-calculation-settings.mutation';
import { SetWorkbookCalculationSettingsCommand } from '../set-workbook-calculation-settings.command';
import { createCommandTestBed } from './create-command-test-bed';

describe('SetWorkbookCalculationSettingsCommand', () => {
    let univer: Univer;
    let get: Injector['get'];
    let commandService: ICommandService;
    let executed: string[];

    const next: IWorkbookCalculationSettings = { iterativeCalculation: true, maxIterations: 50, maxChange: 0.01 };

    beforeEach(() => {
        const testBed = createCommandTestBed();
        univer = testBed.univer;
        get = testBed.get;
        commandService = get(ICommandService);
        commandService.registerCommand(SetWorkbookCalculationSettingsCommand);
        commandService.registerCommand(SetWorkbookCalculationSettingsMutation);
        executed = [];
        commandService.onCommandExecuted((info) => executed.push(info.id));
    });

    afterEach(() => {
        univer.dispose();
    });

    function settings() {
        return get(IUniverInstanceService).getUnit<Workbook>('test', UniverInstanceType.UNIVER_SHEET)!.getCalculationSettings();
    }

    function setResolver(value: unknown) {
        get(IConfigService).setConfig(XLSXKIT_CALCULATION_SETTINGS_LOCK_RESOLVER_CONFIG_KEY, value);
    }

    function expectUpstreamBehaviour() {
        const before = settings();
        expect(commandService.syncExecuteCommand(SetWorkbookCalculationSettingsCommand.id, { unitId: 'test', settings: next })).toBe(true);
        expect(settings()).toEqual(next);
        expect(executed).toContain(SetWorkbookCalculationSettingsMutation.id);
        expect(get(IUndoRedoService).getUndoRedoStatus('test')).toEqual({ undos: 1, redos: 0 });
        expect(commandService.syncExecuteCommand(UndoCommand.id)).toBe(true);
        expect(settings()).toEqual(before);
    }

    it('sets the settings through an undoable mutation without a resolver', () => {
        expectUpstreamBehaviour();
    });

    it.each([
        ['a resolver that answers null', () => null],
        ['a resolver that answers undefined', () => undefined],
        ['a value that is not a function', { notice: 'not a resolver' }],
    ])('keeps the upstream behaviour with %s', (_name, value) => {
        setResolver(value);
        expectUpstreamBehaviour();
    });

    describe('locked by the host', () => {
        const resolve = vi.fn<XlsxkitCalculationSettingsLockResolver>();

        beforeEach(() => {
            resolve.mockReset().mockReturnValue({ notice: 'Set in the template.' });
            setResolver(resolve);
        });

        it('refuses before any mutation and records nothing to undo', () => {
            const before = settings();
            expect(commandService.syncExecuteCommand(SetWorkbookCalculationSettingsCommand.id, { unitId: 'test', settings: next })).toBe(false);
            expect(resolve).toHaveBeenCalledWith({ unitId: 'test' });
            expect(settings()).toEqual(before);
            expect(executed).not.toContain(SetWorkbookCalculationSettingsMutation.id);
            expect(get(IUndoRedoService).getUndoRedoStatus('test')).toEqual({ undos: 0, redos: 0 });
        });

        it('refuses even when the settings would not change', () => {
            expect(commandService.syncExecuteCommand(SetWorkbookCalculationSettingsCommand.id, { unitId: 'test', settings: settings() })).toBe(false);
        });

        it('still applies the mutation, the path a peer or a remote change takes', () => {
            expect(commandService.syncExecuteCommand(SetWorkbookCalculationSettingsMutation.id, { unitId: 'test', settings: next })).toBe(true);
            expect(settings()).toEqual(next);
        });
    });
});
