import { createClient } from '@supabase/supabase-js';

export type PaystackMetadata = {
  org_id?: string;
  plan?: string;
  months?: number | string;
  promo_code?: string | null;
  bonus_days?: number | string;
};

export async function recordPaystackSubscriptionPayment(params: {
  reference: string;
  amountKes: number;
  channel: string | null;
  metadata: PaystackMetadata;
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase server configuration missing.');
  }

  const orgId = params.metadata.org_id;
  const plan = params.metadata.plan;
  const months = Number(params.metadata.months || 1);
  const bonusDays = Number(params.metadata.bonus_days || 0);
  const promoCode = params.metadata.promo_code?.trim().toUpperCase() || null;

  if (!orgId || !plan || !Number.isFinite(months) || months <= 0) {
    throw new Error('Missing Paystack subscription metadata.');
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Idempotency check: skip if already recorded
  const { data: existing } = await adminClient
    .from('subscription_payments')
    .select('id, status')
    .eq('reference', params.reference)
    .maybeSingle();

  if (existing?.status === 'SUCCESS') {
    return { alreadyProcessed: true, orgId, plan, months };
  }

  const { error: insertErr } = await adminClient.from('subscription_payments').insert({
    org_id: orgId,
    reference: params.reference,
    plan,
    months,
    amount_kes: params.amountKes,
    channel: params.channel,
    status: 'SUCCESS'
  });

  if (insertErr) {
    throw new Error(insertErr.message);
  }

  const { data: currentSub } = await adminClient
    .from('subscriptions')
    .select('current_period_end')
    .eq('org_id', orgId)
    .maybeSingle();

  const today = new Date();
  const baseDate =
    currentSub?.current_period_end && new Date(currentSub.current_period_end) > today
      ? new Date(currentSub.current_period_end)
      : today;

  baseDate.setMonth(baseDate.getMonth() + months);
  if (bonusDays > 0) {
    baseDate.setDate(baseDate.getDate() + bonusDays);
  }
  const nextPeriodEnd = baseDate.toISOString().slice(0, 10);

  const { error: subErr } = await adminClient
    .from('subscriptions')
    .update({
      plan,
      status: 'ACTIVE',
      current_period_end: nextPeriodEnd
    })
    .eq('org_id', orgId);

  if (subErr) {
    throw new Error(subErr.message);
  }

  if (promoCode) {
    const { data: promoRow } = await adminClient
      .from('promo_codes')
      .select('id, used_count')
      .eq('code', promoCode)
      .maybeSingle();
    if (promoRow) {
      await adminClient
        .from('promo_codes')
        .update({ used_count: Number(promoRow.used_count || 0) + 1 })
        .eq('id', promoRow.id);
    }
  }

  return { alreadyProcessed: false, orgId, plan, months, current_period_end: nextPeriodEnd };
}