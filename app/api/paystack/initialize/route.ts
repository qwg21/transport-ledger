import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type InitBody = {
  orgId?: string;
  plan?: string;
  months?: number;
  promoCode?: string;
};

const VALID_PLANS = new Set(['STARTER', 'ESSENTIAL', 'GROWTH', 'INTELLIGENCE', 'ENTERPRISE']);

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey || !paystackSecret) {
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

  if (userError || !user || !user.email) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const body = (await req.json()) as InitBody;
  const orgId = body.orgId?.trim();
  const plan = body.plan?.trim().toUpperCase();
  const months = Number(body.months || 1);

  if (!orgId || !plan || !VALID_PLANS.has(plan) || ![1, 3, 12].includes(months)) {
    return NextResponse.json({ error: 'Invalid organization, plan, or billing period.' }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Verify user belongs to this organization
  const { data: member } = await adminClient
    .from('organization_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!member) {
    return NextResponse.json({ error: 'You do not have access to this workspace.' }, { status: 403 });
  }

  const { data: priceRow, error: priceErr } = await adminClient
    .from('plan_pricing')
    .select('*')
    .eq('plan', plan)
    .maybeSingle();

  if (priceErr || !priceRow) {
    return NextResponse.json({ error: 'Selected plan pricing not found.' }, { status: 404 });
  }

  const now = new Date();
  const promoActive =
    priceRow.promo_price_kes !== null &&
    Number(priceRow.promo_price_kes) > 0 &&
    (!priceRow.promo_ends_at || new Date(priceRow.promo_ends_at) > now);

  const monthlyKes = promoActive
    ? Number(priceRow.promo_price_kes)
    : Number(priceRow.monthly_price_kes);

  let totalKes = monthlyKes * months;
  if (months === 12 && Number(priceRow.annual_discount_pct || 0) > 0) {
    totalKes = Math.round(totalKes * (1 - Number(priceRow.annual_discount_pct) / 100));
  }

  let appliedPromoCode: string | null = null;
  let bonusDays = 0;

  if (body.promoCode?.trim()) {
    const code = body.promoCode.trim().toUpperCase();
    const { data: promo } = await adminClient
      .from('promo_codes')
      .select('*')
      .eq('code', code)
      .eq('is_active', true)
      .maybeSingle();

    if (!promo) {
      return NextResponse.json({ error: `Promo code "${code}" is invalid or inactive.` }, { status: 400 });
    }
    if (promo.valid_until && new Date(promo.valid_until) < now) {
      return NextResponse.json({ error: `Promo code "${code}" has expired.` }, { status: 400 });
    }
    if (promo.max_uses !== null && Number(promo.used_count) >= Number(promo.max_uses)) {
      return NextResponse.json({ error: `Promo code "${code}" has reached its usage limit.` }, { status: 400 });
    }
    if (promo.applicable_plan && promo.applicable_plan !== plan) {
      return NextResponse.json({ error: `Promo code "${code}" only applies to ${promo.applicable_plan}.` }, { status: 400 });
    }

    appliedPromoCode = code;
    if (promo.discount_type === 'PERCENT') {
      totalKes = Math.max(100, Math.round(totalKes * (1 - Number(promo.discount_value) / 100)));
    } else if (promo.discount_type === 'FIXED_KES') {
      totalKes = Math.max(100, Math.round(totalKes - Number(promo.discount_value)));
    } else if (promo.discount_type === 'BONUS_DAYS') {
      bonusDays = Number(promo.discount_value);
    }
  }

  const reference = `BL-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

  const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${paystackSecret}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: user.email,
      amount: Math.round(totalKes * 100),
      currency: 'KES',
      reference,
      callback_url: `${req.nextUrl.origin}/`,
      channels: ['mobile_money', 'card', 'bank_transfer'],
      metadata: {
        org_id: orgId,
        plan,
        months,
        promo_code: appliedPromoCode,
        bonus_days: bonusDays,
        user_id: user.id
      }
    })
  });

  const paystackJson = (await paystackRes.json()) as {
    status?: boolean;
    message?: string;
    data?: { authorization_url?: string; reference?: string };
  };

  if (!paystackRes.ok || !paystackJson.status || !paystackJson.data?.authorization_url) {
    return NextResponse.json(
      { error: paystackJson.message || 'Could not initialize Paystack checkout.' },
      { status: 502 }
    );
  }

  return NextResponse.json({
    authorization_url: paystackJson.data.authorization_url,
    reference: paystackJson.data.reference || reference,
    amount_kes: totalKes
  });
}