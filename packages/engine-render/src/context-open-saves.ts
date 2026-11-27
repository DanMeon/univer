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

// Modified by Carenode, 2026 — CNT-5176 render-task-report: added file, the contexts a throwing render task left with open saves

import type { Nullable } from '@univerjs/core';
import type { UniverRenderingContext2D } from './context';

/**
 * The contexts that have more save()s than restore()s right now. Drawing brackets its clip and transform with save()
 * and restore() and no finally, so a render task that throws in between leaves them open: the engine's next tasks
 * and frames would draw under the failed draw's clip and transform, and a failure repeated every frame would push
 * one more state every frame. UniverRenderingContext2D adds itself on its first open save and removes itself when
 * none is left; the engine reads the set around each render task. It is normally empty between tasks. Not exported
 * from the package.
 */
const contextsWithOpenSaves = new Set<UniverRenderingContext2D>();

export function addContextWithOpenSaves(context: UniverRenderingContext2D): void {
    contextsWithOpenSaves.add(context);
}

export function deleteContextWithOpenSaves(context: UniverRenderingContext2D): void {
    contextsWithOpenSaves.delete(context);
}

/** The save depth of every context with open saves, or null when there is none (the usual case). */
export function snapshotOpenSaves(): Nullable<ReadonlyMap<UniverRenderingContext2D, number>> {
    if (contextsWithOpenSaves.size === 0) {
        return null;
    }

    const depths = new Map<UniverRenderingContext2D, number>();
    contextsWithOpenSaves.forEach((context) => depths.set(context, context.getSaveDepth()));
    return depths;
}

/**
 * Restores every context with open saves down to the depth it had in `snapshot` (0 when it was not in it). Saves
 * opened before the snapshot stay open.
 */
export function unwindOpenSaves(snapshot: Nullable<ReadonlyMap<UniverRenderingContext2D, number>>): void {
    for (const context of [...contextsWithOpenSaves]) {
        const depth = snapshot?.get(context) ?? 0;
        while (context.getSaveDepth() > depth) {
            context.restore();
        }
    }
}
