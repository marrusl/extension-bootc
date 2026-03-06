<script lang="ts">
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { AttachAddon } from '@xterm/addon-attach';
import { Terminal } from '@xterm/xterm';
import { onDestroy, onMount } from 'svelte';
import { router } from 'tinro';
import { bootcClient } from '/@/api/client';
import { getTerminalTheme } from '/@/lib/upstream/terminal-theme';
import { EmptyScreen, Button } from '@podman-desktop/ui-svelte';

// Attach-only terminal — connects to the already-running VM's WebSocket
// without launching or stopping the VM. Use this when the VM was started
// externally (e.g. from the Virtual Machines list view).

const WS_PORT = 45252;

let logsXtermDiv = $state<HTMLDivElement>();
let noLogs = $state(true);
let connectError = $state('');
let resizeObserver = $state<ResizeObserver>();
let termFit = $state<FitAddon>();
let logsTerminal = $state<Terminal>();
let socket = $state<WebSocket>();

function closeHandler(): void {
  noLogs = true;
  connectError = 'The VM has stopped or the connection was lost.';
}

function errorHandler(): void {
  connectError = `Unable to connect to the VM terminal on port ${WS_PORT}. Make sure the VM is running.`;
}

async function attachTerminal(): Promise<void> {
  if (!logsXtermDiv) return;

  const fontSize = (await bootcClient.getConfigurationValue('terminal', 'integrated.fontSize')) as number;
  const lineHeight = (await bootcClient.getConfigurationValue('terminal', 'integrated.lineHeight')) as number;

  logsTerminal = new Terminal({
    fontSize,
    lineHeight,
    theme: getTerminalTheme(),
    disableStdin: false,
    convertEol: true,
  });

  termFit = new FitAddon();
  logsTerminal.loadAddon(termFit);
  logsTerminal.open(logsXtermDiv);
  logsTerminal.write('\x1b[?25l');

  window.addEventListener('resize', () => {
    termFit?.fit();
  });
  termFit.fit();

  try {
    socket = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);
    socket.binaryType = 'arraybuffer';
    socket.onclose = closeHandler;
    socket.onerror = errorHandler;
    socket.onopen = (): void => {
      noLogs = false;
      connectError = '';
    };
  } catch {
    connectError = `Failed to connect to VM terminal on port ${WS_PORT}.`;
    return;
  }

  const attachAddon = new AttachAddon(socket);
  logsTerminal.loadAddon(attachAddon);

  logsTerminal.onKey((e: { key: string }) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(new TextEncoder().encode(e.key).buffer);
    }
  });

  logsTerminal.attachCustomKeyEventHandler((arg: KeyboardEvent) => {
    if ((arg.ctrlKey || arg.metaKey) && arg.code === 'KeyV' && arg.type === 'keydown') {
      bootcClient
        .readFromClipboard()
        .then(text => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(new TextEncoder().encode(text).buffer);
          }
        })
        .catch((e: unknown) => console.error('clipboard read error', e));
    }
    return true;
  });
}

onMount(async () => {
  resizeObserver = new ResizeObserver(() => {
    termFit?.fit();
  });
  if (logsXtermDiv) resizeObserver.observe(logsXtermDiv);
  await attachTerminal();
});

onDestroy(() => {
  if (logsXtermDiv) resizeObserver?.unobserve(logsXtermDiv);
  // Close the WebSocket but do NOT stop the VM — the VM lifecycle is
  // managed by the user via the Virtual Machines list, not this view.
  socket?.close();
  logsTerminal?.dispose();
});
</script>

<div class="flex flex-col w-full h-full bg-[var(--pd-content-bg)]">
  <div class="flex items-center justify-between px-5 py-4 border-b border-[var(--pd-content-divider)]">
    <h1 class="text-xl font-semibold text-[var(--pd-content-header)]">VM Terminal</h1>
    <Button on:click={(): void => { router.goto('/virtual-machines'); }} title="Back to Virtual Machines">
      Back
    </Button>
  </div>

  {#if connectError}
    <EmptyScreen icon={undefined} title="Connection error" message={connectError}>
      <Button class="py-3" on:click={(): void => { router.goto('/virtual-machines'); }}>
        Back to Virtual Machines
      </Button>
    </EmptyScreen>
  {/if}

  <div
    class="min-w-full flex flex-col p-[5px] pr-0 bg-[var(--pd-terminal-background)]"
    class:invisible={noLogs}
    class:h-0={noLogs}
    class:h-full={!noLogs}
    bind:this={logsXtermDiv}>
  </div>
</div>
