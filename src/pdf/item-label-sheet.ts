import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import type { ResolvedBulkLabels } from '@/actions/item-labels';
import {
  LABEL_SHEET_GAP_MM,
  LABEL_SHEET_MARGIN_MM,
  LETTER_HEIGHT_MM,
  LETTER_WIDTH_MM,
} from '@/domain/label-sheet';

const MM_TO_POINTS = 72 / 25.4;
const mm = (value: number) => value * MM_TO_POINTS;

function addLabel(
  doc: PDFKit.PDFDocument,
  item: ResolvedBulkLabels['items'][number],
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const padding = mm(1.5);
  SVGtoPDF(doc, item.labelSvg, x + padding, y + padding, {
    width: width - padding * 2,
    height: height - padding * 2,
    preserveAspectRatio: 'xMidYMid meet',
    fontCallback: (family, bold) => {
      if (/mono/i.test(family)) return bold ? 'Courier-Bold' : 'Courier';
      return bold ? 'Helvetica-Bold' : 'Helvetica';
    },
  });
}

export async function createItemLabelSheetPdf(model: ResolvedBulkLabels): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      autoFirstPage: false,
      size: [mm(LETTER_WIDTH_MM), mm(LETTER_HEIGHT_MM)],
      margin: 0,
      info: {
        Title: 'Inventory Item Labels',
        Subject: `${model.layout.totalLabels} inventory item labels`,
        Creator: 'Clinic Inventory System',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const labelWidth = mm(model.layout.size.widthMm);
    const labelHeight = mm(model.layout.size.heightMm);
    const margin = mm(LABEL_SHEET_MARGIN_MM);
    const gap = mm(LABEL_SHEET_GAP_MM);
    let labelIndex = 0;

    for (const item of model.items) {
      for (let copy = 0; copy < item.copies; copy += 1) {
        if (labelIndex % model.layout.labelsPerPage === 0) {
          doc.addPage();
        }
        const pageIndex = labelIndex % model.layout.labelsPerPage;
        const column = pageIndex % model.layout.columns;
        const row = Math.floor(pageIndex / model.layout.columns);
        addLabel(
          doc,
          item,
          margin + column * (labelWidth + gap),
          margin + row * (labelHeight + gap),
          labelWidth,
          labelHeight,
        );
        labelIndex += 1;
      }
    }

    doc.end();
  });
}
