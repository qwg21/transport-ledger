'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { todayLocal } from '@/lib/documents';
import { Truck, Users, MapPin, Fuel, AlertTriangle } from 'lucide-react';

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
  vehicle_id: string | null;
  driver_id: string | null;
  client_name: string;
  origin: string;
  destination: string;
  distance_km: number | null;
  agreed_fare: number;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
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
  isReadOnly: boolean;
  activeTab?: TransportTab;
  onTabChange?: (tab: TransportTab) => void;
};

function licenseAlertStatus(expiry: string | null): 'EXPIRED' | 'SOON' | 'OK' {
  if (!expiry) return 'OK';
  const today = todayLocal();
  if (expiry < today) return 'EXPIRED';
  const diffDays = (new Date(expiry).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24);
  return diffDays <= 30 ? 'SOON' : 'OK';
}

export default function TransportSection({ orgId, currency, isReadOnly, activeTab, onTabChange }: Props) {
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

  // Trip form
  const [tripDate, setTripDate] = useState(todayLocal);
  const [tripClient, setTripClient] = useState('');
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
      if (!active) return;
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

  const handleAddTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const code = `TRP-${tripDate.replace(/-/g, '')}-${String(trips.length + 1).padStart(3, '0')}`;
    const { error } = await supabase.from('trips').insert({
      org_id: orgId,
      trip_code: code,
      trip_date: tripDate,
      vehicle_id: tripVehicleId || null,
      driver_id: tripDriverId || null,
      client_name: tripClient.trim(),
      origin: tripOrigin.trim(),
      destination: tripDest.trim(),
      agreed_fare: Number(tripFare || 0)
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setTripClient('');
    setTripOrigin('');
    setTripDest('');
    setTripFare('');
    loadData();
  };

  const handleTripStatus = async (tripId: string, status: Trip['status']) => {
    const { error } = await supabase.from('trips').update({ status }).eq('id', tripId);
    if (error) setErrorMsg(error.message);
    else loadData();
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

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-xs text-slate-500">Fleet Vehicles</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{kpis.vehicles}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-xs text-slate-500">Active Drivers</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{kpis.drivers}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-xs text-slate-500">Trips ({kpis.trips})</p>
          <p className="text-lg font-bold text-blue-600 mt-1">{currency} {kpis.totalFares.toLocaleString()}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-xs text-slate-500">Fuel &amp; Fleet Costs</p>
          <p className="text-lg font-bold text-rose-600 mt-1">{currency} {kpis.totalCosts.toLocaleString()}</p>
        </div>
        <div className="col-span-2 md:col-span-1 bg-slate-900 text-white rounded-2xl p-4">
          <p className="text-xs text-slate-300">Net Fleet Margin</p>
          <p className={`text-lg font-bold mt-1 ${kpis.margin >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {currency} {kpis.margin.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="flex flex-wrap gap-2">
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
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold ${
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
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">Trips &amp; Charters</h3>
          {!isReadOnly && (
            <form onSubmit={handleAddTrip} className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <input type="date" required value={tripDate} onChange={e => setTripDate(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs" />
              <input type="text" required placeholder="Client / Passenger" value={tripClient} onChange={e => setTripClient(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs" />
              <input type="text" required placeholder="Origin (e.g. JKIA)" value={tripOrigin} onChange={e => setTripOrigin(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs" />
              <input type="text" required placeholder="Destination (e.g. Westlands)" value={tripDest} onChange={e => setTripDest(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs" />
              <select value={tripVehicleId} onChange={e => setTripVehicleId(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs bg-white">
                <option value="">Select Vehicle (Optional)</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.registration_no} ({v.make_model})</option>)}
              </select>
              <select value={tripDriverId} onChange={e => setTripDriverId(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs bg-white">
                <option value="">Select Driver (Optional)</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
              </select>
              <input type="number" required min="0" step="0.01" placeholder={`Agreed Fare (${currency})`} value={tripFare} onChange={e => setTripFare(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs" />
              <button type="submit" className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold">Schedule Trip</button>
            </form>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-2">Date / Code</th>
                  <th className="py-2 px-2">Client &amp; Route</th>
                  <th className="py-2 px-2">Vehicle / Driver</th>
                  <th className="py-2 px-2">Fare</th>
                  <th className="py-2 px-2">Trip Costs</th>
                  <th className="py-2 px-2">Status</th>
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
                        <div className="font-mono font-semibold">{t.trip_code}</div>
                        <div className="text-slate-400">{t.trip_date}</div>
                      </td>
                      <td className="py-2.5 px-2">
                        <div className="font-semibold text-slate-800">{t.client_name}</div>
                        <div className="text-slate-500">{t.origin} &rarr; {t.destination}</div>
                      </td>
                      <td className="py-2.5 px-2 text-slate-600">
                        <div>{v ? v.registration_no : '-'}</div>
                        <div className="text-slate-400">{d ? d.full_name : '-'}</div>
                      </td>
                      <td className="py-2.5 px-2 font-semibold">{currency} {Number(t.agreed_fare).toLocaleString()}</td>
                      <td className="py-2.5 px-2 text-rose-600">{currency} {tripCost.toLocaleString()}</td>
                      <td className="py-2.5 px-2">
                        <select
                          disabled={isReadOnly}
                          value={t.status}
                          onChange={e => handleTripStatus(t.id, e.target.value as Trip['status'])}
                          className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white font-semibold"
                        >
                          <option value="SCHEDULED">SCHEDULED</option>
                          <option value="IN_PROGRESS">IN_PROGRESS</option>
                          <option value="COMPLETED">COMPLETED</option>
                          <option value="CANCELLED">CANCELLED</option>
                        </select>
                      </td>
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
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">Fleet Registry &amp; Vehicle Unit Economics</h3>
          {!isReadOnly && (
            <form onSubmit={handleAddVehicle} className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
              <input type="text" required placeholder="Reg No (e.g. KDK 123A)" value={regNo} onChange={e => setRegNo(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs uppercase" />
              <input type="text" required placeholder="Make & Model (e.g. Toyota Noah)" value={makeModel} onChange={e => setMakeModel(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs" />
              <select value={vehicleType} onChange={e => setVehicleType(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs bg-white">
                <option value="MPV">MPV</option>
                <option value="Van">Van</option>
                <option value="4x4 Land Cruiser">4x4 Land Cruiser</option>
                <option value="Bus">Bus</option>
                <option value="Sedan">Sedan</option>
                <option value="Truck">Truck</option>
              </select>
              <input type="number" min="1" placeholder="Seats / Capacity" value={capacity} onChange={e => setCapacity(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs" />
              <button type="submit" className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold">Add Vehicle</button>
            </form>
          )}
          <div className="overflow-x-auto">
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
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">Drivers &amp; License Compliance</h3>
          {!isReadOnly && (
            <form onSubmit={handleAddDriver} className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
              <input type="text" required placeholder="Full Name" value={driverName} onChange={e => setDriverName(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs" />
              <input type="text" placeholder="Phone (+254...)" value={driverPhone} onChange={e => setDriverPhone(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs" />
              <input type="text" placeholder="License No." value={licenseNo} onChange={e => setLicenseNo(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs" />
              <input type="date" value={licenseExpiry} onChange={e => setLicenseExpiry(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs" />
              <button type="submit" className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold">Add Driver</button>
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
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">Fuel, Maintenance &amp; Trip Costs (Auto-posts to Core GL)</h3>
          {!isReadOnly && (
            <form onSubmit={handleAddCost} className="grid grid-cols-2 md:grid-cols-6 gap-2.5">
              <input type="date" required value={costDate} onChange={e => setCostDate(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs" />
              <select value={costType} onChange={e => setCostType(e.target.value as VehicleCost['cost_type'])} className="border border-slate-300 rounded-xl p-2 text-xs bg-white">
                <option value="FUEL">Fuel</option>
                <option value="MAINTENANCE">Maintenance</option>
                <option value="TOLL">Toll / Parking</option>
                <option value="DRIVER_ALLOWANCE">Driver Allowance</option>
                <option value="INSURANCE">Insurance</option>
                <option value="OTHER">Other</option>
              </select>
              <select value={costVehicleId} onChange={e => setCostVehicleId(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs bg-white">
                <option value="">Vehicle (Optional)</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.registration_no}</option>)}
              </select>
              <select value={costTripId} onChange={e => setCostTripId(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs bg-white">
                <option value="">Trip (Optional)</option>
                {trips.map(t => <option key={t.id} value={t.id}>{t.trip_code} ({t.client_name})</option>)}
              </select>
              <input type="number" required min="1" step="0.01" placeholder={`Amount (${currency})`} value={costAmount} onChange={e => setCostAmount(e.target.value)} className="border border-slate-300 rounded-xl p-2 text-xs" />
              <button type="submit" className="px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold">Log Cost</button>
            </form>
          )}
          <div className="divide-y divide-slate-100 text-xs">
            {costs.map(c => {
              const v = c.vehicle_id ? vehicleMap.get(c.vehicle_id) : undefined;
              return (
                <div key={c.id} className="py-2.5 flex justify-between items-center">
                  <span>
                    <strong>{c.cost_type}</strong> &middot; {c.cost_date}
                    {v ? ` · ${v.registration_no}` : ''}
                    {c.vendor ? ` (${c.vendor})` : ''}
                  </span>
                  <span className="font-semibold text-rose-600">{currency} {Number(c.amount_kes).toLocaleString()}</span>
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