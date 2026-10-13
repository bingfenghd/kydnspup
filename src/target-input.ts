export function normalizeTargetInput(value: string) {
  return value.normalize("NFKC").replace(/。/g, ".");
}
