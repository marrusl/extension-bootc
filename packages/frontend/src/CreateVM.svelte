<script lang="ts">
import { onMount } from 'svelte';
import { Button, EmptyScreen, ErrorMessage, FormPage, Input } from '@podman-desktop/ui-svelte';
import Link from './lib/Link.svelte';
import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { goToDiskImages } from './lib/navigation';
import DiskImageIcon from './lib/DiskImageIcon.svelte';
import { bootcClient } from './api/client';
import { router } from 'tinro';
import type { VmDetails } from '@crc-org/macadam.js';

interface Props {
  imageName?: string;
  imagePath?: string;
}
let { imageName, imagePath }: Props = $props();

// Variables
let errorFormValidation = $state('');
let createInProgress = $state(false);
let createErrorMessage = $state('');
let sshPrivateKeyLocation = $state('');
let sshUsername = $state('');
let virtualMachineName = $state('');

// Track whether each required field has been interacted with so we don't
// show "missing field" errors on the initial empty page load.
let imagePathTouched = $state(false);
let virtualMachineNameTouched = $state(false);

// An array of strings to store the list of VM names to be used for validation
let existingVMNames = $state<string[]>([]);

// Validate imagePath and virtualMachineName. Priority order:
// 1. invalid image format, 2. missing image path, 3. missing VM name, 4. duplicate VM name.
// Missing-field errors are only shown once the field has been touched (or submit was attempted).
$effect(() => {
  if (imagePath && !(imagePath.endsWith('.raw') || imagePath.endsWith('.qcow2'))) {
    errorFormValidation = 'Only raw or qcow2 file formats are supported. Please select a valid image file.';
  } else if (!imagePath && imagePathTouched) {
    errorFormValidation = 'An image file path is required. Please select a raw or qcow2 image file.';
  } else if (!virtualMachineName && virtualMachineNameTouched) {
    errorFormValidation = 'A virtual machine name is required.';
  } else if (virtualMachineName && existingVMNames.includes(virtualMachineName)) {
    errorFormValidation =
      'The virtual machine name already exists. Please choose a different name or delete the existing virtual machine under Settings > Resources.';
  } else {
    errorFormValidation = '';
  }
});

onMount(async () => {
  // If the image name is not empty, set the default name for the virtual machine
  virtualMachineName = imageName ? getDefaultNameFromImageName(imageName) : '';

  // On mount, we will get the "default" configuration values for the username as well as ssh private key location
  // and propagate them to the ssh input fields.
  await getDefaultConfigurationSettings();

  // Get the list of virtual machines and store them in a variable on load,
  // so we can use them to check if the user is trying to create a VM with the same name as an existing one.
  existingVMNames = await listNamesOfVms();
});

// Take the name of the image, for example: quay.io/foobar/image:latest
// and return just "image". This will be used to set a "default name" for the virtual machine name
// based on what's in the image name.
function getDefaultNameFromImageName(imageName: string): string {
  const imageParts = imageName.split('/');
  const imageTag = imageParts[imageParts.length - 1];
  const imageNameWithoutTag = imageTag.split(':')[0];
  return imageNameWithoutTag;
}

async function getDefaultConfigurationSettings(): Promise<void> {
  try {
    sshPrivateKeyLocation = (await bootcClient.getConfigurationValue('bootc', 'macadam.ssh.private.key')) as string;
    sshUsername = (await bootcClient.getConfigurationValue('bootc', 'macadam.ssh.username')) as string;
  } catch (error) {
    console.error('Error getting default configuration settings:', error);
  }
}

async function getVMImageFile(): Promise<void> {
  imagePath = await bootcClient.selectVMImageFile();
}

async function getSSHPrivateKeyFile(): Promise<void> {
  sshPrivateKeyLocation = await bootcClient.selectSSHPrivateKeyFile();
}

// Function that lists all the virtual machines from macadam for us to parse / check
// so we can show a message if the user tries to create a VM with the same name as an existing one.
async function listNamesOfVms(): Promise<string[]> {
  try {
    const vms = await bootcClient.listVMs();

    // Returns the list of VM names, as we do not need any other details from the VM
    const vmNames = vms.map((vm: VmDetails) => vm.Name);
    return vmNames;
  } catch (error) {
    console.error('Error listing VMs:', error);
    return []; // Return an empty array in case of an error
  }
}

async function createVM(): Promise<void> {
  // Mark all required fields as touched so validation messages surface immediately.
  imagePathTouched = true;
  virtualMachineNameTouched = true;

  if (errorFormValidation || !imagePath || !virtualMachineName) {
    return;
  }
  createInProgress = true;
  createErrorMessage = '';
  try {
    await bootcClient.createVM({
      imagePath,
      name: virtualMachineName,
      username: sshUsername,
      sshIdentityPath: sshPrivateKeyLocation,
    });
    router.goto('/virtual-machines');
  } catch (error) {
    createErrorMessage = 'An error occurred while creating the virtual machine. Error: ' + error;
  } finally {
    createInProgress = false;
  }
}
</script>

<FormPage
  title="Create Virtual Machine"
  inProgress={createInProgress}
  breadcrumbLeftPart="Disk Images"
  breadcrumbRightPart="Create Virtual Machine"
  onclose={goToDiskImages}
  onbreadcrumbClick={goToDiskImages}>
  {#snippet icon()}
    <DiskImageIcon size="30px" />
  {/snippet}

  {#snippet content()}
  <div class="p-5 min-w-full h-fit">
    {#if createErrorMessage}
      <EmptyScreen
        icon={faTriangleExclamation}
        title="Error with virtual machine creation"
        message={createErrorMessage}>
        <Button
          class="py-3"
          on:click={(): void => {
            goToDiskImages();
          }}>
          Go back
        </Button>
      </EmptyScreen>
    {:else}
      <div
        class="bg-[var(--pd-content-card-bg)] pt-5 space-y-6 px-8 sm:pb-6 xl:pb-8 rounded-lg text-[var(--pd-content-card-header-text)]">
        <div class={createInProgress ? 'opacity-40 pointer-events-none' : ''}>
          <div class="pb-4">
            <p class="text-sm text-[var(--pd-content-text)]">
              Virtual machines are created using the <Link externalRef="https://github.com/crc-org/macadam"
                >Macadam</Link> tool. This is a cross-platform tool to create and manage virtual machines. The following
              form will help you create a virtual machine by specifying the image file location and SSH credentials.<br /><br />
              <strong>Note:</strong> You must have added a valid public SSH key during the build process to be able to connect to
              the VM using the credentials below.
            </p>
          </div>
          <div class="pb-4">
            <label for="vm-name" class="block mb-2 font-semibold">Name</label>
            <Input
              name="vm-name"
              id="vm-name"
              bind:value={virtualMachineName}
              placeholder="Name for your virtual machine"
              class="w-full"
              aria-label="vm-name"
              onblur={(): void => {
                virtualMachineNameTouched = true;
              }} />
          </div>
          <div class="pb-4">
            <label for="path" class="block mb-2 font-semibold">Image file location (*.raw or *.qcow2)</label>
            <div class="flex flex-row space-x-3">
              <Input
                name="path"
                id="path"
                bind:value={imagePath}
                placeholder="Output folder"
                class="w-full"
                aria-label="folder-select"
                onblur={(): void => {
                  imagePathTouched = true;
                }} />
              <Button on:click={(): Promise<void> => getVMImageFile()}>Browse...</Button>
            </div>
          </div>
          <div class="pb-4">
            <label for="ssh-username" class="block mb-2 font-semibold">Username (ex. root)</label>
            <Input
              name="ssh-username"
              id="ssh-username"
              bind:value={sshUsername}
              placeholder="SSH username"
              class="w-full"
              aria-label="ssh-username" />
          </div>
          <div class="pb-4">
            <label for="ssh-private-key" class="block mb-2 font-semibold">SSH private key filepath (ex. ~/.ssh/id_ed25519)</label>
            <div class="flex flex-row space-x-3">
              <Input
                name="ssh-private-key"
                id="ssh-private-key"
                bind:value={sshPrivateKeyLocation}
                placeholder="SSH private key location"
                class="w-full"
                aria-label="ssh-private-key" />
              <Button on:click={(): Promise<void> => getSSHPrivateKeyFile()}>Browse...</Button>
            </div>
          </div>
        </div>
        {#if errorFormValidation !== ''}
          <ErrorMessage aria-label="validation" error={errorFormValidation} />
        {/if}
        <Button
          class="w-full"
          on:click={createVM}
          disabled={errorFormValidation !== '' || !imagePath || !virtualMachineName || createInProgress}
          >Create Virtual Machine</Button>
      </div>
    {/if}
  </div>
  {/snippet}
</FormPage>
