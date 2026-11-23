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

// Modified by Carenode, 2026 — CNT-5176 mobile-reveal-fixed-box: a focused element in a fixed box is not revealed by scrolling what lies around it

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    resolveMobileKeyboardViewportLayout,
    revealFocusedElementInMobileViewport,
} from '../use-mobile-keyboard-viewport';

afterEach(() => {
    document.body.replaceChildren();
});

describe('mobile keyboard viewport', () => {
    it('maps the visible viewport into both stable and already-resized containing blocks', () => {
        const viewport = { top: 0, bottom: 520, height: 520, stableHeight: 852 };

        expect(resolveMobileKeyboardViewportLayout(0, 852, viewport, 0.4)).toEqual({
            availableHeight: 520,
            bottom: 332,
            height: 340.8,
        });
        expect(resolveMobileKeyboardViewportLayout(0, 520, viewport, 0.8)).toEqual({
            availableHeight: 520,
            bottom: 0,
            height: 520,
        });
    });

    it('scrolls the nearest panel content so the focused input stays visible', () => {
        const container = document.createElement('section');
        const scroller = document.createElement('div');
        const input = document.createElement('input');
        scroller.style.overflowY = 'auto';
        scroller.appendChild(input);
        container.appendChild(scroller);
        document.body.appendChild(container);
        input.focus();

        Object.defineProperties(scroller, {
            clientHeight: { configurable: true, value: 200 },
            scrollHeight: { configurable: true, value: 800 },
        });
        scroller.getBoundingClientRect = () => ({
            bottom: 300,
            height: 200,
            left: 0,
            right: 320,
            top: 100,
            width: 320,
            x: 0,
            y: 100,
            toJSON: () => undefined,
        });
        input.getBoundingClientRect = () => ({
            bottom: 380,
            height: 40,
            left: 0,
            right: 320,
            top: 340,
            width: 320,
            x: 0,
            y: 340,
            toJSON: () => undefined,
        });

        expect(revealFocusedElementInMobileViewport(container, { top: 0, bottom: 300 })).toBe(true);
        expect(scroller.scrollTop).toBe(92);
    });

    it('asks the browser to reveal a covered input when there is no scrollable panel', () => {
        const container = document.createElement('section');
        const input = document.createElement('input');
        const scrollIntoView = vi.fn();
        input.scrollIntoView = scrollIntoView;
        container.appendChild(input);
        document.body.appendChild(container);
        input.focus();
        input.getBoundingClientRect = () => ({
            bottom: 380,
            height: 40,
            left: 0,
            right: 320,
            top: 340,
            width: 320,
            x: 0,
            y: 340,
            toJSON: () => undefined,
        });

        expect(revealFocusedElementInMobileViewport(container, { top: 0, bottom: 300 })).toBe(true);
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    });

    it('leaves a focused element in a fixed box alone: no scroll around the box can move it', () => {
        // ^ a sheet cell editor's hidden input: fixed at the caret near the top of the window, inside a page that scrolls
        const page = document.createElement('main');
        const host = document.createElement('div');
        const inputBox = document.createElement('div');
        const input = document.createElement('div');
        const scrollIntoView = vi.fn();
        page.style.overflowY = 'auto';
        host.style.position = 'fixed';
        inputBox.style.position = 'absolute';
        input.contentEditable = 'true';
        input.tabIndex = -1;
        input.scrollIntoView = scrollIntoView;
        inputBox.appendChild(input);
        host.appendChild(inputBox);
        page.appendChild(host);
        document.body.appendChild(page);
        input.focus();
        Object.defineProperties(page, {
            clientHeight: { configurable: true, value: 791 },
            scrollHeight: { configurable: true, value: 2067 },
        });
        page.scrollTop = 45;
        page.getBoundingClientRect = () => new DOMRect(0, 49, 820, 791);
        input.getBoundingClientRect = () => new DOMRect(1, 1, 0, 18);

        expect(revealFocusedElementInMobileViewport(document.body, { top: 0, bottom: 840 })).toBe(false);
        expect(page.scrollTop).toBe(45);
        expect(scrollIntoView).not.toHaveBeenCalled();

        host.style.position = '';
        input.style.position = 'fixed';
        expect(revealFocusedElementInMobileViewport(document.body, { top: 0, bottom: 840 })).toBe(false);
        expect(page.scrollTop).toBe(45);
        expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it('still scrolls a scroll box inside a fixed box', () => {
        const dialog = document.createElement('div');
        const scroller = document.createElement('div');
        const input = document.createElement('input');
        dialog.style.position = 'fixed';
        scroller.style.overflowY = 'auto';
        scroller.appendChild(input);
        dialog.appendChild(scroller);
        document.body.appendChild(dialog);
        input.focus();
        Object.defineProperties(scroller, {
            clientHeight: { configurable: true, value: 200 },
            scrollHeight: { configurable: true, value: 800 },
        });
        scroller.getBoundingClientRect = () => new DOMRect(0, 100, 320, 200);
        input.getBoundingClientRect = () => new DOMRect(0, 340, 320, 40);

        expect(revealFocusedElementInMobileViewport(document.body, { top: 0, bottom: 300 })).toBe(true);
        expect(scroller.scrollTop).toBe(92);
    });
});
