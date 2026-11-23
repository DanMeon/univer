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
// Modified by Carenode, 2026 — CNT-5176 mobile-keyboard-visible-height: the keyboard told by the visible height, the container followed when the page scrolls it, the visible bottom followed with no keyboard

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
import { ConfigContext, useMobileKeyboardViewportLayout } from '@univerjs/design';
import { connectInjector } from '@wendellhu/redi/react-bindings';
import { useContext, useRef } from 'react';
import { createPortal } from 'react-dom';
import { of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuiltInUIPart, IUIPartsService, UIPartsService } from '../../../services/parts/parts.service';
import { ISidebarService } from '../../../services/sidebar/sidebar.service';
import { ThemeSwitcherService } from '../../../services/theme-switcher/theme-switcher.service';
import { IWorkbenchService, WorkbenchService } from '../../../services/workbench/workbench.service';
import { MobileKeyboardInsetContext } from '../mobile-keyboard-inset-context';
import {
    isMobileKeyboardOpen,
    isMobileWorkbenchBoxPastVisibleBottom,
    MobileWorkbench,
    resolveMobileKeyboardInset,
    resolveMobileWorkbenchBox,
} from '../MobileWorkbench';

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

/** A bar laid out the way the input bar is: lifted from the bottom of its containing block to the visible bottom. */
function ViewportBar() {
    const ref = useRef<HTMLDivElement>(null);
    const layout = useMobileKeyboardViewportLayout(ref);
    return <div ref={ref} data-testid="viewport-bar" style={{ bottom: layout?.bottom ?? 0 }} />;
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
        const partsService = injector.get(IUIPartsService);
        partsService.registerComponent(BuiltInUIPart.FOOTER, () => KeyboardBar);
        partsService.registerComponent(BuiltInUIPart.FOOTER, () => ViewportBar);
        const ConnectedWorkbench = connectInjector(MobileWorkbench, injector) as ConnectedWorkbench;
        const mountContainer = document.createElement('div');
        vi.spyOn(mountContainer, 'getBoundingClientRect').mockImplementation(() => containerRect);
        // ^ the viewport bar's containing block is the container, as the input bar's is the workbench in it
        vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
            return this.dataset.testid === 'viewport-bar' ? mountContainer : null;
        });
        const view = render(<ConnectedWorkbench mountContainer={mountContainer} contextMenu={false} />);
        const root = view.container.querySelector<HTMLElement>('[data-u-comp="app-layout"]')!.parentElement!;
        const bar = view.container.querySelector<HTMLElement>('[data-testid="keyboard-bar"]')!;
        const viewportBar = view.container.querySelector<HTMLElement>('[data-testid="viewport-bar"]')!;
        return { mountContainer, root, bar, viewportBar, view };
    }

    function focusNewInput(): HTMLInputElement {
        const input = document.createElement('input');
        input.scrollIntoView = vi.fn();
        document.body.appendChild(input);
        act(() => input.focus());
        return input;
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
        // ^ the keyboard is up, though it covers nothing of the container
        expect(bar.dataset.viewport).toBe(JSON.stringify({ top: 0, bottom: 504, height: 504, stableHeight: 271 }));
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

    it('moves nothing with no keyboard while the window holds the container or none of it can be seen', () => {
        const { mountContainer, bar, viewportBar } = mount();
        focusNewInput();
        // ^ the container (150 to 844) ends at the window bottom
        expect(bar.dataset.viewport).toBe('null');
        expect(viewportBar.style.bottom).toBe('0px');

        // the host moves the container below the window
        containerRect = new DOMRect(16, 900, 356, 900);
        notifyContainerResize(mountContainer);
        expect(bar.dataset.viewport).toBe('null');
        expect(viewportBar.style.bottom).toBe('0px');
    });

    describe('in a page that scrolls the container', () => {
        let frames: FrameRequestCallback[];
        let page: HTMLElement;

        function runFrames() {
            act(() => {
                while (frames.length > 0) frames.shift()!(0);
            });
        }

        function mountInPage() {
            const mounted = mount();
            page.appendChild(mounted.mountContainer);
            return mounted;
        }

        function focusInput() {
            const input = document.createElement('input');
            const scrollIntoView = vi.fn();
            input.scrollIntoView = scrollIntoView;
            document.body.appendChild(input);
            act(() => input.focus());
            return scrollIntoView;
        }

        function scroll(target: EventTarget, top: number) {
            containerRect = new DOMRect(16, top, 356, 900);
            act(() => {
                target.dispatchEvent(new Event('scroll'));
            });
        }

        beforeEach(() => {
            frames = [];
            vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
            vi.stubGlobal('cancelAnimationFrame', () => {});
            // ^ an approval document: the body's box is 900px tall and starts low, in a page that scrolls
            containerRect = new DOMRect(16, 560, 356, 900);
            page = document.createElement('main');
            document.body.appendChild(page);
        });

        afterEach(() => {
            page.remove();
        });

        it('keeps the keyboard and measures the container again when the page scrolls it, with no reveal of the focus', () => {
            const { bar } = mountInPage();
            runFrames();
            const scrollIntoView = focusInput();
            act(() => {
                viewport.height = 504;
                viewport.dispatchEvent(new Event('resize'));
            });
            expect(bar.style.bottom).toBe('340px');
            runFrames();
            expect(scrollIntoView).toHaveBeenCalledTimes(1);

            // the page scrolls the box up until its bottom (700) is 196px under the keyboard's top
            scroll(page, -200);
            expect(bar.style.bottom).toBe('196px');
            expect(bar.dataset.viewport).toBe(JSON.stringify({ top: 0, bottom: 504, height: 504, stableHeight: 900 }));
            runFrames();
            expect(scrollIntoView).toHaveBeenCalledTimes(1);

            // a scroll that does not move the container is not followed
            const sibling = document.createElement('div');
            document.body.appendChild(sibling);
            scroll(sibling, -250);
            expect(bar.style.bottom).toBe('196px');
            sibling.remove();
        });

        it('tells the keyboard after the page scrolled the container before the edit', () => {
            const { bar } = mountInPage();
            runFrames();
            scroll(document, 200);
            focusInput();
            act(() => {
                viewport.height = 504;
                viewport.dispatchEvent(new Event('resize'));
            });
            expect(bar.style.bottom).toBe('340px');
            expect(bar.dataset.viewport).toBe(JSON.stringify({ top: 0, bottom: 504, height: 504, stableHeight: 900 }));
        });

        it('follows the visible bottom with no keyboard while an editor has the focus, with no inset and no reveal', () => {
            const { root, bar, viewportBar } = mountInPage();
            runFrames();
            expect(viewportBar.style.bottom).toBe('0px');

            // a keyboard attached to the tablet: the window keeps its height, and the box (560 to 1460) reaches 616 below it
            const scrollIntoView = focusInput();
            expect(bar.dataset.viewport).toBe(JSON.stringify({ top: 0, bottom: 844, height: 844, stableHeight: 900 }));
            expect(viewportBar.style.bottom).toBe('616px');
            expect(bar.style.bottom).toBe('0px');
            expect(root.style.getPropertyValue('--univer-mobile-keyboard-inset')).toBe('0px');

            // the page scrolls the box up; then until the window holds its bottom (800); then down again
            scroll(page, 200);
            expect(viewportBar.style.bottom).toBe('256px');
            scroll(page, -100);
            expect(bar.dataset.viewport).toBe('null');
            expect(viewportBar.style.bottom).toBe('0px');
            scroll(page, 300);
            expect(viewportBar.style.bottom).toBe('356px');
            expect(bar.style.bottom).toBe('0px');
            runFrames();
            expect(scrollIntoView).not.toHaveBeenCalled();
        });

        it('lets go of the visible bottom once the focus has left every editor, not while it moves on to another', () => {
            const { bar, viewportBar } = mountInPage();
            runFrames();
            focusInput();
            expect(viewportBar.style.bottom).toBe('616px');

            const next = focusNewInput();
            runFrames();
            expect(viewportBar.style.bottom).toBe('616px');

            // an edit ended with no keyboard to go down: nothing resizes
            act(() => next.blur());
            runFrames();
            expect(bar.dataset.viewport).toBe('null');
            expect(viewportBar.style.bottom).toBe('0px');
        });

        it('keeps the keyboard while the focus moves on to another editor', () => {
            const { bar } = mountInPage();
            runFrames();
            focusInput();
            act(() => {
                viewport.height = 504;
                viewport.dispatchEvent(new Event('resize'));
            });
            expect(bar.style.bottom).toBe('340px');

            focusNewInput();
            runFrames();
            expect(bar.style.bottom).toBe('340px');
            expect(bar.dataset.viewport).toBe(JSON.stringify({ top: 0, bottom: 504, height: 504, stableHeight: 900 }));
        });
    });
});

describe('isMobileWorkbenchBoxPastVisibleBottom', () => {
    it('is a box that can be seen and reaches below the visible bottom', () => {
        expect(isMobileWorkbenchBoxPastVisibleBottom({ height: 900, bottom: 1460 }, 844)).toBe(true);
        expect(isMobileWorkbenchBoxPastVisibleBottom({ height: 694, bottom: 844 }, 504)).toBe(true);
    });

    it('is not a box the window holds, to the pixel', () => {
        expect(isMobileWorkbenchBoxPastVisibleBottom({ height: 694, bottom: 844 }, 844)).toBe(false);
        expect(isMobileWorkbenchBoxPastVisibleBottom({ height: 694.4, bottom: 844.4 }, 843.8)).toBe(false);
        expect(isMobileWorkbenchBoxPastVisibleBottom({ height: 800, bottom: 800 }, 844)).toBe(false);
    });

    it('is not a box that lies all below the visible bottom', () => {
        expect(isMobileWorkbenchBoxPastVisibleBottom({ height: 900, bottom: 1800 }, 844)).toBe(false);
    });
});

describe('isMobileKeyboardOpen', () => {
    it('tells a keyboard by how much higher the visible bottom is than without one', () => {
        expect(isMobileKeyboardOpen(504, 844)).toBe(true);
        expect(isMobileKeyboardOpen(844 - 80, 844)).toBe(true);
        expect(isMobileKeyboardOpen(844 - 56, 844)).toBe(false);
        expect(isMobileKeyboardOpen(844, 844)).toBe(false);
    });
});

describe('resolveMobileKeyboardInset', () => {
    it('excludes persistent browser chrome and reports only keyboard occlusion', () => {
        expect(resolveMobileKeyboardInset(900, 700, 700)).toBe(0);
        expect(resolveMobileKeyboardInset(900, 400, 700)).toBe(300);
    });

    it('uses the visual viewport bottom without displacing the canvas by offsetTop', () => {
        expect(resolveMobileKeyboardInset(932, 180 + 500, 932)).toBe(252);
    });

    it('measures from the container bottom, so a container below a host header counts the whole overlap', () => {
        expect(resolveMobileKeyboardInset(150 + 694, 504, 844)).toBe(340);
    });

    it('reports nothing for a container that ends above the visible bottom', () => {
        expect(resolveMobileKeyboardInset(150 + 271, 504, 844)).toBe(0);
        expect(resolveMobileKeyboardInset(504, 504, 844)).toBe(0);
    });

    it('counts the part of a container that ends under the keyboard', () => {
        expect(resolveMobileKeyboardInset(504 + 60, 504, 844)).toBe(60);
    });

    it('counts no more than the keyboard of a container that reaches below the window, wherever the page puts it', () => {
        expect(resolveMobileKeyboardInset(560 + 900, 504, 844)).toBe(340);
        expect(resolveMobileKeyboardInset(200 + 900, 504, 844)).toBe(340);
    });

    it('reports nothing without a keyboard', () => {
        expect(resolveMobileKeyboardInset(560 + 900, 844 - 56, 844)).toBe(0);
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
