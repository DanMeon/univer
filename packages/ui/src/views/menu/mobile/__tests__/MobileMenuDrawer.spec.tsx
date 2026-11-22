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

// Modified by Carenode, 2026 — the drawer scrolls back to the top whenever its menu opens or leaves a nested view

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
    ConfigService,
    DesktopLogService,
    IConfigService,
    ILogService,
    Injector,
    LocaleService,
    LocaleType,
} from '@univerjs/core';
import { ConfigProvider } from '@univerjs/design';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IMenuSchema } from '../../../../services/menu/menu-manager.service';
import { ComponentManager } from '../../../../common/component-manager';
import { IconManager } from '../../../../common/icon-manager';
import enUS from '../../../../locale/en-US';
import { MenuItemType } from '../../../../services/menu/menu';
import { IMenuManagerService, MenuManagerService } from '../../../../services/menu/menu-manager.service';
import { RediProvider } from '../../../../utils/di';
import { MobileMenuDrawer } from '../MobileMenuDrawer';

const injectors: Injector[] = [];

function createButtonSchemas(prefix: string, count: number): IMenuSchema[] {
    return Array.from({ length: count }, (_, index) => ({
        key: `${prefix}.${index}`,
        order: index,
        item: { id: `${prefix}.${index}`, type: MenuItemType.BUTTON, title: `${prefix} ${index}` },
    }));
}

function renderDrawer(schemas: IMenuSchema[]) {
    const injector = new Injector();
    injectors.push(injector);
    injector.add([IConfigService, { useClass: ConfigService }]);
    injector.add([LocaleService]);
    injector.get(LocaleService).load({ [LocaleType.EN_US]: enUS });
    injector.get(LocaleService).setLocale(LocaleType.EN_US);
    injector.add([ILogService, { useClass: DesktopLogService }]);
    injector.add([IMenuManagerService, { useClass: MenuManagerService }]);
    injector.add([ComponentManager]);
    injector.add([IconManager]);

    render(
        <RediProvider value={{ injector }}>
            <ConfigProvider mountContainer={document.body}>
                <MobileMenuDrawer visible title="Cell" schemas={schemas} onClose={vi.fn()} onOptionSelect={vi.fn()} />
            </ConfigProvider>
        </RediProvider>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('data-u-comp')).toBe('mobile-menu-drawer');
    const scrollArea = dialog.querySelector<HTMLElement>('.univer-overflow-y-auto');
    expect(scrollArea).toBeTruthy();
    return scrollArea!;
}

afterEach(() => {
    cleanup();
    injectors.splice(0).forEach((injector) => injector.dispose());
});

describe('MobileMenuDrawer', () => {
    it('starts a submenu at the top after the parent list was scrolled, and the parent again after going back', () => {
        const scrollArea = renderDrawer([
            ...createButtonSchemas('Action', 12),
            {
                key: 'freeze',
                order: 12,
                item: { id: 'freeze.menu', type: MenuItemType.SUBITEMS, title: 'Freeze' },
                children: createButtonSchemas('Freeze option', 3),
            },
        ]);
        const freeze = screen.getByRole('button', { name: 'Freeze' });
        expect(scrollArea.contains(freeze)).toBe(true);

        scrollArea.scrollTop = 120;
        fireEvent.click(freeze);
        expect(screen.getByRole('button', { name: 'Freeze option 0' })).toBeTruthy();
        expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Freeze');
        expect(scrollArea.scrollTop).toBe(0);

        scrollArea.scrollTop = 80;
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByRole('button', { name: 'Freeze' })).toBeTruthy();
        expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Cell');
        expect(scrollArea.scrollTop).toBe(0);
    });

    it('starts each of two nested views that share a title at the top', () => {
        const scrollArea = renderDrawer([{
            key: 'freeze',
            order: 0,
            item: { id: 'freeze.menu', type: MenuItemType.SUBITEMS, title: 'Freeze' },
            children: [
                ...createButtonSchemas('Freeze option', 12),
                {
                    key: 'freeze.more',
                    order: 12,
                    item: { id: 'freeze.more', type: MenuItemType.SUBITEMS, title: 'Freeze' },
                    children: createButtonSchemas('Freeze detail', 3),
                },
            ],
        }]);

        fireEvent.click(screen.getByRole('button', { name: 'Freeze' }));
        scrollArea.scrollTop = 120;
        fireEvent.click(screen.getByRole('button', { name: 'Freeze' }));
        expect(screen.getByRole('button', { name: 'Freeze detail 0' })).toBeTruthy();
        expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Freeze');
        expect(scrollArea.scrollTop).toBe(0);

        scrollArea.scrollTop = 80;
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByRole('button', { name: 'Freeze option 0' })).toBeTruthy();
        expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Freeze');
        expect(scrollArea.scrollTop).toBe(0);
    });
});
