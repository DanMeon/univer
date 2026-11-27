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

// Modified by Carenode, 2026 — CNT-5176 render-task-report: added file, the render loop's handling of a throwing render task

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UniverRenderingContext2D } from '../context';
import { Canvas } from '../canvas';
import { snapshotOpenSaves } from '../context-open-saves';
import { Engine } from '../engine';

// jest-canvas-mock keeps the native state stack's depth here.
function nativeDepth(ctx: UniverRenderingContext2D): number {
    return (ctx._context as unknown as { _stackIndex: number })._stackIndex;
}

describe('engine render loop with a throwing render task (CNT-5176 render-task-report)', () => {
    let frames: FrameRequestCallback[];
    let engine: Engine;
    let reportError: ReturnType<typeof vi.fn>;
    const originalReportError = Object.getOwnPropertyDescriptor(globalThis, 'reportError');

    // Not vi.stubGlobal: unstubbing would also drop the canvas globals vitest.setup.ts stubs.
    function setReportError(value: unknown) {
        Object.defineProperty(globalThis, 'reportError', { configurable: true, writable: true, value });
    }

    beforeEach(() => {
        frames = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            frames.push(callback);
            return frames.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
        reportError = vi.fn();
        setReportError(reportError);
        engine = new Engine('render-loop-unit', { elementWidth: 10, elementHeight: 10 });
    });

    afterEach(() => {
        engine.dispose();
        if (originalReportError) {
            Object.defineProperty(globalThis, 'reportError', originalReportError);
        } else {
            Reflect.deleteProperty(globalThis, 'reportError');
        }
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    // Runs the frame the engine requested last, as the browser would.
    function runNextFrame(timestamp = 16) {
        const frame = frames.shift();
        if (!frame) {
            throw new Error('the engine requested no frame');
        }
        frame(timestamp);
    }

    it('reports the exception, runs the other task and _endFrame, and requests the next frame', () => {
        const failure = new Error("InvalidStateError: The HTMLImageElement provided is in the 'broken' state.");
        const throwingTask = vi.fn(() => {
            throw failure;
        });
        const otherTask = vi.fn();
        const endFrame = vi.fn();
        engine.endFrame$.subscribe(endFrame);
        engine.runRenderLoop(throwingTask);
        engine.runRenderLoop(otherTask);

        expect(() => runNextFrame()).not.toThrow();

        expect(throwingTask).toHaveBeenCalledOnce();
        expect(otherTask).toHaveBeenCalledOnce();
        expect(endFrame).toHaveBeenCalledOnce();
        expect(reportError).toHaveBeenCalledExactlyOnceWith(failure);
        expect(frames).toHaveLength(1);

        runNextFrame();
        expect(throwingTask).toHaveBeenCalledTimes(2);
        expect(otherTask).toHaveBeenCalledTimes(2);
        expect(frames).toHaveLength(1);
    });

    it('reports a failure that repeats every frame once, and a different one again', () => {
        let message = 'image broken';
        engine.runRenderLoop(() => {
            throw new Error(message);
        });

        runNextFrame();
        runNextFrame();
        runNextFrame();
        expect(reportError).toHaveBeenCalledOnce();

        message = 'another failure';
        runNextFrame();
        runNextFrame();
        expect(reportError).toHaveBeenCalledTimes(2);
        expect(reportError).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'another failure' }));
    });

    it('reports the same message thrown at another place as a different failure', () => {
        let site: 'first' | 'second' = 'first';
        engine.runRenderLoop(() => {
            if (site === 'first') {
                throw new TypeError("Cannot read properties of undefined (reading 'length')");
            }
            throw new TypeError("Cannot read properties of undefined (reading 'length')");
        });

        runNextFrame();
        runNextFrame();
        site = 'second';
        runNextFrame();
        runNextFrame();

        expect(reportError).toHaveBeenCalledTimes(2);
    });

    it('remembers the last 16 distinct failures, so an older one is reported again', () => {
        let message = 'failure 0';
        engine.runRenderLoop(() => {
            throw new Error(message);
        });

        for (let index = 0; index <= 16; index++) {
            message = `failure ${index}`;
            runNextFrame();
        }
        expect(reportError).toHaveBeenCalledTimes(17);

        // failure 0 was dropped when failure 16 came in; failure 1 is still remembered.
        message = 'failure 1';
        runNextFrame();
        expect(reportError).toHaveBeenCalledTimes(17);
        message = 'failure 0';
        runNextFrame();
        expect(reportError).toHaveBeenCalledTimes(18);
    });

    it('rethrows from a timer where reportError does not exist', () => {
        setReportError(undefined);
        vi.useFakeTimers();
        const failure = new Error('image broken');
        engine.runRenderLoop(() => {
            throw failure;
        });

        expect(() => runNextFrame()).not.toThrow();
        expect(frames).toHaveLength(1);

        expect(() => vi.runAllTimers()).toThrow(failure);
    });

    describe('saves a throwing task left open', () => {
        let main: Canvas;
        let cache: Canvas;

        beforeEach(() => {
            main = new Canvas({ width: 40, height: 40, pixelRatio: 1 });
            cache = new Canvas({ width: 20, height: 20, pixelRatio: 1 });
        });

        afterEach(() => {
            main.dispose();
            cache.dispose();
        });

        // A layer render: save, clip and move, then a draw that throws before the restore.
        function throwingDraw(ctx: UniverRenderingContext2D) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, 5, 5);
            ctx.clip();
            ctx.translate(30, 30);
            throw new Error('draw failed');
        }

        it('restores them before the next task of the frame', () => {
            const ctx = main.getContext();
            const seen: Array<{ depth: number; native: number; transform: number[] }> = [];
            engine.runRenderLoop(() => throwingDraw(ctx));
            engine.runRenderLoop(() => {
                const m = ctx.getTransform();
                seen.push({ depth: ctx.getSaveDepth(), native: nativeDepth(ctx), transform: [m.a, m.b, m.c, m.d, m.e, m.f] });
            });

            runNextFrame();

            expect(seen).toEqual([{ depth: 0, native: 0, transform: [1, 0, 0, 1, 0, 0] }]);
            expect(snapshotOpenSaves()).toBeNull();
        });

        it('keeps a save that was open before the task', () => {
            const ctx = main.getContext();
            ctx.save();
            ctx.translate(3, 4);
            engine.runRenderLoop(() => {
                ctx.save();
                throwingDraw(ctx);
            });

            runNextFrame();

            expect(ctx.getSaveDepth()).toBe(1);
            expect(nativeDepth(ctx)).toBe(1);
            const m = ctx.getTransform();
            expect([m.e, m.f]).toEqual([3, 4]);
            ctx.restore();
            expect(snapshotOpenSaves()).toBeNull();
        });

        it('restores a cache canvas context the task left open as well', () => {
            const ctx = main.getContext();
            const cacheCtx = cache.getContext();
            engine.runRenderLoop(() => {
                ctx.save();
                ctx.translate(10, 10);
                throwingDraw(cacheCtx);
            });

            runNextFrame();

            expect([ctx.getSaveDepth(), nativeDepth(ctx)]).toEqual([0, 0]);
            expect([cacheCtx.getSaveDepth(), nativeDepth(cacheCtx)]).toEqual([0, 0]);
            expect(snapshotOpenSaves()).toBeNull();
        });

        it('keeps the count true across reset(), a resize and a restore with nothing open', () => {
            const ctx = main.getContext();
            // jest-canvas-mock has no reset(); the browser's empties the state stack.
            Object.defineProperty(ctx._context, 'reset', { configurable: true, value: vi.fn() });
            ctx.save();
            ctx.save();
            ctx.reset();
            expect(ctx.getSaveDepth()).toBe(0);
            expect(snapshotOpenSaves()).toBeNull();

            ctx.save();
            main.setSize(60, 60, 1);
            expect(ctx.getSaveDepth()).toBe(0);
            expect(snapshotOpenSaves()).toBeNull();

            ctx.restore();
            expect(ctx.getSaveDepth()).toBe(0);
            ctx.save();
            expect(ctx.getSaveDepth()).toBe(1);
            ctx.restore();
            expect(snapshotOpenSaves()).toBeNull();
        });

        it('does not grow any state stack while a task throws every frame', () => {
            const ctx = main.getContext();
            const cacheCtx = cache.getContext();
            engine.runRenderLoop(() => {
                ctx.save();
                ctx.save();
                throwingDraw(cacheCtx);
            });

            for (let frame = 0; frame < 30; frame++) {
                runNextFrame();
                expect([ctx.getSaveDepth(), nativeDepth(ctx), cacheCtx.getSaveDepth(), nativeDepth(cacheCtx)]).toEqual([0, 0, 0, 0]);
            }
            expect(reportError).toHaveBeenCalledOnce();
        });
    });
});
