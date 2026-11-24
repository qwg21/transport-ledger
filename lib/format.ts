export function formatMoney(
  amount: number | string | null | undefined,
  currency = 'KES',
  options?: { compact?: boolean; decimals?: number }
): string {
  const num = Number(amount || 0);
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';

  if (options?.compact) {
    if (abs >= 1_000_000) {
      return `${sign}${currency} ${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    }
    if (abs >= 100_000) {
      return `${sign}${currency} ${(abs / 1_000).toFixed(0)}K`;
    }
    if (abs >= 10_000) {
      return `${sign}${currency} ${(abs / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
    }
  }

  const decimals = options?.decimals ?? 2;
  return `${sign}${currency} ${abs.toLocaleString('en-KE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })}`;
}

export type DatePreset = 'ALL' | 'THIS_MONTH' | 'LAST_MONTH' | 'YTD';

export function getDatePresetRange(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = now.getMonth();

  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  if (preset === 'THIS_MONTH') {
    return {
      from: fmt(new Date(yyyy, mm, 1)),
      to: fmt(new Date(yyyy, mm + 1, 0))
    };
  }
  if (preset === 'LAST_MONTH') {
    return {
      from: fmt(new Date(yyyy, mm - 1, 1)),
      to: fmt(new Date(yyyy, mm, 0))
    };
  }
  if (preset === 'YTD') {
    return {
      from: fmt(new Date(yyyy, 0, 1)),
      to: fmt(now)
    };
  }
  return { from: '', to: '' };
}
