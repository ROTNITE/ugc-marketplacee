# Payment & Escrow MVP

Sandbox ledger for per-match escrow. This MVP does not charge cards or send real
bank payouts. Stripe code remains available for a future provider adapter, but the
active product flow is internal ledger only.

## Flow

1. Brand funds a matched creator with `POST /payments/escrow/fund`.
2. Creator submits one deliverable URL with `POST /deliverables`.
3. Brand releases or refunds the held escrow.
4. Release credits creator balance minus platform commission.
5. Creator can request a sandbox payout from available balance.

## Endpoints

### GET /payments/balance

Returns available balance, pending balance, total earned, and total withdrawn.

### GET /payments/transactions?limit=50&offset=0

Returns only the current user's transactions.

### POST /payments/escrow/fund

```json
{
  "matchId": "uuid",
  "amountCents": 50000
}
```

Creates a completed sandbox deposit and a held escrow for that match.

### GET /payments/escrow/match/:matchId

Returns the current escrow state for a match. Only match participants can read it.

### POST /deliverables

```json
{
  "matchId": "uuid",
  "url": "https://example.com/final.mp4",
  "note": "Ready for review"
}
```

Creator-only. Upserts the current deliverable and marks it `submitted`.

### GET /deliverables/match/:matchId

Returns the current deliverable for a match. Only match participants can read it.

### POST /payments/escrow/release

```json
{
  "escrowHoldId": "uuid"
}
```

Brand-only. Requires a held escrow and a submitted deliverable. Credits the creator
with `amountCents - commissionCents`.

### POST /payments/escrow/refund

```json
{
  "escrowHoldId": "uuid",
  "reason": "Cancelled"
}
```

Brand-only. Marks escrow refunded and rejects the deliverable if one exists.

### POST /payments/payout

```json
{
  "amountCents": 10000
}
```

Current-user payout from available balance. In MVP this completes immediately in the
sandbox ledger.
