declare module "pdf-parse/lib/pdf-parse.js" {
  type ParseResult = { text: string };
  function parsePdf(dataBuffer: Buffer, options?: { max?: number }): Promise<ParseResult>;
  export default parsePdf;
}
