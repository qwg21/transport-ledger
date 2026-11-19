'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { buildDocNumber, explainDbError, todayLocal } from '@/lib/documents';
import type { Customer, DocumentRecord } from '@/lib/types';
import {
  Truck,
  Users,
  MapPin,
  Fuel,
  AlertTriangle,
  FileText,
  Eye,
  Download,
  Share2,
  Receipt
} from 'lucide-react';

export interface Vehicle {
  id: string;
  registration_no: string;
  make_model: string;
  vehicle_type: string;
  capacity: number | null;
  status: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';
  current_odometer_km: number;
}

export interface Driver {
  id: string;
  full_name: string;
  phone: string | null;
  license_no: string | null;
  license_expiry: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface Trip {
  id: string;
  trip_code: string;
  trip_date: string;
  customer_id?: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  client_name: string;
  origin: string;
  destination: string;
  distance_km: number | null;
  agreed_fare: number;
  status: 'ENQUIRY' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  source?: string | null;
  pickup_time?: string | null;
  requested_vehicle_type?: string | null;
  quote_id?: string | null;
  invoice_id?: string | null;
}

export interface VehicleCost {
  id: string;
  cost_date: string;
  vehicle_id: string | null;
  trip_id: string | null;
  cost_type: 'FUEL' | 'MAINTENANCE' | 'TOLL' | 'DRIVER_ALLOWANCE' | 'INSURANCE' | 'OTHER';
  amount_kes: number;
  vendor: string | null;
  notes: string | null;
}

export type TransportTab = 'TRIPS' | 'FLEET' | 'DRIVERS' | 'COSTS';

type Props = {
  orgId: string;
  currency: string;
  customers: Customer[];
  docs: DocumentRecord[];
  isReadOnly: boolean;
  activeTab?: TransportTab;
  onTabChange?: (tab: TransportTab) => void;
  onDocCreated?: () => void;
  onPreviewPdf?: (item: DocumentRecord) => void;
  onDownloadPdf?: (item: DocumentRecord) => void;
  onSharePdf?: (item: DocumentRecord) => void;
  onOpenReceipt?: (item: DocumentRecord) => void;
};

function licenseAlertStatus(expiry: string | null): 'EXPIRED' | 'SOON' | 'OK' {
  if (!expiry) return 'OK';
  const today = todayLocal();
  if (expiry < today) return 'EXPIRED';
  const diffDays = (new Date(expiry).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24);
  return diffDays <= 30 ? 'SOON' : 'OK';
}

export default function TransportSection({
  orgId,
  currency,
  customers,
  docs,
  isReadOnly,
  activeTab,
  onTabChange,
  onDocCreated,
  onPreviewPdf,
  onDownloadPdf,
  onSharePdf,
  onOpenReceipt
}: Props) {
  const [internalTab, setInternalTab] = useState<TransportTab>('TRIPS');
  const tab = activeTab ?? internalTab;
  const setTab = (next: TransportTab) => {
    setInternalTab(next);
    onTabChange?.(next);
  };

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [costs, setCosts] = useState<VehicleCost[]>([]);
  const [billingTripId, setBillingTripId] = useState<string | null>(null);
  const [bookingKey, setBookingKey] = useState<string | null>(null);
  const [showWebhookInfo, setShowWebhookInfo] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Vehicle form
  const [regNo, setRegNo] = useState('');
  const [makeModel, setMakeModel] = useState('');
  const [vehicleType, setVehicleType] = useState('MPV');
  const [capacity, setCapacity] = useState('7');

  // Driver form
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [licenseNo, setLicenseNo] = useState('');
  const [licenseExpiry, setLicenseExpiry] = useState('');

  // Trip form (matches shared public.customers schema)
  const [tripDate, setTripDate] = useState(todayLocal);
  const [selectedCustomerId, setSelectedCustomerId] = useState('NEW');
  const [tripClient, setTripClient] = useState('');
  const [tripClientCompany, setTripClientCompany] = useState('');
  const [tripClientPhone, setTripClientPhone] = useState('');
  const [tripClientEmail, setTripClientEmail] = useState('');
  const [tripClientKraPin, setTripClientKraPin] = useState('');
  const [tripOrigin, setTripOrigin] = useState('');
  const [tripDest, setTripDest] = useState('');
  const [tripVehicleId, setTripVehicleId] = useState('');
  const [tripDriverId, setTripDriverId] = useState('');
  const [tripFare, setTripFare] = useState('');

  // Cost form
  const [costDate, setCostDate] = useState(todayLocal);
  const [costVehicleId, setCostVehicleId] = useState('');
  const [costTripId, setCostTripId] = useState('');
  const [costType, setCostType] = useState<VehicleCost['cost_type']>('FUEL');
  const [costAmount, setCostAmount] = useState('');
  const [costVendor, setCostVendor] = useState('');

  const loadData = useCallback(async () => {
    const [vRes, dRes, tRes, cRes] = await Promise.all([
      supabase.from('vehicles').select('*').eq('org_id', orgId).order('registration_no'),
      supabase.from('drivers').select('*').eq('org_id', orgId).order('full_name'),
      supabase.from('trips').select('*').eq('org_id', orgId).order('trip_date', { ascending: false }).limit(50),
      supabase.from('vehicle_costs').select('*').eq('org_id', orgId).order('cost_date', { ascending: false }).limit(50)
    ]);
    const { data: orgRow } = await supabase
      .from('organizations')
      .select('booking_api_key')
      .eq('id', orgId)
      .maybeSingle();
    setBookingKey((orgRow as { booking_api_key?: string | null } | null)?.booking_api_key ?? null);
    if (!vRes.error) setVehicles((vRes.data as Vehicle[] | null) ?? []);
    if (!dRes.error) setDrivers((dRes.data as Driver[] | null) ?? []);
    if (!tRes.error) setTrips((tRes.data as Trip[] | null) ?? []);
    if (!cRes.error) setCosts((cRes.data as VehicleCost[] | null) ?? []);
  }, [orgId]);

  useEffect(() => {
    let active = true;
    async function init() {
      const [vRes, dRes, tRes, cRes] = await Promise.all([
        supabase.from('vehicles').select('*').eq('org_id', orgId).order('registration_no'),
        supabase.from('drivers').select('*').eq('org_id', orgId).order('full_name'),
        supabase.from('trips').select('*').eq('org_id', orgId).order('trip_date', { ascending: false }).limit(50),
        supabase.from('vehicle_costs').select('*').eq('org_id', orgId).order('cost_date', { ascending: false }).limit(50)
      ]);
      const { data: orgRow } = await supabase
        .from('organizations')
        .select('booking_api_key')
        .eq('id', orgId)
        .maybeSingle();
      if (!active) return;
      setBookingKey((orgRow as { booking_api_key?: string | null } | null)?.booking_api_key ?? null);
      if (!vRes.error) setVehicles((vRes.data as Vehicle[] | null) ?? []);
      if (!dRes.error) setDrivers((dRes.data as Driver[] | null) ?? []);
      if (!tRes.error) setTrips((tRes.data as Trip[] | null) ?? []);
      if (!cRes.error) setCosts((cRes.data as VehicleCost[] | null) ?? []);
    }
    init();
    return () => {
      active = false;
    };
  }, [orgId]);

  const vehicleMap = useMemo(() => new Map(vehicles.map(v => [v.id, v])), [vehicles]);
  const driverMap = useMemo(() => new Map(drivers.map(d => [d.id, d])), [drivers]);
  const customerMap = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);
  const docMap = useMemo(() => new Map(docs.map(d => [d.id, d])), [docs]);

  const costByTrip = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of costs) {
      if (c.trip_id) map.set(c.trip_id, (map.get(c.trip_id) || 0) + Number(c.amount_kes));
    }
    return map;
  }, [costs]);

  const vehicleStats = useMemo(() => {
    const map = new Map<string, { revenue: number; costs: number; trips: number }>();
    for (const v of vehicles) map.set(v.id, { revenue: 0, costs: 0, trips: 0 });
    for (const t of trips) {
      if (t.status !== 'CANCELLED' && t.vehicle_id && map.has(t.vehicle_id)) {
        const cur = map.get(t.vehicle_id)!;
        cur.revenue += Number(t.agreed_fare);
        cur.trips += 1;
      }
    }
    for (const c of costs) {
      if (c.vehicle_id && map.has(c.vehicle_id)) {
        const cur = map.get(c.vehicle_id)!;
        cur.costs += Number(c.amount_kes);
      }
    }
    return map;
  }, [vehicles, trips, costs]);

  const kpis = useMemo(() => {
    const activeTrips = trips.filter(t => t.status !== 'CANCELLED');
    const totalFares = activeTrips.reduce((s, t) => s + Number(t.agreed_fare), 0);
    const totalCosts = costs.reduce((s, c) => s + Number(c.amount_kes), 0);
    return {
      vehicles: vehicles.length,
      drivers: drivers.filter(d => d.status === 'ACTIVE').length,
      trips: activeTrips.length,
      totalFares,
      totalCosts,
      margin: totalFares - totalCosts
    };
  }, [vehicles, drivers, trips, costs]);

  const handleAddVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const { error } = await supabase.from('vehicles').insert({
      org_id: orgId,
      registration_no: regNo.trim().toUpperCase(),
      make_model: makeModel.trim(),
      vehicle_type: vehicleType,
      capacity: capacity ? Number(capacity) : null
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setRegNo('');
    setMakeModel('');
    loadData();
  };

  const handleVehicleStatus = async (vehicleId: string, status: Vehicle['status']) => {
    const { error } = await supabase.from('vehicles').update({ status }).eq('id', vehicleId);
    if (error) setErrorMsg(error.message);
    else loadData();
  };

  const handleAddDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const { error } = await supabase.from('drivers').insert({
      org_id: orgId,
      full_name: driverName.trim(),
      phone: driverPhone.trim() || null,
      license_no: licenseNo.trim() || null,
      license_expiry: licenseExpiry || null
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setDriverName('');
    setDriverPhone('');
    setLicenseNo('');
    setLicenseExpiry('');
    loadData();
  };

  const handleSelectCustomer = (customerId: string) => {
    setSelectedCustomerId(customerId);
    if (customerId === 'NEW') {
      setTripClient('');
      setTripClientCompany('');
      setTripClientPhone('');
      setTripClientEmail('');
      setTripClientKraPin('');
      return;
    }
    const found = customerMap.get(customerId);
    if (found) {
      setTripClient(found.name);
      setTripClientCompany(found.company_name ?? '');
      setTripClientPhone(found.phone ?? '');
      setTripClientEmail(found.email ?? '');
      setTripClientKraPin(found.kra_pin ?? '');
    }
  };

  const handleAddTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanName = tripClient.trim();
    if (!cleanName) {
      setErrorMsg('Enter or select a customer.');
      return;
    }

    let resolvedCustomerId: string | null = selectedCustomerId !== 'NEW' ? selectedCustomerId : null;
    if (!resolvedCustomerId) {
      const existing = customers.find(c => c.name.trim().toLowerCase() === cleanName.toLowerCase());
      if (existing) {
        resolvedCustomerId = existing.id;
      } else {
        const { data: createdCust, error: custErr } = await supabase
          .from('customers')
          .insert([
            {
              org_id: orgId,
              name: cleanName,
              company_name: tripClientCompany.trim() || null,
              phone: tripClientPhone.trim() || null,
              email: tripClientEmail.trim() || null,
              kra_pin: tripClientKraPin.trim() || null
            }
          ])
          .select('id')
          .single();
        if (custErr) {
          setErrorMsg(custErr.message);
          return;
        }
        resolvedCustomerId = createdCust?.id ?? null;
      }
    }

    const code = `TRP-${tripDate.replace(/-/g, '')}-${String(trips.length + 1).padStart(3, '0')}`;
    const { error } = await supabase.from('trips').insert({
      org_id: orgId,
      trip_code: code,
      trip_date: tripDate,
      customer_id: resolvedCustomerId,
      vehicle_id: tripVehicleId || null,
      driver_id: tripDriverId || null,
      client_name: cleanName,
      origin: tripOrigin.trim(),
      destination: tripDest.trim(),
      agreed_fare: Number(tripFare || 0)
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setSelectedCustomerId('NEW');
    setTripClient('');
    setTripClientCompany('');
    setTripClientPhone('');
    setTripClientEmail('');
    setTripClientKraPin('');
    setTripOrigin('');
    setTripDest('');
    setTripFare('');
    await loadData();
    onDocCreated?.();
  };

  const handleTripStatus = async (tripId: string, status: Trip['status']) => {
    const { error } = await supabase.from('trips').update({ status }).eq('id', tripId);
    if (error) setErrorMsg(error.message);
    else loadData();
  };

  const handleCreateTripDocument = async (trip: Trip, docType: 'QUOTE' | 'INVOICE') => {
    if (isReadOnly || billingTripId) return;
    const fare = Number(trip.agreed_fare || 0);
    if (fare <= 0) {
      setErrorMsg(`Set an agreed fare greater than 0 on ${trip.trip_code} before creating a ${docType.toLowerCase()}.`);
      return;
    }

    setBillingTripId(trip.id);
    setErrorMsg(null);
    try {
      const existingQuote = trip.quote_id ? docMap.get(trip.quote_id) : undefined;

      if (docType === 'INVOICE' && existingQuote) {
        const existingInv = docs.find(
          d => d.doc_type === 'INVOICE' && d.chain_code === existingQuote.chain_code && d.status !== 'VOID'
        );
        if (existingInv) {
          await supabase.from('trips').update({ invoice_id: existingInv.id }).eq('id', trip.id);
          await loadData();
          onDocCreated?.();
          return;
        }
      }

      const year = todayLocal().slice(0, 4);
      const chainCode =
        docType === 'INVOICE' && existingQuote
          ? existingQuote.chain_code
          : `${year}-${Math.floor(1000 + Math.random() * 9000)}`;
      const vehicle = trip.vehicle_id ? vehicleMap.get(trip.vehicle_id) : undefined;
      const customer =
        (trip.customer_id ? customerMap.get(trip.customer_id) : undefined) ??
        customers.find(c => c.name.trim().toLowerCase() === trip.client_name.trim().toLowerCase());

      const lineDesc = `Charter / Transfer (${trip.trip_code}): ${trip.origin} to ${trip.destination} on ${trip.trip_date}${
        vehicle ? ` [${vehicle.registration_no}]` : ''
      }`;

      const { data: newDoc, error } = await supabase
        .from('documents')
        .insert([
          {
            org_id: orgId,
            customer_id: customer?.id ?? trip.customer_id ?? null,
            doc_type: docType,
            chain_code: chainCode,
            doc_number: buildDocNumber(docType, chainCode),
            parent_id: docType === 'INVOICE' && existingQuote ? existingQuote.id : null,
            quote_ref: docType === 'INVOICE' && existingQuote ? existingQuote.doc_number : null,
            issue_date: todayLocal(),
            customer_name: customer?.name ?? trip.client_name,
            customer_phone: customer?.phone ?? null,
            customer_email: customer?.email ?? null,
            description: lineDesc,
            amount: fare,
            amount_paid: 0,
            status: docType === 'QUOTE' ? 'ACTIVE' : 'UNPAID'
          }
        ])
        .select('id')
        .single();

      if (error || !newDoc) {
        setErrorMsg(error ? explainDbError(error) : `Could not create ${docType.toLowerCase()}.`);
        return;
      }

      await supabase.from('document_items').insert([
        {
          org_id: orgId,
          document_id: newDoc.id,
          product_id: null,
          description: lineDesc,
          quantity: 1,
          unit_price: fare,
          line_total: fare
        }
      ]);

      if (docType === 'INVOICE' && existingQuote) {
        await supabase.from('documents').update({ status: 'CONVERTED' }).eq('id', existingQuote.id);
      }

      const tripPatch = docType === 'QUOTE' ? { quote_id: newDoc.id } : { invoice_id: newDoc.id };
      const { error: linkErr } = await supabase.from('trips').update(tripPatch).eq('id', trip.id);
      if (linkErr) {
        setErrorMsg(linkErr.message);
      }

      await loadData();
      onDocCreated?.();
    } finally {
      setBillingTripId(null);
    }
  };

  const handleAddCost = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const { error } = await supabase.from('vehicle_costs').insert({
      org_id: orgId,
      cost_date: costDate,
      vehicle_id: costVehicleId || null,
      trip_id: costTripId || null,
      cost_type: costType,
      amount_kes: Number(costAmount),
      vendor: costVendor.trim() || null
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setCostAmount('');
    setCostVendor('');
    loadData();
  };

  const renderTripBilling = (t: Trip) => {
    const quote = t.quote_id ? docMap.get(t.quote_id) : undefined;
    const invoice =
      (t.invoice_id ? docMap.get(t.invoice_id) : undefined) ??
      (quote
        ? docs.find(doc => doc.doc_type === 'INVOICE' && doc.chain_code === quote.chain_code && doc.status !== 'VOID')
        : undefined);
    const busy = billingTripId === t.id;

    if (invoice) {
      const receipts = docs.filter(
        doc => doc.doc_type === 'RECEIPT' && doc.chain_code === invoice.chain_code && doc.status !== 'VOID'
      );
      return (
        <div className="space-y-2">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 font-mono font-semibold text-slate-800">
                <FileText className="w-3 h-3 text-blue-600" />
                {invoice.doc_number}
              </span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  invoice.status === 'PAID'
                    ? 'bg-emerald-50 text-emerald-700'
                    : invoice.status === 'PARTIAL'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                {invoice.status}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {onPreviewPdf && (
                <button type="button" onClick={() => onPreviewPdf(invoice)} title="Preview Invoice PDF" className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg">
                  <Eye className="w-3.5 h-3.5" />
                </button>
              )}
              {onDownloadPdf && (
                <button type="button" onClick={() => onDownloadPdf(invoice)} title="Download Invoice PDF" className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg">
                  <Download className="w-3.5 h-3.5" />
                </button>
              )}
              {onSharePdf && (
                <button type="button" onClick={() => onSharePdf(invoice)} title="Share Invoice PDF" className="p-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg">
                  <Share2 className="w-3.5 h-3.5" />
                </button>
              )}
              {!isReadOnly && (invoice.status === 'UNPAID' || invoice.status === 'PARTIAL') && onOpenReceipt && (
                <button
                  type="button"
                  onClick={() => onOpenReceipt(invoice)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-semibold"
                >
                  <Receipt className="w-3 h-3" /> Receipt
                </button>
              )}
            </div>
          </div>

          {receipts.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-slate-100">
              {receipts.map(r => (
                <div key={r.id} className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 font-mono font-semibold text-emerald-700">
                    <Receipt className="w-3 h-3" />
                    {r.doc_number}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    ({currency} {Number(r.amount).toLocaleString()})
                  </span>
                  {onPreviewPdf && (
                    <button type="button" onClick={() => onPreviewPdf(r)} title="Preview Receipt PDF" className="p-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded">
                      <Eye className="w-3 h-3" />
                    </button>
                  )}
                  {onDownloadPdf && (
                    <button type="button" onClick={() => onDownloadPdf(r)} title="Download Receipt PDF" className="p-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded">
                      <Download className="w-3 h-3" />
                    </button>
                  )}
                  {onSharePdf && (
                    <button type="button" onClick={() => onSharePdf(r)} title="Share Receipt PDF" className="p-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded">
                      <Share2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (quote) {
      return (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-slate-700 font-semibold">{quote.doc_number}</span>
            {onPreviewPdf && (
              <button type="button" onClick={() => onPreviewPdf(quote)} title="Preview PDF" className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg">
                <Eye className="w-3.5 h-3.5" />
              </button>
            )}
            {onDownloadPdf && (
              <button type="button" onClick={() => onDownloadPdf(quote)} title="Download PDF" className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg">
                <Download className="w-3.5 h-3.5" />
              </button>
            )}
            {onSharePdf && (
              <button type="button" onClick={() => onSharePdf(quote)} title="Share PDF" className="p-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg">
                <Share2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {!isReadOnly && t.status !== 'CANCELLED' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => handleCreateTripDocument(t, 'INVOICE')}
              className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-semibold disabled:opacity-50"
            >
              {busy ? 'Working...' : 'Convert to Invoice'}
            </button>
          )}
        </div>
      );
    }

    if (!isReadOnly && t.status !== 'CANCELLED') {
      return (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => handleCreateTripDocument(t, 'QUOTE')}
            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-semibold disabled:opacity-50"
          >
            + Quote
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => handleCreateTripDocument(t, 'INVOICE')}
            className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-semibold disabled:opacity-50"
          >
            {busy ? 'Working...' : '+ Invoice'}
          </button>
        </div>
      );
    }

    return <span className="text-slate-400">-</span>;
  };

  return (
    <div className="space-y-5">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-3.5 sm:p-4">
          <p className="text-xs text-slate-500">Fleet Vehicles</p>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">{kpis.vehicles}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-3.5 sm:p-4">
          <p className="text-xs text-slate-500">Active Drivers</p>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">{kpis.drivers}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-3.5 sm:p-4">
          <p className="text-xs text-slate-500">Trips ({kpis.trips})</p>
          <p className="text-base sm:text-lg font-bold text-blue-600 mt-1">{currency} {kpis.totalFares.toLocaleString()}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-3.5 sm:p-4">
          <p className="text-xs text-slate-500">Fuel &amp; Fleet Costs</p>
          <p className="text-base sm:text-lg font-bold text-rose-600 mt-1">{currency} {kpis.totalCosts.toLocaleString()}</p>
        </div>
        <div className="col-span-2 md:col-span-1 bg-slate-900 text-white rounded-2xl p-3.5 sm:p-4">
          <p className="text-xs text-slate-300">Net Fleet Margin</p>
          <p className={`text-base sm:text-lg font-bold mt-1 ${kpis.margin >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {currency} {kpis.margin.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {(
          [
            { id: 'TRIPS', label: 'Trips & Charters', icon: MapPin },
            { id: 'FLEET', label: 'Fleet Vehicles', icon: Truck },
            { id: 'DRIVERS', label: 'Drivers', icon: Users },
            { id: 'COSTS', label: 'Fuel & Maintenance', icon: Fuel }
          ] as const
        ).map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 ${
                tab === t.id ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {errorMsg && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-700">{errorMsg}</div>
      )}

      {/* TRIPS */}
      {tab === 'TRIPS' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900">Trips &amp; Charters</h3>
            <button
              type="button"
              onClick={() => setShowWebhookInfo(v => !v)}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold"
            >
              {showWebhookInfo ? 'Hide Website API' : 'Connect Website Bookings'}
            </button>
          </div>

          {showWebhookInfo && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs space-y-2">
              <div className="font-semibold text-slate-800">Website Booking Webhook (Per-Business Key)</div>
              <div className="text-slate-600">
                POST bookings from any client website to{' '}
                <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200 font-mono">
                  https://biasharaledger.vercel.app/api/transport/bookings
                </code>{' '}
                with header <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200 font-mono">x-booking-key</code>:
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <code className="bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 font-mono text-[11px] break-all">
                  {bookingKey || 'Run 20261119_02 SQL migration to generate key'}
                </code>
                {bookingKey && (
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(bookingKey);
                      alert('Booking key copied.');
                    }}
                    className="px-2.5 py-1.5 bg-slate-900 text-white rounded-lg font-semibold"
                  >
                    Copy Key
                  </button>
                )}
              </div>
            </div>
          )}
          {!isReadOnly && (
            <form onSubmit={handleAddTrip} className="space-y-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
                <input type="date" required value={tripDate} onChange={e => setTripDate(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs" />
                <select
                  value={selectedCustomerId}
                  onChange={e => handleSelectCustomer(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs bg-white font-medium"
                >
                  <option value="NEW">+ New Customer (Save to Customers)</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.company_name ? `${c.name} (${c.company_name})` : c.name}
                    </option>
                  ))}
                </select>
                <input type="text" required placeholder="Origin (e.g. JKIA)" value={tripOrigin} onChange={e => setTripOrigin(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs" />
                <input type="text" required placeholder="Destination (e.g. Westlands)" value={tripDest} onChange={e => setTripDest(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs" />
              </div>

              {selectedCustomerId === 'NEW' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                  <input type="text" required placeholder="Contact Name" value={tripClient} onChange={e => setTripClient(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs bg-white" />
                  <input type="text" placeholder="Company Name (Optional)" value={tripClientCompany} onChange={e => setTripClientCompany(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs bg-white" />
                  <input type="tel" placeholder="Phone (e.g. 0712...)" value={tripClientPhone} onChange={e => setTripClientPhone(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs bg-white" />
                  <input type="email" placeholder="Email" value={tripClientEmail} onChange={e => setTripClientEmail(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs bg-white" />
                  <input type="text" placeholder="KRA PIN (Optional)" value={tripClientKraPin} onChange={e => setTripClientKraPin(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs bg-white" />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
                <select value={tripVehicleId} onChange={e => setTripVehicleId(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs bg-white">
                  <option value="">Select Vehicle (Optional)</option>
                  {vehicles.map(v => <option key={v.id} value={v.id}>{v.registration_no} ({v.make_model})</option>)}
                </select>
                <select value={tripDriverId} onChange={e => setTripDriverId(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs bg-white">
                  <option value="">Select Driver (Optional)</option>
                  {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                </select>
                <input type="number" required min="0" step="0.01" placeholder={`Agreed Fare (${currency})`} value={tripFare} onChange={e => setTripFare(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs" />
                <button type="submit" className="w-full px-3 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm sm:text-xs font-semibold">Schedule Trip</button>
              </div>
            </form>
          )}

          {/* Mobile Trip Cards */}
          <div className="md:hidden space-y-3">
            {trips.map(t => {
              const v = t.vehicle_id ? vehicleMap.get(t.vehicle_id) : undefined;
              const d = t.driver_id ? driverMap.get(t.driver_id) : undefined;
              const tripCost = costByTrip.get(t.id) || 0;
              return (
                <div key={t.id} className="border border-slate-200 rounded-xl p-3.5 space-y-2.5 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono font-bold text-slate-900">
                        {t.trip_code}
                        {t.source === 'WEBSITE' && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 font-bold text-[10px]">WEB</span>}
                      </div>
                      <div className="text-slate-400">{t.trip_date}</div>
                      {(t.pickup_time || t.requested_vehicle_type) && (
                        <div className="text-slate-400">
                          {t.pickup_time && `Pickup ${t.pickup_time}`}
                          {t.pickup_time && t.requested_vehicle_type && ' · '}
                          {t.requested_vehicle_type}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-slate-900">{currency} {Number(t.agreed_fare).toLocaleString()}</div>
                      <div className="text-rose-600">Cost: {currency} {tripCost.toLocaleString()}</div>
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-800">{t.client_name}</div>
                    <div className="text-slate-500">{t.origin} &rarr; {t.destination}</div>
                    <div className="text-slate-400 mt-0.5">
                      {v ? v.registration_no : 'No vehicle'} &middot; {d ? d.full_name : 'No driver'}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                    <select
                      disabled={isReadOnly}
                      value={t.status}
                      onChange={e => handleTripStatus(t.id, e.target.value as Trip['status'])}
                      className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white font-semibold"
                    >
                      <option value="ENQUIRY">ENQUIRY</option>
                      <option value="SCHEDULED">SCHEDULED</option>
                      <option value="IN_PROGRESS">IN_PROGRESS</option>
                      <option value="COMPLETED">COMPLETED</option>
                      <option value="CANCELLED">CANCELLED</option>
                    </select>
                    <div>{renderTripBilling(t)}</div>
                  </div>
                </div>
              );
            })}
            {trips.length === 0 && <p className="py-4 text-xs text-slate-400">No trips scheduled yet.</p>}
          </div>

          {/* Desktop Trip Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-2">Date / Code</th>
                  <th className="py-2 px-2">Client &amp; Route</th>
                  <th className="py-2 px-2">Vehicle / Driver</th>
                  <th className="py-2 px-2">Fare &amp; Costs</th>
                  <th className="py-2 px-2">Status</th>
                  <th className="py-2 px-2">Billing, PDF &amp; Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {trips.map(t => {
                  const v = t.vehicle_id ? vehicleMap.get(t.vehicle_id) : undefined;
                  const d = t.driver_id ? driverMap.get(t.driver_id) : undefined;
                  const tripCost = costByTrip.get(t.id) || 0;
                  return (
                    <tr key={t.id}>
                      <td className="py-2.5 px-2">
                        <div className="font-mono font-semibold">
                          {t.trip_code}
                          {t.source === 'WEBSITE' && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 font-bold text-[10px]">WEB</span>}
                        </div>
                        <div className="text-slate-400">{t.trip_date}</div>
                        {(t.pickup_time || t.requested_vehicle_type) && (
                          <div className="text-slate-400">
                            {t.pickup_time && `Pickup ${t.pickup_time}`}
                            {t.pickup_time && t.requested_vehicle_type && ' · '}
                            {t.requested_vehicle_type}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-2">
                        <div className="font-semibold text-slate-800">{t.client_name}</div>
                        <div className="text-slate-500">{t.origin} &rarr; {t.destination}</div>
                      </td>
                      <td className="py-2.5 px-2 text-slate-600">
                        <div>{v ? v.registration_no : '-'}</div>
                        <div className="text-slate-400">{d ? d.full_name : '-'}</div>
                      </td>
                      <td className="py-2.5 px-2">
                        <div className="font-semibold text-slate-900">{currency} {Number(t.agreed_fare).toLocaleString()}</div>
                        <div className="text-rose-600">Cost: {currency} {tripCost.toLocaleString()}</div>
                      </td>
                      <td className="py-2.5 px-2">
                        <select
                          disabled={isReadOnly}
                          value={t.status}
                          onChange={e => handleTripStatus(t.id, e.target.value as Trip['status'])}
                          className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white font-semibold"
                        >
                          <option value="ENQUIRY">ENQUIRY</option>
                          <option value="SCHEDULED">SCHEDULED</option>
                          <option value="IN_PROGRESS">IN_PROGRESS</option>
                          <option value="COMPLETED">COMPLETED</option>
                          <option value="CANCELLED">CANCELLED</option>
                        </select>
                      </td>
                      <td className="py-2.5 px-2">{renderTripBilling(t)}</td>
                    </tr>
                  );
                })}
                {trips.length === 0 && <tr><td colSpan={6} className="py-4 text-slate-400">No trips scheduled yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* FLEET */}
      {tab === 'FLEET' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">Fleet Registry &amp; Vehicle Unit Economics</h3>
          {!isReadOnly && (
            <form onSubmit={handleAddVehicle} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5">
              <input type="text" required placeholder="Reg No (e.g. KDK 123A)" value={regNo} onChange={e => setRegNo(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs uppercase" />
              <input type="text" required placeholder="Make & Model (e.g. Toyota Noah)" value={makeModel} onChange={e => setMakeModel(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs" />
              <select value={vehicleType} onChange={e => setVehicleType(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs bg-white">
                <option value="MPV">MPV</option>
                <option value="Van">Van</option>
                <option value="4x4 Land Cruiser">4x4 Land Cruiser</option>
                <option value="Bus">Bus</option>
                <option value="Sedan">Sedan</option>
                <option value="Truck">Truck</option>
              </select>
              <input type="number" min="1" placeholder="Seats / Capacity" value={capacity} onChange={e => setCapacity(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs" />
              <button type="submit" className="w-full px-3 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm sm:text-xs font-semibold">Add Vehicle</button>
            </form>
          )}

          {/* Mobile Fleet Cards */}
          <div className="md:hidden space-y-3">
            {vehicles.map(v => {
              const st = vehicleStats.get(v.id) ?? { revenue: 0, costs: 0, trips: 0 };
              const margin = st.revenue - st.costs;
              return (
                <div key={v.id} className="border border-slate-200 rounded-xl p-3.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="font-mono font-bold text-slate-900">{v.registration_no}</span>
                      <div className="text-slate-500">{v.make_model} ({v.vehicle_type})</div>
                    </div>
                    <select
                      disabled={isReadOnly}
                      value={v.status}
                      onChange={e => handleVehicleStatus(v.id, e.target.value as Vehicle['status'])}
                      className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white font-semibold"
                    >
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="MAINTENANCE">MAINTENANCE</option>
                      <option value="INACTIVE">INACTIVE</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100">
                    <div>
                      <div className="text-slate-400">Revenue</div>
                      <div className="font-semibold text-blue-600">{currency} {st.revenue.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Costs</div>
                      <div className="font-semibold text-rose-600">{currency} {st.costs.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Margin ({st.trips})</div>
                      <div className={`font-bold ${margin >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {currency} {margin.toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {vehicles.length === 0 && <p className="py-4 text-xs text-slate-400">No vehicles registered yet.</p>}
          </div>

          {/* Desktop Fleet Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-2">Vehicle</th>
                  <th className="py-2 px-2">Trips</th>
                  <th className="py-2 px-2">Revenue</th>
                  <th className="py-2 px-2">Direct Costs</th>
                  <th className="py-2 px-2">Net Margin</th>
                  <th className="py-2 px-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vehicles.map(v => {
                  const st = vehicleStats.get(v.id) ?? { revenue: 0, costs: 0, trips: 0 };
                  const margin = st.revenue - st.costs;
                  return (
                    <tr key={v.id}>
                      <td className="py-2.5 px-2">
                        <span className="font-mono font-bold text-slate-900">{v.registration_no}</span>
                        <span className="ml-2 text-slate-600">{v.make_model} ({v.vehicle_type})</span>
                      </td>
                      <td className="py-2.5 px-2">{st.trips}</td>
                      <td className="py-2.5 px-2 font-semibold text-blue-600">{currency} {st.revenue.toLocaleString()}</td>
                      <td className="py-2.5 px-2 text-rose-600">{currency} {st.costs.toLocaleString()}</td>
                      <td className={`py-2.5 px-2 font-bold ${margin >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {currency} {margin.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-2">
                        <select
                          disabled={isReadOnly}
                          value={v.status}
                          onChange={e => handleVehicleStatus(v.id, e.target.value as Vehicle['status'])}
                          className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white font-semibold"
                        >
                          <option value="ACTIVE">ACTIVE</option>
                          <option value="MAINTENANCE">MAINTENANCE</option>
                          <option value="INACTIVE">INACTIVE</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
                {vehicles.length === 0 && <tr><td colSpan={6} className="py-4 text-slate-400">No vehicles registered yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* DRIVERS */}
      {tab === 'DRIVERS' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">Drivers &amp; License Compliance</h3>
          {!isReadOnly && (
            <form onSubmit={handleAddDriver} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5">
              <input type="text" required placeholder="Full Name" value={driverName} onChange={e => setDriverName(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs" />
              <input type="text" placeholder="Phone (+254...)" value={driverPhone} onChange={e => setDriverPhone(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs" />
              <input type="text" placeholder="License No." value={licenseNo} onChange={e => setLicenseNo(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs" />
              <input type="date" value={licenseExpiry} onChange={e => setLicenseExpiry(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs" />
              <button type="submit" className="w-full px-3 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm sm:text-xs font-semibold">Add Driver</button>
            </form>
          )}
          <div className="divide-y divide-slate-100 text-xs">
            {drivers.map(d => {
              const alertState = licenseAlertStatus(d.license_expiry);
              return (
                <div key={d.id} className="py-2.5 flex flex-wrap justify-between items-center gap-2">
                  <div>
                    <span className="font-semibold text-slate-900">{d.full_name}</span>
                    <span className="ml-2 text-slate-500">
                      {d.phone || '-'} &middot; Lic: {d.license_no || '-'}
                      {d.license_expiry ? ` (Exp: ${d.license_expiry})` : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {alertState !== 'OK' && (
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold ${
                          alertState === 'EXPIRED' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        <AlertTriangle className="w-3 h-3" />
                        {alertState === 'EXPIRED' ? 'License Expired' : 'Expiring Soon'}
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded bg-slate-100 font-semibold">{d.status}</span>
                  </div>
                </div>
              );
            })}
            {drivers.length === 0 && <p className="text-slate-400">No drivers added yet.</p>}
          </div>
        </div>
      )}

      {/* FUEL & MAINTENANCE COSTS */}
      {tab === 'COSTS' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">Fuel, Maintenance &amp; Trip Costs (Auto-posts to Core GL)</h3>
          {!isReadOnly && (
            <form onSubmit={handleAddCost} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-2.5">
              <input type="date" required value={costDate} onChange={e => setCostDate(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs" />
              <select value={costType} onChange={e => setCostType(e.target.value as VehicleCost['cost_type'])} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs bg-white">
                <option value="FUEL">Fuel</option>
                <option value="MAINTENANCE">Maintenance</option>
                <option value="TOLL">Toll / Parking</option>
                <option value="DRIVER_ALLOWANCE">Driver Allowance</option>
                <option value="INSURANCE">Insurance</option>
                <option value="OTHER">Other</option>
              </select>
              <select value={costVehicleId} onChange={e => setCostVehicleId(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs bg-white">
                <option value="">Vehicle (Optional)</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.registration_no}</option>)}
              </select>
              <select value={costTripId} onChange={e => setCostTripId(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs bg-white">
                <option value="">Trip (Optional)</option>
                {trips.map(t => <option key={t.id} value={t.id}>{t.trip_code} ({t.client_name})</option>)}
              </select>
              <input type="number" required min="1" step="0.01" placeholder={`Amount (${currency})`} value={costAmount} onChange={e => setCostAmount(e.target.value)} className="w-full border border-slate-300 rounded-xl p-2.5 text-sm sm:text-xs" />
              <button type="submit" className="w-full px-3 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-sm sm:text-xs font-semibold">Log Cost</button>
            </form>
          )}
          <div className="divide-y divide-slate-100 text-xs">
            {costs.map(c => {
              const v = c.vehicle_id ? vehicleMap.get(c.vehicle_id) : undefined;
              return (
                <div key={c.id} className="py-2.5 flex justify-between items-center gap-2">
                  <span>
                    <strong>{c.cost_type}</strong> &middot; {c.cost_date}
                    {v ? ` · ${v.registration_no}` : ''}
                    {c.vendor ? ` (${c.vendor})` : ''}
                  </span>
                  <span className="font-semibold text-rose-600 shrink-0">{currency} {Number(c.amount_kes).toLocaleString()}</span>
                </div>
              );
            })}
            {costs.length === 0 && <p className="text-slate-400">No fleet costs logged yet.</p>}
          </div>
        </div>
      )}
    </div>
  );
}