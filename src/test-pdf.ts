/**
 * A one-page US Letter PDF using a standard font it doesn't embed. With
 * `editedBy`, an incremental save then rewrites its metadata, the way an
 * editing tool would.
 */
export function buildPdf({ editedBy }: { editedBy?: string } = {}) {
  const text = "BT /F1 28 Tf 72 700 Td (INVOICE 2231 Total 4950.00) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Producer (Acme Billing 4.2) /CreationDate (D:20260301090000Z) >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  if (editedBy) {
    const infoOffset = pdf.length;
    pdf += `6 0 obj\n<< /Producer (${editedBy}) /CreationDate (D:20260301090000Z) /ModDate (D:20260915184400Z) >>\nendobj\n`;
    const updateXref = pdf.length;
    pdf += `xref\n6 1\n${String(infoOffset).padStart(10, "0")} 00000 n \n`;
    pdf += `trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R /Prev ${xref} >>\nstartxref\n${updateXref}\n%%EOF\n`;
  }

  return pdf;
}
