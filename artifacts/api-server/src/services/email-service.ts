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

export async function sendPricingTierChangedEmail({
  to,
  previousTierLabel,
  newTierLabel,
  newMonthlyTotal,
  unitCount,
}: {
  to: string;
  previousTierLabel: string;
  newTierLabel: string;
  newMonthlyTotal: number;
  unitCount: number;
}): Promise<{ sent: boolean; stubbed: boolean }> {
  console.log(
    `[EMAIL STUB] Would notify ${to}: your site's data now covers ${unitCount} units, moving you from the ${previousTierLabel}-unit tier to ${newTierLabel} ($${newMonthlyTotal}/mo).`,
  );
  return { sent: false, stubbed: true };
}
