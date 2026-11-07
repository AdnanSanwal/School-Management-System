export const EXAM_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Draft', cls: 'badge-gray' },
  SCHEDULED: { label: 'Scheduled · marks open', cls: 'badge-blue' },
  PUBLISHED: { label: 'Results published', cls: 'badge-green' },
};

/** Opens a report-card PDF via a short-lived signed link. */
export async function openReportCard(getLink: () => Promise<{ url: string }>) {
  const w = window.open('', '_blank');
  try {
    const { url } = await getLink();
    if (w) w.location.href = url; else window.location.href = url;
  } catch (e) {
    w?.close();
    throw e;
  }
}
