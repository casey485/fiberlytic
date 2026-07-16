// ---------------------------------------------------------------------------
// FiberLytic's own billing identity — printed in the header of a Field Map
// invoice export (see fieldMapExport.ts's drawInvoicePage) and used as the
// "Payable To" party on a customer invoice / "Bill To" party on a
// subcontractor's pay invoice. Test placeholder values — swap in the real
// business details before this goes out to an actual customer.
// ---------------------------------------------------------------------------

export const COMPANY_INFO = {
  name: 'FiberLytic Operations',
  addressLine1: '4200 Innovation Way, Suite 210',
  addressLine2: 'Knoxville, TN 37932',
  phone: '865-555-0142',
  email: 'billing@fiberlytic.com',
}
