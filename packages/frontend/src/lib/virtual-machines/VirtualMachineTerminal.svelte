<script lang="ts">
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { onDestroy, onMount } from 'svelte';
import { router } from 'tinro';
import { bootcClient, rpcBrowser } from '/@/api/client';
import { getTerminalTheme } from '/@/lib/upstream/terminal-theme';
import { Messages } from '/@shared/src/messages/Messages';
import type { Subscriber } from '/@shared/src/messages/MessageProxy';
import { EmptyScreen, Button } from '@podman-desktop/ui-svelte';

interface Props {
  name: string;
}
let { name }: Props = $props();

let termDiv = $state<HTMLDivElement>();
let terminal = $state<Terminal>();
let termFit = $state<FitAddon>();
let resizeObserver = $state<ResizeObserver>();

let connecting = $state(true);
let connectError = $state('');
let sessionEnded = $state(false);

let dataSubscriber = $state<Subscriber>();
let closedSubscriber = $state<Subscriber>();
let errorSubscriber = $state<Subscriber>();

async function initTerminal(): Promise<void> {
  if (!termDiv) return;

  const fontSize = (await bootcClient.getConfigurationValue('terminal', 'integrated.fontSize')) as number;
  const lineHeight = (await bootcClient.getConfigurationValue('terminal', 'integrated.lineHeight')) as number;

  terminal = new Terminal({
    fontSize,
    lineHeight,
    theme: getTerminalTheme(),
    disableStdin: false,
    convertEol: true,
  });

  termFit = new FitAddon();
  terminal.loadAddon(termFit);
  terminal.open(termDiv);

  window.addEventListener('resize', (): void => {
    termFit?.fit();
  });
  termFit.fit();

  terminal.onKey((e: { key: string }) => {
    if (!sessionEnded) {
      bootcClient.writeToVMTerminal(e.key).catch((err: unknown) => console.error('write error', err));
    }
  });

  terminal.attachCustomKeyEventHandler((arg: KeyboardEvent) => {
    if ((arg.ctrlKey || arg.metaKey) && arg.code === 'KeyV' && arg.type === 'keydown') {
      bootcClient
        .readFromClipboard()
        .then(text => {
          if (!sessionEnded) {
            bootcClient.writeToVMTerminal(text).catch((err: unknown) => console.error('paste error', err));
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
  if (termDiv) {
    resizeObserver.observe(termDiv);
  }

  dataSubscriber = rpcBrowser.subscribe(Messages.MSG_VM_TERMINAL_DATA, (msg: { data: string }) => {
    terminal?.write(msg.data);
  });

  closedSubscriber = rpcBrowser.subscribe(Messages.MSG_VM_TERMINAL_CLOSED, () => {
    sessionEnded = true;
    terminal?.write('\r\n\x1b[33mConnection closed.\x1b[0m\r\n');
  });

  errorSubscriber = rpcBrowser.subscribe(Messages.MSG_VM_TERMINAL_ERROR, (msg: { error: string }) => {
    sessionEnded = true;
    terminal?.write(`\r\n\x1b[31mError: ${msg.error}\x1b[0m\r\n`);
  });

  await initTerminal();

  try {
    await bootcClient.openVMTerminal(name);
    connecting = false;
  } catch (e) {
    connectError = e instanceof Error ? e.message : String(e);
    connecting = false;
  }
});

onDestroy(() => {
  bootcClient.closeVMTerminal().catch((e: unknown) => console.error('close terminal error', e));

  dataSubscriber?.unsubscribe();
  closedSubscriber?.unsubscribe();
  errorSubscriber?.unsubscribe();

  if (termDiv) {
    resizeObserver?.unobserve(termDiv);
  }
  terminal?.dispose();
});
</script>

<div class="flex flex-col w-full h-full bg-[var(--pd-content-bg)]">
  <div class="flex items-center justify-between px-5 py-4 border-b border-[var(--pd-content-divider)]">
    <h1 class="text-xl font-semibold text-[var(--pd-content-header)]">Terminal — {name}</h1>
    <Button on:click={(): void => { router.goto('/virtual-machines'); }} title="Back to Virtual Machines">
      Back
    </Button>
  </div>

  {#if connectError}
    <EmptyScreen icon={undefined} title="Connection failed" message={connectError}>
      <Button class="py-3" on:click={(): void => { router.goto('/virtual-machines'); }}>
        Back to Virtual Machines
      </Button>
    </EmptyScreen>
  {:else if connecting}
    <EmptyScreen icon={undefined} title="Connecting..." message="Opening SSH session to {name}..." />
  {/if}

  <div
    class="min-w-full flex flex-col p-[5px] pr-0 bg-[var(--pd-terminal-background)]"
    class:invisible={connecting || !!connectError}
    class:h-0={connecting || !!connectError}
    class:h-full={!connecting && !connectError}
    bind:this={termDiv}>
  </div>
</div>
