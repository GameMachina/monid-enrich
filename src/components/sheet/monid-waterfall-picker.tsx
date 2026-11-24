'use client';

import Image from 'next/image';
import { GripVertical } from 'lucide-react';
import { Sortable, SortableItem, SortableItemHandle } from '@/components/ui/sortable';
import { HelpTooltip } from '@/components/ui/help-tooltip';

export interface WaterfallProviderInfo { name: string; baseUsd: number; logo?: string }

/** Ordered provider picker for Monid-routed operations. */
export function MonidWaterfallPicker<T extends string>({ value, providers, info, onChange, label = 'Providers, in order' }: {
	value: T[];
	providers: readonly T[];
	info: Record<T, WaterfallProviderInfo>;
	onChange: (value: T[]) => void;
	label?: string;
}) {
	const order = [...value, ...providers.filter((provider) => !value.includes(provider))];
	const enabled = new Set(value);
	return <div className="w-full">
		<div className="flex items-center gap-1 pb-1 text-body-sm">{label}<HelpTooltip label="About Monid provider waterfalls">
			<span>Providers run from top to bottom and stop at the first match. Drag to reorder or uncheck providers to skip them.</span>
			<span>Monid bills the workspace wallet. A provider may charge for a no-match; prices shown are current starting estimates and the cell records actual usage.</span>
			<span>Only completed no-matches advance to the next provider. Errors and timeouts stop the waterfall to avoid duplicate charges.</span>
		</HelpTooltip></div>
		<Sortable value={order} onValueChange={(next) => onChange(next.filter((provider) => enabled.has(provider)))} getItemValue={(provider) => provider} className="space-y-0.5">
			{order.map((provider) => {
				const item = info[provider];
				return <SortableItem key={provider} value={provider} className="flex h-9 items-center gap-2 rounded-md border-0 bg-surface px-1 shadow-none ring-0 hover:bg-neutral-5">
					<SortableItemHandle render={<button type="button" />} aria-label={`Reorder ${item.name}`} className="grid size-6 touch-none place-items-center text-fg-subtle"><GripVertical className="size-3.5" /></SortableItemHandle>
					<Image src={item.logo ?? '/providers/monid.svg'} alt="" width={18} height={18} unoptimized className="size-[18px] rounded object-contain" />
					<span className="flex-1 truncate text-[12px]">{item.name}</span>
					<span className="text-[11px] tabular-nums text-fg-subtle">from ${item.baseUsd.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}</span>
					<input type="checkbox" aria-label={`Use ${item.name}`} checked={enabled.has(provider)} onChange={(event) => onChange(order.filter((entry) => entry === provider ? event.target.checked : enabled.has(entry)))} className="mx-1 size-3.5 accent-blue-600" />
				</SortableItem>;
			})}
		</Sortable>
	</div>;
}
