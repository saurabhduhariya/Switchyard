<script lang="ts">
  import { sparklineGeometry } from '../lib/trend';
  import { quotaTone } from '../lib/tier';

  interface Props {
    /** Remaining % over time, oldest first. */
    points: number[];
    width?: number;
    height?: number;
    /** Spoken description; the picture alone says nothing to a screen reader. */
    label: string;
  }

  let { points, width = 64, height = 18, label }: Props = $props();

  let geometry = $derived(sparklineGeometry(points, width, height));
  let tone = $derived(quotaTone(points[points.length - 1]));
</script>

{#if geometry}
  <svg
    class="spark tone-{tone}"
    viewBox="0 0 {width} {height}"
    {width}
    {height}
    role="img"
    aria-label={label}
  >
    <title>{label}</title>
    <polyline class="line" points={geometry.line} fill="none" />
    <circle class="end" cx={geometry.end.x} cy={geometry.end.y} r="1.8" />
  </svg>
{/if}

<style>
  .spark {
    flex: none;
    overflow: visible;
  }

  .line {
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linejoin: round;
    stroke-linecap: round;
    opacity: 0.85;
  }

  .end {
    fill: currentColor;
  }

  .tone-good {
    color: var(--vscode-testing-iconPassed, #73c991);
  }

  .tone-warn {
    color: var(--vscode-editorWarning-foreground, #cca700);
  }

  .tone-low {
    color: var(--vscode-errorForeground, #f14c4c);
  }

  .tone-unknown {
    color: var(--vscode-descriptionForeground, #8c8c8c);
  }
</style>
