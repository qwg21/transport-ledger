import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { recordPaystackSubscriptionPayment, type PaystackMetadata } from '@/lib/paystack';

export async function POST(req: NextRequest) {
  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  if (!paystackSecret) {
    return NextResponse.json({ error: 'Webhook secret not configured.' }, { status: 500 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get('x-paystack-signature') || '';
  const expected = crypto.createHmac('sha512', paystackSecret).update(rawBody).digest('hex');

  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return NextResponse.json({ error: 'Invalid Paystack signature.' }, { status: 401 });
  }

  const payload = JSON.parse(rawBody) as {
    event?: string;
    data?: {
      reference?: string;
      amount?: number;
      channel?: string | null;
      metadata?: PaystackMetadata;
    };
  };

  if (payload.event === 'charge.success' && payload.data?.reference) {
    await recordPaystackSubscriptionPayment({
      reference: payload.data.reference,
      amountKes: Math.round(Number(payload.data.amount || 0) / 100),
      channel: payload.data.channel ?? null,
      metadata: payload.data.metadata ?? {}
    });
  }

  return NextResponse.json({ received: true });
}