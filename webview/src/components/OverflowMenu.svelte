<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    items: { label: string; icon?: string; danger?: boolean; action: () => void }[];
    onclose: () => void;
    children?: Snippet;
  }

  let { items, onclose }: Props = $props();
  let menuRef: HTMLDivElement | undefined = $state();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onclose();
    }
  }

  function handleClickOutside(e: MouseEvent) {
    if (menuRef && !menuRef.contains(e.target as Node)) {
      onclose();
    }
  }

  $effect(() => {
    document.addEventListener('click', handleClickOutside, true);
    document.addEventListener('keydown', handleKeydown, true);
    return () => {
      document.removeEventListener('click', handleClickOutside, true);
      document.removeEventListener('keydown', handleKeydown, true);
    };
  });

  $effect(() => {
    if (menuRef) {
      const first = menuRef.querySelector<HTMLButtonElement>('button');
      first?.focus();
    }
  });
</script>

<div class="menu-backdrop">
  <div
    class="overflow-menu"
    role="menu"
    bind:this={menuRef}
  >
    {#each items as item}
      <button
        class="menu-item"
        class:danger={item.danger}
        role="menuitem"
        onclick={() => { item.action(); onclose(); }}
      >
        {#if item.icon}
          <span class="menu-icon">{item.icon}</span>
        {/if}
        {item.label}
      </button>
    {/each}
  </div>
</div>

<style>
  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
  }

  .overflow-menu {
    position: absolute;
    right: 12px;
    min-width: 160px;
    padding: 4px 0;
    border-radius: 6px;
    background: var(--vscode-menu-background, #2d2d2d);
    border: 1px solid var(--vscode-menu-border, rgba(255, 255, 255, 0.12));
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    z-index: 101;
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: none;
    color: var(--vscode-menu-foreground, #ccc);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
  }

  .menu-item:hover,
  .menu-item:focus-visible {
    background: var(--vscode-menu-selectionBackground, #094771);
    color: var(--vscode-menu-selectionForeground, #fff);
    outline: none;
  }

  .menu-item.danger {
    color: var(--vscode-errorForeground, #f48771);
  }

  .menu-item.danger:hover,
  .menu-item.danger:focus-visible {
    background: color-mix(in srgb, var(--vscode-errorForeground, #f48771), transparent 85%);
  }

  .menu-icon {
    font-size: 14px;
    width: 16px;
    text-align: center;
  }
</style>
