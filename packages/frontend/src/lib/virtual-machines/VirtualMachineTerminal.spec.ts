import '@testing-library/jest-dom/vitest';

import { render, screen, waitFor, cleanup } from '@testing-library/svelte';
import { vi, test, expect, beforeEach, afterEach } from 'vitest';
import { bootcClient } from '/@/api/client';
import VirtualMachineTerminal from './VirtualMachineTerminal.svelte';
import type { Subscriber } from '/@shared/src/messages/MessageProxy';
import { Messages } from '/@shared/src/messages/Messages';

// vi.hoisted runs before vi.mock hoisting, so these refs are available in factories
const mocks = vi.hoisted(() => ({
  terminalWrite: vi.fn(),
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    loadAddon = vi.fn();
    open = vi.fn();
    write = mocks.terminalWrite;
    onKey = vi.fn();
    attachCustomKeyEventHandler = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));

// Store subscription callbacks so tests can fire them manually
const subscriptionCallbacks: Record<string, (...args: unknown[]) => void> = {};

vi.mock('/@/api/client', async () => ({
  bootcClient: {
    getConfigurationValue: vi.fn().mockResolvedValue(14),
    openVMTerminal: vi.fn().mockResolvedValue(undefined),
    writeToVMTerminal: vi.fn().mockResolvedValue(undefined),
    closeVMTerminal: vi.fn().mockResolvedValue(undefined),
    readFromClipboard: vi.fn().mockResolvedValue(''),
  },
  rpcBrowser: {
    subscribe: (messageId: string, cb: (...args: unknown[]) => void): Subscriber => {
      subscriptionCallbacks[messageId] = cb;
      return { unsubscribe: vi.fn() };
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(subscriptionCallbacks)) {
    delete subscriptionCallbacks[key];
  }
});

afterEach(() => {
  cleanup();
});

test('calls openVMTerminal with the correct VM name on mount', async () => {
  render(VirtualMachineTerminal, { name: 'test-vm' });

  await waitFor(() => {
    expect(bootcClient.openVMTerminal).toHaveBeenCalledWith('test-vm');
  });
});

test('calls closeVMTerminal on destroy and does not call any VM stop method', async () => {
  const { unmount } = render(VirtualMachineTerminal, { name: 'test-vm' });

  await waitFor(() => {
    expect(bootcClient.openVMTerminal).toHaveBeenCalled();
  });

  unmount();

  expect(bootcClient.closeVMTerminal).toHaveBeenCalled();
  // Verify no VM lifecycle methods were called
  expect(bootcClient).not.toHaveProperty('stopVM');
  expect(bootcClient).not.toHaveProperty('stopCurrentVM');
});

test('MSG_VM_TERMINAL_DATA subscription writes data to the terminal', async () => {
  render(VirtualMachineTerminal, { name: 'test-vm' });

  await waitFor(() => {
    expect(bootcClient.openVMTerminal).toHaveBeenCalled();
  });

  // The subscription callback should have been registered
  expect(subscriptionCallbacks[Messages.MSG_VM_TERMINAL_DATA]).toBeDefined();

  // Fire data event
  subscriptionCallbacks[Messages.MSG_VM_TERMINAL_DATA]({ data: 'hello world' });

  expect(mocks.terminalWrite).toHaveBeenCalledWith('hello world');
});

test('shows error screen when openVMTerminal throws', async () => {
  vi.mocked(bootcClient.openVMTerminal).mockRejectedValue(new Error('VM not found'));

  render(VirtualMachineTerminal, { name: 'bad-vm' });

  await waitFor(() => {
    expect(screen.getByText('VM not found')).toBeInTheDocument();
  });
});

test('MSG_VM_TERMINAL_CLOSED subscription writes a close message to the terminal', async () => {
  render(VirtualMachineTerminal, { name: 'test-vm' });

  await waitFor(() => {
    expect(bootcClient.openVMTerminal).toHaveBeenCalled();
  });

  expect(subscriptionCallbacks[Messages.MSG_VM_TERMINAL_CLOSED]).toBeDefined();

  subscriptionCallbacks[Messages.MSG_VM_TERMINAL_CLOSED]();

  expect(mocks.terminalWrite).toHaveBeenCalledWith(expect.stringContaining('Connection closed.'));
});
