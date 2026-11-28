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

// Modified by Carenode, 2026 — CNT-5176 ios-enter-beforeinput: isIOS (iPhone, iPod, iPad including its desktop user agent)

import { createIdentifier } from '@univerjs/core';

/**
 * A service to provide context info of the host service.
 */
export interface IPlatformService {
    readonly isMac: boolean;
    readonly isWindows: boolean;
    readonly isLinux: boolean;
    /**
     * Whether the page runs on iOS or iPadOS. Optional so that existing implementations stay valid; absent means not
     * iOS.
     */
    readonly isIOS?: boolean;
}

export const IPlatformService = createIdentifier<IPlatformService>('ui.platform.service');

export class PlatformService implements IPlatformService {
    get isMac(): boolean {
        return /Mac/.test(navigator.appVersion);
    }

    get isWindows(): boolean {
        return /Windows/.test(navigator.appVersion);
    }

    get isLinux(): boolean {
        return /Linux/.test(navigator.appVersion);
    }

    get isIOS(): boolean {
        const { userAgent, maxTouchPoints = 0 } = navigator;
        // iPadOS Safari asks for desktop pages by default and then reports a Mac user agent; a Mac has no touch points.
        return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
    }
}
