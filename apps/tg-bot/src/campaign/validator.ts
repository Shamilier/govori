const E164_REGEX = /^\+[1-9]\d{7,14}$/;

export type ValidationResult = {
  valid: string[];
  invalid: string[];
};

export function parseAndValidatePhones(input: string): ValidationResult {
  const candidates = input
    .split(/[\s,;]+/g)
    .map((value) => sanitizePhone(value))
    .filter(Boolean);

  const unique = Array.from(new Set(candidates));

  const valid: string[] = [];
  const invalid: string[] = [];

  for (const phone of unique) {
    if (isE164(phone)) {
      valid.push(phone);
    } else {
      invalid.push(phone);
    }
  }

  return { valid, invalid };
}

export function isE164(phone: string): boolean {
  return E164_REGEX.test(phone);
}

function sanitizePhone(value: string): string {
  return value.trim().replace(/[()\-\u00a0]/g, "");
}
