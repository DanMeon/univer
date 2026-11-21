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

// Modified by Carenode, 2026 — CNT-5176: the dialog with and without the host's calculation-settings lock.

import type { IWorkbookCalculationSettings } from '@univerjs/core';
import type { Root } from 'react-dom/client';
import {
    ConfigService,
    ICommandService,
    IConfigService,
    Injector,
    IPermissionService,
    IUniverInstanceService,
    LocaleService,
    LocaleType,
    MAX_ITERATION_COUNT,
} from '@univerjs/core';
import { SetWorkbookCalculationSettingsCommand, XLSXKIT_CALCULATION_SETTINGS_LOCK_RESOLVER_CONFIG_KEY } from '@univerjs/sheets';
import { IDialogService, RediContext } from '@univerjs/ui';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enUS from '../../../locale/en-US';
import { CalculationOptions } from '../CalculationOptions';
import { CALCULATION_OPTIONS_DIALOG } from '../interface';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('CalculationOptions', () => {
    let container: HTMLDivElement;
    let root: Root;
    let injector: Injector;
    let settings: IWorkbookCalculationSettings;
    const execute = vi.fn();
    const close = vi.fn();

    beforeEach(() => {
        execute.mockReset().mockReturnValue(true);
        close.mockReset();
        settings = { iterativeCalculation: true, maxIterations: 100, maxChange: 0.001 };
        injector = new Injector();
        injector.add([LocaleService]);
        const locale = injector.get(LocaleService);
        locale.load({ [LocaleType.EN_US]: enUS });
        locale.setLocale(LocaleType.EN_US);
        locale.setDirection('ltr');
        injector.add([IUniverInstanceService, { useValue: {
            getUnit: () => ({ getCalculationSettings: () => settings }),
        } as never }]);
        injector.add([ICommandService, { useValue: { syncExecuteCommand: execute } as never }]);
        const editablePermission$ = of({ value: true });
        injector.add([IPermissionService, { useValue: {
            getPermissionPoint$: () => editablePermission$,
            getPermissionPoint: () => ({ value: true }),
        } as never }]);
        injector.add([IDialogService, { useValue: { close } as never }]);
        injector.add([IConfigService, { useClass: ConfigService }]);
        container = document.createElement('div');
        document.body.appendChild(container);
        mount();
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        injector.dispose();
    });

    function mount() {
        root = createRoot(container);
        act(() => root.render(
            <RediContext.Provider value={{ injector }}>
                <CalculationOptions unitId="u" />
            </RediContext.Provider>
        ));
    }

    // Carenode CNT-5176: open the dialog again with the host's resolver registered first.
    function remountWithResolver(value: unknown) {
        act(() => root.unmount());
        injector.get(IConfigService).setConfig(XLSXKIT_CALCULATION_SETTINGS_LOCK_RESOLVER_CONFIG_KEY, value);
        mount();
    }

    function controls() {
        const [count, change] = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="text"]'));
        return {
            checkbox: container.querySelector<HTMLInputElement>('input[type="checkbox"]')!,
            count,
            change,
            ok: Array.from(container.querySelectorAll('button')).find((node) => node.textContent === 'OK')!,
        };
    }

    function edit(index: number, value: string) {
        const input = container.querySelectorAll<HTMLInputElement>('input[type="text"]')[index];
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }

    function confirm() {
        const button = Array.from(container.querySelectorAll('button')).find((node) => node.textContent === 'OK')!;
        act(() => button.click());
    }

    it.each(['', ' ', '0', '-1', '1.5', String(MAX_ITERATION_COUNT + 1), 'Infinity', 'abc'])(
        'keeps invalid iteration count %j open without updating settings',
        (value) => {
            edit(0, value);
            confirm();
            expect(execute).not.toHaveBeenCalled();
            expect(close).not.toHaveBeenCalled();
            const alerts = container.querySelectorAll('[role="alert"]');
            expect(alerts).toHaveLength(1);
            expect(alerts[0].textContent).toContain('Maximum iterations');
            expect(alerts[0].textContent).toContain(String(MAX_ITERATION_COUNT));
            expect(alerts[0].closest('label')?.querySelector('input')?.value).toBe(value);
        }
    );

    it.each(['', ' ', '0', '-0.1', 'Infinity', '1e309', 'abc'])(
        'keeps invalid maximum change %j open without updating settings',
        (value) => {
            edit(1, value);
            confirm();
            expect(execute).not.toHaveBeenCalled();
            expect(close).not.toHaveBeenCalled();
            const alerts = container.querySelectorAll('[role="alert"]');
            expect(alerts).toHaveLength(1);
            expect(alerts[0].textContent).toContain('Maximum change');
            expect(alerts[0].closest('label')?.querySelector('input')?.value).toBe(value);
        }
    );

    it.each([1, MAX_ITERATION_COUNT])('saves valid boundaries and closes only after success: %i', (count) => {
        edit(0, String(count));
        edit(1, '1e-6');
        confirm();
        expect(execute).toHaveBeenCalledWith(SetWorkbookCalculationSettingsCommand.id, {
            unitId: 'u',
            settings: { iterativeCalculation: true, maxIterations: count, maxChange: 0.000001 },
        });
        expect(close).toHaveBeenCalledWith(CALCULATION_OPTIONS_DIALOG);
    });

    it('allows correcting invalid input and does not close when the command fails', () => {
        edit(0, '0');
        confirm();
        edit(0, '20');
        expect(container.querySelector('[role="alert"]')).toBeNull();
        execute.mockReturnValueOnce(false);
        confirm();
        expect(close).not.toHaveBeenCalled();
        confirm();
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('shows both field errors and removes only the corrected field error', () => {
        edit(0, '1.5');
        edit(1, '0');
        confirm();
        expect(container.querySelectorAll('[role="alert"]')).toHaveLength(2);
        expect(execute).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();

        edit(0, '100');
        const alerts = container.querySelectorAll('[role="alert"]');
        expect(alerts).toHaveLength(1);
        expect(alerts[0].textContent).toContain('Maximum change');
        edit(1, '0.001');
        expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    it('allows disabling iteration after an invalid draft while preserving saved numeric settings', () => {
        edit(0, '0');
        edit(1, '');
        confirm();
        act(() => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
        confirm();
        expect(execute).toHaveBeenCalledWith(SetWorkbookCalculationSettingsCommand.id, {
            unitId: 'u',
            settings: { ...settings, iterativeCalculation: false },
        });
        expect(close).toHaveBeenCalledTimes(1);
    });

    describe('calculation-settings lock (Carenode CNT-5176)', () => {
        const notice = 'These settings are changed in the template.';

        it('opens read-only from the first render, keeps the settings visible and shows the notice', () => {
            const resolve = vi.fn(() => ({ notice }));
            remountWithResolver(resolve);
            expect(resolve).toHaveBeenCalledWith({ unitId: 'u' });
            const { checkbox, count, change, ok } = controls();
            expect(checkbox.disabled).toBe(true);
            expect(checkbox.checked).toBe(true);
            expect(count.disabled).toBe(true);
            expect(count.value).toBe('100');
            expect(change.disabled).toBe(true);
            expect(change.value).toBe('0.001');
            expect(ok.disabled).toBe(true);
            const shown = Array.from(container.querySelectorAll('p')).find((node) => node.textContent === notice);
            expect(shown).toBeDefined();
            expect(shown!.className).not.toContain('sr-only');
        });

        it('does nothing on confirm', () => {
            remountWithResolver(() => ({ notice }));
            confirm();
            expect(execute).not.toHaveBeenCalled();
            expect(close).not.toHaveBeenCalled();
        });

        it.each([
            ['a resolver that answers null', () => null],
            ['a resolver that answers undefined', () => undefined],
            ['a value that is not a function', { notice }],
        ])('keeps the upstream dialog with %s', (_name, value) => {
            remountWithResolver(value);
            const { checkbox, count, change, ok } = controls();
            expect(checkbox.disabled).toBe(false);
            expect(count.disabled).toBe(false);
            expect(change.disabled).toBe(false);
            expect(ok.disabled).toBe(false);
            expect(container.textContent).not.toContain(notice);
            confirm();
            expect(execute).toHaveBeenCalledWith(SetWorkbookCalculationSettingsCommand.id, { unitId: 'u', settings });
            expect(close).toHaveBeenCalledWith(CALCULATION_OPTIONS_DIALOG);
        });
    });
});
