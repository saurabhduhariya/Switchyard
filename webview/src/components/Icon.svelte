<script lang="ts">
  export type IconName =
    | 'zap'
    | 'sparkle'
    | 'clock'
    | 'edit'
    | 'trash'
    | 'refresh'
    | 'dots'
    | 'switch'
    | 'pin'
    | 'plus'
    | 'import'
    | 'folder'
    | 'restore'
    | 'settings'
    | 'copy'
    | 'alert'
    | 'close'
    | 'lock'
    | 'bell'
    | 'login'
    | 'arrow-left'
    | 'check'
    | 'external';

  interface Props {
    name: IconName;
    size?: number;
    class?: string;
  }

  let { name, size = 14, class: className = '' }: Props = $props();
</script>

<svg
  class="icon {className}"
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  aria-hidden="true"
>
  {#if name === 'zap'}
    <path
      d="M8.5 1.5L2.5 9h5l-1 5.5L13.5 7h-5l1-5.5z"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
    />
  {:else if name === 'sparkle'}
    <path
      d="M8 1.5C8 4.8 5.2 7.5 2 8c3.2.5 6 3.2 6 6.5.5-3.3 3.2-6 6.5-6.5-3.3-.5-6-3.2-6-6.5z"
      fill="currentColor"
    />
  {:else if name === 'clock'}
    <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3" fill="none" />
    <path
      d="M8 4.5v3.8l2.5 1.5"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      fill="none"
    />
  {:else if name === 'edit'}
    <path
      d="M11.5 2.2a1.4 1.4 0 0 1 2 2L5 12.7l-3.2.8.8-3.2L11.5 2.2z"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
    />
  {:else if name === 'trash'}
    <path
      d="M2.5 4.5h11M6 4.5v-2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2M4 4.5l.8 8.8a1.2 1.2 0 0 0 1.2 1.2h4a1.2 1.2 0 0 0 1.2-1.2l.8-8.8"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
    />
  {:else if name === 'refresh'}
    <path
      d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9M13.5 8a5.5 5.5 0 0 1-9.4 3.9"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      fill="none"
    />
    <polyline
      points="12 1.5 12 4.5 15 4.5"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
    />
    <polyline
      points="4 14.5 4 11.5 1 11.5"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
    />
  {:else if name === 'dots'}
    <circle cx="8" cy="3.5" r="1.2" fill="currentColor" />
    <circle cx="8" cy="8" r="1.2" fill="currentColor" />
    <circle cx="8" cy="12.5" r="1.2" fill="currentColor" />
  {:else if name === 'switch'}
    <path
      d="M2.5 5.5h10M9.5 2.5l3 3-3 3"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
    />
    <path
      d="M13.5 10.5h-10M6.5 13.5l-3-3 3-3"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
    />
  {:else if name === 'pin'}
    <path
      d="M9.8 2.2a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4L11.5 8.5l-.7-.7-3.5 3.5v3.2l-1 1-.7-.7v-3.5l-3.5-3.5-.7.7L1.4 8.3a1 1 0 0 1 0-1.4l2.6-2.6a1 1 0 0 1 1.4 0l2.3 2.3 2.1-4.4z"
      stroke="currentColor"
      stroke-width="1.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
    />
  {:else if name === 'plus'}
    <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none" />
  {:else if name === 'import'}
    <path
      d="M8 2.5v8M5 7.5l3 3 3-3"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
    />
    <path d="M2.5 13.5h11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none" />
  {:else if name === 'folder'}
    <path
      d="M2 3.5a1 1 0 0 1 1-1h3.5l1.5 2H13a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-9z"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linejoin="round"
      fill="none"
    />
  {:else if name === 'restore'}
    <path
      d="M3 6.5h5a4.5 4.5 0 1 1-1.3 6.3"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      fill="none"
    />
    <polyline
      points="5.5 3.5 2.5 6.5 5.5 9.5"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
    />
  {:else if name === 'settings'}
    <circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.2" fill="none" />
    <path
      d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      fill="none"
    />
  {:else if name === 'copy'}
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.25" fill="none" />
    <path
      d="M3.5 10.5h-1a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v1"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="round"
      fill="none"
    />
  {:else if name === 'alert'}
    <path
      d="M8 2l6 11H2L8 2z"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
    />
    <path d="M8 6.5v3M8 11.5h.01" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none" />
  {:else if name === 'close'}
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none" />
  {:else if name === 'lock'}
    <rect x="3.5" y="7" width="9" height="7" rx="1.5" stroke="currentColor" stroke-width="1.3" fill="none" />
    <path
      d="M5.5 7V4.5a2.5 2.5 0 0 1 5 0V7"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      fill="none"
    />
  {:else if name === 'bell'}
    <path
      d="M4 11.5c0-.8.6-2.5 1-4a3 3 0 1 1 6 0c.4 1.5 1 3.2 1 4H4z"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linejoin="round"
      fill="none"
    />
    <path d="M6.5 13.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none" />
  {:else if name === 'login'}
    <path
      d="M6.5 2.5H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3.5"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      fill="none"
    />
    <path
      d="M10.5 11.5l3.5-3.5-3.5-3.5M14 8H5.5"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
    />
  {:else if name === 'arrow-left'}
    <path
      d="M10 3.5L5.5 8l4.5 4.5"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
    />
  {:else if name === 'check'}
    <path
      d="M3.5 8.5l3 3 6-7"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
    />
  {:else if name === 'external'}
    <path
      d="M6 3.5H3.5a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1V10M9 3.5h3.5m0 0V7m0-3.5L7.5 8.5"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
    />
  {/if}
</svg>

<style>
  .icon {
    display: inline-block;
    vertical-align: middle;
    flex-shrink: 0;
  }
</style>
