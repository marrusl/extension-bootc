/**********************************************************************
 * Copyright (C) 2024-2026 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

import { expect, test, vi, beforeEach } from 'vitest';
import examplesCatalog from '../assets/examples.json';
import type { ExamplesList } from '/@shared/src/models/examples';
import { BootcApiImpl } from './api-impl';
import * as podmanDesktopApi from '@podman-desktop/api';
import type * as macadam from '@crc-org/macadam.js';
import { MacadamHandler } from './macadam';
import { Messages } from '/@shared/src/messages/Messages';

const TELEMETRY_LOGGER_MOCK: podmanDesktopApi.TelemetryLogger = {
  logUsage: vi.fn(),
} as unknown as podmanDesktopApi.TelemetryLogger;

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    readFileSync: vi.fn().mockReturnValue(Buffer.from('fake-private-key')),
    existsSync: vi.fn().mockReturnValue(true),
  };
});

vi.mock(
  import('@podman-desktop/api'),
  () =>
    ({
      window: {
        showErrorMessage: vi.fn(),
        showOpenDialog: vi.fn(),
      },
      containerEngine: {
        listImages: vi.fn(),
        listContainers: vi.fn(),
        deleteImage: vi.fn(),
      },
      env: {
        openExternal: vi.fn(),
        createTelemetryLogger: vi.fn(),
      },
      navigation: {
        navigateToImage: vi.fn(),
        navigateToImageBuild: vi.fn(),
      },
    }) as unknown as typeof podmanDesktopApi,
);

vi.mock(
  import('@crc-org/macadam.js'),
  () =>
    ({
      Macadam: vi.fn(
        class {
          createVm = vi.fn();
          init = vi.fn();
          listVms = vi.fn();
        },
      ),
    }) as unknown as typeof macadam,
);

// Stateful SSH mock: .on() stores callbacks and returns `this` for chaining,
// .connect() invokes the authHandler from connect options, .shell() provides a mock stream.
const mockStreamWrite = vi.fn();
const mockStreamClose = vi.fn();
const mockClientEnd = vi.fn();
const mockClientDestroy = vi.fn();
const mockAuthCallback = vi.fn();

vi.mock('ssh2', () => ({
  Client: class MockSSHClient {
    #handlers: Record<string, (...args: unknown[]) => void> = {};
    #mockStream = {
      write: mockStreamWrite,
      close: mockStreamClose,
      on: vi.fn().mockReturnThis(),
    };

    on(event: string, cb: (...args: unknown[]) => void): MockSSHClient {
      this.#handlers[event] = cb;
      return this;
    }

    connect(config?: Record<string, unknown>): void {
      const authHandler = config?.authHandler as ((...args: unknown[]) => void) | undefined;
      if (authHandler) {
        authHandler([], false, (method: unknown) => {
          mockAuthCallback(method);
          if (method === false) {
            this.#handlers['error']?.(new Error('All configured authentication methods failed'));
            return;
          }
          this.#handlers['ready']?.();
        });
      } else {
        this.#handlers['ready']?.();
      }
    }

    shell(cb: (err: Error | undefined, stream: unknown) => void): void {
      cb(undefined, this.#mockStream);
    }

    end = mockClientEnd;
    destroy = mockClientDestroy;
  },
}));

beforeEach(async () => {
  vi.resetAllMocks();
  // Re-apply defaults cleared by resetAllMocks so key-based auth tests
  // continue to find a valid key file without per-test setup.
  const fsModule = await import('node:fs');
  (fsModule.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from('fake-private-key'));
  (fsModule.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
});

function createAPI(): BootcApiImpl {
  const postMessageMock = vi.fn().mockResolvedValue(undefined);

  return new BootcApiImpl({} as podmanDesktopApi.ExtensionContext, TELEMETRY_LOGGER_MOCK, {
    postMessage: postMessageMock,
  } as unknown as podmanDesktopApi.Webview);
}

test('getExamples should return examplesCatalog', async () => {
  const extensionContextMock = {
    storagePath: '/fake-path',
  } as unknown as podmanDesktopApi.ExtensionContext;

  const webviewMock = {} as podmanDesktopApi.Webview;

  const bootcApi = new BootcApiImpl(extensionContextMock, TELEMETRY_LOGGER_MOCK, webviewMock);

  // When running get Examples we should return the examplesCatalog (it's exported)
  const result = await bootcApi.getExamples();
  // Check that the examples and categories are NOT empty
  expect(result.examples.length).not.toBe(0);
  expect(result.categories.length).not.toBe(0);

  expect(result).toEqual(examplesCatalog as ExamplesList);
});

test('listContainers should return list from extension api', async () => {
  const containers = [{}, {}] as podmanDesktopApi.ContainerInfo[];

  vi.mocked(podmanDesktopApi.containerEngine.listContainers).mockResolvedValue(containers);

  const apiImpl = createAPI();
  const result = await apiImpl.listContainers();

  expect(podmanDesktopApi.containerEngine.listContainers).toHaveBeenCalled();
  expect(result.length).toBe(2);
});

test('deleteImage should call the extension api and fire event', async () => {
  const postMessageMock = vi.fn().mockResolvedValue(undefined);

  const apiImpl = new BootcApiImpl({} as podmanDesktopApi.ExtensionContext, TELEMETRY_LOGGER_MOCK, {
    postMessage: postMessageMock,
  } as unknown as podmanDesktopApi.Webview);

  await apiImpl.deleteImage('a', 'b');

  expect(podmanDesktopApi.containerEngine.deleteImage).toHaveBeenCalledWith('a', 'b');
  expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'image-update' }));
});

test('createVM should call the extension api', async () => {
  // Mock createVM as we are only interested if the function is ACTUALLY called.
  vi.spyOn(MacadamHandler.prototype, 'createVm').mockResolvedValue(undefined);

  const apiImpl = createAPI();

  const options = {
    imagePath: '~/foobar',
    sshIdentityPath: '~/foobar/id_ed25519',
    username: 'foobar',
  } as macadam.CreateVmOptions;

  await apiImpl.createVM(options);

  // Check that the createVm methods were called
  expect(MacadamHandler.prototype.createVm).toHaveBeenCalledWith(options);
});

test('check createVM passes underlying error message', async () => {
  vi.spyOn(MacadamHandler.prototype, 'createVm').mockRejectedValue('failed');

  const apiImpl = createAPI();

  try {
    await apiImpl.createVM({} as macadam.CreateVmOptions);
  } catch (e) {
    expect(e).toEqual('failed');
  }
});

test('listVMs should call the extension api', async () => {
  vi.spyOn(MacadamHandler.prototype, 'listVms').mockResolvedValue([{ name: 'foobar' } as unknown as macadam.VmDetails]);

  const apiImpl = createAPI();

  await apiImpl.listVMs();

  // Check that the createVm methods were called
  expect(MacadamHandler.prototype.listVms).toHaveBeenCalled();
});

test('startVM should call the extension api', async () => {
  vi.spyOn(MacadamHandler.prototype, 'startVm').mockResolvedValue(undefined);

  const apiImpl = createAPI();
  await apiImpl.startVM('test-vm');

  expect(MacadamHandler.prototype.startVm).toHaveBeenCalledWith('test-vm');
});

test('stopVM should call the extension api', async () => {
  vi.spyOn(MacadamHandler.prototype, 'stopVm').mockResolvedValue(undefined);

  const apiImpl = createAPI();
  await apiImpl.stopVM('test-vm');

  expect(MacadamHandler.prototype.stopVm).toHaveBeenCalledWith('test-vm');
});

test('deleteVM should call the extension api', async () => {
  vi.spyOn(MacadamHandler.prototype, 'removeVm').mockResolvedValue(undefined);

  const apiImpl = createAPI();
  await apiImpl.deleteVM('test-vm');

  expect(MacadamHandler.prototype.removeVm).toHaveBeenCalledWith('test-vm');
});

test('check listVMs passes underlying error message', async () => {
  vi.spyOn(MacadamHandler.prototype, 'listVms').mockRejectedValue('list failed');

  const apiImpl = createAPI();

  try {
    await apiImpl.listVMs();
  } catch (e) {
    expect(e).toEqual('list failed');
  }
});

test('selectVMImageFile should call the extension api', async () => {
  const apiImpl = createAPI();

  await apiImpl.selectVMImageFile();

  expect(podmanDesktopApi.window.showOpenDialog).toHaveBeenCalled();
});

test('openImage should navigate to it', async () => {
  const apiImpl = createAPI();

  await apiImpl.openImage('sha256:555', 'podman.Podman', 'foo:latest');

  expect(podmanDesktopApi.navigation.navigateToImage).toHaveBeenCalledExactlyOnceWith(
    'sha256:555',
    'podman.Podman',
    'foo:latest',
  );
});

test('openImageBuild should navigate to it', async () => {
  const apiImpl = createAPI();

  await apiImpl.openImageBuild();

  expect(podmanDesktopApi.navigation.navigateToImageBuild).toHaveBeenCalledOnce();
});

test('openVMTerminal connects SSH with correct VM details', async () => {
  const mockVm = {
    Name: 'test-vm',
    Running: true,
    Port: 2222,
    RemoteUsername: 'root',
    IdentityPath: '/home/user/.ssh/id_ed25519',
  } as macadam.VmDetails;

  vi.spyOn(MacadamHandler.prototype, 'listVms').mockResolvedValue([mockVm]);

  const fs = await import('node:fs');

  const apiImpl = createAPI();
  await apiImpl.openVMTerminal('test-vm');

  // readFileSync should have been called with the identity path
  expect(fs.readFileSync).toHaveBeenCalledWith('/home/user/.ssh/id_ed25519');

  // Verify a write flows through to the mock stream
  await apiImpl.writeToVMTerminal('test');
  expect(mockStreamWrite).toHaveBeenCalledWith('test');
});

test('openVMTerminal expands ~/ in IdentityPath before reading the key file', async () => {
  const mockVm = {
    Name: 'test-vm',
    Running: true,
    Port: 2222,
    RemoteUsername: 'root',
    IdentityPath: '~/.ssh/id_ed25519',
  } as macadam.VmDetails;

  vi.spyOn(MacadamHandler.prototype, 'listVms').mockResolvedValue([mockVm]);

  const fs = await import('node:fs');
  const originalHome = process.env.HOME;
  process.env.HOME = '/home/testuser';

  const apiImpl = createAPI();
  await apiImpl.openVMTerminal('test-vm');

  expect(fs.readFileSync).toHaveBeenCalledWith('/home/testuser/.ssh/id_ed25519');

  process.env.HOME = originalHome;
});

test('writeToVMTerminal writes to the active stream', async () => {
  const mockVm = {
    Name: 'test-vm',
    Running: true,
    Port: 2222,
    RemoteUsername: 'root',
    IdentityPath: '/home/user/.ssh/id_ed25519',
  } as macadam.VmDetails;

  vi.spyOn(MacadamHandler.prototype, 'listVms').mockResolvedValue([mockVm]);

  const apiImpl = createAPI();
  await apiImpl.openVMTerminal('test-vm');

  await apiImpl.writeToVMTerminal('ls -la\n');

  expect(mockStreamWrite).toHaveBeenCalledWith('ls -la\n');
});

test('writeToVMTerminal is a no-op when no session exists', async () => {
  const apiImpl = createAPI();
  await apiImpl.writeToVMTerminal('hello');

  expect(mockStreamWrite).not.toHaveBeenCalled();
});

test('closeVMTerminal closes stream and client without stopping the VM', async () => {
  const mockVm = {
    Name: 'test-vm',
    Running: true,
    Port: 2222,
    RemoteUsername: 'root',
    IdentityPath: '/home/user/.ssh/id_ed25519',
  } as macadam.VmDetails;

  vi.spyOn(MacadamHandler.prototype, 'listVms').mockResolvedValue([mockVm]);

  const apiImpl = createAPI();
  await apiImpl.openVMTerminal('test-vm');

  await apiImpl.closeVMTerminal();

  expect(mockStreamClose).toHaveBeenCalled();
  expect(mockClientEnd).toHaveBeenCalled();
  expect(mockClientDestroy).toHaveBeenCalled();

  // Subsequent write should be a no-op (references cleared)
  mockStreamWrite.mockClear();
  await apiImpl.writeToVMTerminal('after-close');
  expect(mockStreamWrite).not.toHaveBeenCalled();
});

test('openVMTerminal posts MSG_VM_TERMINAL_NEEDS_PASSWORD when no key file exists', async () => {
  const mockVm = {
    Name: 'test-vm',
    Running: true,
    Port: 2222,
    RemoteUsername: 'root',
    IdentityPath: '',
  } as macadam.VmDetails;

  vi.spyOn(MacadamHandler.prototype, 'listVms').mockResolvedValue([mockVm]);

  const postMessageMock = vi.fn().mockResolvedValue(undefined);
  const apiImpl = new BootcApiImpl({} as podmanDesktopApi.ExtensionContext, TELEMETRY_LOGGER_MOCK, {
    postMessage: postMessageMock,
  } as unknown as podmanDesktopApi.Webview);

  await apiImpl.openVMTerminal('test-vm');

  expect(postMessageMock).toHaveBeenCalledWith({
    id: Messages.MSG_VM_TERMINAL_NEEDS_PASSWORD,
    body: {},
  });
});

test('submitVMTerminalPassword invokes the stored auth callback with correct args', async () => {
  const mockVm = {
    Name: 'test-vm',
    Running: true,
    Port: 2222,
    RemoteUsername: 'root',
    IdentityPath: '',
  } as macadam.VmDetails;

  vi.spyOn(MacadamHandler.prototype, 'listVms').mockResolvedValue([mockVm]);

  const apiImpl = createAPI();
  await apiImpl.openVMTerminal('test-vm');

  // eslint-disable-next-line sonarjs/no-hardcoded-passwords
  await apiImpl.submitVMTerminalPassword('my-pass');

  expect(mockAuthCallback).toHaveBeenCalledWith(
    // eslint-disable-next-line sonarjs/no-hardcoded-passwords
    expect.objectContaining({ type: 'password', username: 'root', password: 'my-pass' }),
  );
});

test('closeVMTerminal with pending password callback invokes it with false', async () => {
  const mockVm = {
    Name: 'test-vm',
    Running: true,
    Port: 2222,
    RemoteUsername: 'root',
    IdentityPath: '',
  } as macadam.VmDetails;

  vi.spyOn(MacadamHandler.prototype, 'listVms').mockResolvedValue([mockVm]);

  const apiImpl = createAPI();
  await apiImpl.openVMTerminal('test-vm');

  await apiImpl.closeVMTerminal();

  expect(mockAuthCallback).toHaveBeenCalledWith(false);
  expect(mockClientEnd).toHaveBeenCalled();
  expect(mockClientDestroy).toHaveBeenCalled();
});
