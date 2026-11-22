import type { ColumnOp, FormulaSuggestion } from './types';

/** Runs larger than either limit ask before starting. */
export const CONFIRM_CELLS = 50;

type RunOp = ColumnOp | FormulaSuggestion | null | undefined;

/** Provider price varies by Monid endpoint and result; do not estimate it from the operation kind. */
export function creditsPerCell(op: RunOp): number { void op; return 0; }

export interface RunEstimate { cells: number; creditsPerCell: number; credits: number; confirm: boolean; message: string }

const count = (value: number, unit: string) => `${value.toLocaleString('en-US')} ${unit}${value === 1 ? '' : 's'}`;

/** The one confirmation rule for bulk runs, given how many cells each column runs. */
export function estimateCells(columns: ReadonlyArray<{ cells: number; op: RunOp }>): RunEstimate {
	const counted = columns.map(({ cells, op }) => ({ cells: Math.max(0, Math.floor(cells)), op }));
	const cells = counted.reduce((sum, column) => sum + column.cells, 0);
	const credits = 0;
	return {
		cells,
		creditsPerCell: 0,
		credits,
		confirm: cells > CONFIRM_CELLS,
		message: `~${count(cells, 'cell')}`,
	};
}

/** Whether a run asks before starting. `seen` is an estimate already shown (and accepted, if it asked): a run no bigger
    in cells or credits doesn't ask again. */
export function asksFirst(estimate: RunEstimate, seen?: RunEstimate): boolean {
	return estimate.confirm && !(seen && estimate.cells <= seen.cells && estimate.credits <= seen.credits);
}
