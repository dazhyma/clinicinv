declare module 'svg-to-pdfkit' {
  import type PDFDocument from 'pdfkit';

  export interface SVGtoPDFOptions {
    width?: number;
    height?: number;
    preserveAspectRatio?: string;
    fontCallback?: (family: string, bold: boolean, italic: boolean) => string;
  }

  export default function SVGtoPDF(
    document: PDFDocument,
    svg: string,
    x?: number,
    y?: number,
    options?: SVGtoPDFOptions,
  ): void;
}
