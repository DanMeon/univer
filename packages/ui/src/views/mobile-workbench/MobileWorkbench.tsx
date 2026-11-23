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
// Modified by Carenode, 2026 — CNT-5176 mobile-keyboard-visible-height: the keyboard is told by how much shorter the visible viewport got, wherever the container is, and the layout follows a page that scrolls the container and, while an editor has the focus, the visible bottom of a container that reaches below it with no keyboard

import type { Injector } from '@univerjs/core';
import type { IMobileKeyboardViewport } from '@univerjs/design';
import type { ComponentType } from 'react';
import { LifecycleService, LifecycleStages, LocaleService, ThemeService } from '@univerjs/core';
import {
    borderBottomClassName,
    clsx,
    ConfigProvider,
    render,
    revealFocusedElementInMobileViewport,
} from '@univerjs/design';
import { connectInjector, useDependency } from '@wendellhu/redi/react-bindings';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { map } from 'rxjs';
import type { IWorkbenchOptions } from '../../controllers/ui/ui.controller';
import { BuiltInUIPart } from '../../services/parts/parts.service';
import { ThemeSwitcherService } from '../../services/theme-switcher/theme-switcher.service';
import { IWorkbenchService } from '../../services/workbench/workbench.service';
import { useObservable } from '../../utils/di';
import { ComponentContainer, useComponentsOfPart } from '../components/ComponentContainer';
import { MobileContextMenu } from '../components/context-menu/MobileContextMenu';
import { MobileDrawerCoordinatorProvider } from '../components/mobile-drawer/MobileDrawerCoordinator';
import { MobileSidebar } from '../components/sidebar/MobileSidebar';
import { WorkbenchSkeleton } from '../components/workbench-skeleton/WorkbenchSkeleton';
import { MobileKeyboardInsetContext } from './mobile-keyboard-inset-context';
import { MobileCanvasLayoutProvider } from './MobileCanvasLayout';

const MOBILE_KEYBOARD_THRESHOLD = 80;

/**
 * Whether an on-screen keyboard is up: the bottom of the visible viewport is the threshold or more above where it was
 * without one (`stableVisibleBottom`, layout-viewport coordinates). Where the mount container is plays no part — a page
 * that scrolls the container up or down opens and closes no keyboard. Less than the threshold is browser chrome.
 */
export function isMobileKeyboardOpen(visibleBottom: number, stableVisibleBottom: number): boolean {
    return stableVisibleBottom - visibleBottom >= MOBILE_KEYBOARD_THRESHOLD;
}

/**
 * How many CSS pixels of the workbench the on-screen keyboard covers: the part of the mount container between the
 * bottom of the visible viewport and where that bottom was without a keyboard, measured from the container's bottom
 * edge as it is now (all in layout-viewport coordinates). A host that shrank the container above the keyboard leaves
 * nothing covered, and what lies below the visible bottom without a keyboard (browser chrome over the page, the rest
 * of a page that scrolls) is not the keyboard's.
 */
export function resolveMobileKeyboardInset(containerBottom: number, visibleBottom: number, stableVisibleBottom: number): number {
    if (!isMobileKeyboardOpen(visibleBottom, stableVisibleBottom)) {
        return 0;
    }
    return Math.max(0, Math.round(Math.min(containerBottom, stableVisibleBottom) - visibleBottom));
}

export interface IMobileWorkbenchBox {
    /** The height the workbench root takes. */
    height: number;
    /** The container's bottom edge in layout-viewport coordinates. */
    bottom: number;
}

/**
 * The box the workbench fills: its mount container as it is now. A container with no height of its own (one that
 * takes its height from the workbench) gets the window's height, as before.
 */
export function resolveMobileWorkbenchBox(rect: Pick<DOMRect, 'top' | 'height'>, windowHeight: number): IMobileWorkbenchBox {
    const height = rect.height || windowHeight;
    return { height, bottom: rect.top + height };
}

/**
 * Whether some of the box can be seen and the rest lies below the bottom of the visible viewport, as a tall box in a
 * page that scrolls does (layout-viewport coordinates, whole pixels).
 */
export function isMobileWorkbenchBoxPastVisibleBottom(box: IMobileWorkbenchBox, visibleBottom: number): boolean {
    const bottom = Math.round(visibleBottom);
    return Math.round(box.bottom - box.height) < bottom && Math.round(box.bottom) > bottom;
}

export interface IUniverAppProps extends IWorkbenchOptions {
    mountContainer: HTMLElement;

    onRendered?: (container: HTMLElement) => void;
}

export function mountMobileWorkbench(
    injector: Injector,
    options: IWorkbenchOptions,
    mountContainer: HTMLElement,
    onRendered: (contentElement: HTMLElement) => void
): void {
    const ConnectedApp = connectInjector(MobileWorkbench, injector) as ComponentType<IUniverAppProps>;

    render(
        <ConnectedApp
            {...options}
            mountContainer={mountContainer}
            onRendered={onRendered}
        />,
        mountContainer
    );
}

export function MobileWorkbench(props: IUniverAppProps) {
    const {
        header = true,
        toolbar = true,
        footer = true,
        headerMenu = true,
        ribbonType = 'classic',
        contextMenu = true,
        mountContainer,
        onRendered,
    } = props;

    const localeService = useDependency(LocaleService);
    const lifecycleService = useDependency(LifecycleService);
    const workbenchService = useDependency(IWorkbenchService);
    const themeService = useDependency(ThemeService);
    const themeSwitcherService = useDependency(ThemeSwitcherService);

    const contentRef = useRef<HTMLDivElement>(null);
    const canvasContainerRef = useRef<HTMLDivElement>(null);
    const viewportRef = useRef<HTMLDivElement>(null);
    const [keyboardInset, setKeyboardInset] = useState(0);
    const [keyboardViewport, setKeyboardViewport] = useState<IMobileKeyboardViewport | null>(null);

    const footerComponents = useComponentsOfPart(BuiltInUIPart.FOOTER);
    const headerComponents = useComponentsOfPart(BuiltInUIPart.HEADER);
    const headerMenuComponents = useComponentsOfPart(BuiltInUIPart.HEADER_MENU);
    const contentComponents = useComponentsOfPart(BuiltInUIPart.CONTENT);
    const leftSidebarComponents = useComponentsOfPart(BuiltInUIPart.LEFT_SIDEBAR);
    const globalComponents = useComponentsOfPart(BuiltInUIPart.GLOBAL);
    const toolbarComponents = useComponentsOfPart(BuiltInUIPart.TOOLBAR);

    const darkMode = useObservable(themeService.darkMode$, themeService.darkMode);
    const lifecycleStage = useObservable(lifecycleService.lifecycle$, lifecycleService.stage);
    const externalSkeletonVisible = useObservable(workbenchService.skeletonVisible$, undefined, true);
    const ready = lifecycleStage >= LifecycleStages.Ready;

    useEffect(() => {
        if (ready && contentRef.current) {
            onRendered?.(contentRef.current);
        }
    }, [ready, onRendered]);

    const locale = useObservable(
        () => localeService.localeChanged$.pipe(map(() => localeService.getLocales())),
        localeService.getLocales(),
        false,
        [localeService]
    );
    const direction = useObservable(localeService.direction$, localeService.getDirection());

    // Create a portal container for injecting global component themes.
    const portalContainer = useMemo<HTMLElement>(() => document.createElement('div'), []);

    useLayoutEffect(() => {
        const sub = themeService.currentTheme$.subscribe((theme) => {
            themeSwitcherService.injectThemeToHead(theme);
        });

        return () => {
            sub.unsubscribe();
        };
    }, [themeService.currentTheme$, themeSwitcherService]);

    useEffect(() => {
        document.body.appendChild(portalContainer);

        return () => {
            document.body.removeChild(portalContainer);
        };
    }, [mountContainer, portalContainer]);

    useEffect(() => {
        portalContainer.setAttribute('dir', direction);
    }, [direction, portalContainer]);

    useLayoutEffect(() => {
        document.documentElement.classList.toggle('univer-dark', darkMode);
    }, [darkMode]);

    useEffect(() => {
        const visualViewport = window.visualViewport;
        const viewportElement = viewportRef.current;
        if (!viewportElement) {
            return undefined;
        }

        // ^ The root is always as tall as the mount container is now, and what the keyboard covers is measured against
        //   the container's bottom edge. A host may put the container anywhere on the page, size it from the visual
        //   viewport a frame after the window resized, change it with no window resize at all (a panel above it), or
        //   scroll it with the page.
        let box = resolveMobileWorkbenchBox(mountContainer.getBoundingClientRect(), window.innerHeight);
        // ^ Where the bottom of the visible viewport is without a keyboard: it follows the window while nothing is
        //   edited, only rises while an editor has the focus, and is taken anew when the window turns.
        let stableVisibleBottom = visualViewport ? visualViewport.offsetTop + visualViewport.height : window.innerHeight;
        let stableWidth = window.innerWidth;
        let keyboardVisible = false;
        let initialViewportFrame: number | null = null;
        let revealFrame: number | null = null;
        let revealInnerFrame: number | null = null;
        let focusOutFrame: number | null = null;

        const isEditing = () => {
            const activeElement = document.activeElement;
            return activeElement instanceof HTMLInputElement ||
                activeElement instanceof HTMLTextAreaElement ||
                activeElement?.getAttribute('contenteditable') === 'true';
        };

        const cancelReveal = () => {
            if (revealFrame != null) {
                cancelAnimationFrame(revealFrame);
                revealFrame = null;
            }
            if (revealInnerFrame != null) {
                cancelAnimationFrame(revealInnerFrame);
                revealInnerFrame = null;
            }
        };
        const scheduleReveal = (viewport: IMobileKeyboardViewport | null) => {
            cancelReveal();
            if (!viewport) {
                return;
            }

            revealFrame = requestAnimationFrame(() => {
                revealFrame = null;
                revealInnerFrame = requestAnimationFrame(() => {
                    revealInnerFrame = null;
                    revealFocusedElementInMobileViewport(document.body, viewport);
                });
            });
        };
        const updateKeyboardViewport = (revealFocus: boolean) => {
            const visibleTop = visualViewport?.offsetTop ?? 0;
            const visibleHeight = visualViewport?.height ?? window.innerHeight;
            const visibleBottom = visualViewport
                ? visibleTop + visibleHeight
                : window.innerHeight;
            const editing = isEditing();

            if (window.innerWidth !== stableWidth) {
                stableWidth = window.innerWidth;
                stableVisibleBottom = Math.max(window.innerHeight, visibleBottom);
            } else if (editing) {
                stableVisibleBottom = Math.max(stableVisibleBottom, visibleBottom);
            } else {
                stableVisibleBottom = visibleBottom;
            }

            keyboardVisible = editing && isMobileKeyboardOpen(visibleBottom, stableVisibleBottom);
            const nextKeyboardInset = keyboardVisible
                ? resolveMobileKeyboardInset(box.bottom, visibleBottom, stableVisibleBottom)
                : 0;
            viewportElement.style.setProperty('--univer-mobile-keyboard-inset', `${nextKeyboardInset}px`);

            // ^ With no on-screen keyboard (one attached to a tablet), an editor still needs the input bar where it can
            //   be seen: while the container reaches below the visible bottom the layout follows the visible viewport
            //   as it does with a keyboard. The inset stays the keyboard's, and only a keyboard asks for a reveal of
            //   the focused element — the page is the person's to scroll.
            const followVisibleViewport = keyboardVisible ||
                (editing && isMobileWorkbenchBoxPastVisibleBottom(box, visibleBottom));
            const nextKeyboardViewport = followVisibleViewport
                ? {
                    top: Math.round(visibleTop),
                    bottom: Math.round(visibleBottom),
                    height: Math.round(visibleHeight),
                    stableHeight: Math.round(box.height),
                }
                : null;
            setKeyboardInset(nextKeyboardInset);
            setKeyboardViewport(nextKeyboardViewport);
            if (revealFocus) {
                scheduleReveal(keyboardVisible ? nextKeyboardViewport : null);
            }
        };
        const measureViewport = (revealFocus: boolean) => {
            box = resolveMobileWorkbenchBox(mountContainer.getBoundingClientRect(), window.innerHeight);
            viewportElement.style.height = `${box.height}px`;
            updateKeyboardViewport(revealFocus);
        };
        const updateViewport = () => measureViewport(true);
        // ^ A page that scrolls moves the container with nothing resized: measuring again holds the input bar at the
        //   bottom of the visible viewport. It asks for no reveal of the focused element, which would scroll the page
        //   back against the person scrolling it.
        const followAncestorScroll = (event: Event) => {
            if (event.target instanceof Node && event.target.contains(mountContainer)) {
                measureViewport(false);
            }
        };
        // ^ With no keyboard to go down, an edit ends with nothing resized: once the focus has left every editor the
        //   layout stops following the visible viewport. A frame later, so a focus that moves on to another editor
        //   keeps it; what the keyboard covers waits for the window, as before.
        const followFocusOut = () => {
            if (focusOutFrame != null) {
                cancelAnimationFrame(focusOutFrame);
            }
            focusOutFrame = requestAnimationFrame(() => {
                focusOutFrame = null;
                if (!keyboardVisible && !isEditing()) {
                    setKeyboardViewport(null);
                }
            });
        };

        viewportElement.style.height = `${box.height}px`;
        initialViewportFrame = requestAnimationFrame(() => {
            initialViewportFrame = null;
            updateViewport();
        });
        // ^ A container change without a window resize reaches only this observer. The callback runs after layout and
        //   before paint, so the root never shows a stale height for a frame.
        const containerObserver = new ResizeObserver(updateViewport);
        containerObserver.observe(mountContainer);
        window.addEventListener('resize', updateViewport);
        visualViewport?.addEventListener('resize', updateViewport);
        visualViewport?.addEventListener('scroll', updateViewport);
        document.addEventListener('focusin', updateViewport);
        document.addEventListener('focusout', followFocusOut);
        // ^ a scroll of an element does not bubble: the capture phase on the document sees the scroll of every ancestor
        document.addEventListener('scroll', followAncestorScroll, { capture: true, passive: true });

        return () => {
            if (initialViewportFrame != null) {
                cancelAnimationFrame(initialViewportFrame);
            }
            if (focusOutFrame != null) {
                cancelAnimationFrame(focusOutFrame);
            }
            cancelReveal();
            containerObserver.disconnect();
            window.removeEventListener('resize', updateViewport);
            visualViewport?.removeEventListener('resize', updateViewport);
            visualViewport?.removeEventListener('scroll', updateViewport);
            document.removeEventListener('focusin', updateViewport);
            document.removeEventListener('focusout', followFocusOut);
            document.removeEventListener('scroll', followAncestorScroll, { capture: true });
        };
    }, [mountContainer]);

    // Keep the inner layout focusable so focusin bubbles from editors and the layout service can refocus input.
    return (
        <ConfigProvider
            locale={locale?.design}
            direction={direction}
            mountContainer={portalContainer}
            mobileKeyboardViewport={keyboardViewport}
        >
            <MobileCanvasLayoutProvider>
                <MobileKeyboardInsetContext.Provider value={keyboardInset}>
                    <MobileDrawerCoordinatorProvider>
                        <div
                            ref={viewportRef}
                            className="
                              univer-relative univer-h-full univer-min-h-0
                              [&_button:active]:!univer-opacity-70
                              [&_button]:univer-touch-manipulation
                            "
                        >
                            <div
                                data-u-comp="app-layout"
                                className={clsx(`
                                  univer-relative univer-flex univer-h-full univer-min-h-0 univer-flex-col
                                  univer-bg-gray-0
                                  dark:!univer-bg-gray-800
                                `, {
                                    'univer-dark': darkMode,
                                })}
                                tabIndex={-1}
                                onBlur={(e) => e.stopPropagation()}
                                onContextMenu={(e) => e.preventDefault()}
                                dir={direction}
                            >
                                {/* header */}
                                {header && toolbar && (
                                    <header
                                        data-u-comp="headerbar"
                                        className="univer-relative univer-z-10 univer-w-full univer-overflow-hidden"
                                    >
                                        <ComponentContainer
                                            key="toolbar"
                                            components={toolbarComponents}
                                            sharedProps={{
                                                ribbonType,
                                                headerMenuComponents,
                                                headerMenu,
                                            }}
                                        />
                                    </header>
                                )}

                                {/* content */}
                                <section
                                    className="univer-relative univer-flex univer-min-h-0 univer-flex-1 univer-flex-col"
                                >
                                    <div
                                        className={`
                                          univer-grid univer-min-h-0 univer-flex-1 univer-grid-cols-[auto_1fr_auto]
                                          univer-grid-rows-[100%] univer-overflow-hidden
                                        `}
                                    >
                                        <aside className="univer-h-full">
                                            <ComponentContainer key="left-sidebar" components={leftSidebarComponents} />
                                        </aside>

                                        <section
                                            className={clsx(`
                                              univer-relative univer-grid univer-flex-1 univer-grid-rows-[auto_1fr]
                                              univer-overflow-hidden univer-bg-gray-0
                                              dark:!univer-bg-gray-800
                                            `, borderBottomClassName)}
                                        >
                                            {/* The sheet tab bar spans the container, not the screen: a header as wide as the screen widened this
                                                grid's only column and the canvas below it past a container narrower than the window. */}
                                            <header className="univer-min-w-0">
                                                {header && <ComponentContainer key="header" components={headerComponents} />}
                                            </header>

                                            <section
                                                ref={canvasContainerRef}
                                                className="univer-relative univer-min-h-0 univer-overflow-hidden"
                                            >
                                                <div
                                                    ref={contentRef}
                                                    className="univer-absolute univer-inset-0 univer-overflow-hidden"
                                                    data-range-selector
                                                    onContextMenu={(e) => e.preventDefault()}
                                                >
                                                    <ComponentContainer
                                                        key="content"
                                                        components={contentComponents}
                                                        sharedProps={{ containerRef: canvasContainerRef, canvasRef: contentRef }}
                                                    />
                                                </div>
                                            </section>
                                        </section>

                                        <aside className="univer-h-full" />
                                    </div>

                                    {/* footer */}
                                    {footer && (
                                        <footer className="univer-shrink-0">
                                            <ComponentContainer key="footer" components={footerComponents} />
                                        </footer>
                                    )}
                                </section>
                            </div>
                            {(!ready || externalSkeletonVisible) && (
                                <WorkbenchSkeleton darkMode={darkMode} direction={direction} overlay />
                            )}
                        </div>
                        <div
                            className="
                              [&_button:active]:!univer-opacity-70
                              [&_button]:univer-touch-manipulation
                            "
                            dir={direction}
                        >
                            <ComponentContainer key="global" components={globalComponents} />
                            {contextMenu && <MobileContextMenu />}
                            <MobileSidebar />
                        </div>
                    </MobileDrawerCoordinatorProvider>
                </MobileKeyboardInsetContext.Provider>
            </MobileCanvasLayoutProvider>
        </ConfigProvider>
    );
}
