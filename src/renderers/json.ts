export function renderJson(contract: unknown): string {
  return JSON.stringify(contract, null, 2);
}

export function presentJson(contract: unknown): void {
  console.log(renderJson(contract));
}
