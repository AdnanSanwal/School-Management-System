/** Defence in depth for old audit records: credentials must never reach the viewer. */
export function safeAuditMeta(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[nested data omitted]';
  if (Array.isArray(value)) return value.map(v => safeAuditMeta(v, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key,
    /password|secret|token|authorization|cookie|otp|mfa|credential|privatekey|api.?key/i.test(key) ? '[redacted]' : safeAuditMeta(v, depth + 1),
  ]));
}

export function auditKind(row: { entity: string; action: string }): 'activity' | 'request' | 'security' {
  return row.entity === 'auth' ? 'security' : row.action.includes(' /') ? 'request' : 'activity';
}
