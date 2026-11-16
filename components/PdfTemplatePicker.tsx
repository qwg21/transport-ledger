'use client';

import { Check } from 'lucide-react';

export type PdfTemplateOption = {
  id: 'MODERN' | 'CLASSIC' | 'MINIMAL' | 'BOUTIQUE' | 'CORPORATE';
  name: string;
  description: string;
};

const TEMPLATES: PdfTemplateOption[] = [
  { id: 'MODERN', name: 'Modern Executive', description: 'Top accent bar & bold header' },
  { id: 'CLASSIC', name: 'Classic Formal', description: 'Outlined badge & crisp rules' },
  { id: 'MINIMAL', name: 'Minimalist Clean', description: 'Airy layout, light ink' },
  { id: 'BOUTIQUE', name: 'Boutique Retail', description: 'Soft tinted header & warm footer' },
  { id: 'CORPORATE', name: 'Corporate & Stamp', description: 'Formal grid + signature line' }
];

type Props = {
  value: string;
  accentColor: string;
  onChange: (templateId: PdfTemplateOption['id']) => void;
};

export default function PdfTemplatePicker({ value, accentColor, onChange }: Props) {
  const color = accentColor || '#0f172a';

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-slate-600 block">PDF Template</label>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {TEMPLATES.map(tpl => {
          const active = (value || 'MODERN') === tpl.id;
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => onChange(tpl.id)}
              className={`text-left rounded-xl border p-2.5 transition relative ${
                active
                  ? 'border-blue-600 bg-blue-50/50 ring-2 ring-blue-100'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              {active && (
                <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-blue-600 text-white flex items-center justify-center">
                  <Check className="w-2.5 h-2.5" />
                </span>
              )}

              {/* Mini Layout Preview */}
              <div className="h-14 rounded-lg border border-slate-200 bg-white p-1.5 mb-2 flex flex-col justify-between overflow-hidden">
                {tpl.id === 'MODERN' && (
                  <>
                    <div className="h-1.5 w-full rounded-sm" style={{ backgroundColor: color }} />
                    <div className="flex justify-between items-center">
                      <div className="h-1.5 w-8 bg-slate-300 rounded" />
                      <div className="h-2 w-6 rounded-sm" style={{ backgroundColor: color }} />
                    </div>
                    <div className="h-2 w-full rounded-sm opacity-80" style={{ backgroundColor: color }} />
                  </>
                )}
                {tpl.id === 'CLASSIC' && (
                  <>
                    <div className="flex justify-between items-center">
                      <div className="h-1.5 w-9 bg-slate-400 rounded" />
                      <div className="h-2.5 w-7 rounded-sm border" style={{ borderColor: color }} />
                    </div>
                    <div className="h-[1px] w-full" style={{ backgroundColor: color }} />
                    <div className="h-2 w-full rounded-sm" style={{ backgroundColor: color }} />
                  </>
                )}
                {tpl.id === 'MINIMAL' && (
                  <>
                    <div className="flex justify-between items-center">
                      <div className="h-1.5 w-8 bg-slate-300 rounded" />
                      <div className="h-1.5 w-6 rounded" style={{ backgroundColor: color }} />
                    </div>
                    <div className="h-[1px] w-full" style={{ backgroundColor: color }} />
                    <div className="h-1 w-10 bg-slate-200 rounded" />
                  </>
                )}
                {tpl.id === 'BOUTIQUE' && (
                  <>
                    <div className="h-3 w-full rounded-sm opacity-15" style={{ backgroundColor: color }} />
                    <div className="h-1.5 w-10 mx-auto rounded" style={{ backgroundColor: color }} />
                    <div className="h-1.5 w-full rounded-sm opacity-20" style={{ backgroundColor: color }} />
                  </>
                )}
                {tpl.id === 'CORPORATE' && (
                  <>
                    <div className="flex justify-between items-center border-b border-slate-200 pb-1">
                      <div className="h-1.5 w-8 bg-slate-400 rounded" />
                      <div className="h-2 w-6 rounded-sm" style={{ backgroundColor: color }} />
                    </div>
                    <div className="h-1.5 w-full rounded-sm" style={{ backgroundColor: color }} />
                    <div className="flex justify-between pt-1">
                      <div className="h-[1px] w-6 bg-slate-400" />
                      <div className="h-[1px] w-6 bg-slate-400" />
                    </div>
                  </>
                )}
              </div>

              <div className="text-xs font-bold text-slate-900">{tpl.name}</div>
              <div className="text-[11px] text-slate-500 leading-tight">{tpl.description}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}