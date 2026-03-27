export const SECRET_MASK_PLACEHOLDER = "********";

export function maskValue(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  return SECRET_MASK_PLACEHOLDER;
}
