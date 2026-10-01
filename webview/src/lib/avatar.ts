/**
 * Color generation from email hash — deterministic avatar color.
 */
const PALETTE = [
  '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd',
  '#56b6c2', '#d19a66', '#be5046', '#7ec699', '#f08d49',
  '#cc99cd', '#67cdcc', '#f7c46c', '#e57373', '#81c784',
];

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function avatarColor(email: string): string {
  return PALETTE[hashCode(email) % PALETTE.length];
}

export function avatarInitial(email: string): string {
  return (email[0] || '?').toUpperCase();
}
