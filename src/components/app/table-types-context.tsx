'use client';

import type { TableTypeDefinition } from '@/lib/types';
import { createContext, type ReactNode, useContext } from 'react';

const TableTypesContext = createContext<readonly TableTypeDefinition[]>([]);

export function TableTypesProvider({ tableTypes, children }: { tableTypes: readonly TableTypeDefinition[]; children: ReactNode }) {
	return <TableTypesContext value={tableTypes}>{children}</TableTypesContext>;
}

export function useTableTypes() {
	return useContext(TableTypesContext);
}
