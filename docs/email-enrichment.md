# Email enrichment waterfall

Add → Add column → Email enrichment maps name, company domain, and optional company / LinkedIn columns. The compact picker saves enabled providers in drag order. Keyboard sorting uses Space, arrow keys, then Space. It stops at the first usable work email returned, regardless of verification status. No additional verification calls are made; the provider’s verification status is retained in result details. All steps request work email only; phone and personal-email add-ons are disabled.

## Choose the data provider

The column uses Monid's ordered provider waterfall and charges the connected workspace Monid wallet. The app does not call upstream email vendors directly; each selected route is submitted through Monid.

Provider requests use server-side credentials. The browser receives connection status and masked metadata, never the saved key. The cell detail records the selected route, returned sources/confidence, Monid run status, and cost/usage when available. Historical Treg receipts remain read-only.
