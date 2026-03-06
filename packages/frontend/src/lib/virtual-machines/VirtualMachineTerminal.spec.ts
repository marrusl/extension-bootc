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
  onKeyCallback: undefined as ((e: { key: string; domEvent: KeyboardEvent }) => void) | undefined,
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    loadAddon = vi.fn();
    open = vi.fn();
    write = mocks.terminalWrite;
    onKey = vi.fn((cb: (e: { key: string; domEvent: KeyboardEvent }) => void) => {
      mocks.onKeyCallback = cb;
    });
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
    submitVMTerminalPassword: vi.fn().mockResolvedValue(undefined),
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
  mocks.onKeyCallback = undefined;
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

test('password auth success — openVMTerminal resolves and terminal is ready', async () => {
  vi.mocked(bootcClient.openVMTerminal).mockResolvedValue(undefined);

  render(VirtualMachineTerminal, { name: 'test-vm' });

  await waitFor(() => {
    expect(bootcClient.openVMTerminal).toHaveBeenCalledWith('test-vm');
  });

  expect(screen.queryByText('Connecting...')).not.toBeInTheDocument();
  expect(screen.queryByText('Connection failed')).not.toBeInTheDocument();
});

test('auth failed — openVMTerminal rejects and EmptyScreen shows the error message', async () => {
  vi.mocked(bootcClient.openVMTerminal).mockRejectedValue(new Error('All configured authentication methods failed'));

  render(VirtualMachineTerminal, { name: 'test-vm' });

  await waitFor(() => {
    expect(screen.getByText('All configured authentication methods failed')).toBeInTheDocument();
  });

  expect(screen.getByText('Connection failed')).toBeInTheDocument();
});

test('on MSG_VM_TERMINAL_NEEDS_PASSWORD, keystrokes are buffered and not sent', async () => {
  vi.mocked(bootcClient.openVMTerminal).mockResolvedValue(undefined);

  render(VirtualMachineTerminal, { name: 'test-vm' });

  await waitFor(() => {
    expect(bootcClient.openVMTerminal).toHaveBeenCalled();
  });

  expect(subscriptionCallbacks[Messages.MSG_VM_TERMINAL_NEEDS_PASSWORD]).toBeDefined();

  subscriptionCallbacks[Messages.MSG_VM_TERMINAL_NEEDS_PASSWORD]();
  expect(mocks.terminalWrite).toHaveBeenCalledWith('\r\nPassword: ');

  // Type a character — should NOT call writeToVMTerminal (buffered)
  expect(mocks.onKeyCallback).toBeDefined();
  mocks.onKeyCallback!({ key: 'a', domEvent: new KeyboardEvent('keydown', { key: 'a' }) });
  expect(bootcClient.writeToVMTerminal).not.toHaveBeenCalled();
});

test('Enter submits the buffered password via submitVMTerminalPassword', async () => {
  vi.mocked(bootcClient.openVMTerminal).mockResolvedValue(undefined);

  render(VirtualMachineTerminal, { name: 'test-vm' });

  await waitFor(() => {
    expect(bootcClient.openVMTerminal).toHaveBeenCalled();
  });

  subscriptionCallbacks[Messages.MSG_VM_TERMINAL_NEEDS_PASSWORD]();

  expect(mocks.onKeyCallback).toBeDefined();
  mocks.onKeyCallback!({ key: 'p', domEvent: new KeyboardEvent('keydown', { key: 'p' }) });
  mocks.onKeyCallback!({ key: 'a', domEvent: new KeyboardEvent('keydown', { key: 'a' }) });
  mocks.onKeyCallback!({ key: 's', domEvent: new KeyboardEvent('keydown', { key: 's' }) });
  mocks.onKeyCallback!({ key: 's', domEvent: new KeyboardEvent('keydown', { key: 's' }) });

  mocks.onKeyCallback!({ key: '\r', domEvent: new KeyboardEvent('keydown', { key: 'Enter' }) });

  expect(bootcClient.submitVMTerminalPassword).toHaveBeenCalledWith('pass');
  expect(mocks.terminalWrite).toHaveBeenCalledWith('\r\n');

  // After submitting, normal keystrokes should flow through again
  mocks.onKeyCallback!({ key: 'x', domEvent: new KeyboardEvent('keydown', { key: 'x' }) });
  expect(bootcClient.writeToVMTerminal).toHaveBeenCalledWith('x');
});
