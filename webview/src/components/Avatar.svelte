<script lang="ts">
  import { avatarColor, avatarInitial } from '../lib/avatar';

  interface Props {
    email: string;
    size?: number;
    active?: boolean;
  }

  let { email, size = 32, active = false }: Props = $props();

  let color = $derived(avatarColor(email));
  let initial = $derived(avatarInitial(email));
</script>

<div
  class="avatar"
  class:active
  style:width="{size}px"
  style:height="{size}px"
  style:background-color={color}
  style:font-size="{Math.round(size * 0.45)}px"
  aria-hidden="true"
>
  {initial}
  {#if active}
    <span class="dot" aria-hidden="true"></span>
  {/if}
</div>

<style>
  .avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    color: #fff;
    font-weight: 600;
    position: relative;
    flex-shrink: 0;
    user-select: none;
    letter-spacing: 0.02em;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .dot {
    position: absolute;
    bottom: -1px;
    right: -1px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--vscode-testing-iconPassed, #4ec9b0);
    border: 2px solid var(--vscode-sideBar-background, #1e1e1e);
    box-shadow: 0 0 4px var(--vscode-testing-iconPassed, #4ec9b0);
  }
</style>
