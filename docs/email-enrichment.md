# Email enrichment waterfall

Add → Add column → Email enrichment maps name, company domain, and optional company / LinkedIn columns. The compact picker saves enabled providers in drag order. Keyboard sorting uses Space, arrow keys, then Space. It stops at the first usable work email returned, regardless of verification status. No additional verification calls are made; the provider’s verification status is retained in result details. All steps request work email only; phone and personal-email add-ons are disabled.

## Choose the data provider

The column has a separate **Data provider** choice. Monid keeps its ordered provider waterfall and charges the workspace Monid wallet. Treg runs through Treg's own lookup endpoint and charges the connected Treg team's balance. Treg misses may have different billing behavior by operation; the column explains the cost rules before a run. Switching this choice does not move credentials, balances, or run history between providers.

Provider requests use server-side credentials. The browser receives connection status and masked metadata, never the saved key. The cell detail records the selected provider, returned sources/confidence, run status, and cost/usage when available. See [Treg provider support](treg-provider.md) for supported operations, billing, and current gaps.
