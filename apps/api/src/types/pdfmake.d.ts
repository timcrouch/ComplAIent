/**
 * Minimal types for pdfmake 0.3.12, which ships none (and @types/pdfmake describes 0.2).
 * Only what src/reports/render uses; see docs/decisions/0012-report-files.md.
 */
declare module "pdfmake" {
  interface VirtualFileSystem {
    writeFileSync(filename: string, content: Buffer): void;
    existsSync(filename: string): boolean;
  }
  interface FontFamily {
    normal: string;
    bold: string;
    italics: string;
    bolditalics: string;
  }
  interface OutputDocument {
    getBuffer(): Promise<Buffer>;
  }
  interface PdfMake {
    virtualfs: VirtualFileSystem;
    setFonts(fonts: Record<string, FontFamily>): void;
    setUrlAccessPolicy(callback: (url: string) => boolean): void;
    setLocalAccessPolicy(callback: (path: string) => boolean): void;
    createPdf(docDefinition: object): OutputDocument;
  }
  const pdfmake: PdfMake;
  export default pdfmake;
}

/** pdfmake's bundled Roboto, as base64 strings by file name. */
declare module "pdfmake/build/vfs_fonts.js" {
  const vfs: Record<string, string>;
  export default vfs;
}
