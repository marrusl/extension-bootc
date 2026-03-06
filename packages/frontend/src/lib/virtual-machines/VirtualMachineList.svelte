<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import { Button, EmptyScreen, ErrorMessage, Spinner } from '@podman-desktop/ui-svelte';
import { bootcClient, rpcBrowser } from '/@/api/client';
import { Messages } from '/@shared/src/messages/Messages';
import { historyInfo } from '/@/stores/historyInfo';
import { gotoCreateVMForm } from '/@/lib/navigation';
import type { VmDetails } from '@crc-org/macadam.js';
import type { BootcBuildInfo } from '/@shared/src/models/bootc';
import type { Subscriber } from '/@shared/src/messages/MessageProxy';
import type { Unsubscriber } from 'svelte/store';
import Fa from 'svelte-fa';
import { faCopy, faCheck, faPlay, faStop, faTrash, faTerminal } from '@fortawesome/free-solid-svg-icons';
import DiskImageIcon from '/@/lib/DiskImageIcon.svelte';
import { router } from 'tinro';

let vms = $state<VmDetails[]>([]);
let errorMessage = $state('');
let loading = $state(true);
let builds = $state<BootcBuildInfo[]>([]);

let vmSubscriber = $state<Subscriber>();
let historyUnsubscribe = $state<Unsubscriber>();

// Per-card delete confirmation state, keyed by VM name
let confirmingDelete = $state<Record<string, boolean>>({});

// Per-card copy feedback state
let copiedSsh = $state<Record<string, boolean>>({});

// Resolve the source OCI image label and matching build for each VM.
// Both use the same join: VmDetails.Image starts with build.folder.
let vmImageLabels = $derived.by(() => {
  const labels: Record<string, string> = {};
  for (const vm of vms) {
    const match = builds.find(b => vm.Image.startsWith(b.folder));
    labels[vm.Name] = match ? `${match.image}:${match.tag}` : vm.Image;
  }
  return labels;
});

async function loadVMs(): Promise<void> {
  try {
    vms = await bootcClient.listVMs();
    errorMessage = '';
  } catch (e) {
    errorMessage = `Failed to load virtual machines: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    loading = false;
  }
}

function vmStatus(vm: VmDetails): 'running' | 'starting' | 'stopped' {
  if (vm.Running && !vm.Starting) return 'running';
  if (vm.Starting) return 'starting';
  return 'stopped';
}

function vmHypervisorLabel(vmType: string): string {
  if (vmType === 'applehv') return 'Apple Hypervisor';
  if (vmType === 'hyperv') return 'Hyper-V';
  if (vmType === 'wsl') return 'WSL2';
  return vmType;
}

async function startVM(name: string): Promise<void> {
  try {
    await bootcClient.startVM(name);
  } catch (e) {
    errorMessage = `Failed to start VM: ${e instanceof Error ? e.message : String(e)}`;
  }
  await loadVMs();
}

async function stopVM(name: string): Promise<void> {
  try {
    await bootcClient.stopVM(name);
  } catch (e) {
    errorMessage = `Failed to stop VM: ${e instanceof Error ? e.message : String(e)}`;
  }
  await loadVMs();
}

async function deleteVM(name: string): Promise<void> {
  confirmingDelete[name] = false;
  try {
    await bootcClient.deleteVM(name);
  } catch (e) {
    errorMessage = `Failed to delete VM: ${e instanceof Error ? e.message : String(e)}`;
  }
  await loadVMs();
}

async function copySshCommand(name: string, port: number, user: string): Promise<void> {
  const command = `ssh -p ${port} ${user}@localhost`;
  try {
    // navigator.clipboard requires a secure context; fall back to the
    // textarea + execCommand approach which works in all webview contexts.
    await navigator.clipboard.writeText(command);
  } catch {
    const el = document.createElement('textarea');
    el.value = command;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }
  copiedSsh[name] = true;
  setTimeout(() => {
    copiedSsh[name] = false;
  }, 2000);
}

onMount(async () => {
  historyUnsubscribe = historyInfo.subscribe(value => {
    builds = value;
  });

  vmSubscriber = rpcBrowser.subscribe(Messages.MSG_VM_LIST_UPDATED, () => {
    loadVMs().catch(e => console.error('Error refreshing VM list:', e));
  });

  await loadVMs();
});

onDestroy(() => {
  vmSubscriber?.unsubscribe();
  historyUnsubscribe?.();
});
</script>

<div class="flex flex-col w-full h-full bg-[var(--pd-content-bg)]">
  <!-- Page header -->
  <div class="flex items-center justify-between px-5 py-4">
    <h1 class="text-xl font-semibold text-[var(--pd-content-header)]">Virtual Machines</h1>
    <Button on:click={gotoCreateVMForm} icon={DiskImageIcon} title="Create Virtual Machine">Create Virtual Machine</Button>
  </div>

  {#if errorMessage}
    <div class="px-5 pb-3">
      <ErrorMessage error={errorMessage} />
    </div>
  {/if}

  {#if loading}
    <div class="flex items-center justify-center h-full">
      <Spinner size="2em" />
    </div>
  {:else if vms.length === 0}
    <EmptyScreen
      icon={DiskImageIcon}
      title="No virtual machines"
      message="Create a virtual machine from a bootable disk image to get started.">
      <Button class="py-3" on:click={gotoCreateVMForm}>Create Virtual Machine</Button>
    </EmptyScreen>
  {:else}
    <div class="flex flex-col gap-3 px-5 pb-5 overflow-y-auto">
      {#each vms as vm (vm.Name)}
        {@const status = vmStatus(vm)}
        <div class="flex flex-col gap-3 p-4 rounded-lg bg-[var(--pd-content-card-bg)] text-[var(--pd-content-card-text)]">
          <!-- Top row: status badge + name -->
          <div class="flex items-center gap-2">
            {#if status === 'running'}
              <span class="rounded-full px-2 py-0.5 text-xs font-semibold bg-[var(--pd-status-connected)] text-white">Running</span>
            {:else if status === 'starting'}
              <span class="rounded-full px-2 py-0.5 text-xs font-semibold bg-[var(--pd-status-degraded)] text-gray-900 flex items-center gap-1">Starting <Spinner size="0.75em" /></span>
            {:else}
              <span class="rounded-full px-2 py-0.5 text-xs font-semibold bg-[var(--pd-status-not-running)] text-white">Stopped</span>
            {/if}
            <span class="text-base font-semibold text-[var(--pd-content-card-header-text)]">{vm.Name}</span>
          </div>

          <!-- Hypervisor type -->
          {#if vm.VMType}
            <div class="text-xs text-[var(--pd-content-text-secondary)]">{vmHypervisorLabel(vm.VMType)}</div>
          {/if}

          <!-- Source image -->
          <div class="text-sm text-[var(--pd-label-text)]">
            Image: <span class="font-mono">{vmImageLabels[vm.Name]}</span>
          </div>

          <!-- SSH command (running only) -->
          {#if status === 'running'}
            <div
              class="flex items-center gap-2 px-3 py-2 rounded bg-[var(--pd-label-bg)] text-sm">
              <span class="text-[var(--pd-status-connected)] font-medium">SSH:</span>
              <code class="font-mono select-all text-[var(--pd-label-text)]">ssh -p {vm.Port} {vm.RemoteUsername}@localhost</code>
              <button
                type="button"
                class="ml-auto p-1 rounded cursor-pointer hover:opacity-80"
                title={copiedSsh[vm.Name] ? 'Copied!' : 'Copy to clipboard'}
                onclick={(): Promise<void> => copySshCommand(vm.Name, vm.Port, vm.RemoteUsername)}>
                <Fa icon={copiedSsh[vm.Name] ? faCheck : faCopy} size="sm" />
              </button>
            </div>
          {/if}

          <!-- Actions row -->
          <div class="flex items-center gap-2 pt-1">
            {#if confirmingDelete[vm.Name]}
              <span class="text-sm text-[var(--pd-status-terminated)]">Are you sure?</span>
              <Button on:click={(): Promise<void> => deleteVM(vm.Name)} title="Confirm delete">Confirm</Button>
              <Button on:click={(): void => { confirmingDelete[vm.Name] = false; }} title="Cancel delete">Cancel</Button>
            {:else}
              {#if status === 'stopped'}
                <Button on:click={(): Promise<void> => startVM(vm.Name)} icon={faPlay} title="Start VM">Start</Button>
              {/if}
              {#if status === 'running'}
                <Button on:click={(): Promise<void> => stopVM(vm.Name)} icon={faStop} title="Stop VM">Stop</Button>
                <Button
                  on:click={(): void => { router.goto(`/virtual-machines/terminal/${encodeURIComponent(vm.Name)}`); }}
                  icon={faTerminal}
                  title="Open terminal">Terminal</Button>
              {/if}
              <Button
                on:click={(): void => { confirmingDelete[vm.Name] = true; }}
                icon={faTrash}
                title="Delete VM"
                disabled={status === 'starting'}>Delete</Button>
              {#if status === 'starting'}
                <Spinner size="1em" />
              {/if}
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
