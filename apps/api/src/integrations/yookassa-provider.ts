import { logger } from "../observability/logger.js";

/**
 * Minimal YooKassa adapter for the RU market. Activates when both
 * YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY are present.
 *
 * Plugs into the existing PaymentService alongside Stripe. The PaymentService
 * is not refactored here; this adapter exposes the two endpoints the
 * escrow flow actually needs: createPayment + capture.
 */
export type YooKassaPayment = {
  id: string;
  status: "pending" | "succeeded" | "canceled";
  amount: { value: string; currency: string };
  confirmationUrl: string | null;
};

export type YooKassaProvider = {
  createPayment(input: {
    amountRub: number;
    description: string;
    returnUrl: string;
    idempotenceKey: string;
  }): Promise<YooKassaPayment>;
  capturePayment(paymentId: string, idempotenceKey: string): Promise<YooKassaPayment>;
};

export class HttpYooKassaProvider implements YooKassaProvider {
  constructor(
    private readonly shopId: string,
    private readonly secretKey: string,
    private readonly baseUrl = "https://api.yookassa.ru/v3"
  ) {}

  async createPayment(input: {
    amountRub: number;
    description: string;
    returnUrl: string;
    idempotenceKey: string;
  }): Promise<YooKassaPayment> {
    const response = await fetch(`${this.baseUrl}/payments`, {
      method: "POST",
      headers: {
        Authorization: this.basicAuth(),
        "Content-Type": "application/json",
        "Idempotence-Key": input.idempotenceKey
      },
      body: JSON.stringify({
        amount: { value: input.amountRub.toFixed(2), currency: "RUB" },
        confirmation: { type: "redirect", return_url: input.returnUrl },
        capture: false,
        description: input.description
      })
    });
    return this.parse(response, "createPayment");
  }

  async capturePayment(
    paymentId: string,
    idempotenceKey: string
  ): Promise<YooKassaPayment> {
    const response = await fetch(`${this.baseUrl}/payments/${paymentId}/capture`, {
      method: "POST",
      headers: {
        Authorization: this.basicAuth(),
        "Content-Type": "application/json",
        "Idempotence-Key": idempotenceKey
      },
      body: "{}"
    });
    return this.parse(response, "capturePayment");
  }

  private basicAuth(): string {
    return `Basic ${Buffer.from(`${this.shopId}:${this.secretKey}`).toString("base64")}`;
  }

  private async parse(response: Response, op: string): Promise<YooKassaPayment> {
    if (!response.ok) {
      logger.error({ status: response.status, op }, "yookassa request failed");
      throw new Error(`YooKassa ${op} failed: ${response.status}`);
    }
    const raw = (await response.json()) as {
      id: string;
      status: YooKassaPayment["status"];
      amount: YooKassaPayment["amount"];
      confirmation?: { confirmation_url?: string };
    };
    return {
      id: raw.id,
      status: raw.status,
      amount: raw.amount,
      confirmationUrl: raw.confirmation?.confirmation_url ?? null
    };
  }
}
