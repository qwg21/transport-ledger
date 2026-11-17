import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { recordPaystackSubscriptionPayment, type PaystackMetadata } from '@/lib/paystack';

export async function GET(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !paystackSecret) {
    return NextResponse.json({ error: 'Payment server configuration missing.' }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: 'Missing authorization token.' }, { status: 401 });
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const {
    data: { user },
    error: userError
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const reference = req.nextUrl.searchParams.get('reference')?.trim();
  if (!reference) {
    return NextResponse.json({ error: 'Missing transaction reference.' }, { status: 400 });
  }

  const verifyRes = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${paystackSecret}` } }
  );

  const verifyJson = (await verifyRes.json()) as {
    status?: boolean;
    message?: string;
    data?: {
      status?: string;
      reference?: string;
      amount?: number;
      channel?: string | null;
      metadata?: PaystackMetadata;
    };
  };

  if (!verifyRes.ok || !verifyJson.status || verifyJson.data?.status !== 'success') {
    return NextResponse.json(
      { error: verifyJson.message || 'Payment has not been completed.' },
      { status: 400 }
    );
  }

  const result = await recordPaystackSubscriptionPayment({
    reference: verifyJson.data.reference || reference,
    amountKes: Math.round(Number(verifyJson.data.amount || 0) / 100),
    channel: verifyJson.data.channel ?? null,
    metadata: verifyJson.data.metadata ?? {}
  });

  return NextResponse.json({ verified: true, ...result });
}