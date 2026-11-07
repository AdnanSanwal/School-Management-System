import crypto from 'crypto';
import type { Request } from 'express';

/**
 * Online payment gateways (JazzCash, Easypaisa, …) plug in here.
 *
 * Flow: the parent app creates a PaymentIntent → the gateway gives a checkout URL
 * → the parent pays on the gateway's page → the gateway calls our callback →
 * we verify it and record the payment (receipt) exactly once.
 *
 * To add a real provider: implement `PaymentGateway` (createCheckout builds the
 * provider's signed redirect/form; parseCallback verifies the provider's signature
 * with the merchant secret), register it below, and set PAYMENT_GATEWAY=<name>
 * plus the merchant credentials. Only the built-in `test` gateway exists today.
 */
export interface CheckoutInput {
  intentId: string;
  amount: string; // decimal string
  currency: string;
  description: string;
  returnUrl: string;
}

export interface CallbackResult {
  intentId: string;
  success: boolean;
  providerRef: string | null;
  error?: string;
}

export interface PaymentGateway {
  name: string;
  label: string;
  createCheckout(input: CheckoutInput): Promise<{ checkoutUrl: string }>;
  /** Returns null when the callback's signature does not verify. */
  parseCallback(req: Request): Promise<CallbackResult | null>;
}

function base() {
  return (process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, '');
}

function hmac(value: string) {
  const key = process.env.PAYMENT_GATEWAY_SECRET || process.env.JWT_SECRET;
  if (!key) throw new Error('PAYMENT_GATEWAY_SECRET or JWT_SECRET must be set');
  return crypto.createHmac('sha256', key).update(value).digest('base64url');
}

export function testGatewaySign(intentId: string, result: string) {
  return hmac(`test-gateway|${intentId}|${result}`);
}

/**
 * Simulated checkout for development and automated tests — never enabled in production.
 * Its checkout page lets you press "Pay" or "Cancel" and posts a signed callback.
 */
export const testGateway: PaymentGateway = {
  name: 'test',
  label: 'Test gateway (no real money)',
  async createCheckout({ intentId }) {
    return { checkoutUrl: `${base()}/api/v1/payments/gateway/test/checkout/${intentId}?sig=${testGatewaySign(intentId, 'view')}` };
  },
  async parseCallback(req) {
    const { intentId, result, sig } = req.body as Record<string, string>;
    if (!intentId || !['paid', 'cancelled'].includes(result) || !sig) return null;
    const expected = Buffer.from(testGatewaySign(intentId, result));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    return {
      intentId,
      success: result === 'paid',
      providerRef: result === 'paid' ? `TEST-${crypto.randomBytes(5).toString('hex').toUpperCase()}` : null,
      error: result === 'paid' ? undefined : 'Cancelled by payer',
    };
  },
};

const REGISTRY: Record<string, PaymentGateway> = { test: testGateway };

/** The configured gateway, or null when online checkout is off. */
export function activeGateway(): PaymentGateway | null {
  const name = process.env.PAYMENT_GATEWAY;
  if (!name) return null;
  if (name === 'test' && process.env.NODE_ENV === 'production') return null;
  return REGISTRY[name] ?? null;
}
