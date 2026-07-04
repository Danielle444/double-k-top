// Shows only the last 4 digits of a student's teudat-zehut in admin views;
// the full number is still available in the edit form for corrections.
export function maskIdentityNumber(identityNumber: string): string {
  const last4 = identityNumber.slice(-4);
  return `${"•".repeat(Math.max(0, identityNumber.length - 4))}${last4}`;
}
