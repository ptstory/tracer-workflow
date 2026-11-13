export function formatCheckDiagnostic(expected: string, found: string, action: string): string {
  return `Expected: ${expected}; found: ${found}; action: ${action}`;
}
