export function renderJson(contract: unknown): string {
  return JSON.stringify(contract, null, 2);
}
