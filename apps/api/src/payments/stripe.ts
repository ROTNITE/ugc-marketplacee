import Stripe from "stripe";
import type { ApiConfig } from "../config.js";

export class StripeService {
  private stripe: Stripe;
  private config: Pick<ApiConfig, "stripeSecretKey" | "stripeWebhookSecret">;

  constructor(config: Pick<ApiConfig, "stripeSecretKey" | "stripeWebhookSecret">) {
    this.config = config;
    this.stripe = new Stripe(config.stripeSecretKey, {
      apiVersion: "2026-04-22.dahlia"
    });
  }

  async createPaymentIntent(params: {
    amountCents: number;
    currency: string;
    metadata: Record<string, string>;
  }): Promise<Stripe.PaymentIntent> {
    return this.stripe.paymentIntents.create({
      amount: params.amountCents,
      currency: params.currency.toLowerCase(),
      metadata: params.metadata,
      automatic_payment_methods: {
        enabled: true
      }
    });
  }

  async confirmPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    return this.stripe.paymentIntents.confirm(paymentIntentId);
  }

  async retrievePaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    return this.stripe.paymentIntents.retrieve(paymentIntentId);
  }

  async cancelPaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    return this.stripe.paymentIntents.cancel(paymentIntentId);
  }

  async createPayout(params: {
    amountCents: number;
    currency: string;
    destination: string;
    metadata: Record<string, string>;
  }): Promise<Stripe.Payout> {
    return this.stripe.payouts.create({
      amount: params.amountCents,
      currency: params.currency.toLowerCase(),
      destination: params.destination,
      metadata: params.metadata
    });
  }

  async constructWebhookEvent(
    payload: string | Buffer,
    signature: string
  ): Promise<Stripe.Event> {
    return this.stripe.webhooks.constructEvent(
      payload,
      signature,
      this.config.stripeWebhookSecret
    );
  }

  async refundPayment(params: {
    paymentIntentId: string;
    amountCents?: number;
    reason?: string;
  }): Promise<Stripe.Refund> {
    return this.stripe.refunds.create({
      payment_intent: params.paymentIntentId,
      amount: params.amountCents,
      reason: params.reason as Stripe.RefundCreateParams.Reason
    });
  }
}
