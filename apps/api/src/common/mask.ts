export function maskValue(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  if (value.length <= 4) {
    return "****";
  }
  return `${value.slice(0, 2)}********${value.slice(-2)}`;
}

export const SECRET_MASK_PLACEHOLDER = "********";
