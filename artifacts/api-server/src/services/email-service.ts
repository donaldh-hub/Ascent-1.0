/**
 * Stubbed email service.
 *
 * No real email provider (Resend/SendGrid/SES) is configured yet in this
 * environment. To stay honest about what actually happens, this logs a
 * clearly-labeled "would have sent" message instead of silently pretending
 * to deliver an email, and reports back `stubbed: true` so callers can
 * surface that to the user.
 *
 * TODO: wire a real provider (Resend/SendGrid/SES) here once credentials are available.
 */
export async function sendReportEmail({
  to,
  senderNote,
  shareUrl,
  signalSummary,
}: {
  to: string;
  senderNote?: string;
  shareUrl: string;
  signalSummary: string;
}): Promise<{ sent: boolean; stubbed: boolean }> {
  console.log(
    `[EMAIL STUB] Would send to ${to}: "${senderNote ?? ""}" — link: ${shareUrl} — signals: ${signalSummary}`,
  );
  return { sent: false, stubbed: true };
}

export async function sendMagicLinkEmail({
  to,
  loginUrl,
}: {
  to: string;
  loginUrl: string;
}): Promise<{ sent: boolean; stubbed: boolean }> {
  console.log(`[EMAIL STUB] Would send login link to ${to}: ${loginUrl}`);
  return { sent: false, stubbed: true };
}

export async function sendIngestionCompleteEmail({
  to,
  fileName,
  totalRows,
}: {
  to: string;
  fileName: string;
  totalRows: number;
}): Promise<{ sent: boolean; stubbed: boolean }> {
  console.log(`[EMAIL STUB] Would notify ${to}: your emailed report "${fileName}" (${totalRows} rows) has been processed.`);
  return { sent: false, stubbed: true };
}

export async function sendApproachingTierEmail({
  to,
  unitCount,
  currentThreshold,
  nextTierLabel,
}: {
  to: string;
  unitCount: number;
  currentThreshold: number;
  nextTierLabel: string;
}): Promise<{ sent: boolean; stubbed: boolean }> {
  console.log(
    `[EMAIL STUB] Would notify ${to}: your site currently contains data for ${unitCount} unique units. When the aggregated count exceeds ${currentThreshold} units, your site will move to the ${nextTierLabel} data tier.`,
  );
  return { sent: false, stubbed: true };
}

export async function sendReportReminderEmail({
  to,
  propertyName,
}: {
  to: string;
  propertyName: string;
}): Promise<{ sent: boolean; stubbed: boolean }> {
  console.log(
    `[EMAIL STUB] Would send to ${to}: it's time to send this month's work order report for ${propertyName} — ` +
      `reply to this email with the export from your system attached (CSV or PDF).`,
  );
  return { sent: false, stubbed: true };
}

export async function sendPricingTierChangedEmail({
  to,
  previousTierLabel,
  newTierLabel,
  previousUnitCount,
  unitCount,
  previousMonthlyTotal,
  newMonthlyTotal,
  effectiveDate,
}: {
  to: string;
  previousTierLabel: string;
  newTierLabel: string;
  previousUnitCount: number;
  unitCount: number;
  previousMonthlyTotal: number;
  newMonthlyTotal: number;
  effectiveDate: string;
}): Promise<{ sent: boolean; stubbed: boolean }> {
  console.log(
    `[EMAIL STUB] Would notify ${to}: New records have increased your site's aggregated data count from ` +
      `${previousUnitCount} to ${unitCount} unique units, moving you from the ${previousTierLabel} tier to the ` +
      `${newTierLabel} unit data tier. ` +
      `Your monthly fee moves from $${previousMonthlyTotal} to $${newMonthlyTotal}, effective ${effectiveDate} ` +
      `(never retroactively). Review the units behind this count in your dashboard.`,
  );
  return { sent: false, stubbed: true };
}
