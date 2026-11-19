-- 1. Per-org write-only Website Booking Key
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS booking_api_key text UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex');

UPDATE public.organizations
SET booking_api_key = encode(gen_random_bytes(24), 'hex')
WHERE booking_api_key IS NULL;

-- 2. Chauffeur V1 enquiry/booking fields on trips
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS pickup_time text,
  ADD COLUMN IF NOT EXISTS passengers integer,
  ADD COLUMN IF NOT EXISTS requested_vehicle_type text,
  ADD COLUMN IF NOT EXISTS notes text;

-- 3. Allow ENQUIRY status on trips
DO $$ DECLARE v_con text; BEGIN FOR v_con IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.trips'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '\%status\%' LOOP EXECUTE format('ALTER TABLE public.trips DROP CONSTRAINT \%I', v_con); END LOOP; END; $$;

ALTER TABLE public.trips
  ADD CONSTRAINT trips_status_check
  CHECK (status IN ('ENQUIRY', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'));

NOTIFY pgrst, 'reload schema';