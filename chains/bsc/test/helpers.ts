/** Returns three funded accounts, failing loudly if the network provides fewer. */
export function threeAccounts<T>(accounts: readonly T[]): [T, T, T] {
  const [first, second, third] = accounts;
  if (first === undefined || second === undefined || third === undefined) {
    throw new Error(`Expected at least 3 funded test accounts, found ${accounts.length}`);
  }
  return [first, second, third];
}
