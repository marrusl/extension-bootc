/**********************************************************************
 * Copyright (C) 2024-2025 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 * * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

import '@testing-library/jest-dom/vitest';

import { render, screen, waitFor } from '@testing-library/svelte';
import { vi, test, expect } from 'vitest';
import { bootcClient } from '/@/api/client';
import DiskImageDetailsVirtualMachine from './DiskImageDetailsVirtualMachine.svelte';
import type { BootcBuildInfo } from '/@shared/src/models/bootc';
import type { Subscriber } from '/@shared/src/messages/MessageProxy';
import type { VmDetails } from '@crc-org/macadam.js';

// Mock xterm and its addons so terminal setup is a no-op in jsdom.
// Class syntax is required because the component uses `new Terminal()`, `new FitAddon()`, etc.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    loadAddon = vi.fn();
    open = vi.fn();
    write = vi.fn();
    onKey = vi.fn();
    attachCustomKeyEventHandler = vi.fn();
    dispose = vi.fn();
    reset = vi.fn();
    buffer = { normal: { length: 2 } };
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));
vi.mock('@xterm/addon-attach', () => ({ AttachAddon: class {} }));

vi.mock('/@/api/client', async () => {
  return {
    rpcBrowser: {
      subscribe: (): Subscriber => {
        return {
          unsubscribe: (): void => {},
        };
      },
    },
    bootcClient: {
      listHistoryInfo: vi.fn(),
      getConfigurationValue: vi.fn(),
      stopCurrentVM: vi.fn(),
      checkVMLaunchPrereqs: vi.fn(),
      launchVM: vi.fn().mockResolvedValue(undefined),
      isMac: vi.fn(),
      isWindows: vi.fn(),
      listVMs: vi.fn().mockResolvedValue([]),
    },
  };
});

test('Render virtual machine terminal window', async () => {
  vi.mocked(bootcClient.getConfigurationValue).mockResolvedValue(14);

  // Use BootcBuildInfo to render the component
  const build = {
    id: 'id1',
    image: 'my-image',
    imageId: 'image-id',
    tag: 'latest',
    engineId: 'podman',
    type: ['ami'],
    folder: '/bootc',
  } as BootcBuildInfo;

  render(DiskImageDetailsVirtualMachine, { build });

  // Wait for 'launchVM' to have been called
  await waitFor(() => {
    expect(bootcClient.launchVM).toHaveBeenCalled();
  });
  expect(bootcClient.checkVMLaunchPrereqs).toHaveBeenCalledWith('id1');
  expect(bootcClient.launchVM).toHaveBeenCalledWith('id1');
});

test('Show prereqs message if prereq check fails (returns ANY string)', async () => {
  vi.mocked(bootcClient.checkVMLaunchPrereqs).mockResolvedValue('Prereq check failed');

  const build = {
    id: 'id1',
    image: 'my-image',
    imageId: 'image-id',
    tag: 'latest',
    engineId: 'podman',
    type: ['ami'],
    folder: '/bootc',
  } as BootcBuildInfo;

  render(DiskImageDetailsVirtualMachine, { build });

  // Expect prereq failure to be shown
  await waitFor(() => {
    expect(screen.queryByText('Prereq check failed')).toBeDefined();
  });
});

test('Test failed launched VM showing in render', async () => {
  vi.mocked(bootcClient.checkVMLaunchPrereqs).mockResolvedValue(undefined);
  vi.mocked(bootcClient.launchVM).mockRejectedValue('Failed to launch VM');

  const build = {
    id: 'id1',
    image: 'my-image',
    imageId: 'image-id',
    tag: 'latest',
    engineId: 'podman',
    type: ['ami'],
    folder: '/bootc',
  } as BootcBuildInfo;

  render(DiskImageDetailsVirtualMachine, { build });

  // Expect prereq failure to be shown
  await waitFor(() => {
    expect(screen.queryByText('Failed to launch VM')).toBeDefined();
  });
});

test('SSH banner is not visible before the VM starts', async () => {
  const build = {
    id: 'id1',
    image: 'my-image',
    imageId: 'image-id',
    tag: 'latest',
    engineId: 'podman',
    type: ['ami'],
    folder: '/bootc',
  } as BootcBuildInfo;

  render(DiskImageDetailsVirtualMachine, { build });

  // connectionStatus is '' on initial render — banner must not be shown
  expect(screen.queryByText(/ssh -p/)).not.toBeInTheDocument();
});

test('SSH banner shows the correct command after the WebSocket connection opens', async () => {
  vi.mocked(bootcClient.getConfigurationValue).mockResolvedValue(14);
  vi.mocked(bootcClient.listVMs).mockResolvedValue([
    { Name: 'test-vm', Running: true, Port: 2222, RemoteUsername: 'root' } as VmDetails,
  ]);

  vi.useFakeTimers();

  // Capture WebSocket instances as the component creates them.
  // The first instance is used by waitForPort (fires onopen immediately to unblock it).
  // The second instance is the main terminal socket; we trigger its onopen manually.
  const sockets: {
    onopen: ((e: Event) => void) | undefined;
    onclose: ((e: CloseEvent) => void) | undefined;
    onerror: ((e: Event) => void) | undefined;
    binaryType: string;
    close: () => void;
    send: () => void;
  }[] = [];

  vi.stubGlobal(
    'WebSocket',
    class {
      onopen: ((e: Event) => void) | undefined = undefined;
      onclose: ((e: CloseEvent) => void) | undefined = undefined;
      onerror: ((e: Event) => void) | undefined = undefined;
      binaryType = '';
      close = vi.fn();
      send = vi.fn();
      constructor() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sockets.push(this as any);
      }
    },
  );

  // After the first socket is created by waitForPort, fire its onopen asynchronously
  // so the port check resolves. We attach this watcher after stubbing to avoid
  // running async logic inside the constructor (which linters disallow).
  const resolveFirstSocket = (): void => {
    if (sockets.length >= 1 && sockets[0].onopen) {
      sockets[0].onopen(new Event('open'));
    } else {
      setTimeout(resolveFirstSocket, 10);
    }
  };
  setTimeout(resolveFirstSocket, 0);

  const build = {
    id: 'id1',
    image: 'my-image',
    imageId: 'image-id',
    tag: 'latest',
    engineId: 'podman',
    type: ['ami'],
    folder: '/bootc',
  } as BootcBuildInfo;

  render(DiskImageDetailsVirtualMachine, { build });

  // Advance past waitForPort's 1-second setInterval so the port check fires
  await vi.advanceTimersByTimeAsync(1100);

  // sockets[1] is the main terminal socket with onopen = openHandler
  expect(sockets.length).toBeGreaterThanOrEqual(2);

  // openHandler is async — awaiting its return value waits for listVMs to resolve too
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sockets[1].onopen!(new Event('open')) as any);

  // Drain remaining microtask queues so Svelte flushes its reactive DOM updates
  await Promise.resolve();
  await Promise.resolve();

  vi.useRealTimers();

  expect(screen.getByText('ssh -p 2222 root@localhost')).toBeInTheDocument();

  vi.unstubAllGlobals();
});
