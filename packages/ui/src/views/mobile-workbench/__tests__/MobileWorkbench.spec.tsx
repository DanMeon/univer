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

// Modified by Carenode, 2026 — the mobile workbench takes its width, its height and the keyboard overlap from its mount container, not from the window

/**
 * @vitest-environment jsdom
 */

import type { ComponentType } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import {
    ContextService,
    DesktopLogService,
    IConfigService,
    IContextService,
    ILogService,
    Injector,
    IUniverInstanceService,
    LifecycleService,
    LifecycleStages,
    LocaleService,
    ThemeService,
    UniverInstanceService,
} from '@univerjs/core';
import { ConfigContext } from '@univerjs/design';
import { connectInjector } from '@wendellhu/redi/react-bindings';
import { useContext } from 'react';
import { createPortal } from 'react-dom';
import { of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuiltInUIPart, IUIPartsService, UIPartsService } from '../../../services/parts/parts.service';
import { ISidebarService } from '../../../services/sidebar/sidebar.service';
import { ThemeSwitcherService } from '../../../services/theme-switcher/theme-switcher.service';
import { IWorkbenchService, WorkbenchService } from '../../../services/workbench/workbench.service';
import { MobileKeyboardInsetContext } from '../mobile-keyboard-inset-context';
import { MobileWorkbench, resolveMobileKeyboardInset, resolveMobileWorkbenchBox } from '../MobileWorkbench';

function KeyboardBar() {
    const bottom = useContext(MobileKeyboardInsetContext);
    const { mobileKeyboardViewport } = useContext(ConfigContext);
    return (
        <div
            data-testid="keyboard-bar"
            data-viewport={JSON.stringify(mobileKeyboardViewport)}
            style={{ bottom }}
        />
    );
}

function createWorkbenchInjector(): Injector {
    return new Injector([
        [LifecycleService, { useValue: { lifecycle$: of(LifecycleStages.Ready), stage: LifecycleStages.Ready } }],
        [LocaleService, {
            useValue: {
                direction$: of('ltr'),
                getDirection: () => 'ltr',
                getLocales: () => ({ design: {} }),
                localeChanged$: new Subject<void>(),
                t: (key: string) => key,
            },
        }],
        [ThemeService, {
            useValue: {
                currentTheme$: of({}),
                darkMode$: of(false),
                darkMode: false,
            },
        }],
        [ThemeSwitcherService, { useValue: { injectThemeToHead: () => {} } }],
        [IConfigService, { useValue: { getConfig: () => ({ popupRootId: 'test-popup-root' }) } }],
        [IContextService, { useClass: ContextService }],
        [ILogService, { useClass: DesktopLogService }],
        [IUniverInstanceService, { useClass: UniverInstanceService }],
        [IUIPartsService, { useClass: UIPartsService }],
        [IWorkbenchService, { useClass: WorkbenchService }],
        [ISidebarService, {
            useValue: {
                sidebarOptions$: of(null),
                scrollEvent$: new Subject<Event>(),
                visible: false,
                close: () => {},
                setContainer: () => {},
                setWidth: () => {},
            },
        }],
    ]);
}

type ConnectedWorkbench = ComponentType<{ mountContainer: HTMLElement; contextMenu: boolean }>;

const resizeObservers = new Set<{ callback: () => void; targets: Element[] }>();

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
        private readonly _entry: { callback: () => void; targets: Element[] };
        constructor(callback: () => void) {
            this._entry = { callback, targets: [] };
            resizeObservers.add(this._entry);
        }

        observe(target: Element) { this._entry.targets.push(target); }
        unobserve() {}
        disconnect() { resizeObservers.delete(this._entry); }
    });
});

afterEach(() => {
    resizeObservers.clear();
});

/** What a browser does when the host resizes the container without resizing the window. */
function notifyContainerResize(container: Element): void {
    act(() => {
        [...resizeObservers].filter((observer) => observer.targets.includes(container)).forEach((observer) => observer.callback());
    });
}

describe('MobileWorkbench keyboard positioning', () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('shares viewport changes with footer and portal bars per instance and removes listeners on unmount', () => {
        const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0 });
        vi.stubGlobal('visualViewport', viewport);
        const removeViewportListener = vi.spyOn(viewport, 'removeEventListener');
        const removeWindowListener = vi.spyOn(window, 'removeEventListener');
        const injector = createWorkbenchInjector();
        const partsService = injector.get(IUIPartsService);
        partsService.registerComponent(BuiltInUIPart.FOOTER, () => KeyboardBar);
        const portal = document.createElement('div');
        partsService.registerComponent(BuiltInUIPart.GLOBAL, () => () => createPortal(<KeyboardBar />, portal));
        const ConnectedWorkbench = connectInjector(MobileWorkbench, injector) as ConnectedWorkbench;
        const firstMount = document.createElement('div');
        const secondMount = document.createElement('div');
        vi.spyOn(firstMount, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 800));
        vi.spyOn(secondMount, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 600));
        const first = render(<ConnectedWorkbench mountContainer={firstMount} contextMenu={false} />);
        const second = render(<ConnectedWorkbench mountContainer={secondMount} contextMenu={false} />);
        const firstBar = first.container.querySelector<HTMLElement>('[data-testid="keyboard-bar"]')!;
        const secondBar = second.container.querySelector<HTMLElement>('[data-testid="keyboard-bar"]')!;
        const portalBars = portal.querySelectorAll<HTMLElement>('[data-testid="keyboard-bar"]');
        const rootStyle = document.documentElement.getAttribute('style');
        const bodyStyle = document.body.getAttribute('style');
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();

        act(() => {
            viewport.height = 500;
            viewport.dispatchEvent(new Event('resize'));
        });
        expect(firstBar.style.bottom).toBe('300px');
        expect(secondBar.style.bottom).toBe('100px');
        expect(portalBars[0].style.bottom).toBe('300px');
        expect(portalBars[1].style.bottom).toBe('100px');
        expect(firstBar.dataset.viewport).toBe(JSON.stringify({ top: 0, bottom: 500, height: 500, stableHeight: 800 }));
        expect(secondBar.dataset.viewport).toBe(JSON.stringify({ top: 0, bottom: 500, height: 500, stableHeight: 600 }));

        act(() => {
            viewport.offsetTop = 20;
            viewport.dispatchEvent(new Event('scroll'));
        });
        expect(firstBar.style.bottom).toBe('280px');
        expect(secondBar.style.bottom).toBe('80px');
        expect(firstBar.dataset.viewport).toBe(JSON.stringify({ top: 20, bottom: 520, height: 500, stableHeight: 800 }));

        act(() => {
            viewport.height = 800;
            viewport.offsetTop = 0;
            viewport.dispatchEvent(new Event('resize'));
        });
        expect(firstBar.style.bottom).toBe('0px');
        expect(secondBar.style.bottom).toBe('0px');
        expect(document.documentElement.getAttribute('style')).toBe(rootStyle);
        expect(document.body.getAttribute('style')).toBe(bodyStyle);
        input.remove();
        first.unmount();
        second.unmount();
        expect(removeViewportListener.mock.calls.map(([event]) => event)).toEqual(['resize', 'scroll', 'resize', 'scroll']);
        expect(removeWindowListener).toHaveBeenCalledWith('resize', expect.any(Function));
        expect(resizeObservers.size).toBe(0);
        injector.dispose();
    });
});

describe('MobileWorkbench in a host container', () => {
    let containerRect: DOMRect;
    let viewport: EventTarget & { height: number; offsetTop: number };
    let injector: Injector;

    function mount() {
        injector = createWorkbenchInjector();
        injector.get(IUIPartsService).registerComponent(BuiltInUIPart.FOOTER, () => KeyboardBar);
        const ConnectedWorkbench = connectInjector(MobileWorkbench, injector) as ConnectedWorkbench;
        const mountContainer = document.createElement('div');
        vi.spyOn(mountContainer, 'getBoundingClientRect').mockImplementation(() => containerRect);
        const view = render(<ConnectedWorkbench mountContainer={mountContainer} contextMenu={false} />);
        const root = view.container.querySelector<HTMLElement>('[data-u-comp="app-layout"]')!.parentElement!;
        const bar = view.container.querySelector<HTMLElement>('[data-testid="keyboard-bar"]')!;
        return { mountContainer, root, bar, view };
    }

    beforeEach(() => {
        // ^ A card below the host's own header: the container does not start at the top of the window.
        containerRect = new DOMRect(16, 150, 356, 694);
        viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 });
        vi.stubGlobal('visualViewport', viewport);
        vi.stubGlobal('innerHeight', 844);
    });

    afterEach(() => {
        cleanup();
        injector.dispose();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        document.querySelectorAll('input').forEach((input) => input.remove());
    });

    it('takes the height the host gives the container later, with no window resize, also while a cell is edited', () => {
        const { mountContainer, root, bar } = mount();
        expect(root.style.height).toBe('694px');
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();

        // a panel above the editor opens: the container shrinks and the window stays
        containerRect = new DOMRect(16, 478, 356, 366);
        notifyContainerResize(mountContainer);
        expect(root.style.height).toBe('366px');
        expect(bar.style.bottom).toBe('0px');

        // a rotation that the host follows a frame late: the window resize sees the container still at its old height
        act(() => window.dispatchEvent(new Event('resize')));
        expect(root.style.height).toBe('366px');
        containerRect = new DOMRect(16, 120, 812, 270);
        notifyContainerResize(mountContainer);
        expect(root.style.height).toBe('270px');
        containerRect = new DOMRect(16, 150, 356, 694);
        notifyContainerResize(mountContainer);
        expect(root.style.height).toBe('694px');
    });

    it('leaves no keyboard inset when the host shrank the container above the keyboard', () => {
        const { mountContainer, root, bar } = mount();
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();

        // an installed app that resizes its window for the keyboard: the visible area and the host's container shrink
        act(() => {
            viewport.height = 504;
            viewport.dispatchEvent(new Event('resize'));
        });
        containerRect = new DOMRect(16, 150, 356, 271);
        notifyContainerResize(mountContainer);
        expect(root.style.height).toBe('271px');
        expect(bar.style.bottom).toBe('0px');
        expect(bar.dataset.viewport).toBe('null');
        expect(root.style.getPropertyValue('--univer-mobile-keyboard-inset')).toBe('0px');
    });

    it('reserves the part of a container that reaches under the keyboard, measured from its bottom edge', () => {
        const { root, bar } = mount();
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();

        // a browser that keeps the window and shrinks only the visible area: the container bottom (844) is 340 below it
        act(() => {
            viewport.height = 504;
            viewport.dispatchEvent(new Event('resize'));
        });
        expect(root.style.height).toBe('694px');
        expect(bar.style.bottom).toBe('340px');
        expect(bar.dataset.viewport).toBe(JSON.stringify({ top: 0, bottom: 504, height: 504, stableHeight: 694 }));
        expect(root.style.getPropertyValue('--univer-mobile-keyboard-inset')).toBe('340px');

        act(() => {
            input.blur();
            viewport.height = 844;
            viewport.dispatchEvent(new Event('resize'));
        });
        expect(bar.style.bottom).toBe('0px');
        expect(bar.dataset.viewport).toBe('null');
    });
});

describe('resolveMobileKeyboardInset', () => {
    it('excludes persistent browser chrome and reports only keyboard occlusion', () => {
        expect(resolveMobileKeyboardInset(900, 700, 200)).toBe(0);
        expect(resolveMobileKeyboardInset(900, 400, 200)).toBe(300);
    });

    it('uses the visual viewport bottom without displacing the canvas by offsetTop', () => {
        expect(resolveMobileKeyboardInset(932, 180 + 500, 0)).toBe(252);
    });

    it('measures from the container bottom, so a container below a host header counts the whole overlap', () => {
        expect(resolveMobileKeyboardInset(150 + 694, 504, 0)).toBe(340);
    });

    it('reports nothing for a container that ends above the visible bottom', () => {
        expect(resolveMobileKeyboardInset(150 + 271, 504, 0)).toBe(0);
        expect(resolveMobileKeyboardInset(504 + 60, 504, 0)).toBe(0);
    });
});

describe('resolveMobileWorkbenchBox', () => {
    it('is the container as it is now', () => {
        expect(resolveMobileWorkbenchBox({ top: 150, height: 694.5 }, 844)).toEqual({ height: 694.5, bottom: 844.5 });
    });

    it('gives a container with no height of its own the window height', () => {
        expect(resolveMobileWorkbenchBox({ top: 40, height: 0 }, 844)).toEqual({ height: 844, bottom: 884 });
    });
});
