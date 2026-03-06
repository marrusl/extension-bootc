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
import { vi, test, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import DiskImageDetailsBuild from './DiskImageDetailsBuild.svelte';
import { bootcClient } from '/@/api/client';
import type { Subscriber } from '/@shared/src/messages/MessageProxy';

vi.mock('/@/api/client', async () => ({
  bootcClient: {
    loadLogsFromFolder: vi.fn(),
    getConfigurationValue: vi.fn(),
  },
  rpcBrowser: {
    subscribe: (): Subscriber => {
      return {
        unsubscribe: (): void => {},
      };
    },
  },
}));

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    value: vi.fn(),
  });
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();

  vi.mocked(window.matchMedia).mockReturnValue({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as MediaQueryList);
});

afterEach(() => {
  vi.useRealTimers();
});

const mockLogs = `Build log line 1
Build log line 2
Build log line 3`;

test('Render logs and terminal setup', async () => {
  vi.mocked(bootcClient.loadLogsFromFolder).mockResolvedValue(mockLogs);
  vi.mocked(bootcClient.getConfigurationValue).mockResolvedValue(14);

  const folderLocation = '/path/to/logs';
  render(DiskImageDetailsBuild, { folder: folderLocation });

  // Wait for the logs to be shown
  await waitFor(() => {
    expect(bootcClient.loadLogsFromFolder).toHaveBeenCalledWith(folderLocation);
    expect(screen.queryByText('Build log line 1')).toBeDefined();
    expect(screen.queryByText('Build log line 2')).toBeDefined();
    expect(screen.queryByText('Build log line 3')).toBeDefined();
  });
});

test('Handles empty logs correctly', async () => {
  vi.mocked(bootcClient.loadLogsFromFolder).mockResolvedValue('');
  vi.mocked(bootcClient.getConfigurationValue).mockResolvedValue(14);

  const folderLocation = '/empty/logs';
  render(DiskImageDetailsBuild, { folder: folderLocation });

  // Verify no logs message is displayed when logs are empty
  const emptyMessage = await screen.findByText('Unable to read image-build.log file from /empty/logs');
  expect(emptyMessage).toBeDefined();
});

test('Refreshes logs correctly', async () => {
  vi.mocked(bootcClient.loadLogsFromFolder).mockResolvedValue(mockLogs);
  vi.mocked(bootcClient.getConfigurationValue).mockResolvedValue(14);

  render(DiskImageDetailsBuild, { folder: '/empty/logs' });

  // make sure the timer is created (onMount has run)
  await waitFor(() => {
    expect(bootcClient.loadLogsFromFolder).toHaveBeenCalled();
  });

  // verify we start refreshing logs
  expect(bootcClient.loadLogsFromFolder).toHaveBeenCalledTimes(1);
  vi.runOnlyPendingTimers();
  expect(bootcClient.loadLogsFromFolder).toHaveBeenCalledTimes(2);
});

test('stepper is visible and Installing packages is the active phase when rpm marker is in logs', async () => {
  vi.mocked(bootcClient.loadLogsFromFolder).mockResolvedValue('org.osbuild.rpm\nsome build output');
  vi.mocked(bootcClient.getConfigurationValue).mockResolvedValue(14);

  render(DiskImageDetailsBuild, { folder: '/path/to/logs', status: 'running' });

  await waitFor(() => {
    // Stepper is rendered and the active phase label is present
    expect(screen.getByText('Installing packages')).toBeInTheDocument();
    // Phase 0 ("Build started") is now completed — its circle shows a checkmark
    expect(screen.getByText('✓')).toBeInTheDocument();
  });
});

test('stepper shows Complete as the active phase when Build complete! marker is in logs', async () => {
  vi.mocked(bootcClient.loadLogsFromFolder).mockResolvedValue(
    'org.osbuild.rpm\norg.osbuild.selinux\norg.osbuild.ostree.config\norg.osbuild.qemu\nBuild complete!',
  );
  vi.mocked(bootcClient.getConfigurationValue).mockResolvedValue(14);

  render(DiskImageDetailsBuild, { folder: '/path/to/logs', status: 'running' });

  await waitFor(() => {
    expect(screen.getByText('Complete')).toBeInTheDocument();
    // All 5 preceding phases (indices 0–4) are completed and show checkmarks
    expect(screen.getAllByText('✓')).toHaveLength(5);
  });
});

test('stepper is not visible when status is success', async () => {
  vi.mocked(bootcClient.loadLogsFromFolder).mockResolvedValue('org.osbuild.rpm\nsome build output');
  vi.mocked(bootcClient.getConfigurationValue).mockResolvedValue(14);

  render(DiskImageDetailsBuild, { folder: '/path/to/logs', status: 'success' });

  await waitFor(() => {
    expect(bootcClient.loadLogsFromFolder).toHaveBeenCalled();
  });

  // Logs are loaded (noLogs === false) but status is terminal — stepper must not render
  expect(screen.queryByText('Installing packages')).not.toBeInTheDocument();
  expect(screen.queryByText('Build started')).not.toBeInTheDocument();
});
