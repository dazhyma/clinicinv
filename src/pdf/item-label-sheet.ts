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

function titleFontSize(name: string): number {
  if (name.length > 70) return 5.5;
  if (name.length > 45) return 6.5;
  return 8;
}

function addLabel(
  doc: PDFKit.PDFDocument,
  item: ResolvedBulkLabels['items'][number],
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const padding = mm(1.8);
  const titleHeight = Math.min(mm(8), height * 0.26);
  const fontSize = titleFontSize(item.name);

  doc
    .fillColor('#000000')
    .font('Helvetica-Bold')
    .fontSize(fontSize)
    .text(item.name, x + padding, y + mm(1), {
      width: width - padding * 2,
      height: titleHeight,
      align: 'center',
      ellipsis: true,
      lineGap: 0,
    });

  SVGtoPDF(doc, item.labelSvg, x + padding, y + titleHeight, {
    width: width - padding * 2,
    height: height - titleHeight - mm(1.2),
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
