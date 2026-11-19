import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type BookingBody = {
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
  origin?: string;
  destination?: string;
  pickupDate?: string;
  pickupTime?: string;
  vehicleType?: string;
  passengers?: number;
  agreedFare?: number;
  notes?: string;
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-booking-key'
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Server configuration missing.' }, { status: 500, headers: CORS_HEADERS });
  }

  const bookingKey = req.headers.get('x-booking-key')?.trim();
  if (!bookingKey) {
    return NextResponse.json({ error: 'Missing x-booking-key header.' }, { status: 401, headers: CORS_HEADERS });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: org } = await admin
    .from('organizations')
    .select('id, name')
    .eq('booking_api_key', bookingKey)
    .maybeSingle();

  if (!org) {
    return NextResponse.json({ error: 'Invalid booking key.' }, { status: 401, headers: CORS_HEADERS });
  }

  const { data: sub } = await admin
    .from('subscriptions')
    .select('status, current_period_end, transport_addon, enabled_modules')
    .eq('org_id', org.id)
    .maybeSingle();

  const today = new Date().toISOString().slice(0, 10);
  const hasTransport = Boolean(sub?.transport_addon || sub?.enabled_modules?.includes('TRANSPORT'));
  const isActive = Boolean(
    sub && sub.status !== 'SUSPENDED' && sub.status !== 'CANCELLED' && sub.current_period_end >= today
  );

  if (!hasTransport || !isActive) {
    return NextResponse.json(
      { error: 'Transport module is not active for this business.' },
      { status: 403, headers: CORS_HEADERS }
    );
  }

  const body = (await req.json()) as BookingBody;
  const clientName = body.clientName?.trim();
  const origin = body.origin?.trim();
  const destination = body.destination?.trim();
  const pickupDate = body.pickupDate?.trim() || today;

  if (!clientName || !origin || !destination) {
    return NextResponse.json(
      { error: 'clientName, origin, and destination are required.' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const { data: existingCust } = await admin
    .from('customers')
    .select('id')
    .eq('org_id', org.id)
    .ilike('name', clientName)
    .limit(1)
    .maybeSingle();

  let customerId = existingCust?.id ?? null;
  if (!customerId) {
    const { data: newCust } = await admin
      .from('customers')
      .insert({
        org_id: org.id,
        name: clientName,
        phone: body.clientPhone?.trim() || null,
        email: body.clientEmail?.trim() || null
      })
      .select('id')
      .single();
    customerId = newCust?.id ?? null;
  }

  const tripCode = `WEB-${pickupDate.replace(/-/g, '')}-${Math.floor(100 + Math.random() * 900)}`;

  const { data: trip, error: tripErr } = await admin
    .from('trips')
    .insert({
      org_id: org.id,
      trip_code: tripCode,
      trip_date: pickupDate,
      customer_id: customerId,
      client_name: clientName,
      origin,
      destination,
      agreed_fare: Number(body.agreedFare || 0),
      status: 'ENQUIRY',
      source: 'WEBSITE',
      pickup_time: body.pickupTime?.trim() || null,
      passengers: body.passengers ? Number(body.passengers) : null,
      requested_vehicle_type: body.vehicleType?.trim() || null,
      notes: body.notes?.trim() || null
    })
    .select('id, trip_code, status')
    .single();

  if (tripErr || !trip) {
    return NextResponse.json(
      { error: tripErr?.message || 'Could not save booking.' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  return NextResponse.json(
    { ok: true, booking_id: trip.id, trip_code: trip.trip_code, status: trip.status },
    { status: 201, headers: CORS_HEADERS }
  );
}