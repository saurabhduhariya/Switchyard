<script lang="ts" module>
  import type { IconName } from './Icon.svelte';

  export interface MenuItem {
    label: string;
    icon?: IconName;
    danger?: boolean;
    /** Draw a divider above this item. */
    separator?: boolean;
    action: () => void;
  }
</script>

<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    items: MenuItem[];
    /** The button that opened the menu; the menu is placed next to it. */
    anchor: HTMLElement;
    onclose: () => void;
  }

  let { items, anchor, onclose }: Props = $props();

  let menuRef: HTMLDivElement | undefined = $state();
  let top = $state(0);
  let right = $state(0);
  let placed = $state(false);

  /**
   * Render at <body> level. Cards use CSS containment, which would otherwise
   * trap a fixed-position menu inside the card that opened it.
   */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  const GAP = 4;
  const EDGE = 8;

  /**
   * Below the button with its right edge lined up with the button's, so it
   * grows leftwards and never runs off the right of the panel. Flipped above
   * the button when there is no room below.
   */
  function place() {
    if (!menuRef) return;
    const a = anchor.getBoundingClientRect();
    const h = menuRef.getBoundingClientRect().height;
    let y = a.bottom + GAP;
    if (y + h > window.innerHeight - EDGE && a.top - GAP - h >= EDGE) {
      y = a.top - GAP - h;
    }
    top = Math.max(EDGE, Math.min(y, window.innerHeight - h - EDGE));
    right = Math.max(EDGE, window.innerWidth - a.right);
    placed = true;
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from(menuRef?.querySelectorAll<HTMLButtonElement>('.menu-item') ?? []);
  }

  function close(returnFocus: boolean) {
    onclose();
    if (returnFocus) anchor.focus();
  }

  function choose(item: MenuItem) {
    // Focus is not returned to ⋮ here: actions like Rename move focus themselves.
    onclose();
    item.action();
  }

  function handleKeydown(e: KeyboardEvent) {
    const list = buttons();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      list[(i + 1) % list.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      list[list.length - 1]?.focus();
    }
  }

  $effect(() => {
    place();
    // Measure again after layout settles (fonts, portal move) to get the final height.
    const settle = requestAnimationFrame(place);
    // preventScroll: focusing must not scroll the panel, or the scroll listener below
    // would close the menu the moment it opens.
    buttons()[0]?.focus({ preventScroll: true });
    // Follow the button if the panel scrolls or resizes (layout can shift while
    // quota updates arrive). Close only if the button is no longer on screen.
    const onViewportChange = () => {
      if (!anchor.isConnected || anchor.getClientRects().length === 0) {
        close(false);
        return;
      }
      place();
    };
    const raf = requestAnimationFrame(() => {
      window.addEventListener('resize', onViewportChange);
      window.addEventListener('scroll', onViewportChange, true);
    });
    return () => {
      cancelAnimationFrame(settle);
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  });
</script>

<div use:portal>
  <!-- Transparent layer: a click anywhere outside the menu closes it. -->
  <div class="menu-backdrop" aria-hidden="true" onclick={() => close(false)}></div>
  <div
    class="overflow-menu"
    class:placed
    role="menu"
    tabindex="-1"
    bind:this={menuRef}
    style:top="{top}px"
    style:right="{right}px"
    style:--menu-right="{right - 8}px"
    onkeydown={handleKeydown}
  >
    {#each items as item (item.label)}
      {#if item.separator}
        <div class="separator" role="separator"></div>
      {/if}
      <button class="menu-item" class:danger={item.danger} role="menuitem" tabindex="-1" onclick={() => choose(item)}>
        <span class="menu-icon">
          {#if item.icon}<Icon name={item.icon} size={13} />{/if}
        </span>
        <span class="menu-label">{item.label}</span>
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
    position: fixed;
    z-index: 101;
    min-width: 184px;
    /* Never wider than the space left of the button; long labels end in "…". */
    max-width: calc(100vw - 16px - var(--menu-right, 0px));
    padding: 4px;
    border-radius: 6px;
    background: var(--vscode-menu-background, #252526);
    color: var(--vscode-menu-foreground, #ccc);
    border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, rgba(255, 255, 255, 0.12)));
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
    /* Hidden until measured and placed, so it never flashes in the wrong spot. */
    visibility: hidden;
    outline: none;
  }

  .overflow-menu.placed {
    visibility: visible;
    animation: menuIn 0.1s ease-out;
  }

  @keyframes menuIn {
    from {
      opacity: 0;
      transform: translateY(-2px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 26px;
    padding: 0 10px 0 6px;
    border: none;
    border-radius: 4px;
    background: none;
    color: inherit;
    font-family: inherit;
    font-size: 12px;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }

  .menu-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    flex-shrink: 0;
    color: var(--vscode-descriptionForeground, #999);
  }

  .menu-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .menu-item:hover,
  .menu-item:focus-visible,
  .menu-item:focus {
    background: var(--vscode-menu-selectionBackground, #094771);
    color: var(--vscode-menu-selectionForeground, #fff);
    outline: none;
  }

  .menu-item:hover .menu-icon,
  .menu-item:focus .menu-icon {
    color: inherit;
  }

  .menu-item.danger,
  .menu-item.danger .menu-icon {
    color: var(--vscode-errorForeground, #f48771);
  }

  .menu-item.danger:hover,
  .menu-item.danger:focus {
    background: color-mix(in srgb, var(--vscode-errorForeground, #f48771), transparent 85%);
    color: var(--vscode-errorForeground, #f48771);
  }

  .separator {
    height: 1px;
    margin: 4px 2px;
    background: var(--vscode-menu-separatorBackground, var(--vscode-widget-border, rgba(255, 255, 255, 0.1)));
  }

  @media (prefers-reduced-motion: reduce) {
    .overflow-menu.placed {
      animation: none;
    }
  }
</style>
