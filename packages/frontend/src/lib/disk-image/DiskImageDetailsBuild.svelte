<script lang="ts">
import '@xterm/xterm/css/xterm.css';

import { EmptyScreen } from '@podman-desktop/ui-svelte';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { onDestroy, onMount } from 'svelte';
import { router } from 'tinro';
import { bootcClient } from '/@/api/client';
import { getTerminalTheme } from '/@/lib/upstream/terminal-theme';
import type { BootcBuildStatus } from '/@shared/src/models/bootc';

interface Props {
  folder?: string;
  status?: BootcBuildStatus;
}
let { folder, status }: Props = $props();

// Build phase stepper — phases are listed in the order they appear in the log.
const BUILD_PHASES: { marker: string; label: string }[] = [
  { marker: '', label: 'Build started' },
  { marker: 'org.osbuild.rpm', label: 'Installing packages' },
  { marker: 'org.osbuild.selinux', label: 'Configuring SELinux' },
  { marker: 'org.osbuild.ostree.config', label: 'Composing OSTree' },
  { marker: 'org.osbuild.qemu', label: 'Writing disk image' },
  { marker: 'Build complete!', label: 'Complete' },
];

// The index of the last phase whose marker has been seen in the accumulated logs.
// Re-evaluated automatically whenever previousLogs changes.
let currentPhaseIndex = $derived.by(() => {
  let idx = 0;
  for (let i = 1; i < BUILD_PHASES.length; i++) {
    if (previousLogs.includes(BUILD_PHASES[i].marker)) {
      idx = i;
    }
  }
  return idx;
});

// Show the stepper only while there is log content and the build has not
// yet reached a terminal state (success / error).
let showStepper = $derived(
  noLogs === false && status !== 'success' && status !== 'error',
);

// Log
let logsXtermDiv = $state<HTMLDivElement>();
let noLogs = $state(true);
let previousLogs = $state('');
const refreshInterval = 2_000;

// Terminal resize
let resizeObserver = $state<ResizeObserver>();
let termFit = $state<FitAddon>();

let logsTerminal = $state<Terminal>();
let logInterval = $state<ReturnType<typeof setInterval>>();

async function fetchFolderLogs(): Promise<void> {
  if (!folder) {
    return;
  }

  const logs = await bootcClient.loadLogsFromFolder(folder);

  // We will write only the new logs to the terminal,
  // this is a simple way of updating the logs as we update it by calling the function
  // every 2 seconds instead of setting up a file watcher (unable to do so through RPC calls, due to long-running process)
  if (logs !== previousLogs) {
    // Write only the new logs to the log
    const newLogs = logs.slice(previousLogs.length);
    logsTerminal?.write(newLogs);
    previousLogs = logs; // Update the stored logs
    noLogs = false; // Make sure that the logs are visible
  }
}

async function refreshTerminal(): Promise<void> {
  // missing element, return
  if (!logsXtermDiv) {
    console.log('missing xterm div, exiting...');
    return;
  }

  // Retrieve the user configuration settings for the terminal to match the rest of Podman Desktop.
  const fontSize = (await bootcClient.getConfigurationValue('terminal', 'integrated.fontSize')) as number;
  const lineHeight = (await bootcClient.getConfigurationValue('terminal', 'integrated.lineHeight')) as number;

  logsTerminal = new Terminal({
    fontSize: fontSize,
    lineHeight: lineHeight,
    disableStdin: true,
    theme: getTerminalTheme(),
    convertEol: true,
  });
  termFit = new FitAddon();
  logsTerminal.loadAddon(termFit);

  logsTerminal.open(logsXtermDiv);

  // Disable cursor as we are just reading the logs
  logsTerminal.write('\x1b[?25l');

  // Call fit addon each time we resize the window
  window.addEventListener('resize', () => {
    termFit?.fit();
  });
  termFit.fit();
}

onMount(async () => {
  // Refresh the terminal on initial load
  await refreshTerminal();

  // Fetch logs initially and set up the interval to run every 2 seconds
  // we do this to avoid having to setup a file watcher since long-running commands to the backend is
  // not possible through RPC calls (yet).
  await fetchFolderLogs();
  logInterval = setInterval(() => {
    fetchFolderLogs().catch((e: unknown) => console.error('error fetching logs', e));
  }, refreshInterval);

  // Resize the terminal each time we change the div size
  resizeObserver = new ResizeObserver(() => {
    termFit?.fit();
  });

  // Observe the terminal div
  if (logsXtermDiv) {
    resizeObserver.observe(logsXtermDiv);
  }
});

onDestroy(() => {
  // Cleanup the observer on destroy
  if (logsXtermDiv) {
    resizeObserver?.unobserve(logsXtermDiv);
  }

  // Clear the interval when the component is destroyed
  clearInterval(logInterval);
});

export function goToHomePage(): void {
  router.goto('/');
}
</script>

<EmptyScreen
  icon={undefined}
  title="No log file"
  message="Unable to read image-build.log file from {folder}"
  hidden={noLogs === false} />

{#if showStepper}
  <div class="flex items-center px-4 py-3 bg-[var(--pd-content-card-bg)] border-b border-[var(--pd-content-divider)]">
    {#each BUILD_PHASES as phase, i}
      {#if i > 0}
        <div
          class="flex-1 h-px mx-1"
          class:bg-[var(--pd-status-connected)]={i <= currentPhaseIndex}
          class:bg-[var(--pd-label-bg)]={i > currentPhaseIndex}>
        </div>
      {/if}
      <div class="flex flex-col items-center gap-1 shrink-0">
        <div
          class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold transition-colors"
          class:bg-[var(--pd-status-connected)]={i <= currentPhaseIndex}
          class:text-white={i <= currentPhaseIndex}
          class:bg-[var(--pd-label-bg)]={i > currentPhaseIndex}
          class:text-[var(--pd-label-text)]={i > currentPhaseIndex}>
          {#if i < currentPhaseIndex}
            ✓
          {:else}
            {i + 1}
          {/if}
        </div>
        <span
          class="text-[10px] text-center max-w-[72px] leading-tight"
          class:text-[var(--pd-status-connected)]={i === currentPhaseIndex}
          class:font-semibold={i === currentPhaseIndex}
          class:text-[var(--pd-label-text)]={i < currentPhaseIndex}
          class:text-[var(--pd-content-text-disabled)]={i > currentPhaseIndex}>
          {phase.label}
        </span>
      </div>
    {/each}
  </div>
{/if}

<div
  class="min-w-full flex flex-col p-[5px] pr-0 bg-[var(--pd-terminal-background)]"
  class:invisible={noLogs === true}
  class:h-0={noLogs === true}
  class:h-full={noLogs === false}
  bind:this={logsXtermDiv}>
</div>
