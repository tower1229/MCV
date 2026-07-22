import type { OperationContract } from '../operations/contracts';

export function renderJson(contract: OperationContract): string {
  return JSON.stringify(contract, null, 2);
}

